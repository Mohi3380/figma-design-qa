import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { crop, diffRegions, readPng, resizeNearest, writePng } from '../src/report/images.js';

/** Solid-color PNG, optionally with a differently-colored right half. */
function png(width: number, height: number, rgb: [number, number, number], rightHalf?: [number, number, number]): PNG {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = rightHalf && x >= width / 2 ? rightHalf : rgb;
      const i = (y * width + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }
  return image;
}

function pixelAt(image: PNG, x: number, y: number): [number, number, number] {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
}

describe('readPng/writePng', () => {
  it('round-trips', () => {
    const original = png(4, 4, [10, 20, 30]);
    const restored = readPng(writePng(original));
    expect(restored.width).toBe(4);
    expect(pixelAt(restored, 3, 3)).toEqual([10, 20, 30]);
  });
});

describe('crop', () => {
  it('extracts the requested region', () => {
    const src = png(10, 10, [0, 0, 0], [255, 255, 255]); // right half white
    const region = crop(src, { x: 5, y: 0, width: 5, height: 10 })!;
    expect(region.width).toBe(5);
    expect(region.height).toBe(10);
    expect(pixelAt(region, 0, 0)).toEqual([255, 255, 255]);
  });

  it('clamps boxes that overflow the image', () => {
    const src = png(10, 10, [1, 2, 3]);
    const region = crop(src, { x: 8, y: 8, width: 10, height: 10 })!;
    expect(region.width).toBe(2);
    expect(region.height).toBe(2);
  });

  it('returns null for boxes fully outside', () => {
    const src = png(10, 10, [1, 2, 3]);
    expect(crop(src, { x: 20, y: 0, width: 5, height: 5 })).toBeNull();
    expect(crop(src, { x: 0, y: 0, width: 0, height: 5 })).toBeNull();
  });
});

describe('resizeNearest', () => {
  it('preserves solid regions across scales', () => {
    const src = png(4, 4, [0, 0, 0], [200, 0, 0]);
    const doubled = resizeNearest(src, 8, 8);
    expect(pixelAt(doubled, 0, 0)).toEqual([0, 0, 0]);
    expect(pixelAt(doubled, 7, 7)).toEqual([200, 0, 0]);
    const halved = resizeNearest(src, 2, 2);
    expect(pixelAt(halved, 0, 0)).toEqual([0, 0, 0]);
    expect(pixelAt(halved, 1, 1)).toEqual([200, 0, 0]);
  });

  it('returns the source untouched at identical dimensions', () => {
    const src = png(4, 4, [1, 1, 1]);
    expect(resizeNearest(src, 4, 4)).toBe(src);
  });
});

describe('diffRegions', () => {
  it('reports 0% for identical regions', () => {
    const a = png(20, 20, [50, 100, 150]);
    const b = png(20, 20, [50, 100, 150]);
    expect(diffRegions(a, b).mismatchPct).toBe(0);
  });

  it('reports ~50% when half the region differs', () => {
    const design = png(20, 20, [255, 255, 255]);
    const live = png(20, 20, [255, 255, 255], [200, 30, 30]); // right half red
    const { mismatchPct } = diffRegions(design, live);
    expect(mismatchPct).toBeGreaterThan(40);
    expect(mismatchPct).toBeLessThan(60);
  });

  it('resizes the design region to live dimensions before diffing', () => {
    const design = png(10, 10, [50, 100, 150]); // half the size, same color
    const live = png(20, 20, [50, 100, 150]);
    const result = diffRegions(design, live);
    expect(result.mismatchPct).toBe(0);
    expect(result.design.width).toBe(20);
  });
});
