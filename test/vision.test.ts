import { mkdir, rm, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adjudicateIssues,
  adjudicationCandidates,
  applyVerdicts,
  parseVerdicts,
  recountSeverities,
  VisionError,
  type MessagesLike,
  type Verdict,
} from '../src/compare/vision.js';
import { writePng } from '../src/report/images.js';
import type { ComparisonReport, Issue } from '../src/types.js';

function issue(partial: Partial<Issue> & { id: string }): Issue {
  return {
    elementName: partial.id,
    pointer: 'color.background',
    severity: 'high',
    viewport: 1440,
    explanation: 'layer A explanation',
    confidence: 1,
    ...partial,
  };
}

function report(issues: Issue[]): ComparisonReport {
  return {
    design: { fileKey: 'K', frameId: '1:0', frameName: 'F' },
    live: { url: 'http://x', viewport: { width: 1440, height: 900 } },
    comparedAt: '2026-06-05T00:00:00.000Z',
    scale: 1,
    warnings: [],
    summary: {
      pointersChecked: 0,
      passed: 0,
      failed: issues.length,
      skipped: 0,
      issuesBySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    },
    matching: { matched: 0, designOnly: 0, liveOnly: 0, pairs: [] },
    evaluations: [],
    issues,
  };
}

/** Fake Anthropic message carrying a structured-output text block. */
function fakeMessage(payload: unknown, stopReason = 'end_turn'): Anthropic.Message {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    stop_reason: stopReason,
  } as unknown as Anthropic.Message;
}

describe('adjudicationCandidates', () => {
  it('skips info issues and already-adjudicated ones', () => {
    const r = report([
      issue({ id: 'a' }),
      issue({ id: 'b', severity: 'info' }),
      issue({ id: 'c', adjudication: { verdict: 'real', explanation: 'x', model: 'm' } }),
    ]);
    expect(adjudicationCandidates(r).map((i) => i.id)).toEqual(['a']);
  });
});

describe('applyVerdicts', () => {
  it('real adopts the model severity and explanation', () => {
    const r = report([issue({ id: 'a', severity: 'medium' })]);
    applyVerdicts(
      r,
      [{ id: 'a', verdict: 'real', severity: 'critical', explanation: 'button is missing', confidence: 0.95 }],
      'claude-opus-4-8',
    );
    expect(r.issues[0]).toMatchObject({
      severity: 'critical',
      explanation: 'button is missing',
      confidence: 0.95,
      adjudication: { verdict: 'real', model: 'claude-opus-4-8' },
    });
  });

  it('noise down-ranks to low but keeps the previous grade for override', () => {
    const r = report([issue({ id: 'a', severity: 'high' })]);
    applyVerdicts(
      r,
      [{ id: 'a', verdict: 'noise', severity: 'low', explanation: 'anti-aliasing', confidence: 0.8 }],
      'm',
    );
    expect(r.issues[0].severity).toBe('low');
    expect(r.issues[0].adjudication?.previousSeverity).toBe('high');
    expect(r.issues[0].explanation).toBe('layer A explanation'); // original kept
  });

  it('uncertain keeps severity but records the reasoning', () => {
    const r = report([issue({ id: 'a', severity: 'medium' })]);
    applyVerdicts(
      r,
      [{ id: 'a', verdict: 'uncertain', severity: 'high', explanation: 'crops too small', confidence: 0.4 }],
      'm',
    );
    expect(r.issues[0].severity).toBe('medium');
    expect(r.issues[0].adjudication?.verdict).toBe('uncertain');
  });

  it('ignores verdicts for unknown issue ids', () => {
    const r = report([issue({ id: 'a' })]);
    applyVerdicts(
      r,
      [{ id: 'ghost', verdict: 'real', severity: 'critical', explanation: 'x', confidence: 1 }],
      'm',
    );
    expect(r.issues[0].adjudication).toBeUndefined();
  });
});

describe('parseVerdicts', () => {
  it('clamps confidence into 0..1', () => {
    const verdicts = parseVerdicts(
      fakeMessage({ verdicts: [{ id: 'a', verdict: 'real', severity: 'high', explanation: 'x', confidence: 1.7 }] }),
    );
    expect(verdicts[0].confidence).toBe(1);
  });

  it('raises a VisionError on refusals', () => {
    const refusal = { content: [], stop_reason: 'refusal' } as unknown as Anthropic.Message;
    expect(() => parseVerdicts(refusal)).toThrow(VisionError);
  });
});

describe('adjudicateIssues (stubbed client)', () => {
  let outDir: string;
  const requests: Anthropic.MessageStreamParams[] = [];

  const stub: MessagesLike = {
    stream(params) {
      requests.push(params);
      // Echo a verdict per issue found in the request text blocks.
      const ids = (params.messages[0].content as Anthropic.ContentBlockParam[])
        .filter((b): b is Anthropic.TextBlockParam => b.type === 'text')
        .map((b) => /"id": "([^"]+)"/.exec(b.text)?.[1])
        .filter((id): id is string => Boolean(id));
      const verdicts: Verdict[] = ids.map((id, i) => ({
        id,
        verdict: i === 0 ? 'noise' : 'real',
        severity: i === 0 ? 'low' : 'high',
        explanation: `verdict for ${id}`,
        confidence: 0.9,
      }));
      return { finalMessage: async () => fakeMessage({ verdicts }) };
    },
  };

  beforeAll(async () => {
    outDir = await mkdtemp(path.join(tmpdir(), 'design-qa-vision-'));
    await mkdir(path.join(outDir, 'evidence'), { recursive: true });
    const png = new PNG({ width: 4, height: 4 });
    png.data.fill(200);
    await writeFile(path.join(outDir, 'evidence', 'a-design.png'), writePng(png));
  });

  afterAll(() => rm(outDir, { recursive: true, force: true }));

  it('adjudicates candidates, applies verdicts, and recounts the summary', async () => {
    const r = report([
      issue({ id: 'a', severity: 'high', evidence: { design: path.join('evidence', 'a-design.png') } }),
      issue({ id: 'b', severity: 'medium' }),
      issue({ id: 'skip-me', severity: 'info' }),
    ]);

    await adjudicateIssues(r, { model: 'claude-opus-4-8', outDir, messages: stub });

    // a → noise (down-ranked, was high); b → real (re-graded high)
    expect(r.issues[0].severity).toBe('low');
    expect(r.issues[0].adjudication?.previousSeverity).toBe('high');
    expect(r.issues[1].severity).toBe('high');
    expect(r.issues[1].explanation).toBe('verdict for b');
    expect(r.issues[2].adjudication).toBeUndefined(); // info untouched

    expect(r.summary.issuesBySeverity).toMatchObject({ low: 1, high: 1, info: 1 });
  });

  it('sends a cached system rubric, structured output schema, and the evidence image', () => {
    expect(requests).toHaveLength(1);
    const params = requests[0];

    const system = params.system as Anthropic.TextBlockParam[];
    expect(system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(system[0].text).toContain('adjudication layer');

    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(
      (params.output_config?.format as { type: string } | undefined)?.type,
    ).toBe('json_schema');

    const blocks = params.messages[0].content as Anthropic.ContentBlockParam[];
    const images = blocks.filter((b) => b.type === 'image');
    expect(images).toHaveLength(1); // only issue "a" has evidence on disk
  });
});
