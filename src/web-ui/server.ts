/**
 * Web UI (Phase 7): a thin local server that wraps the pipeline so you can
 * run a QA from the browser instead of the terminal — paste the two URLs,
 * click Run, watch progress stream in, view the report inline.
 *
 * Built on Node's `http` (no web-framework dependency). Three routes:
 *   GET /             → the single-page app (HTML embedded below)
 *   GET /run?…        → Server-Sent Events: pipeline progress, then a `done`
 *                       (summary) or `error` event
 *   GET /report       → the most recent self-contained report.html
 *
 * Binds to 127.0.0.1 by default — it runs the pipeline with your local
 * FIGMA_TOKEN / ANTHROPIC_API_KEY, so it is not meant to face the network.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { runPipeline } from '../pipeline.js';

export interface ServeOptions {
  port: number;
  host: string;
  configPath: string;
  outDir: string;
}

export function createApp(options: ServeOptions) {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/') return sendHtml(res, APP_HTML);
    if (req.method === 'GET' && url.pathname === '/run') return runViaSse(url, res, options);
    if (req.method === 'GET' && url.pathname === '/report') return sendReport(res, options.outDir);
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  });
}

export function serve(options: ServeOptions): Promise<void> {
  return new Promise((resolve) => {
    const server = createApp(options);
    server.listen(options.port, options.host, () => {
      const shown = options.host === '0.0.0.0' ? 'localhost' : options.host;
      console.log(`▸ Design QA UI running at http://${shown}:${options.port}`);
      console.log('  Open it in your browser. Ctrl+C to stop.');
      resolve();
    });
  });
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function sendReport(res: ServerResponse, outDir: string): Promise<void> {
  try {
    const html = await readFile(path.join(outDir, 'report.html'), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('No report yet — run a QA first.');
  }
}

/** Stream the pipeline as Server-Sent Events. */
async function runViaSse(url: URL, res: ServerResponse, options: ServeOptions): Promise<void> {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const figma = url.searchParams.get('figma')?.trim();
  const target = url.searchParams.get('target')?.trim();
  if (!figma || !target) {
    send('error', { message: 'Both a Figma URL and a site URL are required.' });
    res.end();
    return;
  }
  const vision = url.searchParams.get('vision') !== 'false';
  const pdf = url.searchParams.get('pdf') !== 'false';
  const viewport = url.searchParams.get('viewport');

  try {
    const config = await loadConfig(options.configPath);
    const result = await runPipeline({
      figmaUrl: figma,
      target,
      viewport: viewport ? Number(viewport) : undefined,
      config,
      outDir: options.outDir,
      vision,
      pdf,
      figmaToken: process.env.FIGMA_TOKEN,
      anthropicKey: process.env.ANTHROPIC_API_KEY,
      log: (message) => send('log', { message }),
    });

    send('done', {
      summary: result.report.summary,
      matching: result.report.matching,
      viewport: result.viewport,
      frameName: result.report.design.frameName,
      hasPdf: Boolean(result.pdfPath),
    });
  } catch (err) {
    send('error', { message: err instanceof Error ? err.message : String(err) });
  } finally {
    res.end();
  }
}

/** The single-page app. Embedded (not a separate file) so it serves
 * identically whether run via tsx or a built dist/. */
