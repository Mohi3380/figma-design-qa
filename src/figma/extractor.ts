/**
 * figma-extractor (spec §6.1): fileKey + nodeId in → normalized tree JSON
 * + frame PNGs (1x, 2x) on disk.
 *
 * Pure orchestration — fetching lives in api.ts, shaping in normalizer.ts —
 * so each piece stays independently testable.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DesignExtraction } from '../types.js';
import { FigmaClient } from './api.js';
import { normalizeTree } from './normalizer.js';

export interface ExtractOptions {
  fileKey: string;
  nodeId: string;
  outDir: string;
  client: FigmaClient;
  log?: (message: string) => void;
}

export interface ExtractResult {
  extraction: DesignExtraction;
  treePath: string;
  pngPaths: { '1x': string; '2x': string };
}

export async function extractFrame(options: ExtractOptions): Promise<ExtractResult> {
  const { fileKey, nodeId, outDir, client } = options;
  const log = options.log ?? (() => {});

  log(`Fetching node ${nodeId} from file ${fileKey}…`);
  const { node } = await client.getNode(fileKey, nodeId);

  log(`Normalizing "${node.name}" (${node.type})…`);
  const tree = normalizeTree(node);

  const extraction: DesignExtraction = {
    source: 'figma-rest',
    fileKey,
    frameId: nodeId,
    frameName: node.name,
    extractedAt: new Date().toISOString(),
    tree,
  };

  await mkdir(outDir, { recursive: true });
  const slug = `${nodeId.replace(/[^a-zA-Z0-9]+/g, '-')}`;

  const treePath = path.join(outDir, `design-tree-${slug}.json`);
  await writeFile(treePath, JSON.stringify(extraction, null, 2), 'utf8');
  log(`Wrote ${treePath}`);

  log('Rendering frame PNG (1x, 2x)…');
  const [png1x, png2x] = await Promise.all([
    client.renderNodePng(fileKey, nodeId, 1),
    client.renderNodePng(fileKey, nodeId, 2),
  ]);

  const png1xPath = path.join(outDir, `frame-${slug}@1x.png`);
  const png2xPath = path.join(outDir, `frame-${slug}@2x.png`);
  await Promise.all([writeFile(png1xPath, png1x), writeFile(png2xPath, png2x)]);
  log(`Wrote ${png1xPath}`);
  log(`Wrote ${png2xPath}`);

  return { extraction, treePath, pngPaths: { '1x': png1xPath, '2x': png2xPath } };
}
