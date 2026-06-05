import { describe, expect, it } from 'vitest';
import { deltaE2000, deltaErgb, rgbToLab } from '../src/compare/color.js';

describe('rgbToLab', () => {
  it('maps white and black to the Lab extremes', () => {
    const white = rgbToLab(255, 255, 255);
    expect(white.L).toBeCloseTo(100, 1);
    expect(white.a).toBeCloseTo(0, 1);
    expect(white.b).toBeCloseTo(0, 1);

    const black = rgbToLab(0, 0, 0);
    expect(black.L).toBeCloseTo(0, 1);
  });

  it('matches the canonical Lab value for sRGB red', () => {
    const red = rgbToLab(255, 0, 0);
    expect(red.L).toBeCloseTo(53.24, 1);
    expect(red.a).toBeCloseTo(80.09, 1);
    expect(red.b).toBeCloseTo(67.2, 1);
  });
});

describe('deltaE2000', () => {
  // Reference pairs from Sharma, Wu & Dalal (2005) — the CIEDE2000
  // implementation test dataset. If these hold, the formula is right.
  const cases: Array<[number[], number[], number]> = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, 2.5, 0], [50, 3.2592, 0.335], 1.0],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
  ];

  it.each(cases)('ΔE00(%j, %j) = %f', ([L1, a1, b1], [L2, a2, b2], expected) => {
    expect(deltaE2000({ L: L1, a: a1, b: b1 }, { L: L2, a: a2, b: b2 })).toBeCloseTo(expected, 3);
  });

  it('is zero for identical colors and symmetric', () => {
    const lab = { L: 42.1, a: 12.3, b: -45.6 };
    expect(deltaE2000(lab, lab)).toBe(0);
    const other = { L: 60, a: -5, b: 20 };
    expect(deltaE2000(lab, other)).toBeCloseTo(deltaE2000(other, lab), 10);
  });
});

describe('deltaErgb', () => {
  it('treats imperceptible hex drift as tiny and real drift as large', () => {
    // #2D6CDF vs #2D6CE0 — one step in blue, invisible to humans.
    expect(deltaErgb({ r: 45, g: 108, b: 223 }, { r: 45, g: 108, b: 224 })).toBeLessThan(0.5);
    // #2D6CDF vs #DF2D2D — blue vs red, unmistakable.
    expect(deltaErgb({ r: 45, g: 108, b: 223 }, { r: 223, g: 45, b: 45 })).toBeGreaterThan(20);
  });
});
