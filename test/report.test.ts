import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compare } from '../src/compare/engine.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { applyPixelDiff } from '../src/report/evidence.js';
import { renderHtmlReport } from '../src/report/html.js';
import { writePng } from '../src/report/images.js';
import { writeReports } from '../src/report/write.js';
import type { ComparisonReport, DesignExtraction, LiveCapture } from '../src/types.js';
import { n, solid } from './helpers.js';

/** Solid PNG with a rectangle of another color painted on it. */
function pngWithRect(
  width: number,
  height: number,
  bg: [number, number, number],
  rect?: { x: number; y: number; w: number; h: number; rgb: [number, number, number] },
): Buffer {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inRect = rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      const [r, g, b] = inRect ? rect.rgb : bg;
      const i = (y * width + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }
  return writePng(image);
}

// A 200×200 design frame with one 100×40 box at (50,50); the live page
// renders that box at the same place but a very different color — the spec
// layer sees matching geometry, the pixel layer sees the color difference.
const design: DesignExtraction = {
  source: 'figma-rest',
  fileKey: 'K',
  frameId: '7:0',
  frameName: 'Mini',
  extractedAt: '2026-06-05T00:00:00.000Z',
  tree: n({
    id: '7:0',
    name: 'Mini',
    bbox: { x: 1000, y: 2000, width: 200, height: 200 },
    fills: [solid('#FFFFFF')],
    children: [
      n({
        id: '7:1',
        name: 'Box',
        type: 'RECTANGLE',
        bbox: { x: 1050, y: 2050, width: 100, height: 40 },
        fills: [solid('#2D6CDF')],
      }),
      n({
        id: '7:2',
        name: 'Gone',
        type: 'RECTANGLE',
        bbox: { x: 1050, y: 2150, width: 100, height: 30 },
        fills: [solid('#AA0000')],
      }),
    ],
  }),
};

const live: LiveCapture = {
  source: 'playwright',
  url: 'http://localhost/x',
  viewport: { width: 200, height: 200 },
  capturedAt: '2026-06-05T00:00:00.000Z',
  tree: n({
    id: 'body',
    name: 'body',
    type: 'body',
    bbox: { x: 0, y: 0, width: 200, height: 200 },
    fills: [solid('#FFFFFF')],
    children: [
      n({
        id: 'body > div',
        name: 'div',
        type: 'div',
        attributes: { 'data-figma-id': '7:1' },
        bbox: { x: 50, y: 50, width: 100, height: 40 },
        fills: [solid('#2D6CDF')],
      }),
    ],
  }),
};

// Frame render: blue box at (50,50). Live page: GREEN box there instead.
const framePng = pngWithRect(200, 200, [255, 255, 255], { x: 50, y: 50, w: 100, h: 40, rgb: [45, 108, 223] });
const pagePng = pngWithRect(200, 200, [255, 255, 255], { x: 50, y: 50, w: 100, h: 40, rgb: [40, 200, 80] });

describe('applyPixelDiff', () => {
  let outDir: string;
  let report: ComparisonReport;

  beforeAll(async () => {
    outDir = await mkdtemp(path.join(tmpdir(), 'design-qa-test-'));
    report = compare(design, live, DEFAULT_CONFIG);
    await applyPixelDiff(report, {
      design,
      live,
      framePng,
      pagePng,
      outDir,
      visualMismatchPct: DEFAULT_CONFIG.tolerances.visualMismatchPct,
    });
  });

  afterAll(() => rm(outDir, { recursive: true, force: true }));

  it('turns the skipped visual pointer into a real failure', () => {
    const visual = report.evaluations.find((e) => e.pointer === 'visual' && e.elementName === 'Box');
    expect(visual?.result).toBe('fail');
    expect(visual?.delta).toBeGreaterThan(90); // the entire box region differs
  });

  it('creates a visual issue with design/live/diff evidence files', async () => {
    const issue = report.issues.find((i) => i.pointer === 'visual' && i.elementName === 'Box');
    expect(issue?.severity).toBe('high'); // >3× the 20% tolerance
    expect(issue?.evidence?.design).toMatch(/evidence[\\/].*-design\.png$/);
    const bytes = await readFile(path.join(outDir, issue!.evidence!.diff!));
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('gives the missing element a design crop and the expected-location live crop', () => {
    const issue = report.issues.find((i) => i.pointer === 'existence' && i.elementName === 'Gone');
    expect(issue?.evidence?.design).toBeDefined();
    expect(issue?.evidence?.live).toMatch(/expected-location/);
  });

  it('recounts the summary after evaluating visual pointers', () => {
    expect(report.summary.passed + report.summary.failed + report.summary.skipped).toBe(
      report.summary.pointersChecked,
    );
    // only `asset` pointers remain deferred now
    const skipped = report.evaluations.filter((e) => e.result === 'skipped');
    expect(skipped.every((e) => e.pointer === 'asset' || e.note?.includes('not croppable'))).toBe(true);
  });

  it('writeReports inlines evidence into a self-contained html', async () => {
    const { jsonPath, htmlPath } = await writeReports(report, outDir);
    const json = JSON.parse(await readFile(jsonPath, 'utf8')) as ComparisonReport;
    expect(json.summary).toEqual(report.summary);

    const html = await readFile(htmlPath!, 'utf8');
    expect(html).toContain('data:image/png;base64,');
    expect(html).not.toContain('src="evidence'); // nothing left un-inlined
  });
});

describe('renderHtmlReport', () => {
  const report = compare(design, live, DEFAULT_CONFIG);

  it('shows the summary numbers and groups issues by element', () => {
    const html = renderHtmlReport(report);
    expect(html).toContain(`<b>${report.summary.pointersChecked}</b><span>pointers checked</span>`);
    expect(html).toContain('Gone'); // the missing element appears
    expect(html).toContain('critical');
  });

  it('escapes HTML in user-controlled strings', () => {
    const hostile = structuredClone(report);
    hostile.issues[0].elementName = '<script>alert(1)</script>';
    hostile.issues[0].explanation = 'x & <img src=x>';
    const html = renderHtmlReport(hostile);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('x &amp; &lt;img src=x&gt;');
  });

  it('renders an all-clear banner when there are no issues', () => {
    const clean = structuredClone(report);
    clean.issues = [];
    expect(renderHtmlReport(clean)).toContain('No issues');
  });
});
