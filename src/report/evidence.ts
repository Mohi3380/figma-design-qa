/**
 * Layer B (spec §6.5-B): region pixel diff + evidence images.
 *
 * Takes the Layer A `ComparisonReport` and the two renders (Figma frame PNG,
 * full-page screenshot) and:
 *
 *  1. evaluates every `visual` pointer Layer A emitted as `skipped` —
 *     crop design region ↔ crop live region → pixelmatch mismatch %,
 *     gated by `tolerances.visualMismatchPct`;
 *  2. attaches evidence crops to every issue (design / live / diff for
 *     visual failures; the design crop and the live crop *at the expected
 *     location* for missing elements — showing what should be there);
 *  3. recounts the summary, since step 1 changed evaluation results.
 *
 * Coordinates: the frame PNG is rendered at 1x, so design bboxes map to it
 * frame-relative (canvas bbox − frame origin), unscaled. The screenshot is
 * DPR-1 page pixels, so live bboxes map 1:1. The design crop is resized to
 * the live crop's dimensions before diffing (inside diffRegions).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PNG } from 'pngjs';
import type {
  BBox,
  ComparisonReport,
  DesignExtraction,
  Issue,
  LiveCapture,
  NormalizedNode,
  Severity,
} from '../types.js';
import { crop, diffRegions, readPng, writePng } from './images.js';

export interface EvidenceOptions {
  design: DesignExtraction;
  live: LiveCapture;
  /** Figma frame render at 1x (frame-pixel coordinates). */
  framePng: Buffer;
  /** Full-page screenshot at DPR 1 (page-pixel coordinates). */
  pagePng: Buffer;
  /** Directory the report lives in; evidence goes to `<outDir>/evidence/`. */
  outDir: string;
  /** Max % mismatching pixels before a visual pointer fails. */
  visualMismatchPct: number;
  log?: (message: string) => void;
}

