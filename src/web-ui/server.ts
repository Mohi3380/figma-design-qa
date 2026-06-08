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
import { createServer, type ServerResponse } from 'node:http';
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
      console.log(`Design QA UI running at http://${shown}:${options.port}`);
      console.log('Open it in your browser. Ctrl+C to stop.');
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
    send('error', { message: 'Both a Figma URL and an App URL are required.' });
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
 * identically whether run via tsx or a built dist/.
 *
 * NOTE: this is a JS template literal — inside it, never use ${...} (would
 * interpolate) or backticks; the client script uses string concatenation. */
const APP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KODERLABS Design QA</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    color-scheme: light;
    --blue: #1763E6;
    --blue-dark: #0B3FA8;
    --blue-deep: #06256B;
    --sky: #4F93FF;
    --ink: #0d1b3e;
    --muted: #64748b;
    --line: #e2e9f5;
    --radius: 16px;
    --shadow: 0 10px 30px rgba(11,63,168,.10);
    --shadow-sm: 0 1px 3px rgba(11,63,168,.08);
    --font: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; font-family: var(--font); color: var(--ink); background: #eef3fc; }

  /* Hero */
  .hero { background: radial-gradient(1200px 400px at 50% -120px, var(--sky), transparent), linear-gradient(135deg, var(--blue-deep), var(--blue)); color: #fff; padding: 40px 24px 96px; text-align: center; }
  .hero .logo { width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 14px; background: #fff; color: var(--blue-deep); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 20px; letter-spacing: -1px; box-shadow: 0 6px 18px rgba(0,0,0,.2); }
  .hero h1 { margin: 0; font-size: 30px; font-weight: 800; letter-spacing: -.4px; }
  .hero p { margin: 10px auto 0; max-width: 560px; color: #d7e6ff; font-size: 15px; line-height: 1.5; }

  main { max-width: 880px; margin: -64px auto 0; padding: 0 24px 56px; position: relative; }
  .card { background: #fff; border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: 26px 28px; margin-bottom: 20px; }

  /* Form */
  .field { margin-bottom: 18px; }
  .field label { display: block; font-weight: 600; font-size: 13px; color: var(--blue-dark); margin-bottom: 7px; }
  .input-wrap { position: relative; }
  .input-wrap svg { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: #97a8c7; pointer-events: none; }
  .input-wrap input { width: 100%; padding: 12px 14px 12px 40px; border: 1px solid #c8d6ef; border-radius: 10px; font: inherit; font-size: 14px; background: #f8faff; transition: border-color .15s, box-shadow .15s, background .15s; }
  .input-wrap input:focus { outline: none; border-color: var(--blue); background: #fff; box-shadow: 0 0 0 3px rgba(23,99,230,.15); }
  .field-hint { display: block; margin-top: 6px; color: var(--muted); font-size: 12px; }

  /* Options */
  .options { display: flex; gap: 14px 22px; align-items: center; flex-wrap: wrap; margin: 4px 0 22px; }
  .switch { display: inline-flex; align-items: center; gap: 9px; cursor: pointer; font-size: 13.5px; font-weight: 500; user-select: none; }
  .switch input { position: absolute; opacity: 0; width: 0; height: 0; }
  .switch .track { width: 40px; height: 23px; background: #cdd8ee; border-radius: 999px; position: relative; transition: background .15s; flex: none; }
  .switch .track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 19px; height: 19px; background: #fff; border-radius: 50%; transition: transform .15s; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
  .switch input:checked + .track { background: var(--blue); }
  .switch input:checked + .track::after { transform: translateX(17px); }
  .switch input:focus-visible + .track { box-shadow: 0 0 0 3px rgba(23,99,230,.3); }
  .vp { display: inline-flex; align-items: center; gap: 9px; font-size: 13.5px; font-weight: 500; }
  .vp input { width: 78px; padding: 7px 10px; border: 1px solid #c8d6ef; border-radius: 8px; font: inherit; font-size: 13px; background: #f8faff; }
  .vp input:focus { outline: none; border-color: var(--blue); background: #fff; }

  /* Button */
  .primary { display: inline-flex; align-items: center; gap: 9px; background: linear-gradient(135deg, var(--blue), var(--blue-dark)); color: #fff; border: none; border-radius: 11px; padding: 13px 30px; font: inherit; font-weight: 700; font-size: 15px; cursor: pointer; box-shadow: 0 6px 16px rgba(23,99,230,.35); transition: transform .1s, box-shadow .15s, filter .15s; }
  .primary:hover:not(:disabled) { filter: brightness(1.05); box-shadow: 0 8px 22px rgba(23,99,230,.45); }
  .primary:active:not(:disabled) { transform: translateY(1px); }
  .primary:disabled { opacity: .55; cursor: default; box-shadow: none; }
  .spinner { width: 16px; height: 16px; border: 2.5px solid rgba(255,255,255,.4); border-top-color: #fff; border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .env-note { margin-top: 16px; color: var(--muted); font-size: 12.5px; display: flex; align-items: center; gap: 7px; }
  .env-note code { background: #eef3fc; color: var(--blue-dark); padding: 1px 6px; border-radius: 5px; font-size: 12px; }
  .err { display: none; background: #FEF2F2; border: 1px solid #FCA5A5; color: #b91c1c; border-radius: 10px; padding: 12px 15px; margin-top: 16px; font-size: 13.5px; }

  /* Stepper */
  .stepper { display: flex; gap: 4px; flex-wrap: wrap; }
  .step { flex: 1 1 0; min-width: 92px; display: flex; flex-direction: column; align-items: center; gap: 8px; position: relative; text-align: center; }
  .step:not(:last-child)::after { content: ""; position: absolute; top: 15px; left: 50%; width: 100%; height: 2px; background: var(--line); z-index: 0; }
  .step.done:not(:last-child)::after { background: var(--blue); }
  .step .dot { width: 32px; height: 32px; border-radius: 50%; background: #fff; border: 2px solid var(--line); color: var(--muted); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; z-index: 1; transition: .2s; }
  .step.active .dot { border-color: var(--blue); color: var(--blue); box-shadow: 0 0 0 4px rgba(23,99,230,.15); }
  .step.done .dot { background: var(--blue); border-color: var(--blue); color: #fff; }
  .step .lbl { font-size: 11.5px; color: var(--muted); font-weight: 500; }
  .step.active .lbl, .step.done .lbl { color: var(--ink); }
  .log-details { margin-top: 18px; border-top: 1px solid var(--line); padding-top: 12px; }
  .log-details summary { cursor: pointer; font-size: 13px; color: var(--muted); font-weight: 600; }
  #progress { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: #475569; max-height: 200px; overflow: auto; margin-top: 10px; }
  #progress div { padding: 1px 0; }
  #progress div::before { content: "›"; color: var(--blue); margin-right: 7px; }
  #progress .ok { color: #15803d; font-weight: 600; }
  #progress .ok::before { content: "✓"; color: #15803d; }

  /* Results */
  #results { display: none; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 14px; }
  .stat { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; box-shadow: var(--shadow-sm); }
  .stat .num { font-size: 24px; font-weight: 800; line-height: 1; }
  .stat .num.pass { color: #15803d; } .stat .num.fail { color: #dc2626; }
  .stat .cap { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .chip { color: #fff; border-radius: 999px; padding: 4px 14px; font-size: 12px; font-weight: 600; }
  .chip.zero { opacity: .4; }

  .browser-frame { background: #fff; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; box-shadow: var(--shadow); }
  .browser-bar { display: flex; align-items: center; gap: 7px; padding: 11px 14px; background: #f6f9ff; border-bottom: 1px solid var(--line); }
  .browser-bar .dot3 { width: 11px; height: 11px; border-radius: 50%; }
  .dot3.r { background: #ff5f56; } .dot3.y { background: #ffbd2e; } .dot3.g { background: #27c93f; }
  .bar-title { margin-left: 8px; font-size: 12.5px; color: var(--muted); font-weight: 500; }
  .bar-title b { color: var(--ink); }
  .browser-bar a { margin-left: auto; font-size: 12.5px; color: var(--blue); font-weight: 600; text-decoration: none; }
  .browser-bar a:hover { text-decoration: underline; }
  iframe { width: 100%; height: 700px; border: 0; background: #fff; display: block; }

  footer { text-align: center; color: #93a3c0; font-size: 12px; padding: 0 0 36px; }
  footer b { color: var(--blue-dark); }
</style>
</head>
<body>
<header class="hero">
  <div class="logo">KL</div>
  <h1>KODERLABS Design QA</h1>
  <p>Pixel-perfect verification — compare a Figma design against your live app and get a severity-graded report.</p>
</header>

<main>
  <section class="card">
    <div class="field">
      <label for="figma">Figma URL</label>
      <div class="input-wrap">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"></path></svg>
        <input type="text" id="figma" placeholder="https://figma.com/design/AbC123/Checkout?node-id=12-345" autocomplete="off" spellcheck="false">
      </div>
      <span class="field-hint">The frame's share link — right-click the frame in Figma → Copy link.</span>
    </div>
    <div class="field">
      <label for="target">App URL</label>
      <div class="input-wrap">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 8h18"></path><circle cx="6.5" cy="6" r=".6" fill="currentColor"></circle><circle cx="8.5" cy="6" r=".6" fill="currentColor"></circle></svg>
        <input type="text" id="target" placeholder="http://localhost:3000/checkout" autocomplete="off" spellcheck="false">
      </div>
      <span class="field-hint">Production, staging, or a local dev URL — anything reachable from this machine.</span>
    </div>

    <div class="options">
      <label class="switch"><input type="checkbox" id="vision" checked><span class="track"></span><span>Vision adjudication</span></label>
      <label class="switch"><input type="checkbox" id="pdf" checked><span class="track"></span><span>Render PDF</span></label>
      <span class="vp"><span>Viewport</span><input type="text" id="viewport" placeholder="auto" autocomplete="off"></span>
    </div>

    <button id="run" class="primary">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="play"><path d="M8 5v14l11-7z"></path></svg>
      <span class="btn-label">Run QA</span>
      <span class="spinner" hidden></span>
    </button>

    <div class="env-note">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-5M12 8h.01"></path></svg>
      <span>Needs <code>FIGMA_TOKEN</code> in the server environment (and <code>ANTHROPIC_API_KEY</code> for vision).</span>
    </div>
    <div class="err" id="err"></div>
  </section>

  <section class="card" id="progressCard" hidden>
    <div class="stepper" id="stepper"></div>
    <details class="log-details">
      <summary>Detailed log</summary>
      <div id="progress"></div>
    </details>
  </section>

  <section id="results">
    <div class="stats" id="stats"></div>
    <div class="chips" id="chips"></div>
    <div class="browser-frame">
      <div class="browser-bar">
        <span class="dot3 r"></span><span class="dot3 y"></span><span class="dot3 g"></span>
        <span class="bar-title" id="reportTitle">report.html</span>
        <a id="reportLink" href="/report" target="_blank">Open in new tab ↗</a>
      </div>
      <iframe id="report" title="QA report"></iframe>
    </div>
  </section>
</main>

<footer><b>KODERLABS</b> Design QA · runs locally · two URLs in, a report out</footer>

<script>
  var $ = function (id) { return document.getElementById(id); };
  var runBtn = $('run'), progress = $('progress'), progressCard = $('progressCard');
  var errBox = $('err'), iframe = $('report'), reportLink = $('reportLink'), reportTitle = $('reportTitle');
  var results = $('results'), stats = $('stats'), chips = $('chips'), stepper = $('stepper');
  var spinner = runBtn.querySelector('.spinner'), btnLabel = runBtn.querySelector('.btn-label'), play = runBtn.querySelector('.play');
  var SEV = { critical: '#DC2626', high: '#EA580C', medium: '#D97706', low: '#2563EB', info: '#64748B' };

  var STEPS = [
    { id: 'extract', lbl: 'Extract', match: ['Fetching node', 'Normalizing', 'Rendering frame'] },
    { id: 'capture', lbl: 'Capture', match: ['Capturing'] },
    { id: 'compare', lbl: 'Compare', match: ['Comparing'] },
    { id: 'pixel', lbl: 'Pixel diff', match: ['Pixel-diffed', 'evidence images'] },
    { id: 'vision', lbl: 'Adjudicate', match: ['Adjudicating', 'adjudicated', 'Skipping vision'] },
    { id: 'report', lbl: 'Report', match: [] }
  ];
  function renderStepper() {
    stepper.innerHTML = STEPS.map(function (s, i) {
      return '<div class="step" data-i="' + i + '"><div class="dot">' + (i + 1) + '</div><div class="lbl">' + s.lbl + '</div></div>';
    }).join('');
  }
  function setStep(active) {
    var nodes = stepper.querySelectorAll('.step');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].className = 'step' + (i < active ? ' done' : i === active ? ' active' : '');
      var dot = nodes[i].querySelector('.dot');
      dot.textContent = i < active ? '\\u2713' : (i + 1);
    }
  }
  function advanceFromLog(msg) {
    for (var i = STEPS.length - 1; i >= 0; i--) {
      for (var j = 0; j < STEPS[i].match.length; j++) {
        if (msg.indexOf(STEPS[i].match[j]) !== -1) { setStep(i); return; }
      }
    }
  }
  function line(text, cls) {
    var div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = text;
    progress.appendChild(div);
    progress.scrollTop = progress.scrollHeight;
  }

  function setRunning(on) {
    runBtn.disabled = on;
    spinner.hidden = !on;
    play.style.display = on ? 'none' : '';
    btnLabel.textContent = on ? 'Running…' : 'Run QA';
  }

  runBtn.addEventListener('click', function () {
    var figma = $('figma').value.trim(), target = $('target').value.trim();
    if (!figma || !target) { showError('Enter both a Figma URL and an App URL.'); return; }

    setRunning(true);
    errBox.style.display = 'none';
    results.style.display = 'none';
    progressCard.hidden = false;
    progress.innerHTML = '';
    renderStepper(); setStep(0);

    var params = new URLSearchParams({
      figma: figma, target: target,
      vision: $('vision').checked ? 'true' : 'false',
      pdf: $('pdf').checked ? 'true' : 'false'
    });
    var vp = $('viewport').value.trim();
    if (vp) params.set('viewport', vp);

    var es = new EventSource('/run?' + params.toString());
    es.addEventListener('log', function (e) {
      var msg = JSON.parse(e.data).message;
      line(msg);
      advanceFromLog(msg);
    });
    es.addEventListener('error', function (e) {
      if (e.data) { showError(JSON.parse(e.data).message); }
      es.close(); setRunning(false);
    });
    es.addEventListener('done', function (e) {
      var d = JSON.parse(e.data);
      setStep(STEPS.length);
      line('done', 'ok');
      renderResults(d);
      iframe.src = '/report?t=' + Date.now();
      results.style.display = 'block';
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
      es.close(); setRunning(false);
    });
  });

  function renderResults(d) {
    var s = d.summary, sev = s.issuesBySeverity;
    stats.innerHTML =
      statCard(s.pointersChecked, 'pointers checked', '') +
      statCard(s.passed, 'passed', 'pass') +
      statCard(s.failed, 'failed', 'fail') +
      statCard(d.matching.matched, 'elements matched', '');
    var order = ['critical', 'high', 'medium', 'low', 'info'];
    chips.innerHTML = order.map(function (k) {
      return '<span class="chip' + (sev[k] ? '' : ' zero') + '" style="background:' + SEV[k] + '">' + k + ' ' + sev[k] + '</span>';
    }).join('');
    reportTitle.innerHTML = '<b>' + esc(d.frameName) + '</b> @ ' + d.viewport + 'px' + (d.hasPdf ? ' · PDF ready' : '');
  }
  function statCard(num, cap, cls) {
    return '<div class="stat"><div class="num ' + cls + '">' + num + '</div><div class="cap">' + cap + '</div></div>';
  }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function showError(msg) {
    errBox.textContent = msg;
    errBox.style.display = 'block';
    setRunning(false);
  }
</script>
</body>
</html>`;
