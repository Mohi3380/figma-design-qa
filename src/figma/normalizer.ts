/**
 * Normalizer: raw Figma REST node → `NormalizedNode` (spec §6.1).
 *
 * Why this exists: the Figma REST API and the Dev Mode MCP server return
 * different shapes, and Phase 2's web capturer returns a third. Everything
 * downstream (matcher, pointers, comparison) consumes only the normalized
 * schema, so source quirks are absorbed here and nowhere else.
 *
 * Notable conversions:
 *  - Figma colors are 0..1 floats → resolved to 0..255 rgba + "#RRGGBB" hex.
 *  - layoutMode/padding/itemSpacing → `autoLayout` (maps ~1:1 to CSS flex).
 *  - `visible` defaults to true and `opacity` to 1 (Figma omits defaults).
 *  - Invisible paints are kept but flagged, so "fill exists but is hidden"
 *    is distinguishable from "no fill".
 */
import type {
  AutoLayout,
  BBox,
  NormalizedNode,
  ResolvedColor,
  ResolvedPaint,
  Typography,
} from '../types.js';
import type { RawFigmaNode } from './api.js';

export function normalizeTree(raw: RawFigmaNode): NormalizedNode {
  const node: NormalizedNode = {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    visible: raw.visible !== false,
    opacity: typeof raw.opacity === 'number' ? raw.opacity : 1,
    bbox: normalizeBBox(raw.absoluteBoundingBox),
    fills: normalizePaints(raw.fills),
    strokes: normalizePaints(raw.strokes),
    children: Array.isArray(raw.children) ? raw.children.map(normalizeTree) : [],
  };

  if (typeof raw.strokeWeight === 'number') node.strokeWeight = raw.strokeWeight;

  const cornerRadius = normalizeCornerRadius(raw);
  if (cornerRadius !== undefined) node.cornerRadius = cornerRadius;

  if (raw.type === 'TEXT' && typeof raw.characters === 'string') {
    node.text = raw.characters;
  }

  const typography = normalizeTypography(raw.style);
  if (typography) node.typography = typography;

  const autoLayout = normalizeAutoLayout(raw);
  if (autoLayout) node.autoLayout = autoLayout;

  const variant = normalizeVariant(raw);
  if (variant) node.variant = variant;

  return node;
}

function normalizeBBox(value: unknown): BBox | null {
  if (value === null || typeof value !== 'object') return null;
  const box = value as Record<string, unknown>;
  const { x, y, width, height } = box;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number'
  ) {
    return null;
  }
  return { x, y, width, height };
}

/** Figma color {r,g,b,a} in 0..1 floats → 0..255 channels + hex. */
export function resolveColor(value: unknown): ResolvedColor | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const c = value as Record<string, unknown>;
  if (typeof c.r !== 'number' || typeof c.g !== 'number' || typeof c.b !== 'number') {
    return undefined;
  }
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  const a = typeof c.a === 'number' ? c.a : 1;
  return { hex: `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase(), rgba: { r, g, b, a } };
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, '0');
}

function normalizePaints(value: unknown): ResolvedPaint[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object')
    .map((p) => {
      const type = typeof p.type === 'string' ? p.type : 'OTHER';
      const paint: ResolvedPaint = {
        type: type === 'SOLID' ? 'SOLID' : type.startsWith('GRADIENT') ? 'GRADIENT' : type === 'IMAGE' ? 'IMAGE' : 'OTHER',
        visible: p.visible !== false,
        opacity: typeof p.opacity === 'number' ? p.opacity : 1,
      };
      if (paint.type === 'SOLID') {
        const color = resolveColor(p.color);
        if (color) paint.color = color;
      } else if (paint.type === 'GRADIENT' && Array.isArray(p.gradientStops)) {
        paint.gradientStops = (p.gradientStops as Array<Record<string, unknown>>)
          .map((stop) => {
            const color = resolveColor(stop.color);
            return color && typeof stop.position === 'number'
              ? { position: stop.position, color }
              : undefined;
          })
          .filter((s): s is NonNullable<typeof s> => s !== undefined);
      }
      return paint;
    });
}

function normalizeCornerRadius(raw: RawFigmaNode): number | [number, number, number, number] | undefined {
  if (Array.isArray(raw.rectangleCornerRadii) && raw.rectangleCornerRadii.length === 4) {
    const [a, b, c, d] = raw.rectangleCornerRadii as number[];
    // collapse uniform per-corner radii to a single number
    if (a === b && b === c && c === d) return a;
    return [a, b, c, d];
  }
  if (typeof raw.cornerRadius === 'number') return raw.cornerRadius;
  return undefined;
}

function normalizeTypography(value: unknown): Typography | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const s = value as Record<string, unknown>;
  if (typeof s.fontFamily !== 'string' || typeof s.fontSize !== 'number') return undefined;
  const typography: Typography = {
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    fontWeight: typeof s.fontWeight === 'number' ? s.fontWeight : 400,
  };
  if (typeof s.lineHeightPx === 'number') typography.lineHeightPx = s.lineHeightPx;
  if (typeof s.letterSpacing === 'number') typography.letterSpacing = s.letterSpacing;
  if (typeof s.textAlignHorizontal === 'string') typography.textAlignHorizontal = s.textAlignHorizontal;
  if (typeof s.textCase === 'string') typography.textCase = s.textCase;
  if (typeof s.textDecoration === 'string') typography.textDecoration = s.textDecoration;
  return typography;
}

function normalizeAutoLayout(raw: RawFigmaNode): AutoLayout | undefined {
  if (raw.layoutMode !== 'HORIZONTAL' && raw.layoutMode !== 'VERTICAL') return undefined;
  const autoLayout: AutoLayout = {
    direction: raw.layoutMode,
    itemSpacing: numberOr(raw.itemSpacing, 0),
    paddingTop: numberOr(raw.paddingTop, 0),
    paddingRight: numberOr(raw.paddingRight, 0),
    paddingBottom: numberOr(raw.paddingBottom, 0),
    paddingLeft: numberOr(raw.paddingLeft, 0),
  };
  if (typeof raw.primaryAxisAlignItems === 'string') autoLayout.primaryAxisAlign = raw.primaryAxisAlignItems;
  if (typeof raw.counterAxisAlignItems === 'string') autoLayout.counterAxisAlign = raw.counterAxisAlignItems;
  return autoLayout;
}

/** Instance variant properties, e.g. { State: "Hover", Size: "Large" }. */
function normalizeVariant(raw: RawFigmaNode): Record<string, string> | undefined {
  if (raw.type !== 'INSTANCE') return undefined;
  const props = raw.componentProperties;
  if (props === null || typeof props !== 'object') return undefined;
  const variant: Record<string, string> = {};
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (value !== null && typeof value === 'object' && 'value' in value) {
      variant[key.split('#')[0]] = String((value as { value: unknown }).value);
    }
  }
  return Object.keys(variant).length > 0 ? variant : undefined;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}
