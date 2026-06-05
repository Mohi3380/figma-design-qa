#!/usr/bin/env node
/**
 * design-qa CLI (spec §5).
 *
 * Phase 1 ships `extract` (Figma → normalized tree + PNG).
 * Phase 2 ships `capture` (live URL → normalized tree + screenshots).
 * The `run` command (extract + capture + compare + report) arrives with
 * later phases; its flags are reserved here so the contract is visible.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { Command } from 'commander';
import { compare } from './compare/engine.js';
import { loadConfig, ConfigError } from './config.js';
import { FigmaClient, FigmaApiError } from './figma/api.js';
import { extractFrame } from './figma/extractor.js';
import { parseFigmaUrl, normalizeNodeId, FigmaUrlError } from './figma/url.js';
import type { DesignExtraction, LiveCapture, Severity } from './types.js';
import { captureUrl, WebCaptureError } from './web/capturer.js';

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
  .action(async (opts: { figma?: string; fileKey?: string; nodeId?: string; config: string; out: string }) => {
    try {
      const config = await loadConfig(opts.config);

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
  .action(async (opts: { target?: string; viewports?: string; config: string; out: string }) => {
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
        log: (msg) => console.log(`▸ ${msg}`),
      });

      console.log(`\n✔ Captured ${target} at ${results.length} viewport(s)`);
      for (const r of results) {
        console.log(`  ${r.capture.viewport.width}px  tree: ${r.treePath}`);
        console.log(`         shot: ${r.screenshotPath}`);
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('compare')
  .description('Compare an extracted design tree against a captured live tree (Layer A spec diff).')
  .requiredOption('--design <path>', 'design-tree-*.json from `design-qa extract`')
  .requiredOption('--live <path>', 'live-tree-*.json from `design-qa capture`')
  .option('--config <path>', 'Path to design-qa.config.json', 'design-qa.config.json')
  .option('--out <path>', 'Report JSON output path', './design-qa-output/report.json')
  .action(async (opts: { design: string; live: string; config: string; out: string }) => {
    try {
      const config = await loadConfig(opts.config);
      const design = await readArtifact<DesignExtraction>(opts.design, 'tree');
      const live = await readArtifact<LiveCapture>(opts.live, 'tree');

      console.log(`▸ Comparing "${design.frameName}" ↔ ${live.url} @ ${live.viewport.width}px…`);
      const report = compare(design, live, config);

      for (const warning of report.warnings) console.warn(`⚠ ${warning}`);

      const { summary, matching } = report;
      console.log(
        `▸ Matched ${matching.matched} pairs · ${matching.designOnly} design-only · ${matching.liveOnly} DOM-only`,
      );

      await writeFile(opts.out, JSON.stringify(report, null, 2), 'utf8');

      console.log(`\n✔ Report ready: ${opts.out}`);
      console.log(
        `  ${summary.pointersChecked} pointers checked · ${summary.passed} passed · ` +
          `${summary.failed} failed · ${summary.skipped} deferred to later phases`,
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
          console.log(`  ${badge(severity)} [${issue.pointer}] ${issue.elementName}${detail}`);
        }
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('run')
  .description('Full pipeline: extract + capture + compare + report. (Arrives in later phases.)')
  .option('--figma <url>', 'Figma frame URL')
  .option('--target <url>', 'Live page URL')
  .action(() => {
    fail(
      '`design-qa run` is not implemented yet — chain `design-qa extract` (Figma), `design-qa capture` (live page), and `design-qa compare` (spec diff). The one-command pipeline arrives with the HTML report (Phase 4). See the spec, §10.',
    );
  });

function handleError(err: unknown): never {
  if (
    err instanceof ConfigError ||
    err instanceof FigmaUrlError ||
    err instanceof FigmaApiError ||
    err instanceof WebCaptureError
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

program.parseAsync(process.argv);
