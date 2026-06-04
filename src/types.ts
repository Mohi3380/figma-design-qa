/**
 * The normalized schema — the contract of the whole pipeline (spec §6.1/6.2).
 *
 * Both the Figma extractor (Phase 1) and the web capturer (Phase 2) emit
 * trees of `NormalizedNode`, so the matcher / pointer-builder / comparison
 * engine never care which source a node came from. Keep this stable.
 */

/** Axis-aligned bounding box. For Figma nodes these are absolute canvas
 * coordinates; consumers normalize to the frame origin before comparing. */
export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A resolved color — Figma's 0..1 float channels converted to 0..255 + hex. */
export interface ResolvedColor {
  hex: string; // "#RRGGBB"
  rgba: { r: number; g: number; b: number; a: number }; // 0-255 channels, a 0-1
}

/** A paint (fill or stroke) with colors fully resolved. Non-solid paints keep
 * their type so later phases can decide how to compare them. */
export interface ResolvedPaint {
  type: 'SOLID' | 'GRADIENT' | 'IMAGE' | 'OTHER';
  visible: boolean;
  opacity: number;
  /** Present for SOLID paints (and gradient stops collapse to their stops list). */
  color?: ResolvedColor;
  /** Present for GRADIENT paints. */
  gradientStops?: Array<{ position: number; color: ResolvedColor }>;
}

export interface Typography {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  textAlignHorizontal?: string;
  textCase?: string;
  textDecoration?: string;
}

/** Auto-layout values map ~1:1 to CSS flexbox (gap/padding/direction). */
export interface AutoLayout {
  direction: 'HORIZONTAL' | 'VERTICAL';
  itemSpacing: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  primaryAxisAlign?: string;
  counterAxisAlign?: string;
}

export interface NormalizedNode {
  /** Source id — Figma node id ("12:345") or, in Phase 2, a DOM selector/path. */
  id: string;
  name: string;
  /** Source node type (FRAME, TEXT, INSTANCE, ... / later: tag names). */
  type: string;
  visible: boolean;
  opacity: number;
  bbox: BBox | null;
  fills: ResolvedPaint[];
  strokes: ResolvedPaint[];
  strokeWeight?: number;
  cornerRadius?: number | [number, number, number, number];
  /** Visible text content (TEXT nodes / DOM text). */
  text?: string;
  typography?: Typography;
  autoLayout?: AutoLayout;
  /** Component variant properties, when the node is a component instance. */
  variant?: Record<string, string>;
  children: NormalizedNode[];
}

/** Top-level artifact written by the extractor for one frame. */
export interface DesignExtraction {
  source: 'figma-rest' | 'figma-mcp';
  fileKey: string;
  frameId: string;
  frameName: string;
  extractedAt: string; // ISO timestamp
  tree: NormalizedNode;
}
