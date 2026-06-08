/**
 * comparison-engine, Layer A (spec §6.5): deterministic spec/token diff.
 *
 * match → evaluate pointers per pair → grade failures into issues (§7).
 * Layers B (pixel) and C (vision) bolt on in Phases 4–5; they consume the
 * same `ComparisonReport` and refine it, so this report shape is already
 * the §8 canonical `report.json`.
 *
 * Severity (§7, defaults): missing element → critical; wrong text on an
 * interactive element (CTA) → critical, other text → high; color → high;
 * font family/size → high, weight/line-height → medium; position/size
 * scaled by magnitude (>16px high, else medium); spacing → medium; barely
 * out of tolerance (≤1.25×) → low; extra-in-DOM → info.
 */
import type { DesignQaConfig } from '../config.js';
import type {
  BBox,
  ComparisonReport,
  DesignExtraction,
  Issue,
  LiveCapture,
  MatchedPair,
  NormalizedNode,
  PointerEvaluation,
  Severity,
} from '../types.js';
import { matchTrees } from './matcher.js';
import { evaluatePair } from './pointers.js';

export function compare(
  design: DesignExtraction,
  live: LiveCapture,
  config: DesignQaConfig,
): ComparisonReport {
  const warnings: string[] = [];

  const designBox = design.tree.bbox;
  const liveBox = live.tree.bbox;
  const scale = designBox && liveBox && designBox.width > 0 ? liveBox.width / designBox.width : 1;
  if (Math.abs(scale - 1) > 0.25) {
    warnings.push(
      `Design frame is ${designBox?.width}px wide but the live page is ${liveBox?.width}px — ` +
        `position/size checks are scaled by ${round2(scale)} and may be unreliable. ` +
        `Compare each viewport against a matching design frame (spec §11).`,
    );
  }

  const match = matchTrees(design.tree, live.tree, {
    mappingAttribute: config.matching.preferAttribute,
    scale,
  });

  // Pre-compute frame-relative boxes the way the matcher does, so pointer
  // evaluations and matching agree on coordinates. Design re-bases to the
  // frame's canvas origin; live boxes are already page coordinates — and the
  // page origin is (0,0), NOT body's bbox (margin collapse can push body's
  // own box down, which would shift every live position).
  const relBoxes = (pair: MatchedPair) => ({
    design: rebase(pair.design.bbox, designBox, scale),
    live: pair.live.bbox,
  });

  const evaluations: PointerEvaluation[] = [];
  for (const pair of match.pairs) {
    evaluations.push(
      ...evaluatePair(pair, { tolerances: config.tolerances, pointers: config.pointers, relBoxes }),
    );
  }

  // Missing elements (in design, not in DOM) — existence failures.
  if (config.pointers.includes('existence')) {
    for (const node of match.designOnly) {
      evaluations.push({
        pointer: 'existence',
        figmaNodeId: node.id,
        elementName: node.name,
        result: 'fail',
        expected: `${node.type} "${node.name}" present`,
        actual: 'no matching element in the DOM',
      });
    }
  }

  const pairByDesignId = new Map(match.pairs.map((p) => [p.design.id, p]));

  const issues: Issue[] = [];
  const usedIds = new Set<string>();
  for (const evaluation of evaluations) {
    if (evaluation.result !== 'fail') continue;
    const pair = evaluation.figmaNodeId ? pairByDesignId.get(evaluation.figmaNodeId) : undefined;
    issues.push(
      toIssue(evaluation, pair, live.viewport.width, config.tolerances, usedIds),
    );
  }

  // Extra-in-DOM (informational, spec §7 "info").
  for (const node of match.liveOnly) {
    issues.push({
      id: uniqueId(slug(`extra-${node.name}`), usedIds),
      elementName: node.name,
      pointer: 'existence',
      severity: 'info',
      expected: 'not in the design frame',
      actual: `${node.type} present at ${node.id}`,
      viewport: live.viewport.width,
      selector: node.id,
      explanation: `"${node.name}" exists in the DOM but has no counterpart in the design — possibly intentional (dynamic content), possibly unspecified UI.`,
      confidence: 1,
    });
  }

  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const issue of issues) bySeverity[issue.severity]++;

  return {
    design: { fileKey: design.fileKey, frameId: design.frameId, frameName: design.frameName },
    live: { url: live.url, viewport: live.viewport },
    comparedAt: new Date().toISOString(),
    scale: round2(scale),
    warnings,
    summary: {
      pointersChecked: evaluations.length,
      passed: evaluations.filter((e) => e.result === 'pass').length,
      failed: evaluations.filter((e) => e.result === 'fail').length,
      skipped: evaluations.filter((e) => e.result === 'skipped').length,
      issuesBySeverity: bySeverity,
    },
    matching: {
      matched: match.pairs.length,
      designOnly: match.designOnly.length,
      liveOnly: match.liveOnly.length,
      pairs: match.pairs.map((p) => ({
        figmaNodeId: p.design.id,
        selector: p.live.id,
        method: p.method,
        confidence: p.confidence,
      })),
    },
    evaluations,
    issues,
  };
}

