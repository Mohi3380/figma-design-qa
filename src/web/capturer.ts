/**
 * web-capturer (spec §6.2): URL + viewports in → normalized live tree JSON
 * + full-page screenshot per viewport on disk.
 *
 * The Phase 2 mirror of `figma/extractor.ts`: pure orchestration. The
 * in-page collection lives in snapshot.ts and the shaping in normalizer.ts,
 * so this file is just Playwright plumbing.
 *
 * Readiness: `networkidle` + `document.fonts.ready` before snapshotting —
 * fonts swap late and would otherwise corrupt typography and text metrics
 * (spec §11: "load the same web fonts").
 *
 * Screenshots: one full-page PNG per viewport. Per-element crops are NOT
 * written here — Phase 4 (pixel diff) crops regions from the full page
 * using the bboxes already in the tree, which avoids hundreds of files
 * per run for elements that may never need visual evidence.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import type { LiveCapture } from '../types.js';
import { normalizeDomTree } from './normalizer.js';
import { CAPTURED_STYLES, snapshotDom, type RawDomNode } from './snapshot.js';

export class WebCaptureError extends Error {}

export interface CaptureOptions {
  url: string;
  /** Viewport widths to capture (spec §9 `viewports`). */
  viewports: number[];
  outDir: string;
  /** Attribute that explicitly maps DOM elements to Figma nodes (§6.3). */
  mappingAttribute: string;
  /** Injectable for tests; defaults to launching headless Chromium. */
  browser?: Browser;
  log?: (message: string) => void;
}

export interface ViewportCapture {
  capture: LiveCapture;
  treePath: string;
  screenshotPath: string;
}

/** Viewport heights are nominal — full-page snapshot/screenshot capture
 * everything below the fold anyway. 16:10-ish desktop, common device sizes. */
const VIEWPORT_HEIGHTS: Record<number, number> = { 1440: 900, 768: 1024, 375: 812 };

export async function captureUrl(options: CaptureOptions): Promise<ViewportCapture[]> {
  const { url, viewports, outDir, mappingAttribute } = options;
  const log = options.log ?? (() => {});

  await mkdir(outDir, { recursive: true });

  const browser = options.browser ?? (await chromium.launch());
  const ownsBrowser = !options.browser;
  try {
    const results: ViewportCapture[] = [];
    for (const width of viewports) {
      const height = VIEWPORT_HEIGHTS[width] ?? Math.round((width * 10) / 16);
      log(`Capturing ${url} at ${width}×${height}…`);

      const page = await browser.newPage({ viewport: { width, height } });
      try {
        // tsx/esbuild compile with keepNames, which sprinkles `__name(...)`
        // helper calls into the serialized snapshotDom source. The helper
        // doesn't exist in the page, so shim it before any evaluate runs.
        await page.addInitScript({ content: 'globalThis.__name = (fn) => fn;' });
        await page.goto(url, { waitUntil: 'networkidle' });
        // Late font swaps would corrupt typography + text boxes.
        await page.evaluate(() => document.fonts.ready.then(() => undefined));

        const raw = (await page.evaluate(snapshotDom, {
          mappingAttribute,
          styleProps: CAPTURED_STYLES as unknown as string[],
        })) as RawDomNode | null;
        if (!raw) {
          throw new WebCaptureError(`Nothing rendered at ${url} (empty <body>).`);
        }

        const capture: LiveCapture = {
          source: 'playwright',
          url,
          viewport: { width, height },
          capturedAt: new Date().toISOString(),
          tree: normalizeDomTree(raw),
        };

        const slug = slugFor(url);
        const treePath = path.join(outDir, `live-tree-${slug}@${width}.json`);
        await writeFile(treePath, JSON.stringify(capture, null, 2), 'utf8');
        log(`Wrote ${treePath}`);

        const screenshotPath = path.join(outDir, `page-${slug}@${width}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        log(`Wrote ${screenshotPath}`);

        results.push({ capture, treePath, screenshotPath });
      } finally {
        await page.close();
      }
    }
    return results;
  } finally {
    if (ownsBrowser) await browser.close();
  }
}

/** "https://app.example.com/checkout?x=1" → "app-example-com-checkout" */
export function slugFor(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WebCaptureError(`Not a valid URL: "${url}".`);
  }
  const slug = `${parsed.hostname}${parsed.pathname}`
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'page';
}
