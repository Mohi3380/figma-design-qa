/**
 * Figma URL parsing.
 *
 * Accepts the URLs people actually paste:
 *   https://www.figma.com/design/:fileKey/:fileName?node-id=12-345
 *   https://www.figma.com/file/:fileKey/:fileName?node-id=12-345   (legacy)
 *   https://www.figma.com/design/:fileKey/branch/:branchKey/:name  (branch → use branchKey)
 *
 * Figma encodes node ids as "12-345" in URLs but the API wants "12:345".
 */

export interface FigmaRef {
  fileKey: string;
  /** API-format node id ("12:345"), if the URL targeted a specific node. */
  nodeId?: string;
}

export class FigmaUrlError extends Error {}

export function parseFigmaUrl(input: string): FigmaRef {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FigmaUrlError(`Not a valid URL: "${input}"`);
  }

  if (!/(^|\.)figma\.com$/.test(url.hostname)) {
    throw new FigmaUrlError(`Not a figma.com URL: "${input}"`);
  }

  const parts = url.pathname.split('/').filter(Boolean);
  // ["design"|"file", fileKey, ...rest] — possibly [..., "branch", branchKey, name]
  if (parts.length < 2 || !['design', 'file', 'proto'].includes(parts[0])) {
    throw new FigmaUrlError(`Unrecognized Figma URL path: "${url.pathname}"`);
  }

  let fileKey = parts[1];
  const branchIndex = parts.indexOf('branch');
  if (branchIndex !== -1 && parts.length > branchIndex + 1) {
    fileKey = parts[branchIndex + 1]; // branches are addressed by their own key
  }

  const ref: FigmaRef = { fileKey };

  const rawNodeId = url.searchParams.get('node-id');
  if (rawNodeId) {
    ref.nodeId = normalizeNodeId(rawNodeId);
  }
  return ref;
}

/** "12-345" (URL form) → "12:345" (API form). Already-API-form ids pass through. */
export function normalizeNodeId(id: string): string {
  return id.replace(/-/g, ':');
}
