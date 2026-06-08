#!/usr/bin/env node
/**
 * design-qa CLI (spec §5).
 *
 * Phase 1 ships `extract` (Figma → normalized tree + PNG).
 * Phase 2 ships `capture` (live URL → normalized tree + screenshots).
 * The `run` command (extract + capture + compare + report) arrives with
 * later phases; its flags are reserved here so the contract is visible.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { loadDotenv } from './env.js';
import { compare } from './compare/engine.js';

// Pick up FIGMA_TOKEN / ANTHROPIC_API_KEY from a local .env before anything
// reads process.env. Real env vars still take precedence.
loadDotenv();
import { adjudicateIssues, VisionError } from './compare/vision.js';
import { loadConfig, ConfigError, type DesignQaConfig } from './config.js';
import { FigmaClient, FigmaApiError } from './figma/api.js';
import { extractFrame } from './figma/extractor.js';
import { mcpExtraction, McpParseError } from './figma/mcp.js';
import { parseFigmaUrl, normalizeNodeId, FigmaUrlError } from './figma/url.js';
import { runPipeline, PipelineError } from './pipeline.js';
import { applyPixelDiff } from './report/evidence.js';
import { renderPdf } from './report/pdf.js';
import { writeReports } from './report/write.js';
import type { ComparisonReport, DesignExtraction, LiveCapture, Severity } from './types.js';
import { captureUrl, WebCaptureError } from './web/capturer.js';
import { serve } from './web-ui/server.js';

const program = new Command();

program
  .name('design-qa')
  .description('Compare a Figma design against a live web app and report mismatches.')
  .version('0.1.0');

program
  .command('extract')
  .description('Extract a Figma frame into a normalized design tree (JSON) + frame PNGs.')
  .option('--figma <url>', 'Figma frame URL (https://figma.com/design/...?node-id=...)')
  .option('--file-key <key>', 'Figma file key (alternative to --figma)')
  .option('--node-id <id>', 'Figma node id, e.g. 12:345 or 12-345 (alternative to --figma)')
  .option('--config <path>', 'Path to design-qa.config.json', 'design-qa.config.json')
  .option('--out <dir>', 'Output directory', './design-qa-output')
  .option('--mcp-metadata <file>', 'Use Figma MCP get_metadata XML instead of the REST API (no token; geometry only)')
  .option('--frame-png <path>', 'Frame screenshot to record (required with --mcp-metadata)')
  .action(async (opts: { figma?: string; fileKey?: string; nodeId?: string; config: string; out: string; mcpMetadata?: string; framePng?: string }) => {
    try {
      const config = await loadConfig(opts.config);

      // MCP source (Phase 6): build the design tree from get_metadata XML +
      // a get_screenshot PNG, with no REST call and no personal-access token.
      if (opts.mcpMetadata) {
        await extractViaMcp(opts, config);
        return;
      }

      // Resolve fileKey/nodeId: explicit flags > --figma URL > config file.
      let fileKey = opts.fileKey;
      let nodeId = opts.nodeId ? normalizeNodeId(opts.nodeId) : undefined;
      if (opts.figma) {
        const ref = parseFigmaUrl(opts.figma);
        fileKey ??= ref.fileKey;
        nodeId ??= ref.nodeId;
      }
      fileKey ??= config.figma.fileKey;
      nodeId ??= config.figma.frames[0] ? normalizeNodeId(config.figma.frames[0]) : undefined;

      if (!fileKey || !nodeId) {
        fail(
          'Need a Figma frame to extract. Pass --figma "<frame url with ?node-id=…>", or --file-key + --node-id, or set figma.fileKey/figma.frames in the config.',
        );
      }

      const token = process.env.FIGMA_TOKEN ?? '';
      const client = new FigmaClient({ token });

      const result = await extractFrame({
        fileKey,
        nodeId,
        outDir: opts.out,
        client,
        log: (msg) => console.log(`▸ ${msg}`),
      });

      console.log(`\n✔ Extracted "${result.extraction.frameName}" (${nodeId})`);
      console.log(`  tree: ${result.treePath}`);
      console.log(`  png:  ${result.pngPaths['1x']} / ${result.pngPaths['2x']}`);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('capture')
  .description('Capture a live page into a normalized element tree (JSON) + screenshots per viewport.')
  .option('--target <url>', 'Live page URL (http://localhost:3000/signup, https://…)')
  .option('--viewports <widths>', 'Comma-separated viewport widths, e.g. 1440,768,375')
  .option('--config <path>', 'Path to design-qa.config.json', 'design-qa.config.json')
  .option('--out <dir>', 'Output directory', './design-qa-output')
  .option('--headed', 'Show the capture browser window (watch it run)')
  .option('--click <selector...>', 'After the base capture, click each selector and capture the resulting state (modals, menus)')
  .action(async (opts: { target?: string; viewports?: string; config: string; out: string; headed?: boolean; click?: string[] }) => {
    try {
      const config = await loadConfig(opts.config);

      // Resolve target/viewports: explicit flags > config file.
      const target =
        opts.target ??
        (config.target.baseUrl
          ? new URL(config.target.routes[0] ?? '/', config.target.baseUrl).toString()
          : undefined);
      if (!target) {
        fail('Need a page to capture. Pass --target "<url>" or set target.baseUrl in the config.');
      }

      let viewports = config.viewports;
      if (opts.viewports) {
        viewports = opts.viewports.split(',').map((v) => Number(v.trim()));
        if (viewports.some((v) => !Number.isInteger(v) || v <= 0)) {
          fail(`--viewports must be comma-separated positive integers, got "${opts.viewports}".`);
        }
      }

      const results = await captureUrl({
        url: target,
        viewports,
        outDir: opts.out,
        mappingAttribute: config.matching.preferAttribute,
        headed: opts.headed,
        interactions: (opts.click ?? []).map((click) => ({ click })),
        log: (msg) => console.log(`▸ ${msg}`),
      });

      console.log(`\n✔ Captured ${target} (${results.length} state/viewport file(s))`);
      for (const r of results) {
        const tag = r.state ? ` [${r.state}]` : '';
        console.log(`  ${r.capture.viewport.width}px${tag}  tree: ${r.treePath}`);
        console.log(`         shot: ${r.screenshotPath}`);
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('compare')
  .description('Compare an extracted design tree against a captured live tree (Layers A + B).')
  .requiredOption('--design <path>', 'design-tree-*.json from `design-qa extract`')
  .requiredOption('--live <path>', 'live-tree-*.json from `design-qa capture`')
  .option('--frame-png <path>', 'Figma frame render @1x (enables the pixel-diff layer)')
  .option('--page-png <path>', 'full-page screenshot from `design-qa capture`')
  .option('--config <path>', 'Path to design-qa.config.json', 'design-qa.config.json')
  .option('--out <dir>', 'Output directory for report.pdf/report.html/report.json', './design-qa-output')
  .option('--no-html', 'Skip the HTML report (implies --no-pdf)')
  .option('--no-pdf', 'Skip the PDF report')
  .option('--no-vision', 'Skip the vision adjudication layer')
  .action(
    async (opts: {
      design: string;
      live: string;
      framePng?: string;
      pagePng?: string;
      config: string;
      out: string;
      html: boolean;
      pdf: boolean;
      vision: boolean;
    }) => {
      try {
        const config = await loadConfig(opts.config);
        const design = await readArtifact<DesignExtraction>(opts.design, 'tree');
        const live = await readArtifact<LiveCapture>(opts.live, 'tree');

        console.log(`▸ Comparing "${design.frameName}" ↔ ${live.url} @ ${live.viewport.width}px…`);
        const report = compare(design, live, config);

        if (opts.framePng && opts.pagePng) {
          await applyPixelDiff(report, {
            design,
            live,
            framePng: await readFile(opts.framePng),
            pagePng: await readFile(opts.pagePng),
            outDir: opts.out,
            visualMismatchPct: config.tolerances.visualMismatchPct,
            log: (msg) => console.log(`▸ ${msg}`),
          });
        } else if (opts.framePng || opts.pagePng) {
          fail('Pixel diff needs BOTH --frame-png and --page-png.');
        }

        await maybeAdjudicate(report, config, opts.out, opts.vision);

        const written = await writeReports(report, opts.out, { html: opts.html });
        let headline = written.htmlPath ?? written.jsonPath;
        if (opts.pdf && written.htmlPath) {
          headline = await renderPdf(written.htmlPath, path.join(opts.out, 'report.pdf'));
        }
        printReport(report, headline);
      } catch (err) {
        handleError(err);
      }
    },
  );

program
  .command('run')
  .description('Full pipeline (spec §14): Figma URL + live URL in, report out.')
  .requiredOption('--figma <url>', 'Figma frame URL (https://figma.com/design/...?node-id=...)')
  .requiredOption('--target <url>', 'Live page URL')
  .option('--viewport <width>', 'Capture viewport width (default: the design frame\'s own width)')
  .option('--config <path>', 'Path to design-qa.config.json', 'design-qa.config.json')
  .option('--out <dir>', 'Output directory', './design-qa-output')
  .option('--no-pdf', 'Skip the PDF report')
  .option('--no-vision', 'Skip the vision adjudication layer')
  .option('--headed', 'Show the capture browser window (watch it run)')
  .action(
    async (opts: {
      figma: string;
      target: string;
      viewport?: string;
      config: string;
      out: string;
      pdf: boolean;
      vision: boolean;
      headed?: boolean;
    }) => {
      try {
        const config = await loadConfig(opts.config);
        let viewport: number | undefined;
        if (opts.viewport) {
          viewport = Number(opts.viewport);
          if (!Number.isInteger(viewport) || viewport <= 0) {
            fail(`--viewport must be a positive integer, got "${opts.viewport}".`);
          }
        }

        const result = await runPipeline({
          figmaUrl: opts.figma,
          target: opts.target,
          viewport,
          config,
          outDir: opts.out,
          vision: opts.vision,
          pdf: opts.pdf,
          headed: opts.headed,
          figmaToken: process.env.FIGMA_TOKEN,
          anthropicKey: process.env.ANTHROPIC_API_KEY,
          log: (msg) => console.log(`▸ ${msg}`),
        });
        printReport(result.report, result.pdfPath ?? result.htmlPath ?? result.jsonPath);
      } catch (err) {
        handleError(err);
      }
    },
  );

program
  .command('serve')
  .description('Launch the web UI: paste two URLs in the browser, view the report inline.')
  .option('--port <port>', 'Port to listen on', '4100')
  .option('--host <host>', 'Host to bind', '127.0.0.1')
  .option('--config <path>', 'Path to design-qa.config.json', 'design-qa.config.json')
  .option('--out <dir>', 'Output directory', './design-qa-output')
  .action(async (opts: { port: string; host: string; config: string; out: string }) => {
    const port = Number(opts.port);
    if (!Number.isInteger(port) || port <= 0) fail(`--port must be a positive integer, got "${opts.port}".`);
    await serve({ port, host: opts.host, configPath: opts.config, outDir: opts.out });
  });

/** Phase 6 MCP source: design tree from get_metadata XML + a get_screenshot
 * PNG. Writes the same design-tree artifact the REST `extract` produces. */
