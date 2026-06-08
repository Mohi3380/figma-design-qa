/**
 * The full pipeline as one reusable function (spec §14): two URLs in,
 * report out. Extracted from the CLI so both `design-qa run` and the web UI
 * (`design-qa serve`) drive the exact same path — no logic forks between them.
 *
 * `log` is the single progress channel: the CLI prints it to the terminal,
 * the web server streams it to the browser over SSE.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compare } from './compare/engine.js';
import { adjudicateIssues, VisionError } from './compare/vision.js';
import type { DesignQaConfig } from './config.js';
import { FigmaClient } from './figma/api.js';
import { extractFrame } from './figma/extractor.js';
import { parseFigmaUrl } from './figma/url.js';
import { applyPixelDiff } from './report/evidence.js';
import { renderPdf } from './report/pdf.js';
import { writeReports } from './report/write.js';
import type { ComparisonReport } from './types.js';

export class PipelineError extends Error {}

export interface RunPipelineOptions {
  figmaUrl: string;
  target: string;
  /** Capture width; defaults to the design frame's own width (spec §11). */
  viewport?: number;
  config: DesignQaConfig;
  outDir: string;
  /** Attempt Layer C when true and a key is present. */
  vision: boolean;
  /** Render report.pdf in addition to .html/.json. */
  pdf: boolean;
  figmaToken?: string;
  anthropicKey?: string;
  log?: (message: string) => void;
}

export interface RunPipelineResult {
  report: ComparisonReport;
  jsonPath: string;
  htmlPath?: string;
  pdfPath?: string;
  viewport: number;
}

export async function runPipeline(opts: RunPipelineOptions): Promise<RunPipelineResult> {
  const log = opts.log ?? (() => {});

  const ref = parseFigmaUrl(opts.figmaUrl);
  if (!ref.nodeId) {
    throw new PipelineError(
      'The Figma URL has no node-id — copy the frame link (right-click the frame → Copy link).',
    );
  }

  // FigmaClient throws a clear "Missing Figma token" error when empty.
  const client = new FigmaClient({ token: opts.figmaToken ?? '' });

  const extracted = await extractFrame({
    fileKey: ref.fileKey,
    nodeId: ref.nodeId,
    outDir: opts.outDir,
    client,
    log,
  });

  const frameWidth = Math.round(extracted.extraction.tree.bbox?.width ?? opts.config.viewports[0]);
  const viewport = opts.viewport ?? frameWidth;

  const { captureUrl } = await import('./web/capturer.js');
  const [captured] = await captureUrl({
    url: opts.target,
    viewports: [viewport],
    outDir: opts.outDir,
    mappingAttribute: opts.config.matching.preferAttribute,
    log,
  });

  log(`Comparing "${extracted.extraction.frameName}" ↔ ${opts.target} @ ${viewport}px…`);
  const report = compare(extracted.extraction, captured.capture, opts.config);

  await applyPixelDiff(report, {
    design: extracted.extraction,
    live: captured.capture,
    framePng: await readFile(extracted.pngPaths['1x']),
    pagePng: await readFile(captured.screenshotPath),
    outDir: opts.outDir,
    visualMismatchPct: opts.config.tolerances.visualMismatchPct,
    log,
  });

  if (opts.vision && opts.config.vision.enabled) {
    if (!opts.anthropicKey) {
      log('Skipping vision adjudication — no ANTHROPIC_API_KEY set.');
    } else {
      try {
        await adjudicateIssues(report, { model: opts.config.vision.model, outDir: opts.outDir, log });
      } catch (err) {
        if (err instanceof VisionError) log(`Vision adjudication skipped: ${err.message}`);
        else throw err;
      }
    }
  }

  const written = await writeReports(report, opts.outDir);
  let pdfPath: string | undefined;
  if (opts.pdf && written.htmlPath) {
    pdfPath = await renderPdf(written.htmlPath, path.join(opts.outDir, 'report.pdf'));
  }

  return { report, jsonPath: written.jsonPath, htmlPath: written.htmlPath, pdfPath, viewport };
}
