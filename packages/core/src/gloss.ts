import { UNCLEAR, type AssembledUtterance, type GlossToken, type SignLanguage } from './types';
import { buildLexiconIndex, lexiconFor, type LexiconEntry } from './lexicon';

/**
 * Gloss → English (PLAN.md §4.3).
 *
 * A recogniser emits glosses (ME QUESTION HAVE), not English. Something has to
 * turn that into a sentence. The danger is that anything good at producing
 * fluent English is also good at producing fluent English that the person never
 * said — and this text is attributed to them, in their own voice, to their
 * colleagues. A plausible wrong sentence here is a real harm, not a UX blemish.
 *
 * So there are two assemblers and one guard:
 *
 *  - `assembleRuleBased` — boring, literal, incapable of invention. Always safe.
 *  - `buildClaudeRequest` — better English, via the Claude API. Opt-in, text-only.
 *  - `validateAssembly`  — checks any candidate (LLM or otherwise) against the
 *    glosses that licensed it, and rejects content that no gloss supports.
 *
 * The guard is the load-bearing part. Prompt instructions are a request; the
 * guard is an enforcement point. Never ship the LLM path without it.
 */

/** Rendered in place of a sign the recogniser could not identify. */
export const GAP_MARKER = '[…]';

/**
 * Words the assembler may introduce without a licensing gloss, because they
 * carry grammar rather than content. Sign languages legitimately omit these,
 * so re-inserting them is translation, not fabrication.
 *
 * Pronouns are deliberately NOT here. Adding "I" or "she" invents a referent,
 * and getting the referent wrong changes who said what about whom.
 */
const FREE_FUNCTION_WORDS = new Set([
  'a', 'an', 'the',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'about',
  'and', 'or', 'but', 'that', 'this',
  'will', 'would',
]);

const SUFFIXES = ['ing', 'ed', 'es', 'ly', 's'];

