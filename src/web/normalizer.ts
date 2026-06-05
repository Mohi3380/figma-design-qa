/**
 * Normalizer: raw DOM snapshot → `NormalizedNode` (spec §6.2).
 *
 * The web-side mirror of `figma/normalizer.ts`: every browser quirk is
 * absorbed here and nowhere else. Runs in Node (not the page), so it's
 * unit-testable against a JSON fixture with no browser.
 *
 * Notable conversions:
 *  - Computed colors ("rgb(…)"/"rgba(…)") → ResolvedColor (hex + rgba).
 *  - Transparent backgrounds (`rgba(0,0,0,0)`) → no fill, matching Figma
 *    nodes that simply have no fill.
 *  - CSS font-weight keywords/strings → numeric weight.
 *  - display:flex → `autoLayout` (the inverse of Figma's mapping:
 *    flex-direction/gap/padding/justify/align → direction/itemSpacing/…).
 *  - Direct text → a synthetic TEXT child whose fills are the text color,
 *    mirroring Figma's structure (Button FRAME → TEXT child), so the two
 *    trees align structurally for the matcher.
 *  - visibility:hidden → visible:false (kept — "present but hidden" is a
 *    reportable state; display:none was already dropped in the snapshot).
 */
import type {
  AutoLayout,
  BBox,
  NormalizedNode,
  ResolvedColor,
  ResolvedPaint,
  Typography,
} from '../types.js';
import type { RawDomNode } from './snapshot.js';

export function normalizeDomTree(raw: RawDomNode): NormalizedNode {
  const styles = raw.styles;

  const node: NormalizedNode = {
    id: raw.selector,
    name: nameFor(raw),
    type: raw.tag,
    visible: styles.visibility !== 'hidden',
    opacity: numberOr(styles.opacity, 1),
    bbox: normalizeBBox(raw.bbox),
    fills: backgroundPaints(styles),
    strokes: borderPaints(styles),
    children: raw.children.map(normalizeDomTree),
  };

  const borderWidth = parsePx(styles.borderTopWidth);
  if (borderWidth !== undefined && borderWidth > 0 && styles.borderTopStyle !== 'none') {
    node.strokeWeight = borderWidth;
  }

  const cornerRadius = normalizeCornerRadius(styles);
  if (cornerRadius !== undefined) node.cornerRadius = cornerRadius;

  const autoLayout = normalizeAutoLayout(styles);
  if (autoLayout) node.autoLayout = autoLayout;

  if (Object.keys(raw.attributes).length > 0) node.attributes = { ...raw.attributes };

  // Direct text → synthetic TEXT child (fills = text color), so DOM trees
  // have the same shape as Figma trees: container node → TEXT node.
  if (raw.text) {
    node.children.unshift(syntheticTextNode(raw));
  }

  return node;
}

/** Human-readable name, best-effort: aria-label > id > "tag 'text…'" > tag. */
function nameFor(raw: RawDomNode): string {
  if (raw.attributes['aria-label']) return raw.attributes['aria-label'];
  if (raw.attributes.id) return `${raw.tag}#${raw.attributes.id}`;
  if (raw.text) return `${raw.tag} "${excerpt(raw.text)}"`;
  return raw.tag;
}

function excerpt(text: string): string {
  return text.length > 32 ? `${text.slice(0, 32).trimEnd()}…` : text;
}

function syntheticTextNode(raw: RawDomNode): NormalizedNode {
  const styles = raw.styles;
  const color = parseCssColor(styles.color);
  const fills: ResolvedPaint[] =
    color && color.rgba.a > 0 ? [{ type: 'SOLID', visible: true, opacity: 1, color }] : [];

  const text: NormalizedNode = {
    id: `${raw.selector}::text`,
    name: excerpt(raw.text),
    type: 'TEXT',
    visible: styles.visibility !== 'hidden',
    opacity: 1,
    // Glyph-tight bounds measured in-page (Range rects) — Figma TEXT boxes
    // hug the glyphs, so comparing against the element box would be a
    // guaranteed false positive. Element box only as a fallback.
    bbox: normalizeBBox(raw.textBBox ?? raw.bbox),
    fills,
    strokes: [],
    text: raw.text,
    children: [],
  };

  const typography = normalizeTypography(styles);
  if (typography) text.typography = typography;

  return text;
}

function normalizeBBox(bbox: RawDomNode['bbox']): BBox | null {
  const { x, y, width, height } = bbox;
  if ([x, y, width, height].some((v) => typeof v !== 'number' || Number.isNaN(v))) return null;
  return { x, y, width, height };
}

/**
 * Parse a computed CSS color. Browsers resolve computed colors to
 * "rgb(r, g, b)" / "rgba(r, g, b, a)"; anything else (e.g. wide-gamut
 * `color(srgb …)`) is rare in computed output and returns undefined.
 */