async function extractViaMcp(
  opts: { figma?: string; fileKey?: string; nodeId?: string; out: string; mcpMetadata?: string; framePng?: string },
  config: DesignQaConfig,
): Promise<void> {
  let fileKey = opts.fileKey;
  let nodeId = opts.nodeId ? normalizeNodeId(opts.nodeId) : undefined;
  if (opts.figma) {
    const ref = parseFigmaUrl(opts.figma);
    fileKey ??= ref.fileKey;
    nodeId ??= ref.nodeId;
  }
  fileKey ??= config.figma.fileKey;
  nodeId ??= config.figma.frames[0] ? normalizeNodeId(config.figma.frames[0]) : undefined;
  if (!nodeId) fail('Need a --node-id (or a --figma URL with node-id) to pick the frame from the MCP metadata.');
  if (!opts.framePng) fail('--mcp-metadata needs --frame-png <path> (the get_screenshot PNG of that node).');

  const raw = await readFile(opts.mcpMetadata!, 'utf8');
  const extraction = mcpExtraction(unwrapMcpResult(raw), nodeId, fileKey ?? 'mcp');

  await mkdir(opts.out, { recursive: true });
  const slug = nodeId.replace(/[^a-zA-Z0-9]+/g, '-');
  const treePath = path.join(opts.out, `design-tree-${slug}.json`);
  await writeFile(treePath, JSON.stringify(extraction, null, 2), 'utf8');
  const pngPath = path.join(opts.out, `frame-${slug}@1x.png`);
  await copyFile(opts.framePng!, pngPath);

  const count = countNodes(extraction.tree);
  console.log(`▸ Parsed MCP metadata → "${extraction.frameName}" (${nodeId}), ${count} nodes`);
  console.log(`\n✔ Extracted via Figma MCP (geometry only — no colors/typography)`);
  console.log(`  tree: ${treePath}`);
  console.log(`  png:  ${pngPath}`);
}

