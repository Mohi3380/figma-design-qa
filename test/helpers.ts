import type { NormalizedNode, ResolvedPaint } from '../src/types.js';

/** Terse NormalizedNode builder for matcher/engine tests. */
export function n(partial: Partial<NormalizedNode> & { id: string }): NormalizedNode {
  return {
    name: partial.id,
    type: 'FRAME',
    visible: true,
    opacity: 1,
    bbox: null,
    fills: [],
    strokes: [],
    children: [],
    ...partial,
  };
}

/** "#RRGGBB" → a visible SOLID paint. */
export function solid(hex: string, a = 1): ResolvedPaint {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { type: 'SOLID', visible: true, opacity: 1, color: { hex: hex.toUpperCase(), rgba: { r, g, b, a } } };
}
