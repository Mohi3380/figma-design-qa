/**
 * matcher (spec §6.3): align Figma nodes ↔ live DOM elements.
 *
 * Matching passes, in priority order — each pass only sees nodes the
 * previous passes left unmatched, and each records its method + confidence
 * so the report can show *why* a pair was trusted:
 *
 *  1. attribute — the DOM element carries `data-figma-id="<node id>"`
 *     (spec §11: "the cleanest solution is social"). Exact, confidence 1.
 *  2. text — TEXT nodes with identical normalized text. Unique text on
 *     both sides → 0.9; ambiguous text disambiguated by distance → 0.75.
 *  3. anchor — a matched TEXT pair pulls its parents together: the button
 *     FRAME around "Place order" matches the <button> around the same
 *     text. Repeats up the tree until it stops producing pairs. 0.8 ×
 *     the child's confidence.
 *  4. geometry — leftovers paired by type-compatibility + position +
 *     size similarity, greedy best-first above a floor. ≤ 0.7.
 *
 * Coordinates: design bboxes are absolute Figma-canvas — re-based here to
 * the frame's origin and uniformly scaled by liveWidth/designWidth (handles
 * scrollbar-width drift; a real frame↔viewport mismatch is warned about
 * upstream, spec §11). Live bboxes are already page coordinates and stay
 * untouched: the frame's top-left corresponds to the page's (0,0).
 *
 * Buckets (spec §6.3): matched pairs / in-design-not-in-DOM (only
 * *significant* nodes — a layout-only wrapper FRAME with no fill isn't a
 * "missing element") / in-DOM-not-in-design (informational).
 */
import type { BBox, MatchedPair, NormalizedNode } from '../types.js';
import { textSimilarity } from './similarity.js';

export interface MatchOptions {
  /** DOM attribute that explicitly maps to a Figma node id. */
  mappingAttribute: string;
  /** Uniform scale applied to design coordinates (liveWidth/designWidth). */
  scale: number;
}

export interface MatchResult {
  pairs: MatchedPair[];
  /** Significant visible design nodes with no live counterpart. */
  designOnly: NormalizedNode[];
  /** Significant live nodes with no design counterpart. */
  liveOnly: NormalizedNode[];
}

interface FlatNode {
  node: NormalizedNode;
  parent: FlatNode | null;
  /** bbox re-based to the tree root's origin (and scaled, for design). */
  rel: BBox | null;
}

