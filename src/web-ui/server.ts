/**
 * Web UI (Phase 7): a thin local server that wraps the pipeline so you can
 * run a QA from the browser instead of the terminal — a landing page with the
 * tool built in: paste the two URLs, click Run, watch progress, view the
 * report inline.
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

/** The landing page + embedded tool. Self-contained (no asset routes) so it
 * serves identically under tsx or a built dist/.
 *
 * NOTE: this is a JS template literal — inside it, never use ${...} (would
 * interpolate) or backticks; the client script uses string concatenation. */
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%231763E6'/%3E%3Ctext x='32' y='45' font-family='Segoe UI,Arial,sans-serif' font-size='30' font-weight='bold' fill='white' text-anchor='middle'%3EKL%3C/text%3E%3C/svg%3E";

const APP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KODERLABS Design QA — Figma vs. live app verification</title>
<meta name="description" content="KODERLABS Design QA compares a Figma design against your live app and reports every visual mismatch — color, typography, spacing, icons, text and layout — severity-graded with evidence.">
<meta name="keywords" content="design QA, Figma, visual regression, design comparison, pixel diff, pixel perfect, KODERLABS">
<meta name="author" content="KODERLABS">
<meta name="theme-color" content="#1763E6">
<link rel="canonical" href="/">
<meta property="og:type" content="website">
<meta property="og:title" content="KODERLABS Design QA">
<meta property="og:description" content="Compare a Figma design against your live app and get a severity-graded report with evidence.">
<meta property="og:site_name" content="KODERLABS Design QA">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="KODERLABS Design QA">
<meta name="twitter:description" content="Compare a Figma design against your live app and get a severity-graded report with evidence.">
<link rel="icon" type="image/svg+xml" href="${FAVICON}">
<link rel="apple-touch-icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  :root {
    color-scheme: light;
    --blue: #1763E6;
    --blue-dark: #0B3FA8;
    --blue-deep: #06256B;
    --sky: #4F93FF;
    --ink: #0d1b3e;
    --muted: #5a6b8c;
    --line: #e2e9f5;
    --radius: 16px;
    --shadow: 0 10px 30px rgba(11,63,168,.10);
    --shadow-sm: 0 1px 3px rgba(11,63,168,.08);
    --font: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin: 0; font-family: var(--font); color: var(--ink); background: #fff; line-height: 1.55; }
  a { color: inherit; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 24px; }

  /* Nav */
  nav { position: sticky; top: 0; z-index: 50; background: rgba(255,255,255,.85); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
  nav .wrap { display: flex; align-items: center; gap: 18px; height: 64px; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 16px; letter-spacing: -.3px; }
  .brand .logo { width: 30px; height: 30px; border-radius: 8px; background: linear-gradient(135deg, var(--blue), var(--blue-deep)); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; }
  nav .links { margin-left: auto; display: flex; align-items: center; gap: 22px; }
  nav .links a { text-decoration: none; color: var(--muted); font-size: 14px; font-weight: 500; }
  nav .links a:hover { color: var(--ink); }
  .btn { display: inline-flex; align-items: center; gap: 8px; border: none; border-radius: 10px; font: inherit; font-weight: 700; cursor: pointer; text-decoration: none; }
  .btn-primary { background: linear-gradient(135deg, var(--blue), var(--blue-dark)); color: #fff; padding: 10px 20px; box-shadow: 0 6px 16px rgba(23,99,230,.32); transition: filter .15s, transform .1s, box-shadow .15s; }
  .btn-primary:hover { filter: brightness(1.06); box-shadow: 0 9px 22px rgba(23,99,230,.42); }
  .btn-primary:active { transform: translateY(1px); }
  .btn-ghost { background: #eef3fc; color: var(--blue-dark); padding: 10px 18px; }

  /* Hero */
  .hero { background: radial-gradient(900px 380px at 80% -120px, #dbe8ff, transparent), linear-gradient(180deg, #f7faff, #fff); padding: 72px 0 64px; }
  .hero .wrap { display: grid; grid-template-columns: 1.05fr .95fr; gap: 48px; align-items: center; }
  .pill { display: inline-flex; align-items: center; gap: 7px; background: #e7eefc; color: var(--blue-dark); font-size: 12.5px; font-weight: 600; padding: 5px 12px; border-radius: 999px; }
  .hero h1 { font-size: 46px; line-height: 1.08; letter-spacing: -1.2px; margin: 18px 0 0; font-weight: 900; }
  .hero h1 .grad { background: linear-gradient(120deg, var(--blue), var(--sky)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .hero p.lead { font-size: 17px; color: var(--muted); margin: 18px 0 0; max-width: 520px; }
  .hero .cta { display: flex; gap: 12px; margin-top: 28px; flex-wrap: wrap; }
  .hero .trust { margin-top: 18px; color: #8595b5; font-size: 12.5px; }

  /* Hero visual — a stylized report card */
  .preview { background: #fff; border: 1px solid var(--line); border-radius: 18px; box-shadow: var(--shadow); overflow: hidden; }
  .preview .bar { display: flex; align-items: center; gap: 6px; padding: 11px 14px; background: #f6f9ff; border-bottom: 1px solid var(--line); }
  .preview .bar i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .preview .bar .t { margin-left: 8px; font-size: 12px; color: var(--muted); }
  .preview .body { padding: 18px; }
  .preview .stat-row { display: flex; gap: 10px; margin-bottom: 14px; }
  .preview .s { flex: 1; background: #f7faff; border: 1px solid var(--line); border-radius: 10px; padding: 10px; text-align: center; }
  .preview .s b { display: block; font-size: 20px; }
  .preview .s span { font-size: 10.5px; color: var(--muted); }
  .preview .chips { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
  .ch { color: #fff; border-radius: 999px; font-size: 11px; font-weight: 700; padding: 3px 11px; }
  .preview .iss { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; font-size: 12.5px; }
  .preview .iss .h { display: flex; align-items: center; gap: 8px; }
  .preview .iss .tag { font-size: 10px; font-weight: 700; color: #fff; border-radius: 4px; padding: 1px 6px; }
  .preview .iss .d { color: var(--muted); margin-top: 3px; font-family: ui-monospace, Consolas, monospace; font-size: 11px; }

  /* Generic section */
  section.block { padding: 64px 0; }
  .eyebrow { color: var(--blue); font-weight: 700; font-size: 13px; letter-spacing: .4px; text-transform: uppercase; text-align: center; }
  h2.title { text-align: center; font-size: 32px; letter-spacing: -.6px; margin: 8px 0 6px; font-weight: 800; }
  p.sub { text-align: center; color: var(--muted); max-width: 620px; margin: 0 auto; }

  /* Steps */
  .steps3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 40px; }
  .step3 { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 22px; box-shadow: var(--shadow-sm); }
  .step3 .n { width: 34px; height: 34px; border-radius: 9px; background: #eef3fc; color: var(--blue-dark); font-weight: 800; display: flex; align-items: center; justify-content: center; }
  .step3 h3 { margin: 14px 0 6px; font-size: 16px; }
  .step3 p { margin: 0; color: var(--muted); font-size: 14px; }

  /* Features grid */
  #features { background: #f7faff; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .feat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 40px; }
  .feat { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 20px; }
  .feat .ic { width: 38px; height: 38px; border-radius: 10px; background: linear-gradient(135deg, #e7eefc, #d6e4ff); display: flex; align-items: center; justify-content: center; font-size: 19px; }
  .feat h3 { margin: 12px 0 5px; font-size: 15px; }
  .feat p { margin: 0; color: var(--muted); font-size: 13.5px; }

  /* Tool */
  #run { scroll-margin-top: 80px; }
  .tool-card { max-width: 720px; margin: 40px auto 0; background: #fff; border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: 26px 28px; }
  .field { margin-bottom: 18px; }
  .field label { display: block; font-weight: 600; font-size: 13px; color: var(--blue-dark); margin-bottom: 7px; }
  .input-wrap { position: relative; }
  .input-wrap svg { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: #97a8c7; pointer-events: none; }
  .input-wrap input { width: 100%; padding: 12px 14px 12px 40px; border: 1px solid #c8d6ef; border-radius: 10px; font: inherit; font-size: 14px; background: #f8faff; transition: border-color .15s, box-shadow .15s, background .15s; }
  .input-wrap input:focus { outline: none; border-color: var(--blue); background: #fff; box-shadow: 0 0 0 3px rgba(23,99,230,.15); }
  .field-hint { display: block; margin-top: 6px; color: var(--muted); font-size: 12px; }
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
  .primary { display: inline-flex; align-items: center; gap: 9px; background: linear-gradient(135deg, var(--blue), var(--blue-dark)); color: #fff; border: none; border-radius: 11px; padding: 13px 30px; font: inherit; font-weight: 700; font-size: 15px; cursor: pointer; box-shadow: 0 6px 16px rgba(23,99,230,.35); transition: filter .15s; }
  .primary:hover:not(:disabled) { filter: brightness(1.06); }
  .primary:disabled { opacity: .55; cursor: default; box-shadow: none; }
  .spinner { width: 16px; height: 16px; border: 2.5px solid rgba(255,255,255,.4); border-top-color: #fff; border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .env-note { margin-top: 16px; color: var(--muted); font-size: 12.5px; display: flex; align-items: center; gap: 7px; }
  .env-note code { background: #eef3fc; color: var(--blue-dark); padding: 1px 6px; border-radius: 5px; font-size: 12px; }
  .err { display: none; background: #FEF2F2; border: 1px solid #FCA5A5; color: #b91c1c; border-radius: 10px; padding: 12px 15px; margin-top: 16px; font-size: 13.5px; }

  /* Stepper + results */
  .panel { max-width: 720px; margin: 18px auto 0; background: #fff; border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow-sm); padding: 22px 24px; }
  .stepper { display: flex; gap: 4px; flex-wrap: wrap; }
  .step { flex: 1 1 0; min-width: 88px; display: flex; flex-direction: column; align-items: center; gap: 8px; position: relative; text-align: center; }
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
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 12px; margin-bottom: 14px; }
  .stat { background: #f7faff; border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
  .stat .num { font-size: 24px; font-weight: 800; line-height: 1; }
  .stat .num.pass { color: #15803d; } .stat .num.fail { color: #dc2626; }
  .stat .cap { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .chip { color: #fff; border-radius: 999px; padding: 4px 14px; font-size: 12px; font-weight: 600; }
  .chip.zero { opacity: .4; }
  .browser-frame { border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .browser-bar { display: flex; align-items: center; gap: 7px; padding: 11px 14px; background: #f6f9ff; border-bottom: 1px solid var(--line); }
  .browser-bar .dot3 { width: 11px; height: 11px; border-radius: 50%; }
  .dot3.r { background: #ff5f56; } .dot3.y { background: #ffbd2e; } .dot3.g { background: #27c93f; }
  .bar-title { margin-left: 8px; font-size: 12.5px; color: var(--muted); font-weight: 500; }
  .bar-title b { color: var(--ink); }
  .browser-bar a { margin-left: auto; font-size: 12.5px; color: var(--blue); font-weight: 600; text-decoration: none; }
  iframe { width: 100%; height: 680px; border: 0; background: #fff; display: block; }

  /* Footer */
  footer { background: var(--blue-deep); color: #cfe0ff; padding: 40px 0; }
  footer .wrap { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  footer .brand { color: #fff; }
  footer .brand .logo { background: #fff; color: var(--blue-deep); }
  footer .fl { margin-left: auto; display: flex; gap: 20px; }
  footer a { color: #cfe0ff; text-decoration: none; font-size: 14px; }
  footer a:hover { color: #fff; }
  .noscript { background: #FEF2F2; color: #b91c1c; text-align: center; padding: 10px; font-size: 14px; }

  @media (max-width: 860px) {
    .hero .wrap { grid-template-columns: 1fr; }
    .hero h1 { font-size: 36px; }
    .steps3, .feat-grid { grid-template-columns: 1fr; }
    nav .links a:not(.btn) { display: none; }
  }
</style>
</head>
<body>
<noscript><div class="noscript">This tool needs JavaScript enabled to run a QA.</div></noscript>

<nav>
  <div class="wrap">
    <span class="brand"><span class="logo">KL</span> KODERLABS Design QA</span>
    <span class="links">
      <a href="#how">How it works</a>
      <a href="#features">Checks</a>
      <a href="https://github.com/Mohi3380/figma-design-qa" target="_blank" rel="noopener">GitHub</a>
      <a href="#run" class="btn btn-primary">Run a QA</a>
    </span>
  </div>
</nav>

<header class="hero">
  <div class="wrap">
    <div>
      <span class="pill">● Figma → live app · automated QA</span>
      <h1>Catch every <span class="grad">design&nbsp;drift</span> before it ships.</h1>
      <p class="lead">KODERLABS Design QA compares your Figma design against the live app and reports every mismatch — color, typography, spacing, icons, text and layout — severity-graded, with side-by-side evidence.</p>
      <div class="cta">
        <a href="#run" class="btn btn-primary">Run a QA →</a>
        <a href="#features" class="btn btn-ghost">See what it checks</a>
      </div>
      <div class="trust">Runs locally · two URLs in, a report out · PDF &amp; HTML</div>
    </div>
    <div class="preview" aria-hidden="true">
      <div class="bar"><i style="background:#ff5f56"></i><i style="background:#ffbd2e"></i><i style="background:#27c93f"></i><span class="t">report.html — Login</span></div>
      <div class="body">
        <div class="stat-row">
          <div class="s"><b>47</b><span>checked</span></div>
          <div class="s"><b style="color:#15803d">13</b><span>passed</span></div>
          <div class="s"><b style="color:#dc2626">34</b><span>failed</span></div>
        </div>
        <div class="chips">
          <span class="ch" style="background:#DC2626">critical 9</span>
          <span class="ch" style="background:#EA580C">high 17</span>
          <span class="ch" style="background:#D97706">medium 5</span>
          <span class="ch" style="background:#2563EB">low 3</span>
        </div>
        <div class="iss"><div class="h"><span class="tag" style="background:#EA580C">color</span> Sign In button</div><div class="d">expected #1763E6 · got #7A2E2E · ΔE 31</div></div>
        <div class="iss"><div class="h"><span class="tag" style="background:#D97706">text</span> Subtitle</div><div class="d">82% similar — copy differs</div></div>
        <div class="iss"><div class="h"><span class="tag" style="background:#DC2626">existence</span> Sign Up link</div><div class="d">in design, missing from the DOM</div></div>
      </div>
    </div>
  </div>
</header>

<section class="block" id="how">
  <div class="wrap">
    <div class="eyebrow">How it works</div>
    <h2 class="title">Two URLs in, a report out</h2>
    <p class="sub">No per-element setup. Point it at a Figma frame and your live page — the rest is automated.</p>
    <div class="steps3">
      <div class="step3"><div class="n">1</div><h3>Point it at your design + app</h3><p>Paste a Figma frame URL and your live (or localhost) app URL. That's the whole setup.</p></div>
      <div class="step3"><div class="n">2</div><h3>It extracts &amp; captures</h3><p>Pulls the design tree from Figma and renders the live page with a real browser at the matching viewport.</p></div>
      <div class="step3"><div class="n">3</div><h3>You get a graded report</h3><p>Every mismatch, ranked critical → low, with design / live / diff evidence — as PDF and HTML.</p></div>
    </div>
  </div>
</section>

<section class="block" id="features">
  <div class="wrap">
    <div class="eyebrow">What it checks</div>
    <h2 class="title">Nine kinds of design drift</h2>
    <p class="sub">Layered checks: deterministic spec diff, pixel diff, and optional AI adjudication to filter noise.</p>
    <div class="feat-grid">
      <div class="feat"><div class="ic">🧩</div><h3>Element presence</h3><p>Flags anything in the design that's missing — or present but hidden — in the live DOM.</p></div>
      <div class="feat"><div class="ic">🎨</div><h3>Color</h3><p>Perceptual ΔE (CIEDE2000) on fills, text and borders — not naive hex equality.</p></div>
      <div class="feat"><div class="ic">🔤</div><h3>Typography</h3><p>Font family, size, weight, line-height and letter-spacing, per text node.</p></div>
      <div class="feat"><div class="ic">📐</div><h3>Spacing &amp; layout</h3><p>Position, size, auto-layout gaps and padding against your tolerances.</p></div>
      <div class="feat"><div class="ic">🖼️</div><h3>Icons &amp; images</h3><p>Matches graphic assets and pixel-diffs them to catch the wrong or missing icon.</p></div>
      <div class="feat"><div class="ic">✍️</div><h3>Text similarity</h3><p>Fuzzy copy matching — "reworded" is a soft flag, not a false "missing".</p></div>
      <div class="feat"><div class="ic">🔍</div><h3>Image quality</h3><p>Detects upscaled, pixelated images shown far larger than their source.</p></div>
      <div class="feat"><div class="ic">🪟</div><h3>Interactive states</h3><p>Click a trigger to open modals or menus, then compare those states too.</p></div>
      <div class="feat"><div class="ic">🤖</div><h3>AI adjudication</h3><p>Claude judges real regression vs. cosmetic noise and re-grades severity.</p></div>
    </div>
  </div>
</section>

<section class="block" id="run">
  <div class="wrap">
    <div class="eyebrow">Run it</div>
    <h2 class="title">Start a QA</h2>
    <p class="sub">Paste the two URLs and go. Progress streams live; the report renders right here.</p>

    <form class="tool-card" id="qa-form">
      <div class="field">
        <label for="figma">Figma URL</label>
        <div class="input-wrap">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"></path></svg>
          <input type="text" id="figma" name="figma" inputmode="url" required placeholder="https://figma.com/design/AbC123/Checkout?node-id=12-345" autocomplete="off" spellcheck="false">
        </div>
        <span class="field-hint">The frame's share link — right-click the frame in Figma → Copy link.</span>
      </div>
      <div class="field">
        <label for="target">App URL</label>
        <div class="input-wrap">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 8h18"></path><circle cx="6.5" cy="6" r=".6" fill="currentColor"></circle><circle cx="8.5" cy="6" r=".6" fill="currentColor"></circle></svg>
          <input type="text" id="target" name="target" inputmode="url" required placeholder="http://localhost:3000/checkout" autocomplete="off" spellcheck="false">
        </div>
        <span class="field-hint">Production, staging, or a local dev URL — anything reachable from this machine.</span>
      </div>
      <div class="options">
        <label class="switch"><input type="checkbox" id="vision" checked><span class="track"></span><span>Vision adjudication</span></label>
        <label class="switch"><input type="checkbox" id="pdf" checked><span class="track"></span><span>Render PDF</span></label>
        <span class="vp"><span>Viewport</span><input type="text" id="viewport" inputmode="numeric" placeholder="auto" autocomplete="off"></span>
      </div>
      <button id="run" class="primary" type="submit">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="play"><path d="M8 5v14l11-7z"></path></svg>
        <span class="btn-label">Run QA</span>
        <span class="spinner" hidden></span>
      </button>
      <div class="env-note">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-5M12 8h.01"></path></svg>
        <span>Needs <code>FIGMA_TOKEN</code> in the server environment (and <code>ANTHROPIC_API_KEY</code> for vision).</span>
      </div>
      <div class="err" id="err" role="alert" aria-live="assertive"></div>
    </form>

    <div class="panel" id="progressCard" hidden>
      <div class="stepper" id="stepper"></div>
      <details class="log-details">
        <summary>Detailed log</summary>
        <div id="progress" aria-live="polite"></div>
      </details>
    </div>

    <div id="results" class="panel" style="display:none">
      <div class="stats" id="stats"></div>
      <div class="chips" id="chips"></div>
      <div class="browser-frame">
        <div class="browser-bar">
          <span class="dot3 r"></span><span class="dot3 y"></span><span class="dot3 g"></span>
          <span class="bar-title" id="reportTitle">report.html</span>
          <a id="reportLink" href="/report" target="_blank" rel="noopener">Open in new tab ↗</a>
        </div>
        <iframe id="report" title="QA report"></iframe>
      </div>
    </div>
  </div>
</section>

<footer>
  <div class="wrap">
    <span class="brand"><span class="logo">KL</span> KODERLABS Design QA</span>
    <span class="fl">
      <a href="#how">How it works</a>
      <a href="#features">Checks</a>
      <a href="#run">Run a QA</a>
      <a href="https://github.com/Mohi3380/figma-design-qa" target="_blank" rel="noopener">GitHub</a>
    </span>
  </div>
</footer>

<script>
  var $ = function (id) { return document.getElementById(id); };
  var form = $('qa-form'), runBtn = $('run'), progress = $('progress'), progressCard = $('progressCard');
  var errBox = $('err'), iframe = $('report'), reportLink = $('reportLink'), reportTitle = $('reportTitle');
  var results = $('results'), stats = $('stats'), chips = $('chips'), stepper = $('stepper');
  var spinner = runBtn.querySelector('.spinner'), btnLabel = runBtn.querySelector('.btn-label'), play = runBtn.querySelector('.play');
  var SEV = { critical: '#DC2626', high: '#EA580C', medium: '#D97706', low: '#2563EB', info: '#64748B' };

  var STEPS = [
    { id: 'extract', lbl: 'Extract', match: ['Fetching node', 'Normalizing', 'Rendering frame', 'Parsed MCP'] },
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
      nodes[i].querySelector('.dot').textContent = i < active ? '\\u2713' : (i + 1);
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

  form.addEventListener('submit', function (e) {
    e.preventDefault();
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
    es.addEventListener('log', function (ev) {
      var msg = JSON.parse(ev.data).message;
      line(msg);
      advanceFromLog(msg);
    });
    es.addEventListener('error', function (ev) {
      if (ev.data) { showError(JSON.parse(ev.data).message); }
      es.close(); setRunning(false);
    });
    es.addEventListener('done', function (ev) {
      var d = JSON.parse(ev.data);
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
  function showError(msg) { errBox.textContent = msg; errBox.style.display = 'block'; setRunning(false); }
</script>
</body>
</html>`;