/** The MCP tool result is saved as JSON `[{type,text}]`; unwrap to the raw
 * XML. A plain .xml file passes through untouched. */
function unwrapMcpResult(raw: string): string {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const texts = arr
        .map((e: unknown) => (e && typeof (e as { text?: unknown }).text === 'string' ? (e as { text: string }).text : ''))
        .filter(Boolean);
      if (texts.length) return texts.join('\n');
    } catch {
      // not JSON — fall through and treat as raw XML
    }
  }
  return raw;
}

function countNodes(node: { children: unknown[] }): number {
  let n = 1;
  for (const child of node.children as { children: unknown[] }[]) n += countNodes(child);
  return n;
}

function handleError(err: unknown): never {
  if (
    err instanceof ConfigError ||
    err instanceof FigmaUrlError ||
    err instanceof FigmaApiError ||
    err instanceof WebCaptureError ||
    err instanceof PipelineError ||
    err instanceof McpParseError
  ) {
    fail(err.message);
  }
  throw err;
}

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

/** Read an extract/capture artifact, with a friendly error if it's not one. */
async function readArtifact<T>(path: string, requiredKey: string): Promise<T> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    fail(`Cannot read "${path}": ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(`"${path}" is not valid JSON.`);
  }
  if (parsed === null || typeof parsed !== 'object' || !(requiredKey in parsed)) {
    fail(`"${path}" doesn't look like a design-qa artifact (missing "${requiredKey}").`);
  }
  return parsed as T;
}

