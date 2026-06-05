import { describe, expect, it } from 'vitest';
import { matchTrees, normalizeText } from '../src/compare/matcher.js';
import { n, solid } from './helpers.js';

const OPTS = { mappingAttribute: 'data-figma-id', scale: 1 };

describe('normalizeText', () => {
  it('collapses whitespace and case', () => {
    expect(normalizeText('  Place\n  Order ')).toBe('place order');
  });
});

describe('matchTrees', () => {
  it('pass 1: explicit attribute mapping wins with confidence 1', () => {
    const design = n({
      id: 'root',
      bbox: { x: 0, y: 0, width: 1000, height: 800 },
      children: [n({ id: '9:1', type: 'RECTANGLE', bbox: { x: 10, y: 10, width: 50, height: 50 }, fills: [solid('#FF0000')] })],
    });
    const live = n({
      id: 'body',
      bbox: { x: 0, y: 0, width: 1000, height: 800 },
      children: [
        // geometry is totally different — the attribute still decides
        n({ id: '#hero', type: 'div', bbox: { x: 500, y: 500, width: 300, height: 300 }, attributes: { 'data-figma-id': '9:1' } }),
      ],
    });

    const result = matchTrees(design, live, OPTS);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]).toMatchObject({ method: 'attribute', confidence: 1 });
    expect(result.pairs[0].design.id).toBe('9:1');
    expect(result.pairs[0].live.id).toBe('#hero');
  });

  it('pass 2: unique text matches at 0.9', () => {
    const design = n({
      id: 'root',
      bbox: { x: 0, y: 0, width: 1000, height: 800 },
      children: [n({ id: '1:1', type: 'TEXT', text: 'Sign Up', bbox: { x: 0, y: 0, width: 100, height: 20 } })],
    });
    const live = n({
      id: 'body',
      bbox: { x: 0, y: 0, width: 1000, height: 800 },
      children: [n({ id: 'body > h1::text', type: 'TEXT', text: 'sign  up', bbox: { x: 400, y: 300, width: 90, height: 22 } })],
    });

    const result = matchTrees(design, live, OPTS);
    expect(result.pairs[0]).toMatchObject({ method: 'text', confidence: 0.9 });
  });

  it('pass 2: repeated text pairs nearest-first at 0.75', () => {
    const design = n({
      id: 'root',
      bbox: { x: 0, y: 0, width: 1000, height: 800 },
      children: [
        n({ id: 'd-top', type: 'TEXT', text: 'Item', bbox: { x: 0, y: 0, width: 50, height: 20 } }),
        n({ id: 'd-bottom', type: 'TEXT', text: 'Item', bbox: { x: 0, y: 100, width: 50, height: 20 } }),
      ],
    });
    const live = n({
      id: 'body',
      bbox: { x: 0, y: 0, width: 1000, height: 800 },
      children: [
        n({ id: 'l-bottom', type: 'TEXT', text: 'Item', bbox: { x: 0, y: 98, width: 50, height: 20 } }),
        n({ id: 'l-top', type: 'TEXT', text: 'Item', bbox: { x: 0, y: 2, width: 50, height: 20 } }),
      ],
    });

    const result = matchTrees(design, live, OPTS);
    const byDesign = Object.fromEntries(result.pairs.map((p) => [p.design.id, p.live.id]));
    expect(byDesign).toEqual({ 'd-top': 'l-top', 'd-bottom': 'l-bottom' });
    expect(result.pairs.every((p) => p.method === 'text' && p.confidence === 0.75)).toBe(true);
  });

  it('pass 3: a matched text pulls its parents together (anchor)', () => {
    const designText = n({ id: '2:2', type: 'TEXT', text: 'Place order', bbox: { x: 20, y: 10, width: 80, height: 20 } });
    const design = n({
      id: 'root',
      bbox: { x: 0, y: 0, width: 1000, height: 800 },
      children: [
        n({ id: '2:1', type: 'INSTANCE', bbox: { x: 10, y: 0, width: 200, height: 48 }, fills: [solid('#2D6CDF')], children: [designText] }),
      ],
    });
    const liveText = n({ id: 'body > button::text', type: 'TEXT', text: 'Place order', bbox: { x: 25, y: 12, width: 78, height: 18 } });
    const live = n({
      id: 'body',
      bbox: { x: 0, y: 0, width: 1000, height: 800 },
      children: [
        n({ id: 'body > button', type: 'button', bbox: { x: 10, y: 0, width: 200, height: 48 }, fills: [solid('#2D6CDF')], children: [liveText] }),
      ],
    });

    const result = matchTrees(design, live, OPTS);
    const parentPair = result.pairs.find((p) => p.design.id === '2:1');
    expect(parentPair).toMatchObject({ method: 'anchor', confidence: 0.72 }); // 0.8 × 0.9
    expect(parentPair?.live.id).toBe('body > button');
  });

  it('pass 4: geometry pairs same-shaped leftovers, TEXT never with non-TEXT', () => {
    const design = n({
      id: 'root',
      bbox: { x: 0, y: 0, width: 1000, height: 800 },
      children: [n({ id: '3:1', type: 'RECTANGLE', bbox: { x: 10, y: 10, width: 100, height: 50 }, fills: [solid('#00FF00')] })],
    });
    const live = n({
      id: 'body',
      bbox: { x: 0, y: 0, width: 1000, height: 800 },
      children: [
        n({ id: 'body > span::text', type: 'TEXT', text: 'x', bbox: { x: 10, y: 10, width: 100, height: 50 } }),
        n({ id: 'body > div', type: 'div', bbox: { x: 12, y: 11, width: 100, height: 50 }, fills: [solid('#00FF00')] }),
      ],
    });

    const result = matchTrees(design, live, OPTS);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]).toMatchObject({ method: 'geometry' });
    expect(result.pairs[0].live.id).toBe('body > div'); // not the TEXT at identical coords
    expect(result.pairs[0].confidence).toBeGreaterThan(0.6);
  });

  it('buckets: significant unmatched nodes only; wrappers and hidden stay out', () => {
    const design = n({
      id: 'root',
      bbox: { x: 0, y: 0, width: 1000, height: 800 },
      children: [
        n({ id: 'wrapper', type: 'FRAME', bbox: { x: 0, y: 0, width: 1000, height: 100 } }), // layout-only
        n({ id: 'painted', type: 'RECTANGLE', bbox: { x: 0, y: 700, width: 50, height: 50 }, fills: [solid('#123456')] }),
        n({ id: 'ghost', type: 'RECTANGLE', visible: false, bbox: { x: 0, y: 0, width: 10, height: 10 }, fills: [solid('#000000')] }),
      ],
    });
    const live = n({
      id: 'body',
      bbox: { x: 0, y: 0, width: 1000, height: 800 },
      children: [
        n({ id: 'body > div', type: 'div', bbox: { x: 500, y: 0, width: 400, height: 400 } }), // unpainted wrapper
        n({ id: 'body > aside', type: 'aside', bbox: { x: 900, y: 0, width: 100, height: 400 }, fills: [solid('#ABCDEF')] }),
      ],
    });

    const result = matchTrees(design, live, OPTS);
    expect(result.pairs).toHaveLength(0);
    expect(result.designOnly.map((d) => d.id)).toEqual(['painted']); // not wrapper, not invisible ghost
    expect(result.liveOnly.map((l) => l.id)).toEqual(['body > aside']); // not the bare div
  });

  it('never geometry-matches hidden live nodes — explicit signals only', () => {
    const design = n({
      id: 'root',
      bbox: { x: 0, y: 0, width: 1000, height: 800 },
      children: [n({ id: '5:1', type: 'RECTANGLE', bbox: { x: 10, y: 10, width: 100, height: 50 }, fills: [solid('#333333')] })],
    });
    const hidden = n({
      id: 'body > p',
      type: 'p',
      visible: false,
      bbox: { x: 10, y: 10, width: 100, height: 50 },
      fills: [solid('#333333')],
    });
    const live = n({ id: 'body', bbox: { x: 0, y: 0, width: 1000, height: 800 }, children: [hidden] });

    const result = matchTrees(design, live, OPTS);
    expect(result.pairs).toHaveLength(0);
    expect(result.designOnly.map((d) => d.id)).toEqual(['5:1']); // a clean "missing"

    // …but an explicit attribute may still claim the hidden element
    hidden.attributes = { 'data-figma-id': '5:1' };
    const explicit = matchTrees(design, live, OPTS);
    expect(explicit.pairs).toHaveLength(1);
    expect(explicit.pairs[0].method).toBe('attribute');
  });

  it('applies the scale to design coordinates before geometry matching', () => {
    // Design frame is 2000 wide, live page 1000 — scale 0.5.
    const design = n({
      id: 'root',
      bbox: { x: 0, y: 0, width: 2000, height: 1600 },
      children: [n({ id: '4:1', type: 'RECTANGLE', bbox: { x: 200, y: 200, width: 400, height: 200 }, fills: [solid('#222222')] })],
    });
    const live = n({
      id: 'body',
      bbox: { x: 0, y: 0, width: 1000, height: 800 },
      children: [n({ id: 'body > div', type: 'div', bbox: { x: 100, y: 100, width: 200, height: 100 }, fills: [solid('#222222')] })],
    });

    const result = matchTrees(design, live, { ...OPTS, scale: 0.5 });
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].method).toBe('geometry');
  });
});
