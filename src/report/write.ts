/**
 * Report writer (spec §8): the two artifacts.
 *
 *  - report.json — canonical, machine-readable; evidence as relative paths.
 *  - report.html — human-facing, self-contained: every referenced evidence
 *    image is inlined as a data URI so the single file travels alone.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ComparisonReport } from '../types.js';
import { renderHtmlReport } from './html.js';

export interface WrittenReports {
  jsonPath: string;
  htmlPath?: string;
}

export async function writeReports(
  report: ComparisonReport,
  outDir: string,
  { html = true } = {},
): Promise<WrittenReports> {
  const jsonPath = path.join(outDir, 'report.json');
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  if (!html) return { jsonPath };

  // Inline every evidence image the issues reference.
  const images = new Map<string, string>();
  const rels = new Set<string>();
  for (const issue of report.issues) {
    for (const rel of Object.values(issue.evidence ?? {})) {
      if (rel) rels.add(rel);
    }
  }
  for (const rel of rels) {
    try {
      const bytes = await readFile(path.join(outDir, rel));
      images.set(rel, `data:image/png;base64,${bytes.toString('base64')}`);
    } catch {
      // Missing file → the <img> falls back to the relative path.
    }
  }

  const htmlPath = path.join(outDir, 'report.html');
  await writeFile(htmlPath, renderHtmlReport(report, { images }), 'utf8');
  return { jsonPath, htmlPath };
}
