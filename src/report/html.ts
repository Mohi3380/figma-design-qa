/**
 * reporter (spec §6.6, §8): ComparisonReport → self-contained report.html.
 *
 * Pure render — report in, HTML string out — so it's testable without I/O.
 * Evidence images arrive as a map of relative path → data URI and are
 * inlined, so the single file can be emailed or attached to a PR (§8).
 *
 * Layout: summary header (pointers checked / passed / failed by severity),
 * issues grouped by element ordered by worst severity, each with design /
 * live / diff thumbnails and expected-vs-actual values; matching detail and
 * the full evaluation table sit in collapsed <details> at the bottom.
 */
import type { ComparisonReport, Issue, Severity } from '../types.js';

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: '#D32F2F',
  high: '#EF6C00',
  medium: '#F9A825',
  low: '#1976D2',
  info: '#607D8B',
};

export interface RenderOptions {
  /** Relative evidence path → data URI. Missing entries fall back to the
   * relative path (report still works next to its evidence/ folder). */
  images?: Map<string, string>;
}

export function renderHtmlReport(report: ComparisonReport, options: RenderOptions = {}): string {
  const { summary } = report;
  const s = summary.issuesBySeverity;
  const src = (rel: string | undefined) =>
    rel ? (options.images?.get(rel) ?? rel.replace(/\\/g, '/')) : undefined;

  const groups = groupIssues(report.issues);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Design QA — ${esc(report.design.frameName)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1a1a2e; background: #f5f6fa; }
  header { background: #fff; border-bottom: 1px solid #e6e8ee; padding: 20px 32px; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  .meta { color: #667; font-size: 13px; }
  .meta code { background: #f0f2f7; padding: 1px 5px; border-radius: 4px; }
  .summary { display: flex; gap: 12px; flex-wrap: wrap; padding: 16px 32px; }
  .stat { background: #fff; border: 1px solid #e6e8ee; border-radius: 8px; padding: 10px 16px; min-width: 96px; }
  .stat b { display: block; font-size: 20px; }
  .stat span { color: #667; font-size: 12px; }
  .chips { display: flex; gap: 8px; align-items: center; padding: 0 32px 8px; flex-wrap: wrap; }
  .chip { color: #fff; border-radius: 999px; padding: 2px 12px; font-size: 12px; font-weight: 600; }
  .warning { margin: 8px 32px; padding: 10px 14px; background: #FFF8E1; border: 1px solid #F9A825; border-radius: 8px; font-size: 13px; }
  main { padding: 16px 32px 48px; max-width: 1200px; }
  .element { background: #fff; border: 1px solid #e6e8ee; border-radius: 10px; margin: 0 0 16px; overflow: hidden; }
  .element > h2 { margin: 0; padding: 12px 16px; font-size: 15px; border-bottom: 1px solid #f0f2f7; display: flex; gap: 8px; align-items: center; }
  .element .where { color: #889; font-weight: 400; font-size: 12px; }
  .issue { padding: 12px 16px; border-bottom: 1px solid #f0f2f7; }
  .issue:last-child { border-bottom: none; }
  .issue-head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .badge { color: #fff; border-radius: 4px; padding: 1px 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
  .pointer { font-family: ui-monospace, Consolas, monospace; font-size: 12px; background: #f0f2f7; border-radius: 4px; padding: 1px 6px; }
  .conf { color: #99a; font-size: 11px; margin-left: auto; }
  .explanation { margin: 6px 0 0; }
  .adjudication { margin: 6px 0 0; padding: 6px 10px; background: #F6F4FF; border: 1px solid #D9D2F0; border-radius: 6px; font-size: 13px; }
  .adjudication .model { color: #99a; font-size: 11px; }
  .values { margin: 8px 0 0; font-size: 13px; display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; }
  .values dt { color: #667; }
  .values dd { margin: 0; font-family: ui-monospace, Consolas, monospace; }
  .evidence { display: flex; gap: 12px; margin-top: 10px; flex-wrap: wrap; }
  .evidence figure { margin: 0; }
  .evidence img { max-width: 320px; max-height: 200px; border: 1px solid #e6e8ee; border-radius: 6px; display: block; background: repeating-conic-gradient(#eee 0 25%, #fff 0 50%) 0 0/16px 16px; }
  .evidence figcaption { font-size: 11px; color: #889; text-align: center; margin-top: 2px; }
  details { background: #fff; border: 1px solid #e6e8ee; border-radius: 10px; margin: 0 0 16px; padding: 0; }
  details summary { cursor: pointer; padding: 12px 16px; font-weight: 600; }
  details table { width: 100%; border-collapse: collapse; font-size: 13px; }
  details th, details td { text-align: left; padding: 6px 16px; border-top: 1px solid #f0f2f7; }
  details th { color: #667; font-weight: 600; }
  .pass { color: #2E7D32; } .fail { color: #D32F2F; } .skipped { color: #99a; }
  .ok-banner { background: #E8F5E9; border: 1px solid #66BB6A; color: #2E7D32; border-radius: 10px; padding: 16px; font-weight: 600; }
</style>
</head>
<body>
<header>
  <h1>Design QA report — ${esc(report.design.frameName)}</h1>
  <div class="meta">
    <code>${esc(report.design.fileKey)}</code> node <code>${esc(report.design.frameId)}</code>
    ↔ <a href="${esc(report.live.url)}">${esc(report.live.url)}</a>
    @ ${report.live.viewport.width}×${report.live.viewport.height}
    · compared ${esc(report.comparedAt)}${report.scale !== 1 ? ` · scale ${report.scale}` : ''}
  </div>
</header>
${report.warnings.map((w) => `<div class="warning">⚠ ${esc(w)}</div>`).join('\n')}
<div class="summary">
  <div class="stat"><b>${summary.pointersChecked}</b><span>pointers checked</span></div>
  <div class="stat"><b class="pass">${summary.passed}</b><span>passed</span></div>
  <div class="stat"><b class="fail">${summary.failed}</b><span>failed</span></div>
  <div class="stat"><b class="skipped">${summary.skipped}</b><span>deferred</span></div>
  <div class="stat"><b>${report.matching.matched}</b><span>elements matched</span></div>
</div>
<div class="chips">
  ${SEVERITY_ORDER.map((sev) => `<span class="chip" style="background:${SEVERITY_COLOR[sev]}">${sev} ${s[sev]}</span>`).join('\n  ')}
</div>
<main>
${
  groups.length === 0
    ? `<div class="ok-banner">✔ No issues — the live page matches the design within tolerances.</div>`
    : groups.map((g) => renderElement(g, src)).join('\n')
}
<details>
  <summary>Element matching (${report.matching.matched} pairs · ${report.matching.designOnly} design-only · ${report.matching.liveOnly} DOM-only)</summary>
  <table>
    <tr><th>Figma node</th><th>Selector</th><th>Method</th><th>Confidence</th></tr>
    ${report.matching.pairs
      .map(
        (p) =>
          `<tr><td>${esc(p.figmaNodeId)}</td><td><code>${esc(p.selector)}</code></td><td>${esc(p.method)}</td><td>${p.confidence}</td></tr>`,
      )
      .join('\n    ')}
  </table>
</details>
<details>
  <summary>All ${summary.pointersChecked} pointer evaluations</summary>
  <table>
    <tr><th>Element</th><th>Pointer</th><th>Result</th><th>Expected</th><th>Actual</th><th>Tolerance</th></tr>
    ${report.evaluations
      .map(
        (e) =>
          `<tr><td>${esc(e.elementName)}</td><td><code>${esc(e.pointer)}</code></td><td class="${e.result}">${e.result}</td><td>${esc(e.expected ?? '')}</td><td>${esc(e.actual ?? '')}</td><td>${esc(e.tolerance ?? e.note ?? '')}</td></tr>`,
      )
      .join('\n    ')}
  </table>
</details>
</main>
</body>
</html>
`;
}

interface ElementGroup {
  elementName: string;
  selector?: string;
  figmaNodeId?: string;
  worst: Severity;
  issues: Issue[];
}

/** Group issues by element, order groups by worst severity (spec §8). */
function groupIssues(issues: Issue[]): ElementGroup[] {
  const byElement = new Map<string, ElementGroup>();
  for (const issue of issues) {
    const key = issue.figmaNodeId ?? issue.selector ?? issue.elementName;
    let group = byElement.get(key);
    if (!group) {
      group = {
        elementName: issue.elementName,
        selector: issue.selector,
        figmaNodeId: issue.figmaNodeId,
        worst: issue.severity,
        issues: [],
      };
      byElement.set(key, group);
    }
    group.issues.push(issue);
    if (rank(issue.severity) < rank(group.worst)) group.worst = issue.severity;
  }
  const groups = [...byElement.values()];
  for (const group of groups) {
    group.issues.sort((a, b) => rank(a.severity) - rank(b.severity));
  }
  groups.sort((a, b) => rank(a.worst) - rank(b.worst));
  return groups;
}

function renderElement(group: ElementGroup, src: (rel?: string) => string | undefined): string {
  const where = [group.figmaNodeId, group.selector]
    .filter((part): part is string => Boolean(part))
    .map(esc)
    .join(' ↔ ');
  return `<section class="element">
  <h2><span class="badge" style="background:${SEVERITY_COLOR[group.worst]}">${group.worst}</span>
      ${esc(group.elementName)} <span class="where">${where}</span></h2>
  ${group.issues.map((issue) => renderIssue(issue, src)).join('\n  ')}
</section>`;
}

function renderIssue(issue: Issue, src: (rel?: string) => string | undefined): string {
  const values =
    issue.expected !== undefined || issue.actual !== undefined
      ? `<dl class="values">
      ${issue.expected !== undefined ? `<dt>expected</dt><dd>${esc(issue.expected)}</dd>` : ''}
      ${issue.actual !== undefined ? `<dt>actual</dt><dd>${esc(issue.actual)}</dd>` : ''}
      ${issue.tolerance ? `<dt>tolerance</dt><dd>${esc(issue.tolerance)}</dd>` : ''}
    </dl>`
      : '';

  const figures = (
    [
      ['design', issue.evidence?.design],
      [issue.pointer === 'existence' && !issue.selector ? 'live (expected location)' : 'live', issue.evidence?.live],
      ['diff', issue.evidence?.diff],
    ] as const
  )
    .filter(([, rel]) => rel)
    .map(
      ([label, rel]) =>
        `<figure><img src="${esc(src(rel)!)}" alt="${esc(label)}"><figcaption>${esc(label)}</figcaption></figure>`,
    )
    .join('\n      ');

  const adjudication = issue.adjudication
    ? `<p class="adjudication">🤖 <b>${esc(issue.adjudication.verdict)}</b>${
        issue.adjudication.previousSeverity
          ? ` (down-ranked from ${esc(issue.adjudication.previousSeverity)})`
          : ''
      } — ${esc(issue.adjudication.explanation)} <span class="model">${esc(issue.adjudication.model)}</span></p>`
    : '';

  return `<div class="issue" id="${esc(issue.id)}">
    <div class="issue-head">
      <span class="badge" style="background:${SEVERITY_COLOR[issue.severity]}">${issue.severity}</span>
      <span class="pointer">${esc(issue.pointer)}</span>
      <span class="conf">confidence ${issue.confidence}</span>
    </div>
    <p class="explanation">${esc(issue.explanation)}</p>
    ${adjudication}
    ${values}
    ${figures ? `<div class="evidence">\n      ${figures}\n    </div>` : ''}
  </div>`;
}

function rank(severity: Severity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

function esc(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
