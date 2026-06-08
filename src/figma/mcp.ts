/**
 * Figma Dev Mode MCP source (spec §10 Phase 6 — "switch Figma source to MCP").
 *
 * The claude.ai / Dev Mode Figma MCP authenticates through the user's Figma
 * session, so it reads files a personal-access-token without `file_content`
 * scope cannot. Its `get_metadata` returns a compact XML tree —
 *   <frame id="1:2" name="Card" x="20" y="40" width="300" height="120"> … </frame>
 * — carrying id / type / name / position / size, but NO colors or typography
 * (that needs the much heavier `get_design_context`). So an MCP-sourced
 * design tree powers existence / position / size pointers + the pixel-diff
 * layer; color and typography pointers simply find nothing to assert.
 *
 * The MCP tools are called by the agent/host, not this process, so the flow
 * is: fetch metadata + a node screenshot via MCP → hand the XML + PNG to
 * this module → it normalizes into the same `DesignExtraction` the REST path
 * emits, so the rest of the pipeline is unchanged.
 *
 * Coordinates: MCP x/y are relative to the immediate parent. We re-base the
 * extracted node to its own origin (0,0) and accumulate offsets down, so the
 * subtree lands in the same frame-relative space the comparison engine uses.
 */
import type { DesignExtraction, NormalizedNode } from '../types.js';

export class McpParseError extends Error {}

export interface RawMcpNode {
  tag: string;
  id: string;
  name: string;
  /** Relative to the immediate parent (as the MCP reports it). */
  x: number;
  y: number;
  width: number;
  height: number;
  children: RawMcpNode[];
}

/** MCP layer tag → the node `type` the normalized schema uses (kept close to
 * Figma REST's vocabulary so downstream type checks behave the same). */
const TYPE_MAP: Record<string, string> = {
  canvas: 'CANVAS',
  section: 'SECTION',
  frame: 'FRAME',
  group: 'GROUP',
  text: 'TEXT',
  instance: 'INSTANCE',
  symbol: 'COMPONENT',
  'rounded-rectangle': 'RECTANGLE',
  rectangle: 'RECTANGLE',
  ellipse: 'ELLIPSE',
  vector: 'VECTOR',
  line: 'LINE',
  'boolean-operation': 'BOOLEAN_OPERATION',
};

const TAG_RE = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w-]+="[^"]*")*)\s*(\/?)>/g;
const ATTR_RE = /([\w-]+)="([^"]*)"/g;

function decodeEntities(s: string): string {
  return s
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

/** Parse the MCP `get_metadata` XML into a raw node tree. */
export function parseMcpMetadata(xml: string): RawMcpNode {
  const roots: RawMcpNode[] = [];
  const stack: RawMcpNode[] = [];
  let match: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;

  while ((match = TAG_RE.exec(xml)) !== null) {
    const [, closing, tag, attrText, selfClose] = match;

    if (closing) {
      stack.pop();
      continue;
    }

    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    ATTR_RE.lastIndex = 0;
    while ((a = ATTR_RE.exec(attrText)) !== null) attrs[a[1]] = a[2];

    const node: RawMcpNode = {
      tag,
      id: attrs.id ?? '',
      name: decodeEntities(attrs.name ?? ''),
      x: Number(attrs.x ?? 0),
      y: Number(attrs.y ?? 0),
      width: Number(attrs.width ?? 0),
      height: Number(attrs.height ?? 0),
      children: [],
    };

    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);

    if (!selfClose) stack.push(node);
  }

  if (roots.length === 0) throw new McpParseError('No nodes found in the MCP metadata.');
  return roots.length === 1 ? roots[0] : { tag: 'root', id: 'root', name: 'root', x: 0, y: 0, width: 0, height: 0, children: roots };
}

/** Depth-first search for a node id (accepts `1:2` or `1-2`). */
export function findMcpNode(root: RawMcpNode, id: string): RawMcpNode | undefined {
  const want = id.replace('-', ':');
  const norm = (s: string) => s.replace('-', ':');
  const stack: RawMcpNode[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (norm(node.id) === want) return node;
    for (const child of node.children) stack.push(child);
  }
  return undefined;
}

/**
 * Convert a raw MCP subtree into a `NormalizedNode`, with `node` as the
 * frame origin (0,0) and every descendant placed in frame-relative absolute
 * coordinates. fills/strokes/typography are empty — MCP metadata has none.
 */
export function mcpToNormalized(node: RawMcpNode): NormalizedNode {
  const walk = (raw: RawMcpNode, originX: number, originY: number): NormalizedNode => {
    // This node's absolute position within the extracted frame.
    const absX = originX + raw.x;
    const absY = originY + raw.y;
    const type = TYPE_MAP[raw.tag] ?? raw.tag.toUpperCase();

    const normalized: NormalizedNode = {
      id: raw.id,
      name: raw.name || raw.id,
      type,
      visible: true,
      opacity: 1,
      bbox: { x: absX, y: absY, width: raw.width, height: raw.height },
      fills: [],
      strokes: [],
      children: raw.children.map((c) => walk(c, absX, absY)),
    };
    // Best-effort: Figma often names a text layer with its content, so expose
    // the layer name as text so the matcher has a content signal to try.
    if (type === 'TEXT' && raw.name) normalized.text = raw.name;
    return normalized;
  };

  // Extracted frame becomes the origin: its own x/y are dropped to 0,0.
  return walk({ ...node, x: 0, y: 0 }, 0, 0);
}

/** Build a `DesignExtraction` from MCP metadata XML + a chosen node. */
export function mcpExtraction(
  xml: string,
  nodeId: string,
  fileKey: string,
): DesignExtraction {
  const root = parseMcpMetadata(xml);
  const node = findMcpNode(root, nodeId);
  if (!node) throw new McpParseError(`Node "${nodeId}" not found in the MCP metadata.`);
  return {
    source: 'figma-mcp',
    fileKey,
    frameId: node.id,
    frameName: node.name || node.id,
    extractedAt: new Date().toISOString(),
    tree: mcpToNormalized(node),
  };
}
