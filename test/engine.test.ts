import { describe, expect, it } from 'vitest';
import { compare } from '../src/compare/engine.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { DesignExtraction, LiveCapture } from '../src/types.js';
import { n, solid } from './helpers.js';

/**
 * End-to-end Layer A test: a checkout design vs a live page seeded with
 * known regressions —
 *  - button background drifted #2D6CDF → #3A78E0 (the spec §14 example)
 *  - button sits 20px lower than designed
 *  - heading font-size 28px instead of 32px
 *  - promo banner missing from the DOM entirely
 *  - an ad div in the DOM that the design doesn't know about
 *  - button label uppercased by CSS (must NOT be an issue)
 */

const design: DesignExtraction = {
  source: 'figma-rest',
  fileKey: 'AbC123',
  frameId: '1:0',
  frameName: 'Checkout / Desktop',
  extractedAt: '2026-06-05T00:00:00.000Z',
  tree: n({
    id: '1:0',
    name: 'Checkout / Desktop',
    bbox: { x: 100, y: 200, width: 1440, height: 900 },
    fills: [solid('#FFFFFF')],
    children: [
      n({
        id: '1:1',
        name: 'Heading',
        type: 'TEXT',
        text: 'Checkout',
        bbox: { x: 148, y: 232, width: 320, height: 40 },
        fills: [solid('#1A1A2E')],
        typography: { fontFamily: 'Inter', fontSize: 32, fontWeight: 700, lineHeightPx: 40 },
      }),
      n({
        id: '1:2',
        name: 'Button / Place order',
        type: 'INSTANCE',
        bbox: { x: 148, y: 800, width: 240, height: 48 },
        fills: [solid('#2D6CDF')],
        autoLayout: {
          direction: 'HORIZONTAL',
          itemSpacing: 8,
          paddingTop: 12,
          paddingRight: 24,
          paddingBottom: 12,
          paddingLeft: 24,
        },
        children: [
          n({
            id: '1:3',
            name: 'Label',
            type: 'TEXT',
            text: 'Place order',
            bbox: { x: 220, y: 814, width: 96, height: 20 },
            fills: [solid('#FFFFFF')],
            typography: { fontFamily: 'Inter', fontSize: 16, fontWeight: 600 },
          }),
        ],
      }),
      n({
        id: '1:4',
        name: 'Promo banner',
        type: 'RECTANGLE',
        bbox: { x: 148, y: 320, width: 1144, height: 120 },
        fills: [solid('#FFE2E2')],
      }),
    ],
  }),
};

const live: LiveCapture = {
  source: 'playwright',
  url: 'http://localhost:3000/checkout',
  viewport: { width: 1440, height: 900 },
  capturedAt: '2026-06-05T00:00:00.000Z',
  tree: n({
    id: 'body',
    name: 'body',
    type: 'body',
    bbox: { x: 0, y: 0, width: 1440, height: 900 },
    fills: [solid('#FFFFFF')],
    children: [
      n({
        id: 'body > h1',
        name: 'h1 "Checkout"',
        type: 'h1',
        bbox: { x: 48, y: 32, width: 320, height: 40 },
        children: [
          n({
            id: 'body > h1::text',
            name: 'Checkout',
            type: 'TEXT',
            text: 'Checkout',
            bbox: { x: 48, y: 32, width: 320, height: 40 },
            fills: [solid('#1A1A2E')],
            typography: { fontFamily: 'Inter', fontSize: 28, fontWeight: 700, lineHeightPx: 40 },
          }),
        ],
      }),
      n({
        id: 'body > button',
        name: 'button "PLACE ORDER"',
        type: 'button',
        attributes: { 'data-figma-id': '1:2' },
        bbox: { x: 48, y: 620, width: 240, height: 48 },
        fills: [solid('#3A78E0')],
        autoLayout: {
          direction: 'HORIZONTAL',
          itemSpacing: 8,
          paddingTop: 12,
          paddingRight: 24,
          paddingBottom: 12,
          paddingLeft: 24,
        },
        children: [
          n({
            id: 'body > button::text',
            name: 'PLACE ORDER',
            type: 'TEXT',
            text: 'PLACE ORDER',
            bbox: { x: 120, y: 634, width: 96, height: 20 },
            fills: [solid('#FFFFFF')],
            typography: { fontFamily: 'Inter', fontSize: 16, fontWeight: 600, textCase: 'UPPER' },
          }),
        ],
      }),
      n({
        id: 'body > div.ad',
        name: 'div.ad',
        type: 'div',
        bbox: { x: 1200, y: 700, width: 200, height: 100 },
        fills: [solid('#00FF99')],
      }),
    ],
  }),
};

