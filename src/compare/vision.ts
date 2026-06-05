/**
 * comparison-engine, Layer C (spec §6.5-C): vision adjudication.
 *
 * Layers A and B are deterministic but blind to *meaning*: a 28% pixel
 * mismatch can be a missing icon (real) or font anti-aliasing (noise).
 * This layer shows Claude each candidate issue — the structured deltas plus
 * the design / live / diff crops — and asks for a verdict: real regression
 * or cosmetic noise, a (possibly re-graded) severity, a one-line human
 * explanation, and a confidence. Noise is down-ranked to `low`, never
 * deleted — `adjudication.previousSeverity` keeps the Layer A/B grade so a
 * human can override (spec §7).
 *
 * API shape (per the claude-api guidance):
 *  - structured output via `output_config.format` (json_schema) — the
 *    verdict array parses guaranteed-valid, no regex post-processing;
 *  - adaptive thinking — judging "does this difference matter?" is exactly
 *    the kind of borderline call that benefits from it;
 *  - streaming + finalMessage() — image-heavy requests, avoids timeouts;
 *  - prompt caching — the system rubric is static and marked with
 *    cache_control so multi-chunk runs and repeated CLI invocations reuse
 *    it. (Note: prefixes below the model's minimum cacheable size silently
 *    don't cache — the marker is still correct placement, just inert for
 *    small rubrics.)
 *  - issues are sent in chunks so evidence images don't blow up a single
 *    request.
 *
 * The Anthropic client is injectable so tests run offline.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { ComparisonReport, Issue, Severity } from '../types.js';

export class VisionError extends Error {}

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/** One verdict from the model, matching VERDICT_SCHEMA. */
export interface Verdict {
  id: string;
  verdict: 'real' | 'noise' | 'uncertain';
  severity: Severity;
  explanation: string;
  confidence: number;
}

/** The static rubric — stable bytes first, so the cache prefix holds across
 * chunks and runs. Volatile content (issues, images) goes in user turns. */
const SYSTEM_PROMPT = `You are the adjudication layer of an automated design-QA tool. The tool compared a Figma design against the live implementation of a web page and produced candidate issues from two deterministic layers: a spec diff (expected vs actual values for color, typography, position, size, spacing, text) and a region pixel diff (percentage of differing pixels between the design render and a screenshot).

Deterministic layers cannot judge MEANING. Your job, for each candidate issue, is to decide whether it is a real visual regression a designer would want fixed, or cosmetic noise.

Common NOISE patterns (down-rank these):
- Anti-aliasing and font-rendering differences between Figma's renderer and the browser (slightly different glyph edges, sub-pixel shifts).
- Text metric differences that follow from an already-reported root cause (if the font family is wrong, derived size/position/visual issues on the same text are symptoms, not separate problems — keep the root cause, mark derived ones as noise and say which issue is the root cause).
- Dynamic content placeholders (dates, usernames, counts) that can never match design dummy text.
- Sub-pixel position/size deltas barely over tolerance with no visible effect in the crops.

Common REAL patterns (keep or up-rank these):
- Missing or hidden elements that the design clearly shows.
- Color drift visible in the crops (wrong token, not rendering variance).
- Wrong copy on interactive elements (buttons, links).
- Layout breaks: overlap, clipping, wrapping that the design does not have.
- Wrong font family or weight (visible glyph-shape differences).

For each issue you receive, return one verdict object:
- id: the issue id, copied exactly.
- verdict: "real", "noise", or "uncertain" (uncertain = the evidence is not enough to decide; the issue keeps its current severity).
- severity: your judgement of the correct severity — "critical" (broken/missing core UI, wrong CTA copy), "high" (clearly visible drift: wrong color token, wrong heading font, large offset), "medium" (visible but minor), "low" (barely perceptible / noise), "info" (not a defect).
- explanation: ONE sentence a developer reads in the report. Name what is visibly different (or why it is noise). No hedging filler.
- confidence: 0 to 1, how sure you are of the verdict.

Judge from the images first, the numbers second. If no images are attached for an issue, judge from the structured values alone and lower your confidence. Return a verdict for EVERY issue you were given, in the same order.`;

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'verdict', 'severity', 'explanation', 'confidence'],
        properties: {
          id: { type: 'string', description: 'Issue id, copied exactly from the input.' },
          verdict: { type: 'string', enum: ['real', 'noise', 'uncertain'] },
          severity: { type: 'string', enum: SEVERITIES },
          explanation: { type: 'string', description: 'One sentence for the report.' },
          confidence: { type: 'number', description: '0..1 — how sure the verdict is.' },
        },
      },
    },
  },
} as const;

/** Issues worth the model's time: real candidates, not informational notes. */
export function adjudicationCandidates(report: ComparisonReport): Issue[] {
  return report.issues.filter((issue) => issue.severity !== 'info' && !issue.adjudication);
}

/** Minimal slice of the Anthropic client the adjudicator needs — injectable
 * so tests can stub it without network. */
export interface MessagesLike {
  stream(params: Anthropic.MessageStreamParams): { finalMessage(): Promise<Anthropic.Message> };
}

export interface VisionOptions {
  /** From config `vision.model` (default claude-opus-4-8). */
  model: string;
  /** Report directory — evidence paths in issues are relative to it. */
  outDir: string;
  /** Issues per request; evidence images are the real payload driver. */
  chunkSize?: number;
  /** Injectable for tests. Defaults to a real Anthropic client (reads
   * ANTHROPIC_API_KEY from the environment). */
  messages?: MessagesLike;
  log?: (message: string) => void;
}

