/**
 * Minimal Figma REST API client (spec §6.1, REST fallback path).
 *
 * Only the two endpoints Phase 1 needs:
 *   GET /v1/files/:key/nodes?ids=...       → raw node subtrees
 *   GET /v1/images/:key?ids=...&format=png → rendered frame PNG URLs
 *
 * Auth: personal access token in the X-Figma-Token header, read from
 * FIGMA_TOKEN by the caller. No SDK dependency — native fetch is enough.
 */

const API_BASE = 'https://api.figma.com';

export class FigmaApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

export interface FigmaClientOptions {
  token: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/** Raw (un-normalized) Figma node as returned by the REST API. Deliberately
 * loose — the normalizer is the layer that imposes shape. */
export type RawFigmaNode = Record<string, unknown> & {
  id: string;
  name: string;
  type: string;
  children?: RawFigmaNode[];
};

interface FileNodesResponse {
  name: string;
  nodes: Record<string, { document: RawFigmaNode } | null>;
}

interface ImagesResponse {
  err: string | null;
  images: Record<string, string | null>;
}

export class FigmaClient {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FigmaClientOptions) {
    if (!options.token) {
      throw new FigmaApiError(
        'Missing Figma token. Set the FIGMA_TOKEN environment variable (Figma → Settings → Security → Personal access tokens).',
      );
    }
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${API_BASE}${path}`, {
      headers: { 'X-Figma-Token': this.token },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new FigmaApiError(
        `Figma API ${res.status} ${res.statusText} for ${path}${body ? ` — ${truncate(body, 300)}` : ''}`,
        res.status,
      );
    }
    return (await res.json()) as T;
  }

  /** Fetch one node's raw subtree (the frame to extract). */
  async getNode(fileKey: string, nodeId: string): Promise<{ fileName: string; node: RawFigmaNode }> {
    const data = await this.get<FileNodesResponse>(
      `/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}`,
    );
    const entry = data.nodes[nodeId];
    if (!entry) {
      throw new FigmaApiError(`Node "${nodeId}" not found in file "${fileKey}".`);
    }
    return { fileName: data.name, node: entry.document };
  }

  /** Render a node to PNG at the given scale and return the image bytes. */
  async renderNodePng(fileKey: string, nodeId: string, scale: 1 | 2): Promise<Buffer> {
    const data = await this.get<ImagesResponse>(
      `/v1/images/${encodeURIComponent(fileKey)}?ids=${encodeURIComponent(nodeId)}&format=png&scale=${scale}`,
    );
    if (data.err) throw new FigmaApiError(`Figma image render failed: ${data.err}`);
    const url = data.images[nodeId];
    if (!url) throw new FigmaApiError(`Figma returned no image URL for node "${nodeId}".`);

    const res = await this.fetchImpl(url);
    if (!res.ok) {
      throw new FigmaApiError(`Failed to download rendered PNG (${res.status} ${res.statusText}).`, res.status);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