const APP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Design QA</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1a1a2e; background: #f5f6fa; }
  header { background: #fff; border-bottom: 1px solid #e6e8ee; padding: 16px 24px; }
  header h1 { margin: 0; font-size: 18px; }
  header p { margin: 2px 0 0; color: #667; font-size: 13px; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px; }
  .card { background: #fff; border: 1px solid #e6e8ee; border-radius: 10px; padding: 18px 20px; margin-bottom: 18px; }
  label { display: block; font-weight: 600; font-size: 13px; margin: 10px 0 4px; }
  input[type=text] { width: 100%; padding: 9px 11px; border: 1px solid #cfd4e0; border-radius: 7px; font: inherit; }
  input[type=text]:focus { outline: 2px solid #2D6CDF; border-color: #2D6CDF; }
  .row { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; margin-top: 12px; }
  .row label { margin: 0; font-weight: 400; display: flex; gap: 6px; align-items: center; }
  .actions { margin-top: 16px; display: flex; gap: 12px; align-items: center; }
  button { background: #2D6CDF; color: #fff; border: none; border-radius: 8px; padding: 10px 22px; font: inherit; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  .hint { color: #889; font-size: 12px; }
  #progress { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; background: #0f1117; color: #cdd3e0; border-radius: 8px; padding: 12px 14px; max-height: 260px; overflow: auto; white-space: pre-wrap; display: none; }
  #progress .warn { color: #f9c66b; }
  #progress .ok { color: #6bd089; }
  #summary { display: none; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
  .chip { color: #fff; border-radius: 999px; padding: 3px 13px; font-size: 12px; font-weight: 600; }
  .stat { background: #f0f2f7; border-radius: 8px; padding: 6px 12px; font-size: 13px; }
  iframe { width: 100%; height: 720px; border: 1px solid #e6e8ee; border-radius: 10px; background: #fff; display: none; margin-top: 8px; }
  .err { display: none; background: #FDECEA; border: 1px solid #D32F2F; color: #b71c1c; border-radius: 8px; padding: 10px 14px; margin-top: 12px; }
  a.report-link { display: none; font-size: 13px; }
</style>
</head>
<body>
<header>
  <h1>Design QA</h1>
  <p>Compare a Figma frame against a live page. Two URLs in, a report out.</p>
</header>
<main>
  <div class="card">
    <label for="figma">Figma frame URL</label>
    <input type="text" id="figma" placeholder="https://figma.com/design/AbC123/Checkout?node-id=12-345" autocomplete="off">
    <label for="target">Site URL</label>
    <input type="text" id="target" placeholder="http://localhost:3000/checkout" autocomplete="off">
    <div class="row">
      <label><input type="checkbox" id="vision" checked> Vision adjudication (Layer C)</label>
      <label><input type="checkbox" id="pdf" checked> Also render PDF</label>
      <label>Viewport <input type="text" id="viewport" placeholder="auto" style="width:80px" autocomplete="off"></label>
    </div>
    <div class="actions">
      <button id="run">Run QA</button>
      <span class="hint">Needs FIGMA_TOKEN (and ANTHROPIC_API_KEY for vision) in the server's environment.</span>
    </div>
    <div class="err" id="err"></div>
    <div id="summary"></div>
    <a class="report-link" id="reportLink" href="/report" target="_blank">Open full report in a new tab ↗</a>
  </div>
  <div id="progress"></div>
  <iframe id="report" title="QA report"></iframe>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  const runBtn = $('run'), progress = $('progress'), summary = $('summary');
  const errBox = $('err'), iframe = $('report'), reportLink = $('reportLink');
  const SEV = { critical: '#D32F2F', high: '#EF6C00', medium: '#F9A825', low: '#1976D2', info: '#607D8B' };

  function line(text, cls) {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = text;
    progress.appendChild(div);
    progress.scrollTop = progress.scrollHeight;
  }

  runBtn.addEventListener('click', () => {
    const figma = $('figma').value.trim(), target = $('target').value.trim();
    if (!figma || !target) { showError('Enter both a Figma URL and a site URL.'); return; }

    runBtn.disabled = true;
    errBox.style.display = 'none';
    summary.style.display = 'none'; summary.innerHTML = '';
    iframe.style.display = 'none'; reportLink.style.display = 'none';
    progress.style.display = 'block'; progress.innerHTML = '';

    const params = new URLSearchParams({
      figma, target,
      vision: $('vision').checked ? 'true' : 'false',
      pdf: $('pdf').checked ? 'true' : 'false',
    });
    const vp = $('viewport').value.trim();
    if (vp) params.set('viewport', vp);

    const es = new EventSource('/run?' + params.toString());
    es.addEventListener('log', (e) => line('▸ ' + JSON.parse(e.data).message));
    es.addEventListener('error', (e) => {
      // Network drop fires a contentless error; only show a message we were sent.
      if (e.data) { showError(JSON.parse(e.data).message); }
      else if (es.readyState === EventSource.CLOSED) { /* normal close */ }
      es.close(); runBtn.disabled = false;
    });
    es.addEventListener('done', (e) => {
      const d = JSON.parse(e.data);
      line('\\u2714 done', 'ok');
      renderSummary(d);
      iframe.src = '/report?t=' + Date.now();
      iframe.style.display = 'block';
      reportLink.style.display = 'inline';
      es.close(); runBtn.disabled = false;
    });
  });

  function renderSummary(d) {
    const s = d.summary, sev = s.issuesBySeverity;
    const parts = [
      '<span class="stat"><b>' + d.frameName + '</b> @ ' + d.viewport + 'px</span>',
      '<span class="stat">' + s.pointersChecked + ' checked \\u00b7 ' + s.passed + ' passed \\u00b7 ' + s.failed + ' failed</span>',
    ];
    for (const k of ['critical','high','medium','low','info']) {
      parts.push('<span class="chip" style="background:' + SEV[k] + '">' + k + ' ' + sev[k] + '</span>');
    }
    summary.innerHTML = parts.join(' ');
    summary.style.display = 'flex';
  }

  function showError(msg) {
    errBox.textContent = '\\u2716 ' + msg;
    errBox.style.display = 'block';
    runBtn.disabled = false;
  }
</script>
</body>
</html>`;
