/**
 * pointer-builder + Layer A evaluation (spec §6.4, §6.5-A).
 *
 * For each matched pair, generate and immediately evaluate the deterministic
 * checkpoints. Each evaluation carries expected/actual/tolerance strings so
 * a failure reads like: expected "#2D6CDF", got "#3A78E0" (ΔE 6.1 > 3).
 *
 * Coordinate rule (spec §11): positions/sizes compare the *frame-relative*,
 * scaled design box against the *page-relative* live box — both re-based by
 * the caller before they get here.
 *
 * `asset` and `visual` pointers are emitted as `skipped` — they need pixel
 * evidence (Phase 4) and vision adjudication (Phase 5). Emitting them keeps
 * the "N pointers checked" count honest about what was NOT checked.
 */
import type { PointerType, Tolerances } from '../config.js';
import type { BBox, MatchedPair, NormalizedNode, PointerEvaluation, ResolvedPaint } from '../types.js';
import { deltaErgb } from './color.js';
import { normalizeText } from './matcher.js';

export interface EvaluateOptions {
  tolerances: Tolerances;
  pointers: PointerType[];
  /** Frame-relative design bbox + page-relative live bbox per pair. */
  relBoxes: (pair: MatchedPair) => { design: BBox | null; live: BBox | null };
}

export function evaluatePair(pair: MatchedPair, options: EvaluateOptions): PointerEvaluation[] {
  const { tolerances, pointers } = options;
  const enabled = new Set(pointers);
  const out: PointerEvaluation[] = [];
  const base = {
    figmaNodeId: pair.design.id,
    selector: pair.live.id,
    elementName: pair.design.name,
  };
  const push = (e: Omit<PointerEvaluation, keyof typeof base>) => out.push({ ...base, ...e });

  if (enabled.has('existence')) {
    // A pair can exist yet be invisible — attribute/text matching is allowed
    // to find hidden elements precisely so this reads "present but hidden"
    // instead of "missing".
    if (pair.live.visible) {
      push({ pointer: 'existence', result: 'pass', note: `matched via ${pair.method} (${pair.confidence})` });
    } else {
      push({
        pointer: 'existence',
        result: 'fail',
        expected: `${pair.design.type} "${pair.design.name}" visible`,
        actual: `present in the DOM but hidden (visibility/opacity)`,
      });
    }
  }

  const { design: dBox, live: lBox } = options.relBoxes(pair);

  if (enabled.has('position') && dBox && lBox) {
    const dx = lBox.x - dBox.x;
    const dy = lBox.y - dBox.y;
    const delta = round1(Math.max(Math.abs(dx), Math.abs(dy)));
    push({
      pointer: 'position',
      result: delta <= tolerances.positionPx ? 'pass' : 'fail',
      expected: `(${round1(dBox.x)}, ${round1(dBox.y)})`,
      actual: `(${round1(lBox.x)}, ${round1(lBox.y)})`,
      tolerance: `±${tolerances.positionPx}px (off by ${delta}px)`,
      delta,
    });
  }

  if (enabled.has('size') && dBox && lBox) {
    const dw = lBox.width - dBox.width;
    const dh = lBox.height - dBox.height;
    const delta = round1(Math.max(Math.abs(dw), Math.abs(dh)));
    push({
      pointer: 'size',
      result: delta <= tolerances.sizePx ? 'pass' : 'fail',
      expected: `${round1(dBox.width)}×${round1(dBox.height)}`,
      actual: `${round1(lBox.width)}×${round1(lBox.height)}`,
      tolerance: `±${tolerances.sizePx}px (off by ${delta}px)`,
      delta,
    });
  }

  if (enabled.has('color')) {
    const which = pair.design.type === 'TEXT' ? 'color.text' : 'color.background';
    const fill = compareColor(which, pair.design.fills, pair.live.fills, tolerances.colorDeltaE);
    if (fill) push(fill);
    const border = compareColor('color.border', pair.design.strokes, pair.live.strokes, tolerances.colorDeltaE);
    if (border) push(border);
  }

  if (enabled.has('typography') && pair.design.type === 'TEXT') {
    out.push(...compareTypography(pair, base, tolerances));
  }

  if (enabled.has('spacing') && pair.design.autoLayout && pair.live.autoLayout) {
    out.push(...compareSpacing(pair, base, tolerances));
  }

  if (enabled.has('text') && pair.design.type === 'TEXT' && pair.design.text !== undefined) {
    push(compareText(pair));
  }

  if (enabled.has('asset')) {
    push({ pointer: 'asset', result: 'skipped', note: 'needs exported-asset diff — Phase 4' });
  }
  if (enabled.has('visual')) {
    push({ pointer: 'visual', result: 'skipped', note: 'needs region pixel diff — Phase 4' });
  }

  return out;
}

