import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/web-ui/server.js';

/** Boot the app on an ephemeral port and return its base URL. */
function listen(): Promise<{ base: string; close: () => Promise<void> }> {
  const app = createApp({ port: 0, host: '127.0.0.1', configPath: 'nope.json', outDir: 'nowhere' });
  return new Promise((resolve) => {
    app.listen(0, '127.0.0.1', () => {
      const { port } = app.address() as AddressInfo;
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => app.close(() => r())),
      });
    });
  });
}

/** Read an SSE response body into [eventName, dataObject] pairs. */
async function readSse(res: Response): Promise<Array<[string, unknown]>> {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((chunk) => {
      const event = /event: (.+)/.exec(chunk)?.[1] ?? '';
      const data = /data: (.+)/.exec(chunk)?.[1];
      return [event, data ? JSON.parse(data) : undefined] as [string, unknown];
    });
}

describe('web-ui server', () => {
  let server: { base: string; close: () => Promise<void> };

  beforeAll(async () => {
    server = await listen();
  });
  afterAll(() => server.close());

  it('serves the single-page app at /', async () => {
    const res = await fetch(`${server.base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<title>KODERLABS Design QA');
    expect(body).toContain('Run QA');
    expect(body).toContain('rel="icon"'); // favicon present
    expect(body).toContain('name="description"'); // SEO meta present
  });

  it('404s unknown routes', async () => {
    const res = await fetch(`${server.base}/nope`);
    expect(res.status).toBe(404);
  });

  it('/run with no params streams an error event', async () => {
    const res = await fetch(`${server.base}/run`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = await readSse(res);
    expect(events).toHaveLength(1);
    expect(events[0][0]).toBe('error');
    expect((events[0][1] as { message: string }).message).toMatch(/required/i);
  });

  it('/run surfaces a missing-token error through the stream (no FIGMA_TOKEN in test env)', async () => {
    const prev = process.env.FIGMA_TOKEN;
    delete process.env.FIGMA_TOKEN;
    try {
      const res = await fetch(
        `${server.base}/run?figma=${encodeURIComponent('https://figma.com/design/K/F?node-id=1-2')}&target=${encodeURIComponent('https://example.com')}&vision=false&pdf=false`,
      );
      const events = await readSse(res);
      const error = events.find(([name]) => name === 'error');
      expect(error).toBeDefined();
      expect((error![1] as { message: string }).message).toMatch(/Figma token/i);
    } finally {
      if (prev !== undefined) process.env.FIGMA_TOKEN = prev;
    }
  });

  it('/report 404s when no report exists yet', async () => {
    const res = await fetch(`${server.base}/report`);
    expect(res.status).toBe(404);
  });
});