describe('compare (Layer A)', () => {
  const report = compare(design, live, DEFAULT_CONFIG);
  const issueByPointer = (pointer: string, name?: string) =>
    report.issues.find((i) => i.pointer === pointer && (!name || i.elementName === name));

  it('matches the button by attribute and the texts by content', () => {
    const methods = Object.fromEntries(report.matching.pairs.map((p) => [p.figmaNodeId, p.method]));
    expect(methods['1:2']).toBe('attribute');
    expect(methods['1:1']).toBe('text');
    expect(methods['1:3']).toBe('text');
  });

  it('flags the missing promo banner as a critical existence issue', () => {
    const issue = issueByPointer('existence', 'Promo banner');
    expect(issue).toMatchObject({ severity: 'critical', figmaNodeId: '1:4' });
  });

  it('flags the button color drift as high with a ΔE tolerance string', () => {
    const issue = issueByPointer('color.background', 'Button / Place order');
    expect(issue).toMatchObject({ severity: 'high', expected: '#2D6CDF', actual: '#3A78E0' });
    expect(issue?.tolerance).toMatch(/ΔE2000 < 3/);
  });

  it('flags the 20px position drift as high (>16px)', () => {
    const issue = issueByPointer('position', 'Button / Place order');
    expect(issue?.severity).toBe('high');
    expect(issue?.tolerance).toContain('off by 20px');
  });

  it('flags the heading font-size as high severity', () => {
    const issue = issueByPointer('typography.fontSize', 'Heading');
    expect(issue).toMatchObject({ severity: 'high', expected: '32px', actual: '28px' });
  });

  it('does NOT flag CSS-uppercased button copy as a text issue', () => {
    expect(issueByPointer('text')).toBeUndefined();
  });

  it('reports the ad div as info, not a failure', () => {
    const issue = issueByPointer('existence', 'div.ad');
    expect(issue?.severity).toBe('info');
    expect(report.summary.issuesBySeverity.info).toBe(1);
  });

  it('passes what should pass: spacing, text color, weights', () => {
    const failed = new Set(report.evaluations.filter((e) => e.result === 'fail').map((e) => e.pointer + '|' + e.elementName));
    expect(failed.has('spacing.gap|Button / Place order')).toBe(false);
    expect(failed.has('spacing.padding|Button / Place order')).toBe(false);
    expect(failed.has('color.text|Label')).toBe(false);
    expect(failed.has('typography.fontWeight|Heading')).toBe(false);
  });

  it('defers asset/visual pointers as skipped, keeping the count honest', () => {
    expect(report.summary.skipped).toBeGreaterThan(0);
    expect(report.evaluations.filter((e) => e.result === 'skipped').every((e) => e.note)).toBe(true);
  });

  it('summary adds up', () => {
    const { pointersChecked, passed, failed, skipped } = report.summary;
    expect(passed + failed + skipped).toBe(pointersChecked);
    expect(report.scale).toBe(1);
    expect(report.warnings).toEqual([]);
  });

  it('reports an attribute-matched but hidden element as "present but hidden"', () => {
    const hiddenLive = structuredClone(live);
    const button = hiddenLive.tree.children[1];
    button.visible = false;
    const report2 = compare(design, hiddenLive, DEFAULT_CONFIG);
    const issue = report2.issues.find(
      (i) => i.pointer === 'existence' && i.elementName === 'Button / Place order',
    );
    expect(issue?.severity).toBe('critical');
    expect(issue?.actual).toContain('hidden');
  });

  it('warns when frame and viewport widths diverge badly', () => {
    const narrow: LiveCapture = { ...live, viewport: { width: 375, height: 812 } };
    const tree = structuredClone(live.tree);
    tree.bbox = { x: 0, y: 0, width: 375, height: 812 };
    const scaled = compare(design, { ...narrow, tree }, DEFAULT_CONFIG);
    expect(scaled.warnings).toHaveLength(1);
    expect(scaled.scale).toBeCloseTo(375 / 1440, 2);
  });
});