function badge(severity: Severity): string {
  return { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵', info: 'ℹ️' }[severity];
}

/** Run Layer C when enabled and possible; skip loudly, never fail the run —
 * the deterministic report is still valid without adjudication. */
async function maybeAdjudicate(
  report: ComparisonReport,
  config: DesignQaConfig,
  outDir: string,
  visionFlag: boolean,
): Promise<void> {
  if (!visionFlag || !config.vision.enabled) return;
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      '⚠ Skipping vision adjudication — set ANTHROPIC_API_KEY to enable it (or pass --no-vision to silence this).',
    );
    return;
  }
  try {
    await adjudicateIssues(report, {
      model: config.vision.model,
      outDir,
      log: (msg) => console.log(`▸ ${msg}`),
    });
  } catch (err) {
    if (err instanceof VisionError) {
      console.warn(`⚠ Vision adjudication skipped: ${err.message}`);
      return;
    }
    throw err;
  }
}

/** Shared console summary for `compare` and `run` (spec §14 shape). */
function printReport(report: ComparisonReport, reportPath: string): void {
  for (const warning of report.warnings) console.warn(`⚠ ${warning}`);

  const { summary, matching } = report;
  console.log(
    `▸ Matched ${matching.matched} pairs · ${matching.designOnly} design-only · ${matching.liveOnly} DOM-only`,
  );

  console.log(`\n✔ Report ready: ${reportPath}`);
  console.log(
    `  ${summary.pointersChecked} pointers checked · ${summary.passed} passed · ` +
      `${summary.failed} failed${summary.skipped ? ` · ${summary.skipped} deferred` : ''}`,
  );
  const s = summary.issuesBySeverity;
  console.log(
    `  Critical ${s.critical} · High ${s.high} · Medium ${s.medium} · Low ${s.low} · Info ${s.info}`,
  );

  const ordered: Severity[] = ['critical', 'high', 'medium', 'low'];
  for (const severity of ordered) {
    for (const issue of report.issues.filter((i) => i.severity === severity)) {
      const detail =
        issue.expected !== undefined ? ` — expected ${issue.expected}, got ${issue.actual}` : '';
      const verdict =
        issue.adjudication?.verdict === 'noise'
          ? ` (noise, was ${issue.adjudication.previousSeverity})`
          : '';
      console.log(`  ${badge(severity)} [${issue.pointer}] ${issue.elementName}${detail}${verdict}`);
    }
  }
}

program.parseAsync(process.argv);
