import { describe, expect, it } from 'vitest';
import {
  GAP_MARKER,
  assembleRuleBased,
  buildClaudeRequest,
  chooseAssembly,
  validateAssembly,
} from './gloss';
import { UNCLEAR, type GlossToken } from './types';

const ASL = { language: 'asl' as const };

function toks(...specs: Array<string | [string, number]>): GlossToken[] {
  return specs.map((s, i) => {
    const [gloss, conf] = typeof s === 'string' ? [s, 0.95] : s;
    return { gloss, confidence: conf as number, startedAt: i * 100, endedAt: i * 100 + 80 };
  });
}

describe('assembleRuleBased', () => {
  it('renders glosses literally, in order', () => {
    const u = assembleRuleBased(toks('ME', 'HAVE', 'QUESTION'), ASL);
    expect(u.text).toBe('I have?');
    expect(u.hasGaps).toBe(false);
  });

  it('marks a question from a wh-gloss', () => {
    expect(assembleRuleBased(toks('WHAT', 'TIME'), ASL).text).toBe('What time?');
  });

  it('preserves unclear signs as a visible gap', () => {
    const u = assembleRuleBased(toks('ME', UNCLEAR, 'WORK'), ASL);
    expect(u.text).toContain(GAP_MARKER);
    expect(u.hasGaps).toBe(true);
  });

  it('turns a low-confidence gloss into a gap rather than a guess', () => {
    const u = assembleRuleBased(toks('ME', ['MEETING', 0.2]), { ...ASL, abstainBelow: 0.6 });
    expect(u.text).toContain(GAP_MARKER);
    expect(u.text).not.toContain('meeting');
  });

  it('gaps an unknown gloss instead of leaking the raw label', () => {
    const u = assembleRuleBased(toks('SOME-UNTRAINED-SIGN'), ASL);
    expect(u.text).not.toContain('UNTRAINED');
    expect(u.hasGaps).toBe(true);
  });

  it('collapses consecutive gaps', () => {
    const u = assembleRuleBased(toks(UNCLEAR, UNCLEAR, UNCLEAR), ASL);
    expect(u.text.match(/\[…\]/g)).toHaveLength(1);
  });

  it('renders fingerspelled names and numbers', () => {
    const u = assembleRuleBased(toks('ME', 'NAME', 'FS:PRIYA'), ASL);
    expect(u.text).toContain('Priya');
    expect(assembleRuleBased(toks('NUM:5', 'MEETING'), ASL).text).toContain('5');
  });

  it('reports the weakest link as the utterance confidence', () => {
    const u = assembleRuleBased(toks(['ME', 0.99], ['WORK', 0.42]), ASL);
    expect(u.confidence).toBeCloseTo(0.42);
  });

  it('returns empty text for no tokens', () => {
    expect(assembleRuleBased([], ASL).text).toBe('');
  });
});

describe('validateAssembly — the fabrication guard', () => {
  it('accepts a faithful rendering with added function words', () => {
    const r = validateAssembly(toks('ME', 'HAVE', 'QUESTION'), 'I have a question.', ASL);
    expect(r.ok).toBe(true);
  });

  it('rejects invented content, however plausible', () => {
    const r = validateAssembly(
      toks('ME', 'QUESTION'),
      'I have a question about the deployment timeline.',
      ASL,
    );
    expect(r.ok).toBe(false);
    expect(r.unlicensed).toEqual(expect.arrayContaining(['deployment']));
  });

  it('rejects an invented pronoun — it invents a referent', () => {
    const r = validateAssembly(toks('WORK', 'FINISH'), 'She finished the work.', ASL);
    expect(r.ok).toBe(false);
    expect(r.unlicensed.map((w) => w.toLowerCase())).toContain('she');
  });

  it('rejects a candidate that smoothed a gap away', () => {
    const r = validateAssembly(toks('ME', UNCLEAR, 'WORK'), 'I am working.', ASL);
    expect(r.ok).toBe(false);
    expect(r.droppedGaps).toBe(true);
  });

  it('accepts a candidate that keeps the gap in place', () => {
    const r = validateAssembly(toks('ME', UNCLEAR, 'WORK'), `I ${GAP_MARKER} work.`, ASL);
    expect(r.ok).toBe(true);
  });

  it('tolerates inflection of a licensed word', () => {
    expect(validateAssembly(toks('WORK'), 'Working.', ASL).ok).toBe(true);
    expect(validateAssembly(toks('MEETING'), 'The meetings.', ASL).ok).toBe(true);
  });

  it('accepts fingerspelled names it licensed', () => {
    expect(validateAssembly(toks('NAME', 'FS:PRIYA'), 'My name is Priya.', ASL).ok).toBe(false);
    expect(validateAssembly(toks('ME', 'NAME', 'FS:PRIYA'), 'My name is Priya.', ASL).ok).toBe(true);
  });
});

describe('chooseAssembly', () => {
  it('uses the LLM candidate when it passes the guard', () => {
    const t = toks('ME', 'HAVE', 'QUESTION');
    const r = chooseAssembly(t, 'I have a question.', ASL);
    expect(r.via).toBe('llm');
    expect(r.utterance.text).toBe('I have a question.');
  });

  it('falls back to literal assembly when the candidate fabricates', () => {
    const t = toks('ME', 'HAVE', 'QUESTION');
    const r = chooseAssembly(t, 'I have a question about the Q3 roadmap.', ASL);
    expect(r.via).toBe('rule-based');
    expect(r.rejection?.unlicensed).toContain('roadmap');
    expect(r.utterance.text).toBe('I have?');
  });

  it('falls back when there is no candidate at all', () => {
    expect(chooseAssembly(toks('YES'), null, ASL).via).toBe('rule-based');
  });
});

describe('buildClaudeRequest', () => {
  it('sends only glosses, and caches the system prompt', () => {
    const req = buildClaudeRequest(toks('ME', UNCLEAR, 'WORK'), ASL);
    expect(req.model).toBe('claude-sonnet-5');
    expect(req.system[0]?.cache_control).toEqual({ type: 'ephemeral' });
    const user = req.messages[0]!.content;
    expect(user).toContain('ME');
    expect(user).toContain(GAP_MARKER);
    // No timestamps, no keypoints, no identifiers.
    expect(user).not.toMatch(/\d{4,}/);
  });
});