/** First *visible* solid paint — what a human would call "the color". */
function visibleSolid(paints: ResolvedPaint[]): ResolvedPaint | undefined {
  return paints.find((p) => p.visible && p.type === 'SOLID' && p.color);
}

function visiblePaint(paints: ResolvedPaint[]): ResolvedPaint | undefined {
  return paints.find((p) => p.visible);
}

function compareColor(
  pointer: string,
  designPaints: ResolvedPaint[],
  livePaints: ResolvedPaint[],
  tolerance: number,
): Omit<PointerEvaluation, 'figmaNodeId' | 'selector' | 'elementName'> | undefined {
  const design = visiblePaint(designPaints);
  if (!design) return undefined; // design expects nothing — nothing to check

  if (design.type !== 'SOLID' || !design.color) {
    return { pointer, result: 'skipped', note: `design uses a ${design.type} paint — compared visually in Phase 4` };
  }

  const live = visibleSolid(livePaints);
  if (!live?.color) {
    const liveOther = visiblePaint(livePaints);
    return {
      pointer,
      result: 'fail',
      expected: design.color.hex,
      actual: liveOther ? `${liveOther.type} paint` : 'none',
      tolerance: `ΔE2000 < ${tolerance}`,
    };
  }

  const deltaE = round1(deltaErgb(design.color.rgba, live.color.rgba));
  const alphaDrift = Math.abs(design.color.rgba.a - live.color.rgba.a) > 0.05;
  return {
    pointer,
    result: deltaE <= tolerance && !alphaDrift ? 'pass' : 'fail',
    expected: design.color.hex + alphaText(design.color.rgba.a),
    actual: live.color.hex + alphaText(live.color.rgba.a),
    tolerance: `ΔE2000 < ${tolerance} (actual ΔE ${deltaE})`,
    delta: deltaE,
  };
}

function alphaText(a: number): string {
  return a >= 1 ? '' : ` @ ${Math.round(a * 100)}% alpha`;
}