export function matchTrees(
  designRoot: NormalizedNode,
  liveRoot: NormalizedNode,
  options: MatchOptions,
): MatchResult {
  // Roots are the coordinate anchors, not candidates — the frame *is* the
  // page. Design re-bases to the frame's canvas origin; live boxes are
  // already page coordinates (origin (0,0), not body's bbox — margin
  // collapse can displace body's own box).
  const design = flatten(designRoot, designRoot.bbox, options.scale).filter(
    (f) => f.node !== designRoot && f.node.visible,
  );
  const live = flatten(liveRoot, null, 1).filter((f) => f.node !== liveRoot);

  const pairs: MatchedPair[] = [];
  const matchedDesign = new Set<NormalizedNode>();
  const matchedLive = new Set<NormalizedNode>();

  const pair = (d: FlatNode, l: FlatNode, method: MatchedPair['method'], confidence: number) => {
    pairs.push({ design: d.node, live: l.node, method, confidence: round2(confidence) });
    matchedDesign.add(d.node);
    matchedLive.add(l.node);
  };
  const free = (list: FlatNode[], matched: Set<NormalizedNode>) =>
    list.filter((f) => !matched.has(f.node));

  // Pass 1 — explicit attribute mapping.
  const byFigmaId = new Map<string, FlatNode>();
  for (const l of live) {
    const id = l.node.attributes?.[options.mappingAttribute];
    if (id && !byFigmaId.has(id)) byFigmaId.set(id, l);
  }
  for (const d of design) {
    const l = byFigmaId.get(d.node.id);
    if (l && !matchedLive.has(l.node)) pair(d, l, 'attribute', 1);
  }

  // Pass 2 — text content.
  const designTexts = groupByText(free(design, matchedDesign));
  const liveTexts = groupByText(free(live, matchedLive));
  for (const [text, dNodes] of designTexts) {
    const lNodes = liveTexts.get(text);
    if (!lNodes) continue;
    if (dNodes.length === 1 && lNodes.length === 1) {
      pair(dNodes[0], lNodes[0], 'text', 0.9);
    } else {
      // Ambiguous (repeated copy, e.g. list items): pair nearest-first.
      for (const d of dNodes) {
        const candidates = lNodes.filter((l) => !matchedLive.has(l.node));
        const nearest = minBy(candidates, (l) => centerDistance(d.rel, l.rel));
        if (nearest) pair(d, nearest, 'text', 0.75);
      }
    }
  }

  // Pass 2b — fuzzy text: reworded copy ("Sign In" vs "Login") won't match
  // exactly, but a high similarity + proximity still points at the same
  // element. Pairing it here means the `text` pointer reports "copy differs"
  // instead of a false "missing element". Lower confidence than exact text.
  const dText = free(design, matchedDesign).filter((f) => f.node.type === 'TEXT' && f.node.text);
  const lText = free(live, matchedLive).filter((f) => f.node.type === 'TEXT' && f.node.text);
  const fuzzy: Array<{ d: FlatNode; l: FlatNode; sim: number }> = [];
  for (const d of dText) {
    for (const l of lText) {
      const sim = textSimilarity(d.node.text!, l.node.text!);
      if (sim >= 0.6) fuzzy.push({ d, l, sim });
    }
  }
  fuzzy.sort((a, b) => b.sim - a.sim);
  for (const { d, l, sim } of fuzzy) {
    if (matchedDesign.has(d.node) || matchedLive.has(l.node)) continue;
    pair(d, l, 'text', round2(0.6 + 0.2 * sim)); // 0.72–0.8
  }

  // Pass 3 — anchor propagation: matched children pull parents together.
  const flatByNode = new Map<NormalizedNode, FlatNode>();
  for (const f of [...design, ...live]) flatByNode.set(f.node, f);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of [...pairs]) {
      const dParent = flatByNode.get(p.design)?.parent;
      const lParent = flatByNode.get(p.live)?.parent;
      if (!dParent || !lParent) continue;
      if (!flatByNode.has(dParent.node) || !flatByNode.has(lParent.node)) continue; // a root
      if (matchedDesign.has(dParent.node) || matchedLive.has(lParent.node)) continue;
      if (!typesCompatible(dParent.node, lParent.node)) continue;
      pair(dParent, lParent, 'anchor', 0.8 * p.confidence);
      grew = true;
    }
  }

  // Pass 4 — geometry: greedy best-first on a type/position/size score.
  // Hidden live nodes are excluded: geometry is too weak a signal to claim
  // "your missing element is actually this invisible one" — only explicit
  // signals (attribute/text) may pair with hidden elements.
  const dFree = free(design, matchedDesign).filter((f) => f.rel);
  const lFree = free(live, matchedLive).filter((f) => f.rel && f.node.visible);
  const diag = liveRoot.bbox ? Math.hypot(liveRoot.bbox.width, liveRoot.bbox.height) : 1;
  // 0.75 floor: a true counterpart (same place, same size) scores ~0.95+;
  // a *different* element that merely overlaps scores ~0.6. Better to report
  // a clean "missing element" than to pair junk and emit position/size/color
  // noise about the wrong element.
  const scored: Array<{ d: FlatNode; l: FlatNode; score: number }> = [];
  for (const d of dFree) {
    for (const l of lFree) {
      if (!typesCompatible(d.node, l.node)) continue;
      const score = geometryScore(d.rel!, l.rel!, diag);
      if (score >= 0.75) scored.push({ d, l, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  for (const { d, l, score } of scored) {
    if (matchedDesign.has(d.node) || matchedLive.has(l.node)) continue;
    pair(d, l, 'geometry', score * 0.7);
  }

  return {
    pairs,
    designOnly: free(design, matchedDesign)
      .filter((f) => isSignificantDesign(f.node))
      .map((f) => f.node),
    liveOnly: free(live, matchedLive)
      .filter((f) => isSignificantLive(f.node))
      .map((f) => f.node),
  };
}

/** Re-base every bbox to the root origin, scaling design coordinates. */
function flatten(root: NormalizedNode, origin: BBox | null, scale: number): FlatNode[] {
  const out: FlatNode[] = [];
  const ox = origin?.x ?? 0;
  const oy = origin?.y ?? 0;
  const walk = (node: NormalizedNode, parent: FlatNode | null) => {
    const rel: BBox | null = node.bbox
      ? {
          x: (node.bbox.x - ox) * scale,
          y: (node.bbox.y - oy) * scale,
          width: node.bbox.width * scale,
          height: node.bbox.height * scale,
        }
      : null;
    const flat: FlatNode = { node, parent, rel };
    out.push(flat);
    for (const child of node.children) walk(child, flat);
  };
  walk(root, null);
  return out;
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function groupByText(nodes: FlatNode[]): Map<string, FlatNode[]> {
  const map = new Map<string, FlatNode[]>();
  for (const f of nodes) {
    if (f.node.type !== 'TEXT' || !f.node.text) continue;
    const key = normalizeText(f.node.text);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(f);
    map.set(key, list);
  }
  return map;
}

/** TEXT only pairs with TEXT; containers/shapes pair with any element. */
function typesCompatible(design: NormalizedNode, live: NormalizedNode): boolean {
  return (design.type === 'TEXT') === (live.type === 'TEXT');
}

/** 0..1: half size similarity, half proximity (relative to page diagonal). */
function geometryScore(d: BBox, l: BBox, diag: number): number {
  const sizeSim =
    (Math.min(d.width, l.width) / Math.max(d.width, l.width) || 0) *
    (Math.min(d.height, l.height) / Math.max(d.height, l.height) || 0);
  const dist = Math.hypot(
    d.x + d.width / 2 - (l.x + l.width / 2),
    d.y + d.height / 2 - (l.y + l.height / 2),
  );
  const proximity = Math.max(0, 1 - dist / (diag * 0.25));
  return 0.5 * sizeSim + 0.5 * proximity;
}

function centerDistance(a: BBox | null, b: BBox | null): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.hypot(
    a.x + a.width / 2 - (b.x + b.width / 2),
    a.y + a.height / 2 - (b.y + b.height / 2),
  );
}

/** A design node whose absence from the DOM is a real "missing element":
 * text, anything visibly painted, or a component instance. Layout-only
 * wrappers (no fill, no stroke) are structure, not content. */
function isSignificantDesign(node: NormalizedNode): boolean {
  if (node.type === 'TEXT') return true;
  if (node.type === 'INSTANCE' || node.type === 'COMPONENT') return true;
  const painted = (paints: NormalizedNode['fills']) => paints.some((p) => p.visible);
  return painted(node.fills) || painted(node.strokes);
}

/** A live node worth reporting as "in DOM but not in design" (info bucket):
 * visible, and either text or visibly painted. Bare wrappers are noise. */
function isSignificantLive(node: NormalizedNode): boolean {
  if (!node.visible) return false;
  if (node.type === 'TEXT' && node.text) return true;
  return node.fills.some((p) => p.visible) || node.strokes.some((p) => p.visible);
}

function minBy<T>(list: T[], fn: (t: T) => number): T | undefined {
  let best: T | undefined;
  let bestValue = Number.POSITIVE_INFINITY;
  for (const item of list) {
    const value = fn(item);
    if (value < bestValue) {
      best = item;
      bestValue = value;
    }
  }
  return best;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
