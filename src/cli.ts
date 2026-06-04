#!/usr/bin/env node
/**
 * design-qa CLI (spec §5).
 *
 * Phase 1 ships the `extract` command (Figma → normalized tree + PNG).
 * The `run` command (extract + capture + compare + report) arrives with
 * later phases; its flags are reserved here so the contract is visible.
 */
import { Command } from 'commander';
import { loadConfig, ConfigError } from './config.js';
import { FigmaClient, FigmaApiError } from './figma/api.js';
import { extractFrame } from './figma/extractor.js';
import { parseFigmaUrl, normalizeNodeId, FigmaUrlError } from './figma/url.js';

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
  .command('run')
  .description('Full pipeline: extract + capture + compare + report. (Arrives in later phases.)')
  .option('--figma <url>', 'Figma frame URL')
  .option('--target <url>', 'Live page URL')
  .action(() => {
    fail('`design-qa run` is not implemented yet — Phase 1 ships `design-qa extract`. See the spec, §10.');
  });

function handleError(err: unknown): never {
  if (err instanceof ConfigError || err instanceof FigmaUrlError || err instanceof FigmaApiError) {
    fail(err.message);
  }
  throw err;
}

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

program.parseAsync(process.argv);
