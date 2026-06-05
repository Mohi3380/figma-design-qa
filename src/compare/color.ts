/**
 * Perceptual color difference (spec §15): ΔE via CIEDE2000, not raw hex
 * equality. "Expected #2D6CDF, got #2D6CE0" should pass — no human can see
 * that difference — while a same-hue lightness drift should fail.
 *
 * Pipeline: sRGB (0-255) → linear RGB → XYZ (D65) → CIELAB → ΔE00.
 * Implemented from the standard formulae (Sharma et al. 2005); the unit
 * tests pin known values from that paper's reference dataset.
 */

export interface Lab {
  L: number;
  a: number;
  b: number;
}

/** sRGB 0-255 channels → CIELAB (D65 reference white). */
export function rgbToLab(r: number, g: number, b: number): Lab {
  // sRGB → linear
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });

  // linear RGB → XYZ (sRGB matrix, D65)
  const x = lin[0] * 0.4124564 + lin[1] * 0.3575761 + lin[2] * 0.1804375;
  const y = lin[0] * 0.2126729 + lin[1] * 0.7151522 + lin[2] * 0.072175;
  const z = lin[0] * 0.0193339 + lin[1] * 0.119192 + lin[2] * 0.9503041;

  // XYZ → Lab
  const refX = 0.95047;
  const refY = 1.0;
  const refZ = 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x / refX);
  const fy = f(y / refY);
  const fz = f(z / refZ);

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIEDE2000 color difference between two Lab colors. */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const deg2rad = Math.PI / 180;
  const rad2deg = 180 / Math.PI;

  const C1 = Math.hypot(lab1.a, lab1.b);
  const C2 = Math.hypot(lab2.a, lab2.b);
  const Cbar = (C1 + C2) / 2;

  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * lab1.a;
  const a2p = (1 + G) * lab2.a;

  const C1p = Math.hypot(a1p, lab1.b);
  const C2p = Math.hypot(a2p, lab2.b);

  const h1p = C1p === 0 ? 0 : (Math.atan2(lab1.b, a1p) * rad2deg + 360) % 360;
  const h2p = C2p === 0 ? 0 : (Math.atan2(lab2.b, a2p) * rad2deg + 360) % 360;

  const dLp = lab2.L - lab1.L;
  const dCp = C2p - C1p;

  let dhp: number;
  if (C1p * C2p === 0) dhp = 0;
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
  else dhp = h2p - h1p > 180 ? h2p - h1p - 360 : h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * deg2rad);

  const Lbarp = (lab1.L + lab2.L) / 2;
  const Cbarp = (C1p + C2p) / 2;

  let hbarp: number;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
  else hbarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;

  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * deg2rad) +
    0.24 * Math.cos(2 * hbarp * deg2rad) +
    0.32 * Math.cos((3 * hbarp + 6) * deg2rad) -
    0.2 * Math.cos((4 * hbarp - 63) * deg2rad);

  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(2 * dTheta * deg2rad) * RC;

  return Math.sqrt(
    (dLp / SL) ** 2 +
      (dCp / SC) ** 2 +
      (dHp / SH) ** 2 +
      RT * (dCp / SC) * (dHp / SH),
  );
}

/** Convenience: ΔE00 between two sRGB colors (0-255 channels). */
export function deltaErgb(
  rgb1: { r: number; g: number; b: number },
  rgb2: { r: number; g: number; b: number },
): number {
  return deltaE2000(rgbToLab(rgb1.r, rgb1.g, rgb1.b), rgbToLab(rgb2.r, rgb2.g, rgb2.b));
}
