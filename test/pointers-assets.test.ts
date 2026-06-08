import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import { evaluatePair } from '../src/compare/pointers.js';
import type { BBox, MatchedPair, NormalizedNode, PointerEvaluation } from '../src/types.js';
import { n } from './helpers.js';

function evalPair(
  design: NormalizedNode,
  live: NormalizedNode,
  pointers: typeof DEFAULT_CONFIG.pointers,
  boxes: { design: BBox | null; live: BBox | null } = { design: null, live: null },
): PointerEvaluation[] {
  const pair: MatchedPair = { design, live, method: 'attribute', confidence: 1 };
  return evaluatePair(pair, { tolerances: DEFAULT_CONFIG.tolerances, pointers, relBoxes: () => boxes });
}

describe('text pointer — fuzzy', () => {
  it('passes near-identical copy (≥92% similar)', () => {
    const e = evalPair(
      n({ id: 'd', type: 'TEXT', text: 'Forgot Password?' }),
      n({ id: 'l', type: 'TEXT', text: 'Forgot password' }),
      ['text'],
    ).find((x) => x.pointer === 'text')!;
    expect(e.result).toBe('pass');
  });

  it('fails reworded copy but records similarity in delta', () => {
    const e = evalPair(
      n({ id: 'd', type: 'TEXT', text: 'Create your account' }),
      n({ id: 'l', type: 'TEXT', text: 'Create an account' }),
      ['text'],
    ).find((x) => x.pointer === 'text')!;
    expect(e.result).toBe('fail');
    expect(e.delta).toBeGreaterThan(0.6);
    expect(e.tolerance).toMatch(/% similar/);
  });
});

describe('asset pointer — icon / image', () => {
  it('flags a design icon with no live graphic asset', () => {
    const e = evalPair(
      n({ id: 'd', name: 'Lock Icon', type: 'VECTOR', asset: { kind: 'icon' } }),
      n({ id: 'l', name: 'div', type: 'div' }),
      ['asset'],
    ).find((x) => x.pointer === 'asset')!;
    expect(e.result).toBe('fail');
    expect(e.expected).toBe('icon present');
  });

  it('defers icon/image visual sameness to Layer B (skipped)', () => {
    const e = evalPair(
      n({ id: 'd', type: 'VECTOR', asset: { kind: 'icon' } }),
      n({ id: 'l', type: 'svg', asset: { kind: 'icon' } }),
      ['asset'],
    ).find((x) => x.pointer === 'asset')!;
    expect(e.result).toBe('skipped');
    expect(e.note).toMatch(/region pixel diff/);
  });

  it('does not emit a generic visual pointer for an asset node', () => {
    const evals = evalPair(
      n({ id: 'd', type: 'VECTOR', asset: { kind: 'icon' } }),
      n({ id: 'l', type: 'svg', asset: { kind: 'icon' } }),
      ['asset', 'visual'],
    );
    expect(evals.some((e) => e.pointer === 'visual')).toBe(false);
    expect(evals.some((e) => e.pointer === 'asset')).toBe(true);
  });
});

describe('asset.resolution — pixelation', () => {
  it('flags an image displayed far larger than its source', () => {
    const e = evalPair(
      n({ id: 'd', type: 'RECTANGLE', asset: { kind: 'image' } }),
      n({ id: 'l', type: 'img', asset: { kind: 'image', naturalWidth: 100, naturalHeight: 80 } }),
      ['asset'],
      { design: null, live: { x: 0, y: 0, width: 400, height: 320 } },
    ).find((x) => x.pointer === 'asset.resolution');
    expect(e?.result).toBe('fail');
    expect(e?.actual).toMatch(/pixelated/);
    expect(e?.delta).toBeCloseTo(4, 1); // 400 / 100
  });

  it('passes an image shown at or below its source resolution', () => {
    const evals = evalPair(
      n({ id: 'd', type: 'RECTANGLE', asset: { kind: 'image' } }),
      n({ id: 'l', type: 'img', asset: { kind: 'image', naturalWidth: 800, naturalHeight: 640 } }),
      ['asset'],
      { design: null, live: { x: 0, y: 0, width: 400, height: 320 } },
    );
    expect(evals.some((e) => e.pointer === 'asset.resolution')).toBe(false);
  });
});