export async function applyPixelDiff(
  report: ComparisonReport,
  options: EvidenceOptions,
): Promise<void> {
  const log = options.log ?? (() => {});
  const frame = readPng(options.framePng);
  const page = readPng(options.pagePng);

  const evidenceDir = path.join(options.outDir, 'evidence');
  await mkdir(evidenceDir, { recursive: true });

  const designById = indexById(options.design.tree);
  const liveById = indexById(options.live.tree);
  const frameOrigin = options.design.tree.bbox;

  /** Design bbox → frame-PNG pixel coordinates (1x render, no scale). */
  const designRegion = (id: string | undefined): PNG | null => {
    const bbox = id ? designById.get(id)?.bbox : undefined;
    if (!bbox) return null;
    return crop(frame, rebase(bbox, frameOrigin));
  };
  /** Live bbox → screenshot pixel coordinates (already page pixels). */
  const liveRegion = (id: string | undefined): PNG | null => {
    const bbox = id ? liveById.get(domSelector(id))?.bbox : undefined;
    return bbox ? crop(page, bbox) : null;
  };
  /** Where a missing design element *should* sit on the live page. */
  const expectedLiveRegion = (id: string | undefined): PNG | null => {
    const bbox = id ? designById.get(id)?.bbox : undefined;
    if (!bbox) return null;
    const rel = rebase(bbox, frameOrigin);
    return crop(page, {
      x: rel.x * report.scale,
      y: rel.y * report.scale,
      width: rel.width * report.scale,
      height: rel.height * report.scale,
    });
  };

  const files = new Map<string, Buffer>(); // relative path → bytes, deduped
  const save = (name: string, png: PNG | null): string | undefined => {
    if (!png) return undefined;
    const rel = path.join('evidence', `${name}.png`);
    if (!files.has(rel)) files.set(rel, writePng(png));
    return rel;
  };

  // 1. Evaluate the visual pointers Layer A deferred.
  let visualChecked = 0;
  for (const evaluation of report.evaluations) {
    if (evaluation.pointer !== 'visual' || evaluation.result !== 'skipped') continue;
    const design = designRegion(evaluation.figmaNodeId);
    const live = liveRegion(evaluation.selector ?? '');
    if (!design || !live) {
      evaluation.note = 'region not croppable (outside the rendered image)';
      continue;
    }

    const result = diffRegions(design, live);
    visualChecked++;
    evaluation.result = result.mismatchPct <= options.visualMismatchPct ? 'pass' : 'fail';
    evaluation.expected = `≤ ${options.visualMismatchPct}% differing pixels`;
    evaluation.actual = `${result.mismatchPct}% differ`;
    evaluation.tolerance = `${options.visualMismatchPct}%`;
    evaluation.delta = result.mismatchPct;
    delete evaluation.note;

    if (evaluation.result === 'fail') {
      const slug = fileSlug(evaluation.figmaNodeId ?? evaluation.elementName);
      report.issues.push({
        id: uniqueIssueId(`${fileSlug(evaluation.elementName)}-visual`, report.issues),
        elementName: evaluation.elementName,
        pointer: 'visual',
        severity: visualSeverity(result.mismatchPct, options.visualMismatchPct),
        expected: evaluation.expected,
        actual: evaluation.actual,
        tolerance: evaluation.tolerance,
        viewport: report.live.viewport.width,
        figmaNodeId: evaluation.figmaNodeId,
        selector: evaluation.selector,
        explanation: `"${evaluation.elementName}" renders ${result.mismatchPct}% different pixels than the design region.`,
        confidence: pairConfidence(report, evaluation.figmaNodeId),
        evidence: {
          design: save(`${slug}-design`, result.design),
          live: save(`${slug}-live`, result.live),
          diff: save(`${slug}-diff`, result.diff),
        },
      });
    }
  }
  log(`Pixel-diffed ${visualChecked} regions`);

  // 2. Attach evidence crops to the Layer A issues.
  for (const issue of report.issues) {
    if (issue.evidence) continue; // visual issues already carry theirs
    const slug = fileSlug(issue.figmaNodeId ?? issue.selector ?? issue.id);
    const design = save(`${slug}-design`, designRegion(issue.figmaNodeId));
    // For "missing element" issues there is no live element — show the live
    // page at the location the design expects it, which is the actual story.
    const live =
      issue.pointer === 'existence' && issue.figmaNodeId && !issue.selector
        ? save(`${slug}-expected-location`, expectedLiveRegion(issue.figmaNodeId))
        : save(`${slug}-live`, liveRegion(issue.selector ?? ''));
    if (design || live) {
      issue.evidence = {};
      if (design) issue.evidence.design = design;
      if (live) issue.evidence.live = live;
    }
  }

  await Promise.all(
    [...files].map(([rel, bytes]) => writeFile(path.join(options.outDir, rel), bytes)),
  );
  log(`Wrote ${files.size} evidence images to ${evidenceDir}`);

  // 3. Recount the summary — step 1 flipped skipped → pass/fail.
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const issue of report.issues) bySeverity[issue.severity]++;
  report.summary = {
    pointersChecked: report.evaluations.length,
    passed: report.evaluations.filter((e) => e.result === 'pass').length,
    failed: report.evaluations.filter((e) => e.result === 'fail').length,
    skipped: report.evaluations.filter((e) => e.result === 'skipped').length,
    issuesBySeverity: bySeverity,
  };
}

function visualSeverity(mismatchPct: number, tolerance: number): Severity {
  if (mismatchPct <= tolerance * 1.25) return 'low'; // barely over — likely rendering noise
  return mismatchPct > tolerance * 3 ? 'high' : 'medium';
}

function indexById(root: NormalizedNode): Map<string, NormalizedNode> {
  const map = new Map<string, NormalizedNode>();
  const walk = (node: NormalizedNode) => {
    map.set(node.id, node);
    node.children.forEach(walk);
  };
  walk(root);
  return map;
}

/** Synthetic TEXT nodes ("#sel::text") have glyph-tight boxes; for *visual*
 * evidence the carrier element's box is the honest region to show. */
function domSelector(id: string): string {
  return id.replace(/::text$/, '');
}

function rebase(box: BBox, origin: BBox | null): BBox {
  return { x: box.x - (origin?.x ?? 0), y: box.y - (origin?.y ?? 0), width: box.width, height: box.height };
}

function pairConfidence(report: ComparisonReport, figmaNodeId: string | undefined): number {
  return report.matching.pairs.find((p) => p.figmaNodeId === figmaNodeId)?.confidence ?? 1;
}

function fileSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'region';
}

function uniqueIssueId(base: string, issues: Issue[]): string {
  const used = new Set(issues.map((i) => i.id));
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  return id;
}