function toIssue(
  e: PointerEvaluation,
  pair: MatchedPair | undefined,
  viewport: number,
  tolerances: DesignQaConfig['tolerances'],
  usedIds: Set<string>,
): Issue {
  return {
    id: uniqueId(slug(`${e.elementName}-${e.pointer}`), usedIds),
    elementName: e.elementName,
    pointer: e.pointer,
    severity: gradeSeverity(e, pair, tolerances),
    expected: e.expected,
    actual: e.actual,
    tolerance: e.tolerance,
    viewport,
    figmaNodeId: e.figmaNodeId,
    selector: e.selector,
    explanation: explain(e, pair),
    confidence: pair?.confidence ?? 1,
  };
}

/** Default severity rules (spec §7). The vision layer re-grades in Phase 5. */
function gradeSeverity(
  e: PointerEvaluation,
  pair: MatchedPair | undefined,
  tolerances: DesignQaConfig['tolerances'],
): Severity {
  const nearTolerance = (tolerance: number) =>
    e.delta !== undefined && tolerance > 0 && e.delta <= tolerance * 1.25;

  switch (true) {
    case e.pointer === 'existence':
      return 'critical';
    case e.pointer === 'text': {
      // Fuzzy: `delta` is the similarity (0..1). Reworded-but-close copy is a
      // medium drift; genuinely different copy is high (critical on a CTA).
      const similarity = e.delta ?? 0;
      if (similarity >= 0.6) return 'medium';
      return pair && isInteractive(pair.live) ? 'critical' : 'high';
    }
    case e.pointer === 'asset':
      return 'high'; // icon/image missing or not a graphic asset
    case e.pointer === 'asset.resolution':
      return 'medium'; // upscaled / pixelated image
    case e.pointer.startsWith('color'):
      return 'high';
    case e.pointer === 'typography.fontFamily' || e.pointer === 'typography.fontSize' || e.pointer === 'typography':
      return 'high';
    case e.pointer.startsWith('typography'):
      return 'medium';
    case e.pointer === 'position':
    case e.pointer === 'size': {
      const tolerance = e.pointer === 'position' ? tolerances.positionPx : tolerances.sizePx;
      if (nearTolerance(tolerance)) return 'low';
      return e.delta !== undefined && e.delta > 16 ? 'high' : 'medium';
    }
    case e.pointer.startsWith('spacing'):
      return nearTolerance(tolerances.spacingPx) ? 'low' : 'medium';
    default:
      return 'medium';
  }
}

/** A live element a user acts on — wrong copy here is a critical issue. */
function isInteractive(live: NormalizedNode): boolean {
  // live TEXT nodes are synthetic children: "#sel > button::text" → check the carrier
  const selector = live.id.replace(/::text$/, '');
  const tag = selector.split('>').pop()?.trim().split(/[.#:[]/)[0];
  return tag === 'button' || tag === 'a' || live.attributes?.role === 'button';
}

function explain(e: PointerEvaluation, pair: MatchedPair | undefined): string {
  const name = `"${e.elementName}"`;
  switch (true) {
    case e.pointer === 'existence':
      return `${name} is in the design but no matching element was found in the DOM.`;
    case e.pointer === 'text':
      return `${name} copy differs from the design — expected ${e.expected}, got ${e.actual} (${e.tolerance}).`;
    case e.pointer === 'asset':
      return `${name}: ${e.actual} — the design expects ${e.expected}.`;
    case e.pointer === 'asset.resolution':
      return `${name} image is ${e.actual} — it will look pixelated.`;
    case e.pointer === 'color.text':
      return `${name} text color drifts from the design (expected ${e.expected}, got ${e.actual}).`;
    case e.pointer === 'color.background':
      return `${name} background drifts from the design (expected ${e.expected}, got ${e.actual}).`;
    case e.pointer === 'color.border':
      return `${name} border color drifts from the design (expected ${e.expected}, got ${e.actual}).`;
    case e.pointer.startsWith('typography'):
      return `${name} ${e.pointer.split('.')[1] ?? 'typography'} differs: expected ${e.expected}, got ${e.actual}.`;
    case e.pointer === 'position':
      return `${name} sits at ${e.actual} instead of ${e.expected} (frame-relative).`;
    case e.pointer === 'size':
      return `${name} renders ${e.actual} instead of ${e.expected}.`;
    case e.pointer.startsWith('spacing'):
      return `${name} ${e.pointer.split('.')[1]} is ${e.actual}, design says ${e.expected}.`;
    default:
      return `${name}: expected ${e.expected}, got ${e.actual}.`;
  }
}

function rebase(box: BBox | null, origin: BBox | null, scale: number): BBox | null {
  if (!box) return null;
  const ox = origin?.x ?? 0;
  const oy = origin?.y ?? 0;
  return {
    x: (box.x - ox) * scale,
    y: (box.y - oy) * scale,
    width: box.width * scale,
    height: box.height * scale,
  };
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'issue'
  );
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
