'use client';

import { useRef, useState } from 'react';
import { API_BASE, api } from '@/lib/api';
import { SEVERITY_COLORS as SEV, SEVERITY_ORDER as SEV_ORDER } from '@/lib/severity';

const STEPS = [
  { id: 'extract', lbl: 'Extract', match: ['Fetching node', 'Normalizing', 'Rendering frame', 'Parsed MCP'] },
  { id: 'capture', lbl: 'Capture', match: ['Capturing'] },
  { id: 'compare', lbl: 'Compare', match: ['Comparing'] },
  { id: 'pixel', lbl: 'Pixel diff', match: ['Pixel-diffed', 'evidence images'] },
  { id: 'vision', lbl: 'Adjudicate', match: ['Adjudicating', 'adjudicated', 'Skipping vision'] },
  { id: 'report', lbl: 'Report', match: [] as string[] },
];

interface Summary {
  pointersChecked: number;
  passed: number;
  failed: number;
  issuesBySeverity: Record<string, number>;
}
interface DoneData {
  jobId: string;
  summary: Summary;
  matching: { matched: number };
  viewport: number;
  frameName: string;
  hasPdf: boolean;
}

export default function QAForm({ onComplete }: { onComplete?: () => void }) {
  const [figma, setFigma] = useState('');
  const [target, setTarget] = useState('');
  const [vision, setVision] = useState(true);
  const [pdf, setPdf] = useState(true);
  const [viewport, setViewport] = useState('');

  const [running, setRunning] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [lines, setLines] = useState<{ text: string; ok?: boolean }[]>([]);
  const [step, setStep] = useState(-1);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<DoneData | null>(null);
  const [reportSrc, setReportSrc] = useState('');
  const esRef = useRef<EventSource | null>(null);
  // Captured from stream events so we can recover the result by polling if the
  // live connection drops mid-run (see the error handler below).
  const jobIdRef = useRef<string | null>(null);

  function advance(msg: string) {
    for (let i = STEPS.length - 1; i >= 0; i--) {
      if (STEPS[i].match.some((m) => msg.includes(m))) {
        setStep(i);
        return;
      }
    }
  }

  function showDone(d: DoneData) {
    setStep(STEPS.length);
    setDone(d);
    setReportSrc(`${API_BASE}/qa/jobs/${d.jobId}/report.html`);
  }

  /** A finished QA job's persisted view (sanitized — no filesystem paths). */
  interface JobView {
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    error: string | null;
    report: {
      frameName: string | null;
      viewport: number | null;
      pointersChecked: number;
      passed: number;
      failed: number;
      matched: number;
      issuesBySeverity: Record<string, number> | null;
      hasPdf: boolean;
    } | null;
  }

  // When the live SSE connection drops, the server job often keeps running and
  // finishes fine. Poll its persisted status before declaring failure so a
  // transient blip doesn't lose a completed run. Returns true once resolved.
  async function recoverFromJob(jobId: string): Promise<boolean> {
    for (let i = 0; i < 8; i++) {
      let job: JobView;
      try {
        job = await api.get<JobView>(`/qa/jobs/${jobId}`);
      } catch {
        return false;
      }
      if (job.status === 'COMPLETED' && job.report) {
        const r = job.report;
        showDone({
          jobId,
          summary: {
            pointersChecked: r.pointersChecked,
            passed: r.passed,
            failed: r.failed,
            issuesBySeverity: r.issuesBySeverity ?? {},
          },
          matching: { matched: r.matched },
          viewport: r.viewport ?? 0,
          frameName: r.frameName ?? '',
          hasPdf: r.hasPdf,
        });
        return true;
      }
      if (job.status === 'FAILED') {
        setErr(job.error || 'QA run failed.');
        return true;
      }
      await new Promise((res) => setTimeout(res, 1500));
    }
    return false;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!figma.trim() || !target.trim()) {
      setErr('Enter both a Figma URL and an App URL.');
      return;
    }
    setRunning(true);
    setErr('');
    setDone(null);
    setShowProgress(true);
    setLines([]);
    setStep(0);
    jobIdRef.current = null;

    // The SSE stream authenticates via the access_token cookie and, being an
    // EventSource, cannot transparently refresh-on-401 the way apiFetch does.
    // Proactively refresh first so a stale short-lived token doesn't 401 the
    // connection right as the run starts.
    try {
      await api.post('/auth/refresh');
    } catch {
      /* keep going — the current token may still be valid */
    }

    const params = new URLSearchParams({
      figma: figma.trim(),
      target: target.trim(),
      vision: vision ? 'true' : 'false',
      pdf: pdf ? 'true' : 'false',
    });
    if (viewport.trim()) params.set('viewport', viewport.trim());

    const es = new EventSource(`${API_BASE}/qa/run?` + params.toString(), { withCredentials: true });
    esRef.current = es;
    es.addEventListener('log', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as { message: string; jobId?: string };
      if (d.jobId) jobIdRef.current = d.jobId;
      setLines((l) => [...l, { text: d.message }]);
      advance(d.message);
    });
    es.addEventListener('error', (ev) => {
      const data = (ev as MessageEvent).data;
      // Always close so the browser doesn't auto-reconnect — a reconnect would
      // re-hit /qa/run and start a DUPLICATE job.
      es.close();
      if (data) {
        // Application-level error emitted by the backend — a real failure.
        setErr(JSON.parse(data).message);
        setRunning(false);
        onComplete?.();
        return;
      }
      // Native transport error (network blip / stream ended without 'done').
      // The server job may still be running, so try to recover its result.
      const jobId = jobIdRef.current;
      if (!jobId) {
        setErr('Connection lost before the QA finished.');
        setRunning(false);
        onComplete?.();
        return;
      }
      void recoverFromJob(jobId).then((resolved) => {
        if (!resolved) setErr('Lost the live connection — check Run history for the result.');
        setRunning(false);
        onComplete?.();
      });
    });
    es.addEventListener('done', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as DoneData;
      jobIdRef.current = d.jobId;
      setLines((l) => [...l, { text: 'done', ok: true }]);
      showDone(d);
      es.close();
      setRunning(false);
      onComplete?.();
    });
  }

  return (
    <>
      <form className="tool-card" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="figma">Figma URL</label>
          <div className="input-wrap">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
            <input type="text" id="figma" inputMode="url" required placeholder="https://figma.com/design/AbC123/Checkout?node-id=12-345" autoComplete="off" spellCheck={false} value={figma} onChange={(e) => setFigma(e.target.value)} />
          </div>
          <span className="field-hint">The frame&apos;s share link — right-click the frame in Figma → Copy link.</span>
        </div>
        <div className="field">
          <label htmlFor="target">App URL</label>
          <div className="input-wrap">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 8h18" /><circle cx="6.5" cy="6" r=".6" fill="currentColor" /><circle cx="8.5" cy="6" r=".6" fill="currentColor" /></svg>
            <input type="text" id="target" inputMode="url" required placeholder="http://localhost:3000/checkout" autoComplete="off" spellCheck={false} value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
          <span className="field-hint">Production, staging, or a local dev URL — anything reachable from this machine.</span>
        </div>
        <div className="options">
          <label className="switch"><input type="checkbox" checked={vision} onChange={(e) => setVision(e.target.checked)} /><span className="track" /><span>Vision adjudication</span></label>
          <label className="switch"><input type="checkbox" checked={pdf} onChange={(e) => setPdf(e.target.checked)} /><span className="track" /><span>Render PDF</span></label>
          <span className="vp"><span>Viewport</span><input type="text" inputMode="numeric" placeholder="auto" autoComplete="off" value={viewport} onChange={(e) => setViewport(e.target.value)} /></span>
        </div>
        <button className="primary" type="submit" disabled={running}>
          {running ? <span className="spinner" /> : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="play"><path d="M8 5v14l11-7z" /></svg>}
          <span className="btn-label">{running ? 'Running…' : 'Start QA'}</span>
        </button>
        <div className="env-note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-5M12 8h.01" /></svg>
          <span>Needs <code>FIGMA_TOKEN</code> in the server environment (and <code>ANTHROPIC_API_KEY</code> for vision).</span>
        </div>
        {err && <div className="err" role="alert" style={{ display: 'block' }}>{err}</div>}
      </form>

      {showProgress && (
        <div className="panel">
          <div className="stepper">
            {STEPS.map((s, i) => {
              const cls = i < step ? 'step done' : i === step ? 'step active' : 'step';
              return (
                <div key={s.id} className={cls}>
                  <div className="dot">{i < step ? '✓' : i + 1}</div>
                  <div className="lbl">{s.lbl}</div>
                </div>
              );
            })}
          </div>
          <details className="log-details">
            <summary>Detailed log</summary>
            <div id="progress" aria-live="polite">
              {lines.map((l, i) => (
                <div key={i} className={l.ok ? 'ok' : undefined}>{l.text}</div>
              ))}
            </div>
          </details>
        </div>
      )}

      {done && (
        <div className="panel">
          <div className="stats">
            <div className="stat"><div className="num">{done.summary.pointersChecked}</div><div className="cap">pointers checked</div></div>
            <div className="stat"><div className="num pass">{done.summary.passed}</div><div className="cap">passed</div></div>
            <div className="stat"><div className="num fail">{done.summary.failed}</div><div className="cap">failed</div></div>
            <div className="stat"><div className="num">{done.matching.matched}</div><div className="cap">elements matched</div></div>
          </div>
          <div className="chips">
            {SEV_ORDER.map((k) => {
              const n = done.summary.issuesBySeverity[k] ?? 0;
              return <span key={k} className={'chip' + (n ? '' : ' zero')} style={{ background: SEV[k] }}>{k} {n}</span>;
            })}
          </div>
          <div className="browser-frame">
            <div className="browser-bar">
              <span className="dot3 r" /><span className="dot3 y" /><span className="dot3 g" />
              <span className="bar-title"><b>{done.frameName}</b> @ {done.viewport}px{done.hasPdf ? ' · PDF ready' : ''}</span>
              <a href={reportSrc} target="_blank" rel="noopener noreferrer">Open in new tab ↗</a>
            </div>
            <iframe src={reportSrc} title="QA report" />
          </div>
        </div>
      )}
    </>
  );
}
