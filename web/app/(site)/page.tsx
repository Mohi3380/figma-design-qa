import Link from 'next/link';
import ScrollReveal from '@/components/ScrollReveal';

const STATS = [
  { n: '9', l: 'Kinds of drift checked' },
  { n: '3', l: 'Detection layers' },
  { n: 'ΔE2000', l: 'Perceptual color accuracy' },
  { n: 'PDF · HTML', l: 'Shareable report formats' },
];

const STEPS = [
  { n: '1', h: 'Point it at your design + app', p: "Paste a Figma frame URL and your live (or localhost) app URL. That's the whole setup." },
  { n: '2', h: 'It extracts & captures', p: 'Pulls the design tree from Figma and renders the live page with a real browser at the matching viewport.' },
  { n: '3', h: 'You get a graded report', p: 'Every mismatch, ranked critical → low, with design / live / diff evidence — as PDF and HTML.' },
];

const LAYERS = [
  {
    tag: 'Layer A',
    h: 'Deterministic spec diff',
    p: 'Compares expected vs. actual values for color, typography, position, size, spacing and text — node by node, against your tolerances. No guesswork.',
  },
  {
    tag: 'Layer B',
    h: 'Region pixel diff',
    p: 'Crops each suspect region from the design render and the live screenshot and pixel-diffs them, so a missing icon or shifted block shows up visually.',
  },
  {
    tag: 'Layer C',
    h: 'AI adjudication',
    p: 'Claude looks at the evidence and judges real regression vs. cosmetic noise, re-grades severity, and writes a one-line explanation. Optional — bring your own key.',
  },
];

const FEATURES = [
  { ic: '🧩', h: 'Element presence', p: "Flags anything in the design that's missing — or present but hidden — in the live DOM." },
  { ic: '🎨', h: 'Color', p: 'Perceptual ΔE (CIEDE2000) on fills, text and borders — not naive hex equality.' },
  { ic: '🔤', h: 'Typography', p: 'Font family, size, weight, line-height and letter-spacing, per text node.' },
  { ic: '📐', h: 'Spacing & layout', p: 'Position, size, auto-layout gaps and padding against your tolerances.' },
  { ic: '🖼️', h: 'Icons & images', p: 'Matches graphic assets and pixel-diffs them to catch the wrong or missing icon.' },
  { ic: '✍️', h: 'Text similarity', p: 'Fuzzy copy matching — "reworded" is a soft flag, not a false "missing".' },
  { ic: '🔍', h: 'Image quality', p: 'Detects upscaled, pixelated images shown far larger than their source.' },
  { ic: '🪟', h: 'Interactive states', p: 'Click a trigger to open modals or menus, then compare those states too.' },
  { ic: '🤖', h: 'AI adjudication', p: 'Claude judges real regression vs. cosmetic noise and re-grades severity.' },
];

const AUDIENCE = [
  { ic: '🎯', h: 'Designers', p: 'Confirm the build actually matches your handoff — down to the token — without pixel-peeping by hand.' },
  { ic: '⚡', h: 'Front-end devs', p: 'Catch drift before it hits PR review. Two URLs, a graded report, fixes prioritized for you.' },
  { ic: '📋', h: 'QA & PMs', p: 'A shareable, severity-graded report with side-by-side evidence — no Figma expertise required.' },
];

const FAQ = [
  { q: 'Do I have to configure each element?', a: 'No. You give it two URLs — a Figma frame and your live page — and it matches and checks everything automatically.' },
  { q: 'Does it use my own Figma access?', a: 'Yes. You connect your own Figma (one-click OAuth, or paste a personal token). Credentials are encrypted per-user and never shared between accounts.' },
  { q: 'Is AI required?', a: 'No. The deterministic spec diff and pixel diff run without any AI. Add your own Anthropic key to enable Claude vision adjudication on top.' },
  { q: 'Can it test a localhost app?', a: 'In local development, yes. In production, requests to private/internal addresses are blocked for safety (SSRF protection).' },
  { q: 'What do I actually get?', a: 'A severity-graded report — critical → low — as a self-contained HTML page and a PDF, each issue backed by design / live / diff evidence.' },
];

