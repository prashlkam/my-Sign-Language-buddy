/**
 * Seed vocabulary for v1 (PLAN.md §4.2).
 *
 * IMPORTANT: this list is a placeholder chosen for *meeting utility* by a
 * hearing developer. PLAN.md §11 makes vocabulary selection a decision for the
 * Deaf co-designers, not for us. Treat every entry as provisional and expect
 * the final list to differ substantially. It is here so the pipeline has
 * something to run against, not because it is right.
 *
 * `gloss` is the uppercase label a recogniser emits. `english` is the default
 * surface realisation used by the rule-based assembler and — critically — the
 * only wording the fabrication guard will accept for that gloss.
 */

export interface LexiconEntry {
  gloss: string;
  /** Primary English realisation. */
  english: string;
  /** Other realisations the fabrication guard should also accept. */
  alternates?: string[];
  /** Forces a question mark on the assembled utterance. */
  question?: boolean;
}

export const MEETING_LEXICON_ASL: LexiconEntry[] = [
  { gloss: 'YES', english: 'yes' },
  { gloss: 'NO', english: 'no' },
  { gloss: 'HELLO', english: 'hello', alternates: ['hi'] },
  { gloss: 'THANK-YOU', english: 'thank you', alternates: ['thanks'] },
  { gloss: 'PLEASE', english: 'please' },
  { gloss: 'SORRY', english: 'sorry' },
  { gloss: 'AGREE', english: 'agree' },
  { gloss: 'DISAGREE', english: 'disagree' },
  { gloss: 'UNDERSTAND', english: 'understand' },
  { gloss: 'NOT-UNDERSTAND', english: "don't understand" },
  { gloss: 'QUESTION', english: '', question: true },
  { gloss: 'ME', english: 'I', alternates: ['me', 'my'] },
  { gloss: 'YOU', english: 'you', alternates: ['your'] },
  { gloss: 'WE', english: 'we', alternates: ['us', 'our'] },
  { gloss: 'NOT', english: 'not' },
  { gloss: 'WANT', english: 'want' },
  { gloss: 'NEED', english: 'need' },
  { gloss: 'HAVE', english: 'have' },
  { gloss: 'CAN', english: 'can' },
  { gloss: 'FINISH', english: 'finished', alternates: ['done', 'finish'] },
  { gloss: 'WAIT', english: 'wait' },
  { gloss: 'ONE-MOMENT', english: 'one moment' },
  { gloss: 'REPEAT', english: 'repeat' },
  { gloss: 'SLOW', english: 'slow', alternates: ['slower', 'slowly'] },
  { gloss: 'AGAIN', english: 'again' },
  { gloss: 'WHAT', english: 'what', question: true },
  { gloss: 'WHO', english: 'who', question: true },
  { gloss: 'WHERE', english: 'where', question: true },
  { gloss: 'WHEN', english: 'when', question: true },
  { gloss: 'WHY', english: 'why', question: true },
  { gloss: 'HOW', english: 'how', question: true },
  { gloss: 'WORK', english: 'work' },
  { gloss: 'MEETING', english: 'meeting' },
  { gloss: 'TIME', english: 'time' },
  { gloss: 'TODAY', english: 'today' },
  { gloss: 'TOMORROW', english: 'tomorrow' },
  { gloss: 'YESTERDAY', english: 'yesterday' },
  { gloss: 'GOOD', english: 'good' },
  { gloss: 'BAD', english: 'bad' },
  { gloss: 'HELP', english: 'help' },
  { gloss: 'START', english: 'start' },
  { gloss: 'STOP', english: 'stop' },
  { gloss: 'SEE', english: 'see' },
  { gloss: 'HEAR', english: 'hear' },
  { gloss: 'DEAF', english: 'Deaf' },
  { gloss: 'SIGN', english: 'sign' },
  { gloss: 'NAME', english: 'name' },
];

/**
 * BSL is a different language, not a relabelling of ASL (PLAN.md §4.2 / §6 M6).
 * This is intentionally empty: populating it by translating the ASL list would
 * bake in exactly the mistake the plan warns about. It gets filled by BSL
 * signers during M6.
 */
export const MEETING_LEXICON_BSL: LexiconEntry[] = [];

export function lexiconFor(language: 'asl' | 'bsl'): LexiconEntry[] {
  return language === 'asl' ? MEETING_LEXICON_ASL : MEETING_LEXICON_BSL;
}

export function buildLexiconIndex(entries: LexiconEntry[]): Map<string, LexiconEntry> {
  const m = new Map<string, LexiconEntry>();
  for (const e of entries) m.set(e.gloss, e);
  return m;
}