export async function adjudicateIssues(
  report: ComparisonReport,
  options: VisionOptions,
): Promise<void> {
  const log = options.log ?? (() => {});
  const chunkSize = options.chunkSize ?? 6;

  const candidates = adjudicationCandidates(report);
  if (candidates.length === 0) {
    log('No candidate issues to adjudicate.');
    return;
  }
  log(`Adjudicating ${candidates.length} candidate issues with ${options.model}…`);

  const messages = options.messages ?? new Anthropic().messages;

  for (let i = 0; i < candidates.length; i += chunkSize) {
    const chunk = candidates.slice(i, i + chunkSize);
    const content = await buildChunkContent(chunk, options.outDir);

    let response: Anthropic.Message;
    try {
      response = await messages
        .stream({
          model: options.model,
          max_tokens: 16000,
          thinking: { type: 'adaptive' },
          system: [
            {
              type: 'text',
              text: SYSTEM_PROMPT,
              // Stable prefix — cached across chunks/runs when large enough.
              cache_control: { type: 'ephemeral' },
            },
          ],
          output_config: { format: { type: 'json_schema', schema: VERDICT_SCHEMA } },
          messages: [{ role: 'user', content }],
        })
        .finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        throw new VisionError(
          'Anthropic API rejected the credentials — check ANTHROPIC_API_KEY.',
        );
      }
      if (err instanceof Anthropic.APIError) {
        throw new VisionError(`Vision adjudication failed: ${err.status} ${err.message}`);
      }
      throw err;
    }

    const verdicts = parseVerdicts(response);
    applyVerdicts(report, verdicts, options.model);
    log(`  ${Math.min(i + chunkSize, candidates.length)}/${candidates.length} adjudicated`);
  }

  recountSeverities(report);
}

/** Issue facts + labelled evidence images for one chunk. */
async function buildChunkContent(
  issues: Issue[],
  outDir: string,
): Promise<Anthropic.ContentBlockParam[]> {
  const content: Anthropic.ContentBlockParam[] = [
    {
      type: 'text',
      text: `Adjudicate these ${issues.length} candidate issues. Issues are separated below; evidence images (when present) follow each issue's facts.`,
    },
  ];

  for (const issue of issues) {
    const facts = {
      id: issue.id,
      elementName: issue.elementName,
      pointer: issue.pointer,
      currentSeverity: issue.severity,
      expected: issue.expected,
      actual: issue.actual,
      tolerance: issue.tolerance,
      matchConfidence: issue.confidence,
    };
    content.push({ type: 'text', text: `--- Issue ---\n${JSON.stringify(facts, null, 2)}` });

    const labels: Array<[string, string | undefined]> = [
      ['design crop (the intent)', issue.evidence?.design],
      ['live crop (what rendered)', issue.evidence?.live],
      ['pixel diff (differences in red)', issue.evidence?.diff],
    ];
    for (const [label, rel] of labels) {
      if (!rel) continue;
      const image = await readEvidence(outDir, rel);
      if (!image) continue;
      content.push({ type: 'text', text: `${label}:` });
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: image },
      });
    }
  }

  return content;
}

async function readEvidence(outDir: string, rel: string): Promise<string | undefined> {
  try {
    return (await readFile(path.join(outDir, rel))).toString('base64');
  } catch {
    return undefined; // missing evidence file → judge from the numbers
  }
}

/** Structured output → verdicts. The schema guarantees shape; this guards
 * the things a schema can't (unknown ids handled in applyVerdicts). */
export function parseVerdicts(response: Anthropic.Message): Verdict[] {
  const text = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === 'text',
  );
  if (!text) {
    if (response.stop_reason === 'refusal') {
      throw new VisionError('The vision model refused to adjudicate this batch.');
    }
    throw new VisionError(`Vision response had no text content (stop: ${response.stop_reason}).`);
  }
  const parsed = JSON.parse(text.text) as { verdicts: Verdict[] };
  return parsed.verdicts.map((v) => ({
    ...v,
    confidence: Math.min(1, Math.max(0, v.confidence)),
  }));
}

/**
 * Fold verdicts into the report (pure, exported for tests):
 *  - real      → adopt the model's severity + explanation
 *  - noise     → down-rank to `low` (kept, never deleted), previous grade
 *                preserved for human override
 *  - uncertain → severity unchanged, reasoning still recorded
 */
export function applyVerdicts(report: ComparisonReport, verdicts: Verdict[], model: string): void {
  const byId = new Map(report.issues.map((issue) => [issue.id, issue]));
  for (const verdict of verdicts) {
    const issue = byId.get(verdict.id);
    if (!issue) continue; // hallucinated id — drop it

    issue.adjudication = {
      verdict: verdict.verdict,
      explanation: verdict.explanation,
      model,
    };
    issue.confidence = verdict.confidence;

    if (verdict.verdict === 'real') {
      issue.severity = verdict.severity;
      issue.explanation = verdict.explanation;
    } else if (verdict.verdict === 'noise') {
      issue.adjudication.previousSeverity = issue.severity;
      issue.severity = 'low';
    }
    // uncertain: keep Layer A/B severity and explanation.
  }
}

export function recountSeverities(report: ComparisonReport): void {
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const issue of report.issues) bySeverity[issue.severity]++;
  report.summary.issuesBySeverity = bySeverity;
}
