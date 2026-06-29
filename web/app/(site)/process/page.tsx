import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Our Process',
  description:
    'How Pixparity works: two inputs in, one severity-graded report out — read the design, capture the live site, match, diff, AI double-check, and deliver the report.',
  alternates: { canonical: '/process' },
};

export default function ProcessPage() {
  return (
    <>
      <header className="page-hero">
        <div className="wrap">
          <div className="eyebrow">Our Process</div>
          <h1 className="page-title">Design QA — Figma vs. Live Website</h1>
          <p className="page-lead">
            Automated visual quality check: the design is the source of truth, the live site is
            graded against it.
          </p>
        </div>
      </header>

      <main className="proc">
        <div className="wrap">
          <section className="proc-sec">
            <h2 className="proc-h2"><span className="num">1</span> The Big Picture</h2>
            <p className="proc-sub">Two inputs in, one report out — no manual screenshots, no per-page setup.</p>
            <div className="proc-flow">
              <div className="proc-col">
                <div className="proc-box"><span className="t">🎨 Figma Design</span><span className="d">paste the frame link</span></div>
                <div className="proc-box"><span className="t">🌐 Live Website</span><span className="d">paste the page URL</span></div>
              </div>
              <span className="proc-ar">→</span>
              <div className="proc-box engine"><span className="t">⚙️ Design QA Engine</span><span className="d">compares design to build</span></div>
              <span className="proc-ar">→</span>
              <div className="proc-box out"><span className="t">📄 Report</span><span className="d">PDF · HTML · JSON</span></div>
            </div>
          </section>

          <section className="proc-sec">
            <h2 className="proc-h2"><span className="num">2</span> How It Works</h2>
            <p className="proc-sub">Six stages — reading the design and capturing the live site run in parallel, then everything is compared.</p>
            <div className="proc-twoup">
              <div className="proc-step"><span className="n">1</span><div><span className="st">Read the design</span><span className="sd">layout, colors, text &amp; sizes, straight from Figma</span></div></div>
              <div className="proc-step"><span className="n">2</span><div><span className="st">Capture the live site</span><span className="sd">open the real page in a browser, record every element + a screenshot</span></div></div>
            </div>
            <div className="proc-merge">↓</div>
            <div className="proc-steps">
              <div className="proc-step"><span className="n">3</span><div><span className="st">Match them up</span><span className="sd">pair each design element with its counterpart on the live site</span></div></div>
              <span className="proc-ar dn">↓</span>
              <div className="proc-step"><span className="n">4</span><div><span className="st">Spot the differences</span><span className="sd">compare color, size, position, spacing, text &amp; typography</span></div></div>
              <span className="proc-ar dn">↓</span>
              <div className="proc-step"><span className="n">5</span><div><span className="st">Visual proof</span><span className="sd">overlay screenshots and highlight the mismatched areas</span></div></div>
              <span className="proc-ar dn">↓</span>
              <div className="proc-step ai"><span className="n">6</span><div><span className="st">AI double-check</span><span className="sd">AI filters out false alarms and rates how serious each issue is</span></div></div>
              <span className="proc-ar dn">↓</span>
              <div className="proc-step done"><span className="n">✓</span><div><span className="st">Report delivered</span><span className="sd">every issue ranked by severity, with side-by-side evidence</span></div></div>
            </div>
            <div className="proc-note"><b>Note:</b> Step 6 (AI double-check) runs when an AI key is configured; without it the flow still works and simply skips the noise-filtering step.</div>
          </section>

          <section className="proc-sec">
            <h2 className="proc-h2"><span className="num">3</span> How Issues Are Graded</h2>
            <p className="proc-sub">Findings are ranked so the team fixes what matters first.</p>
            <div className="proc-sev">
              <div className="proc-chip c1"><div className="lv">🔴 Critical</div><div className="ds">Element missing or badly broken</div></div>
              <div className="proc-chip c2"><div className="lv">🟠 High</div><div className="ds">Clearly wrong color / size / text</div></div>
              <div className="proc-chip c3"><div className="lv">🟡 Medium</div><div className="ds">Noticeable but minor drift</div></div>
              <div className="proc-chip c4"><div className="lv">⚪ Low / Info</div><div className="ds">Tiny, often cosmetic</div></div>
            </div>
            <p className="proc-sub" style={{ margin: '14px 0 0' }}>A release can be set to <b>block automatically</b> when any issue at or above a chosen level (e.g. &quot;High&quot;) is found.</p>
          </section>

          <section className="proc-sec">
            <h2 className="proc-h2"><span className="num">4</span> Where It Fits in Your Workflow</h2>
            <p className="proc-sub">Runs on demand, or automatically as part of the release process.</p>
            <div className="proc-flow">
              <div className="proc-pill">Designer<br />finishes Figma</div>
              <span className="proc-ar">→</span>
              <div className="proc-pill">Developer<br />builds the page</div>
              <span className="proc-ar">→</span>
              <div className="proc-pill qa">Design QA<br />runs the check</div>
              <span className="proc-ar">→</span>
              <div className="proc-pill ship">✅ Ship it</div>
            </div>
            <div className="proc-loop">↺ If differences are found → developer fixes &amp; re-runs the check until it matches.</div>
          </section>

          <section className="proc-sec">
            <h2 className="proc-h2"><span className="num">5</span> What It Checks — At a Glance</h2>
            <p className="proc-sub">The comparison covers the things a designer would flag in a manual review.</p>
            <table className="proc-table">
              <tbody>
                <tr><th>Stage</th><th>In plain words</th><th>You get</th></tr>
                <tr><td><b>Read the design</b></td><td>Pulls layout, colors, text, fonts &amp; sizes from your Figma frame</td><td>The &quot;source of truth&quot;</td></tr>
                <tr><td><b>Capture the live site</b></td><td>Opens the real page in a real browser, records every element + screenshot</td><td>The &quot;as-built&quot; snapshot</td></tr>
                <tr><td><b>Match &amp; compare</b></td><td>Pairs elements, then checks color, size, position, spacing, text &amp; typography</td><td>A list of mismatches</td></tr>
                <tr><td><b>Visual proof</b></td><td>Highlights the exact wrong areas on a screenshot</td><td>Side-by-side evidence</td></tr>
                <tr><td><b>AI double-check</b></td><td>Confirms real problems vs. noise and ranks severity</td><td>A trustworthy, prioritized report</td></tr>
              </tbody>
            </table>
          </section>
        </div>
      </main>
    </>
  );
}