function compareTypography(
  pair: MatchedPair,
  base: Pick<PointerEvaluation, 'figmaNodeId' | 'selector' | 'elementName'>,
  tolerances: Tolerances,
): PointerEvaluation[] {
  const d = pair.design.typography;
  const l = pair.live.typography;
  if (!d) return [];
  if (!l) {
    return [
      { ...base, pointer: 'typography', result: 'fail', expected: `${d.fontFamily} ${d.fontSize}px`, actual: 'no typography captured' },
    ];
  }

  const out: PointerEvaluation[] = [];
  const check = (
    pointer: string,
    expected: string | undefined,
    actual: string | undefined,
    pass: boolean,
    extra: Partial<PointerEvaluation> = {},
  ) => out.push({ ...base, pointer, result: pass ? 'pass' : 'fail', expected, actual, ...extra });

  check(
    'typography.fontFamily',
    d.fontFamily,
    l.fontFamily,
    d.fontFamily.toLowerCase() === l.fontFamily.toLowerCase(),
  );

  const sizeTolerance = tolerances.fontSizeExact ? 0 : 1;
  check('typography.fontSize', `${d.fontSize}px`, `${l.fontSize}px`, Math.abs(d.fontSize - l.fontSize) <= sizeTolerance, {
    tolerance: tolerances.fontSizeExact ? 'exact' : '±1px',
    delta: round1(Math.abs(d.fontSize - l.fontSize)),
  });

  check('typography.fontWeight', String(d.fontWeight), String(l.fontWeight), d.fontWeight === l.fontWeight);

  if (d.lineHeightPx !== undefined && l.lineHeightPx !== undefined) {
    check(
      'typography.lineHeight',
      `${d.lineHeightPx}px`,
      `${l.lineHeightPx}px`,
      Math.abs(d.lineHeightPx - l.lineHeightPx) <= 1,
      { tolerance: '±1px', delta: round1(Math.abs(d.lineHeightPx - l.lineHeightPx)) },
    );
  }

  if (d.letterSpacing !== undefined) {
    const live = l.letterSpacing ?? 0; // CSS "normal" = 0
    check('typography.letterSpacing', `${d.letterSpacing}px`, `${live}px`, Math.abs(d.letterSpacing - live) <= 0.25, {
      tolerance: '±0.25px',
      delta: round1(Math.abs(d.letterSpacing - live)),
    });
  }

  return out;
}

function compareSpacing(
  pair: MatchedPair,
  base: Pick<PointerEvaluation, 'figmaNodeId' | 'selector' | 'elementName'>,
  tolerances: Tolerances,
): PointerEvaluation[] {
  const d = pair.design.autoLayout!;
  const l = pair.live.autoLayout!;
  const out: PointerEvaluation[] = [];

  out.push({
    ...base,
    pointer: 'spacing.direction',
    result: d.direction === l.direction ? 'pass' : 'fail',
    expected: d.direction,
    actual: l.direction,
  });

  const gapDelta = round1(Math.abs(d.itemSpacing - l.itemSpacing));
  out.push({
    ...base,
    pointer: 'spacing.gap',
    result: gapDelta <= tolerances.spacingPx ? 'pass' : 'fail',
    expected: `${d.itemSpacing}px`,
    actual: `${l.itemSpacing}px`,
    tolerance: `±${tolerances.spacingPx}px`,
    delta: gapDelta,
  });

  const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;
  const dPad = sides.map((s) => d[`padding${s}`]);
  const lPad = sides.map((s) => l[`padding${s}`]);
  const padDelta = round1(Math.max(...sides.map((_, i) => Math.abs(dPad[i] - lPad[i]))));
  out.push({
    ...base,
    pointer: 'spacing.padding',
    result: padDelta <= tolerances.spacingPx ? 'pass' : 'fail',
    expected: dPad.map((p) => `${p}px`).join(' '),
    actual: lPad.map((p) => `${p}px`).join(' '),
    tolerance: `±${tolerances.spacingPx}px per side`,
    delta: padDelta,
  });

  return out;
}

function compareText(pair: MatchedPair): Omit<PointerEvaluation, 'figmaNodeId' | 'selector' | 'elementName'> {
  const expected = pair.design.text ?? '';
  const actual = pair.live.text ?? '';
  // CSS text-transform restyles the glyphs without touching the DOM source,
  // and designers often type display-case into Figma — so when either side
  // declares a case transform, compare case-insensitively.
  const caseTransformed = pair.design.typography?.textCase || pair.live.typography?.textCase;
  const a = caseTransformed ? normalizeText(expected) : expected.replace(/\s+/g, ' ').trim();
  const b = caseTransformed ? normalizeText(actual) : actual.replace(/\s+/g, ' ').trim();
  return {
    pointer: 'text',
    result: a === b ? 'pass' : 'fail',
    expected: `"${expected}"`,
    actual: `"${actual}"`,
    tolerance: caseTransformed ? 'case-insensitive (text-transform present)' : 'exact',
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
