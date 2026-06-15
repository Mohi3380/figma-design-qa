import Link from 'next/link';

const STEPS = [
  { n: '1', h: 'Point it at your design + app', p: "Paste a Figma frame URL and your live (or localhost) app URL. That's the whole setup." },
  { n: '2', h: 'It extracts & captures', p: 'Pulls the design tree from Figma and renders the live page with a real browser at the matching viewport.' },
  { n: '3', h: 'You get a graded report', p: 'Every mismatch, ranked critical → low, with design / live / diff evidence — as PDF and HTML.' },
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

export default function Home() {
  return (
    <>
      <header className="hero">
        <div className="wrap">
          <div>
            <span className="pill">● Figma → live app · automated QA</span>
            <h1>
              Catch every <span className="grad">design&nbsp;drift</span> before it ships.
            </h1>
            <p className="lead">
              KODERLABS Design QA compares your Figma design against the live app and reports every
              mismatch — color, typography, spacing, icons, text and layout — severity-graded, with
              side-by-side evidence.
            </p>
            <div className="cta">
              <Link href="/#run" className="btn btn-primary">Start QA →</Link>
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

      <section className="block" id="how">
        <div className="wrap">
          <div className="eyebrow">How it works</div>
          <h2 className="title">Two URLs in, a report out</h2>
          <p className="sub">No per-element setup. Point it at a Figma frame and your live page — the rest is automated.</p>
          <div className="steps3">
            {STEPS.map((s) => (
              <div className="step3" key={s.n}>
                <div className="n">{s.n}</div>
                <h3>{s.h}</h3>
                <p>{s.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="block" id="features">
        <div className="wrap">
          <div className="eyebrow">What it checks</div>
          <h2 className="title">Nine kinds of design drift</h2>
          <p className="sub">Layered checks: deterministic spec diff, pixel diff, and optional AI adjudication to filter noise.</p>
          <div className="feat-grid">
            {FEATURES.map((f) => (
              <div className="feat" key={f.h}>
                <div className="ic">{f.ic}</div>
                <h3>{f.h}</h3>
                <p>{f.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="block" id="run">
        <div className="wrap">
          <div className="team-cta">
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
