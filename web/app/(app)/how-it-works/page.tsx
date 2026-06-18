'use client';

import Link from 'next/link';

const STEPS = [
  { n: '1', h: 'Point it at your design + app', p: 'Paste a Figma frame URL and your live (or localhost) app URL. That’s the whole setup.' },
  { n: '2', h: 'It extracts & captures', p: 'Pulls the design tree from Figma and renders the live page with a real browser at the matching viewport.' },
  { n: '3', h: 'You get a graded report', p: 'Every mismatch, ranked critical → low, with design / live / diff evidence — as PDF and HTML.' },
];

const LAYERS = [
  { tag: 'Layer A', h: 'Deterministic spec diff', p: 'Compares expected vs. actual values for color, typography, position, size, spacing and text — node by node, against your tolerances.' },
  { tag: 'Layer B', h: 'Region pixel diff', p: 'Crops each suspect region from the design render and the live screenshot and pixel-diffs them, so a missing icon or shifted block shows up visually.' },
  { tag: 'Layer C', h: 'AI adjudication', p: 'Claude looks at the evidence and judges real regression vs. cosmetic noise, re-grades severity, and writes a one-line explanation. Optional — uses your own key.' },
];

const CHECKS = [
  'Element presence', 'Color (ΔE / CIEDE2000)', 'Typography', 'Spacing & layout',
  'Icons & images', 'Text similarity', 'Image quality', 'Interactive states',
];

export default function HowItWorksPage() {
  return (
    <div className="app-page">
      <div className="dash-head">
        <h1>How it works</h1>
      </div>
      <p className="dash-sub">Two URLs in, a severity-graded report out — here’s the pipeline behind every run.</p>

      <h2 className="profile-section-title">The flow</h2>
      <div className="steps3">
        {STEPS.map((s) => (
          <div className="step3" key={s.n}>
            <div className="n">{s.n}</div>
            <h3>{s.h}</h3>
            <p>{s.p}</p>
          </div>
        ))}
      </div>

      <h2 className="profile-section-title">Three detection layers</h2>
      <div className="layers-grid">
        {LAYERS.map((l) => (
          <div className="layer-card" key={l.tag}>
            <span className="layer-tag">{l.tag}</span>
            <h3>{l.h}</h3>
            <p>{l.p}</p>
          </div>
        ))}
      </div>

      <h2 className="profile-section-title">What it checks</h2>
      <div className="hiw-checks">
        {CHECKS.map((c) => (
          <span className="hiw-chip" key={c}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            {c}
          </span>
        ))}
      </div>

      <div className="hiw-cta">
        <div>
          <b>Ready to run one?</b>
          <span>Connect your Figma + app and watch progress stream live.</span>
        </div>
        <div className="hiw-cta-btns">
          <Link className="btn btn-ghost" href="/integrations">Integrations</Link>
          <Link className="btn btn-primary" href="/start-qa">Start a QA →</Link>
        </div>
      </div>
    </div>
  );
}