/** Strip punctuation and case, keeping the word readable for error reports. */
function bareWord(word: string): string {
  return word.replace(/[^A-Za-z0-9'-]/g, '');
}

/**
 * Crude iterative stemmer. Must be applied repeatedly until stable, or
 * "meetings" → "meeting" while "meeting" → "meet" and the two never match.
 */
function normalise(word: string): string {
  let w = bareWord(word).toLowerCase().replace(/-/g, '');
  for (let guard = 0; guard < 3; guard++) {
    const before = w;
    for (const suf of SUFFIXES) {
      if (w.length > suf.length + 2 && w.endsWith(suf)) {
        w = w.slice(0, -suf.length);
        break;
      }
    }
    if (w === before) break;
  }
  return w;
}

/** `FS:PRASHANTH` → fingerspelled name. `NUM:5` → number. */
function specialToken(gloss: string): string | null {
  if (gloss.startsWith('FS:')) {
    const raw = gloss.slice(3);
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  }
  if (gloss.startsWith('NUM:')) return gloss.slice(4);
  return null;
}

export interface AssembleOptions {
  language: SignLanguage;
  /** Glosses below this confidence are rendered as gaps rather than guessed at. */
  abstainBelow?: number;
}

/**
 * Literal assembly. Maps each gloss to its lexicon realisation, preserves order
 * and gaps, capitalises, and punctuates. It does not reorder, does not infer
 * subjects, and does not smooth. The output reads like glosses because it *is*
 * glosses — which is honest, and which Deaf users can read.
 */
export function assembleRuleBased(
  tokens: GlossToken[],
  opts: AssembleOptions,
): AssembledUtterance {
  const index = buildLexiconIndex(lexiconFor(opts.language));
  const abstainBelow = opts.abstainBelow ?? 0;

  const parts: string[] = [];
  let question = false;
  let hasGaps = false;
  let confidence = 1;

  for (const t of tokens) {
    confidence = Math.min(confidence, t.confidence);

    if (t.gloss === UNCLEAR || t.confidence < abstainBelow) {
      hasGaps = true;
      if (parts[parts.length - 1] !== GAP_MARKER) parts.push(GAP_MARKER);
      continue;
    }

    const special = specialToken(t.gloss);
    if (special !== null) {
      parts.push(special);
      continue;
    }

    const entry = index.get(t.gloss);
    if (!entry) {
      // A gloss with no lexicon entry is not something we can render. Showing
      // the raw label would leak internals; guessing would be fabrication.
      hasGaps = true;
      if (parts[parts.length - 1] !== GAP_MARKER) parts.push(GAP_MARKER);
      continue;
    }
    if (entry.question) question = true;
    if (entry.english !== '') parts.push(entry.english);
  }

  let text = parts.join(' ').trim();
  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
    if (!/[.?!]$/.test(text)) text += question ? '?' : '.';
  }

  return { text, confidence: tokens.length === 0 ? 0 : confidence, hasGaps, tokens };
}

export interface ValidationResult {
  ok: boolean;
  /** Words in the candidate that no gloss licensed. */
  unlicensed: string[];
  /** True if the candidate dropped a gap the glosses required. */
  droppedGaps: boolean;
}

/**
 * The fabrication guard.
 *
 * Every content word in `candidate` must trace back to a gloss in `tokens`, and
 * every gap in the glosses must still be visible in the candidate. Function
 * words are free; pronouns and content words are not.
 *
 * This is intentionally strict. A false rejection costs us a slightly clumsier
 * sentence from the rule-based fallback. A false acceptance puts words in a
 * Deaf person's mouth in front of their colleagues. The asymmetry is not close.
 */
export function validateAssembly(
  tokens: GlossToken[],
  candidate: string,
  opts: AssembleOptions,
): ValidationResult {
  const index = buildLexiconIndex(lexiconFor(opts.language));
  const licensed = new Set<string>();
  let requiredGaps = 0;

  for (const t of tokens) {
    if (t.gloss === UNCLEAR) {
      requiredGaps++;
      continue;
    }
    const special = specialToken(t.gloss);
    if (special !== null) {
      licensed.add(normalise(special));
      continue;
    }
    const entry: LexiconEntry | undefined = index.get(t.gloss);
    if (!entry) {
      requiredGaps++;
      continue;
    }
    for (const surface of [entry.english, ...(entry.alternates ?? [])]) {
      for (const w of surface.split(/\s+/)) {
        if (w) licensed.add(normalise(w));
      }
    }
    // The gloss label itself is acceptable evidence (e.g. THANK-YOU → "thank").
    for (const part of entry.gloss.toLowerCase().split(/[-_]/)) licensed.add(normalise(part));
  }

  const gapCount = (candidate.match(/\[…\]|\[\.\.\.\]/g) ?? []).length;
  const unlicensed: string[] = [];

  const stripped = candidate.replace(/\[…\]|\[\.\.\.\]/g, ' ');
  for (const raw of stripped.split(/\s+/)) {
    const bare = bareWord(raw);
    if (bare === '') continue;
    if (FREE_FUNCTION_WORDS.has(bare.toLowerCase())) continue;
    if (licensed.has(normalise(raw))) continue;
    // Reported without punctuation so the diagnostic reads cleanly in the UI.
    unlicensed.push(bare);
  }

  return {
    ok: unlicensed.length === 0 && gapCount >= requiredGaps,
    unlicensed,
    droppedGaps: gapCount < requiredGaps,
  };
}

export interface ClaudeRequest {
  model: string;
  max_tokens: number;
  system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
  messages: Array<{ role: 'user'; content: string }>;
}

const SYSTEM_PROMPT = `You convert American or British Sign Language gloss sequences into English for a live captioning tool. The English you produce is spoken aloud to other people in a video call and attributed to the Deaf person who signed it.

Rules, in priority order:

1. Render ONLY what the glosses contain. Never add a subject, object, detail, or clause that no gloss licenses. If the glosses are fragmentary, the English must be fragmentary.
2. Preserve every ${GAP_MARKER} marker exactly, in position. These mark signs the recogniser could not identify. Never fill a gap in, never smooth over one, never drop one.
3. Do not add pronouns. If no gloss indicates who is acting, leave it out.
4. Keep it short. One sentence unless the glosses clearly span more.
5. Add only the grammatical words English requires (articles, copulas, prepositions).
6. Output the English only — no notes, no alternatives, no explanation.

An awkward but faithful sentence is correct. A fluent sentence containing anything the signer did not sign is a failure, and a serious one.`;

/**
 * Builds the Claude API request for the opt-in cloud path (PLAN.md §4.3).
 * Only glosses leave the device — never video, never audio, never keypoints.
 *
 * The system prompt is cached (it is identical for every utterance), which
 * keeps per-utterance cost to the handful of tokens in the gloss sequence.
 */
export function buildClaudeRequest(
  tokens: GlossToken[],
  opts: AssembleOptions & { model?: string },
): ClaudeRequest {
  const seq = tokens
    .map((t) => (t.gloss === UNCLEAR ? GAP_MARKER : t.gloss))
    .join(' ');

  return {
    model: opts.model ?? 'claude-sonnet-5',
    max_tokens: 150,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: `Language: ${opts.language.toUpperCase()}\nGloss sequence: ${seq}\n\nEnglish:`,
      },
    ],
  };
}

/**
 * Accept an LLM candidate only if it survives the guard; otherwise fall back to
 * the literal assembly. The caller is told which one it got so the UI can say so.
 */
export function chooseAssembly(
  tokens: GlossToken[],
  candidate: string | null,
  opts: AssembleOptions,
): { utterance: AssembledUtterance; via: 'llm' | 'rule-based'; rejection?: ValidationResult } {
  const fallback = assembleRuleBased(tokens, opts);
  if (candidate === null || candidate.trim() === '') {
    return { utterance: fallback, via: 'rule-based' };
  }
  const check = validateAssembly(tokens, candidate, opts);
  if (!check.ok) {
    return { utterance: fallback, via: 'rule-based', rejection: check };
  }
  return {
    utterance: { ...fallback, text: candidate.trim() },
    via: 'llm',
  };
}
