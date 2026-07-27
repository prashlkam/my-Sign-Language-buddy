import { describe, expect, it } from 'vitest';
import { StablePrefixCommitter } from './stable-prefix';

describe('StablePrefixCommitter', () => {
  it('commits nothing from a single hypothesis', () => {
    const c = new StablePrefixCommitter(2);
    const r = c.push('can you hear');
    expect(r.committed).toBe('');
    expect(r.draft).toBe('can you hear');
  });

  it('commits words two consecutive hypotheses agree on', () => {
    const c = new StablePrefixCommitter(2);
    c.push('can you hear');
    const r = c.push('can you hear me');
    expect(r.committed).toBe('can you hear');
    expect(r.newlyCommitted).toBe('can you hear');
    expect(r.draft).toBe('me');
  });

  it('does not commit a word the ASR is still revising', () => {
    const c = new StablePrefixCommitter(2);
    c.push('I think we should');
    c.push('I think we shut');
    const r = c.push('I think we shut down');
    // "should"/"shut" disagreed, so only the agreed prefix advances.
    expect(r.committed).toBe('I think we shut');
    expect(r.committed.includes('should')).toBe(false);
  });

  it('never rewrites text the user has already read', () => {
    const c = new StablePrefixCommitter(2);
    c.push('the deploy is green');
    const first = c.push('the deploy is green');
    expect(first.committed).toBe('the deploy is green');

    // ASR revises history — we keep what was shown and count the divergence.
    const after = c.push('the deployment is red');
    expect(after.committed.startsWith('the deploy is green')).toBe(true);
    expect(c.diagnostics.divergences).toBeGreaterThan(0);
  });

  it('finalize commits the outstanding draft and resets', () => {
    const c = new StablePrefixCommitter(2);
    c.push('one moment');
    c.push('one moment please');
    const f = c.finalize();
    expect(f.committed).toBe('one moment please');
    expect(f.draft).toBe('');
    expect(c.push('next utterance').committed).toBe('');
  });

  it('finalize with explicit final text prefers the final text', () => {
    const c = new StablePrefixCommitter(2);
    c.push('i have a');
    c.push('i have a question');
    const f = c.finalize('i have a question about the schema');
    expect(f.committed).toBe('i have a question about the schema');
  });

  it('agreement=3 is more conservative than agreement=2', () => {
    const two = new StablePrefixCommitter(2);
    const three = new StablePrefixCommitter(3);
    for (const h of ['hello there', 'hello there everyone']) {
      two.push(h);
      three.push(h);
    }
    expect(two.diagnostics.committedWordCount).toBeGreaterThan(
      three.diagnostics.committedWordCount,
    );
  });

  it('handles empty and whitespace hypotheses', () => {
    const c = new StablePrefixCommitter(2);
    expect(c.push('').committed).toBe('');
    expect(c.push('   ').draft).toBe('');
  });
});
