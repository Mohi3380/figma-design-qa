/**
 * Text similarity for fuzzy matching (Phase 7+).
 *
 * UI copy rarely matches the design byte-for-byte — case tweaks, a reworded
 * subtitle, a trailing period. Exact comparison turns all of these into hard
 * "missing"/"mismatch" failures. A similarity ratio lets the tool say
 * "94% similar — minor wording drift" instead, and lets the matcher pair a
 * design text with its live counterpart even when the words shifted.
 *
 * Sørensen–Dice over character bigrams: robust for short strings, cheap, and
 * symmetric. Returns 0..1 (1 = identical after normalization).
 */

export function normalizeForSimilarity(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function textSimilarity(a: string, b: string): number {
  const x = normalizeForSimilarity(a);
  const y = normalizeForSimilarity(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0; // too short for bigrams and not equal

  const bigrams = (s: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      map.set(g, (map.get(g) ?? 0) + 1);
    }
    return map;
  };

  const A = bigrams(x);
  const B = bigrams(y);
  let intersection = 0;
  for (const [g, countA] of A) {
    const countB = B.get(g);
    if (countB) intersection += Math.min(countA, countB);
  }
  return (2 * intersection) / (x.length - 1 + (y.length - 1));
}
