/**
 * PNG region helpers for Layer B (spec §6.5-B): crop, resize, pixel diff.
 *
 * Pure buffer-in/buffer-out so the diff logic is unit-testable with tiny
 * synthetic PNGs. `pixelmatch` does the perceptual pixel comparison
 * (anti-aliasing aware); we add region cropping and a nearest-neighbor
 * resize so design crops (frame pixels) and live crops (page pixels) reach
 * pixelmatch at identical dimensions. Nearest-neighbor is deliberate:
 * smoother resamplers blur edges and *hide* genuine 1px differences, and
 * the residual aliasing noise is exactly what tolerances + Layer C absorb.
 */
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { BBox } from '../types.js';

export interface Region {
  png: PNG;
}

export function readPng(buffer: Buffer): PNG {
  return PNG.sync.read(buffer);
}

export function writePng(png: PNG): Buffer {
  return PNG.sync.write(png);
}

/** Crop a bbox out of a PNG, clamped to the image bounds. Returns null when
 * the bbox lies fully outside the image (e.g. element below the fold of a
 * shorter design render). */
export function crop(src: PNG, box: BBox): PNG | null {
  const x = Math.max(0, Math.round(box.x));
  const y = Math.max(0, Math.round(box.y));
  const right = Math.min(src.width, Math.round(box.x + box.width));
  const bottom = Math.min(src.height, Math.round(box.y + box.height));
  const width = right - x;
  const height = bottom - y;
  if (width <= 0 || height <= 0) return null;

  const out = new PNG({ width, height });
  for (let row = 0; row < height; row++) {
    const srcStart = ((y + row) * src.width + x) * 4;
    src.data.copy(out.data, row * width * 4, srcStart, srcStart + width * 4);
  }
  return out;
}

/** Nearest-neighbor resize (see module note on why not bilinear). */
export function resizeNearest(src: PNG, width: number, height: number): PNG {
  if (src.width === width && src.height === height) return src;
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / width));
      const si = (sy * src.width + sx) * 4;
      const di = (y * width + x) * 4;
      src.data.copy(out.data, di, si, si + 4);
    }
  }
  return out;
}

export interface RegionDiff {
  /** 0..100 — % of pixels pixelmatch considers different. */
  mismatchPct: number;
  /** Red-on-faded overlay marking the differing pixels. */
  diff: PNG;
  /** The two compared regions, post-resize (for evidence images). */
  design: PNG;
  live: PNG;
}

/** Diff a design region against a live region. The design side is resized
 * to the live dimensions (live pixels are what the user actually sees). */
export function diffRegions(design: PNG, live: PNG): RegionDiff {
  const resized = resizeNearest(design, live.width, live.height);
  const diff = new PNG({ width: live.width, height: live.height });
  const differing = pixelmatch(resized.data, live.data, diff.data, live.width, live.height, {
    threshold: 0.1, // pixelmatch's perceptual sensitivity, not our gate
    includeAA: false, // anti-aliased pixels are noise, not regressions
  });
  const mismatchPct = Math.round((differing / (live.width * live.height)) * 1000) / 10;
  return { mismatchPct, diff, design: resized, live };
}
