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
  /** Source attributes the matcher cares about (Phase 2 DOM nodes only):
   * the explicit mapping attribute (`data-figma-id`), role, aria-label, id. */
  attributes?: Record<string, string>;
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

/** Top-level artifact written by the web capturer for one URL × viewport. */
export interface LiveCapture {
  source: 'playwright';
  url: string;
  viewport: { width: number; height: number };
  capturedAt: string; // ISO timestamp
  tree: NormalizedNode;
}

// ---------------------------------------------------------------------------
// Phase 3: matching + comparison (spec §6.3–§6.5, §7)
// ---------------------------------------------------------------------------

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type MatchMethod = 'attribute' | 'text' | 'anchor' | 'geometry';

/** One aligned design↔live pair (spec §6.3). */
export interface MatchedPair {
  design: NormalizedNode;
  live: NormalizedNode;
  method: MatchMethod;
  /** 0..1 — how sure the matcher is. attribute=1, heuristics less. */
  confidence: number;
}

/** One evaluated checkpoint (spec §6.4) — a "pointer". Passes are kept so
 * the report can say "312 pointers checked · 289 passed". */
export interface PointerEvaluation {
  /** e.g. "existence", "position", "color.background", "typography.fontSize" */
  pointer: string;
  figmaNodeId?: string;
  selector?: string;
  elementName: string;
  result: 'pass' | 'fail' | 'skipped';
  expected?: string;
  actual?: string;
  tolerance?: string;
  /** Numeric magnitude of the difference, when meaningful (px, ΔE, …). */
  delta?: number;
  /** Why a pointer was skipped (e.g. visual diffs arrive in Phase 4). */
  note?: string;
}

/** A failed pointer, enriched for the report (spec §7). */
export interface Issue {
  id: string;
  elementName: string;
  pointer: string;
  severity: Severity;
  expected?: string;
  actual?: string;
  tolerance?: string;
  viewport: number;
  figmaNodeId?: string;
  selector?: string;
  explanation: string;
  /** Match confidence of the underlying pair (1 for existence issues). */
  confidence: number;
  /** Evidence image paths, relative to the report directory (Phase 4).
   * design = crop of the Figma render, live = crop of the screenshot,
   * diff = pixelmatch overlay (only when both regions exist). */
  evidence?: { design?: string; live?: string; diff?: string };
}

/** Canonical comparison output (spec §8 report.json, Layer A scope). */
export interface ComparisonReport {
  design: { fileKey: string; frameId: string; frameName: string };
  live: { url: string; viewport: { width: number; height: number } };
  comparedAt: string; // ISO timestamp
  /** Uniform scale applied to design coordinates (liveWidth / designWidth). */
  scale: number;
  warnings: string[];
  summary: {
    pointersChecked: number;
    passed: number;
    failed: number;
    skipped: number;
    issuesBySeverity: Record<Severity, number>;
  };
  matching: {
    matched: number;
    designOnly: number;
    liveOnly: number;
    pairs: Array<{ figmaNodeId: string; selector: string; method: MatchMethod; confidence: number }>;
  };
  evaluations: PointerEvaluation[];
  issues: Issue[];
}