export default function Home() {
  return (
    <>
      <ScrollReveal />

      <header className="hero">
        <div className="wrap">
          <div className="hero-copy">
            <span className="pill">● Figma → live app · automated QA</span>
            <h1>
              Catch every <span className="grad">design&nbsp;drift</span> before it ships.
            </h1>
            <p className="lead">
              Pixparity compares your Figma design against the live app and reports every
              mismatch — color, typography, spacing, icons, text and layout — severity-graded, with
              side-by-side evidence.
            </p>
            <div className="cta">
              <Link href="/signup" className="btn btn-primary">Start QA →</Link>
              <Link href="/#features" className="btn btn-ghost">See what it checks</Link>
            </div>
            <div className="trust">Runs locally · two URLs in, a report out · PDF &amp; HTML</div>
          </div>
          <div className="preview hero-art">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="hero-shot" src="/hero.jpg" alt="Illustration of a QA engineer inspecting a Figma design with a magnifying glass to find bugs" />
          </div>
        </div>
      </header>

      <section className="stats-band">
        <div className="wrap">
          <div className="stats-grid">
            {STATS.map((s, i) => (
              <div className="stat-cell reveal" style={{ transitionDelay: `${i * 70}ms` }} key={s.l}>
                <div className="stat-n">{s.n}</div>
                <div className="stat-l">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="block" id="how">
        <div className="wrap">
          <div className="eyebrow reveal">How it works</div>
          <h2 className="title reveal">Two URLs in, a report out</h2>
          <p className="sub reveal">No per-element setup. Point it at a Figma frame and your live page — the rest is automated.</p>
          <div className="steps3">
            {STEPS.map((s, i) => (
              <div className="step3 reveal" style={{ transitionDelay: `${i * 90}ms` }} key={s.n}>
                <div className="n">{s.n}</div>
                <h3>{s.h}</h3>
                <p>{s.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="block" id="layers">
        <div className="wrap">
          <div className="eyebrow reveal">Under the hood</div>
          <h2 className="title reveal">Three layers, from exact to intelligent</h2>
          <p className="sub reveal">Deterministic checks find the facts; AI filters the noise — so the report shows what actually matters.</p>
          <div className="layers-grid">
            {LAYERS.map((l, i) => (
              <div className="layer-card reveal" style={{ transitionDelay: `${i * 90}ms` }} key={l.tag}>
                <span className="layer-tag">{l.tag}</span>
                <h3>{l.h}</h3>
                <p>{l.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="block" id="features">
        <div className="wrap">
          <div className="eyebrow reveal">What it checks</div>
          <h2 className="title reveal">Nine kinds of design drift</h2>
          <p className="sub reveal">Layered checks: deterministic spec diff, pixel diff, and optional AI adjudication to filter noise.</p>
          <div className="feat-grid">
            {FEATURES.map((f, i) => (
              <div className="feat reveal" style={{ transitionDelay: `${(i % 3) * 80}ms` }} key={f.h}>
                <div className="ic">{f.ic}</div>
                <h3>{f.h}</h3>
                <p>{f.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="block" id="who">
        <div className="wrap">
          <div className="eyebrow reveal">Who it&apos;s for</div>
          <h2 className="title reveal">One report the whole team can read</h2>
          <p className="sub reveal">Built so non-technical teammates can run a QA and act on it — not just engineers.</p>
          <div className="aud-grid">
            {AUDIENCE.map((a, i) => (
              <div className="aud-card reveal" style={{ transitionDelay: `${i * 90}ms` }} key={a.h}>
                <div className="ic">{a.ic}</div>
                <h3>{a.h}</h3>
                <p>{a.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="block" id="faq">
        <div className="wrap narrow">
          <div className="eyebrow reveal">FAQ</div>
          <h2 className="title reveal">Questions, answered</h2>
          <div className="faq-list">
            {FAQ.map((f, i) => (
              <details className="faq-item reveal" style={{ transitionDelay: `${i * 50}ms` }} key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="block" id="run">
        <div className="wrap">
          <div className="team-cta reveal">
            <h2>Ready to catch design drift?</h2>
            <p>Create a free account to run a Design QA — paste a Figma URL and your live app, watch progress stream live, and get a severity-graded report.</p>
            <Link className="btn btn-primary" href="/signup">Get started free</Link>
            <p style={{ marginTop: 14, marginBottom: 0 }}>
              Already have an account? <Link href="/login" style={{ color: '#fff', textDecoration: 'underline' }}>Log in</Link>
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