export function parseCssColor(value: string | undefined): ResolvedColor | undefined {
  if (!value) return undefined;
  const match = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (!match) return undefined;
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  const a = match[4] !== undefined ? Number(match[4]) : 1;
  if ([r, g, b].some((c) => c > 255)) return undefined;
  return { hex: `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase(), rgba: { r, g, b, a } };
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, '0');
}

function backgroundPaints(styles: Record<string, string>): ResolvedPaint[] {
  const paints: ResolvedPaint[] = [];

  const bg = parseCssColor(styles.backgroundColor);
  // Fully transparent background = "no fill" in Figma terms.
  if (bg && bg.rgba.a > 0) {
    paints.push({ type: 'SOLID', visible: true, opacity: 1, color: bg });
  }

  const image = styles.backgroundImage;
  if (image && image !== 'none') {
    paints.push({
      type: image.includes('gradient') ? 'GRADIENT' : 'IMAGE',
      visible: true,
      opacity: 1,
    });
  }

  return paints;
}

function borderPaints(styles: Record<string, string>): ResolvedPaint[] {
  const width = parsePx(styles.borderTopWidth);
  if (width === undefined || width <= 0 || styles.borderTopStyle === 'none') return [];
  const color = parseCssColor(styles.borderTopColor);
  if (!color || color.rgba.a === 0) return [];
  return [{ type: 'SOLID', visible: true, opacity: 1, color }];
}

function normalizeCornerRadius(
  styles: Record<string, string>,
): number | [number, number, number, number] | undefined {
  const corners = [
    parsePx(styles.borderTopLeftRadius),
    parsePx(styles.borderTopRightRadius),
    parsePx(styles.borderBottomRightRadius),
    parsePx(styles.borderBottomLeftRadius),
  ];
  if (corners.some((c) => c === undefined)) return undefined;
  const [a, b, c, d] = corners as [number, number, number, number];
  if (a === 0 && b === 0 && c === 0 && d === 0) return undefined;
  if (a === b && b === c && c === d) return a;
  return [a, b, c, d];
}

function normalizeTypography(styles: Record<string, string>): Typography | undefined {
  const fontSize = parsePx(styles.fontSize);
  const family = firstFontFamily(styles.fontFamily);
  if (fontSize === undefined || !family) return undefined;

  const typography: Typography = {
    fontFamily: family,
    fontSize,
    fontWeight: parseFontWeight(styles.fontWeight),
  };

  const lineHeight = parsePx(styles.lineHeight);
  if (lineHeight !== undefined) typography.lineHeightPx = lineHeight;

  const letterSpacing = parsePx(styles.letterSpacing); // "normal" → undefined
  if (letterSpacing !== undefined) typography.letterSpacing = letterSpacing;

  if (styles.textAlign) typography.textAlignHorizontal = styles.textAlign.toUpperCase();

  // CSS text-transform → Figma textCase vocabulary.
  const textCase = { uppercase: 'UPPER', lowercase: 'LOWER', capitalize: 'TITLE' }[
    styles.textTransform ?? ''
  ];
  if (textCase) typography.textCase = textCase;

  const decoration = { underline: 'UNDERLINE', 'line-through': 'STRIKETHROUGH' }[
    styles.textDecorationLine ?? ''
  ];
  if (decoration) typography.textDecoration = decoration;

  return typography;
}

/** First family in the computed list, unquoted: `"Inter", sans-serif` → `Inter`. */
export function firstFontFamily(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const first = value.split(',')[0].trim().replace(/^["']|["']$/g, '');
  return first || undefined;
}

export function parseFontWeight(value: string | undefined): number {
  if (!value) return 400;
  const numeric = Number(value);
  if (!Number.isNaN(numeric)) return numeric;
  return { normal: 400, bold: 700 }[value] ?? 400;
}

/** The inverse of the Figma mapping: CSS flexbox → AutoLayout. */
function normalizeAutoLayout(styles: Record<string, string>): AutoLayout | undefined {
  if (styles.display !== 'flex' && styles.display !== 'inline-flex') return undefined;

  const direction = styles.flexDirection?.startsWith('column') ? 'VERTICAL' : 'HORIZONTAL';
  // The gap along the main axis is what Figma calls itemSpacing.
  const gap = direction === 'VERTICAL' ? styles.rowGap : styles.columnGap;

  const autoLayout: AutoLayout = {
    direction,
    itemSpacing: parsePx(gap) ?? 0,
    paddingTop: parsePx(styles.paddingTop) ?? 0,
    paddingRight: parsePx(styles.paddingRight) ?? 0,
    paddingBottom: parsePx(styles.paddingBottom) ?? 0,
    paddingLeft: parsePx(styles.paddingLeft) ?? 0,
  };

  const justify = cssAlignToFigma(styles.justifyContent);
  if (justify) autoLayout.primaryAxisAlign = justify;
  const align = cssAlignToFigma(styles.alignItems);
  if (align) autoLayout.counterAxisAlign = align;

  return autoLayout;
}

/** CSS justify/align keywords → Figma's MIN/CENTER/MAX/SPACE_BETWEEN. */
function cssAlignToFigma(value: string | undefined): string | undefined {
  switch (value) {
    case 'flex-start':
    case 'start':
    case 'normal': // default alignment resolves to start behavior
    case 'stretch': // Figma has no stretch; start is the closest anchor
      return 'MIN';
    case 'center':
      return 'CENTER';
    case 'flex-end':
    case 'end':
      return 'MAX';
    case 'space-between':
      return 'SPACE_BETWEEN';
    default:
      return undefined;
  }
}

function parsePx(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/^(-?[\d.]+)px$/);
  if (!match) return undefined;
  return Number(match[1]);
}

function numberOr(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isNaN(n) || value === undefined || value === '' ? fallback : n;
}
