import { describe, expect, it, vi } from 'vitest';
import { CaptionEngine } from './caption-engine';
import type { Participant } from './types';

const alice: Participant = { id: 'a', name: 'Alice', isSelf: false };
const bob: Participant = { id: 'b', name: 'Bob', isSelf: false };

describe('CaptionEngine', () => {
  it('replaces the interim line rather than appending to it', () => {
    const e = new CaptionEngine();
    e.upsertInterim({ source: 'asr', speaker: alice, text: 'can you', startedAt: 0 });
    e.upsertInterim({ source: 'asr', speaker: alice, text: 'can you hear', startedAt: 0 });
    expect(e.snapshot()).toHaveLength(1);
    expect(e.snapshot()[0]!.text).toBe('can you hear');
  });

  it('keeps interim lines from different speakers separate', () => {
    const e = new CaptionEngine();
    e.upsertInterim({ source: 'asr', speaker: alice, text: 'hello', startedAt: 0 });
    e.upsertInterim({ source: 'asr', speaker: bob, text: 'hi', startedAt: 0 });
    expect(e.snapshot()).toHaveLength(2);
  });

  it('committing clears the matching interim line', () => {
    const e = new CaptionEngine();
    e.upsertInterim({ source: 'asr', speaker: alice, text: 'can you hear', startedAt: 0 });
    e.commit({ source: 'asr', speaker: alice, text: 'can you hear me', startedAt: 0 });
    expect(e.snapshot()).toHaveLength(1);
    expect(e.snapshot()[0]!.interim).toBe(false);
  });

  it('merges a quick continuation from the same speaker', () => {
    const e = new CaptionEngine({ mergeWindowMs: 10_000 });
    e.commit({ source: 'asr', speaker: alice, text: 'One moment.', startedAt: 0 });
    e.commit({ source: 'asr', speaker: alice, text: 'Let me check.', startedAt: 0 });
    expect(e.snapshot()).toHaveLength(1);
    expect(e.snapshot()[0]!.text).toBe('One moment. Let me check.');
  });

  it('does not merge across speakers', () => {
    const e = new CaptionEngine({ mergeWindowMs: 10_000 });
    e.commit({ source: 'asr', speaker: alice, text: 'Ready?', startedAt: 0 });
    e.commit({ source: 'asr', speaker: bob, text: 'Ready.', startedAt: 0 });
    expect(e.snapshot()).toHaveLength(2);
  });

  it('does not merge across sources — signed and spoken text stay distinct', () => {
    const e = new CaptionEngine({ mergeWindowMs: 10_000 });
    e.commit({ source: 'asr', speaker: alice, text: 'Any questions?', startedAt: 0 });
    e.commit({ source: 'sign', speaker: alice, text: 'Yes.', startedAt: 0 });
    expect(e.snapshot()).toHaveLength(2);
  });

  it('carries the weakest confidence through a merge', () => {
    const e = new CaptionEngine({ mergeWindowMs: 10_000 });
    e.commit({ source: 'sign', speaker: null, text: 'Yes.', confidence: 0.9, startedAt: 0 });
    e.commit({ source: 'sign', speaker: null, text: 'Agree.', confidence: 0.5, startedAt: 0 });
    expect(e.snapshot()[0]!.confidence).toBeCloseTo(0.5);
  });

  it('bounds memory with a ring buffer', () => {
    const e = new CaptionEngine({ maxCaptions: 3, mergeWindowMs: 0 });
    for (let i = 0; i < 10; i++) {
      e.commit({ source: 'asr', speaker: alice, text: `line ${i}`, startedAt: 0 });
    }
    expect(e.snapshot()).toHaveLength(3);
    expect(e.snapshot()[2]!.text).toBe('line 9');
  });

  it('ignores empty text', () => {
    const e = new CaptionEngine();
    e.upsertInterim({ source: 'asr', speaker: alice, text: '   ', startedAt: 0 });
    expect(e.commit({ source: 'asr', speaker: alice, text: '', startedAt: 0 })).toBeNull();
    expect(e.snapshot()).toHaveLength(0);
  });

  it('notifies subscribers immediately and on change', () => {
    const e = new CaptionEngine();
    const fn = vi.fn();
    const off = e.subscribe(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    e.commit({ source: 'system', speaker: null, text: 'Camera started.', startedAt: 0 });
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    e.clear();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
