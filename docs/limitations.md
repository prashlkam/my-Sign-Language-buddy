# Limitations

Read this before showing the tool to anyone who might rely on it.
Corresponds to [PLAN.md](../PLAN.md) §0, §4.2 and §11.

## It is not an interpreter

It is a communication aid for everyday calls — standups, catch-ups, informal
meetings. For medical appointments, legal or financial matters, employment
decisions, disciplinary meetings, or emergencies, a qualified interpreter is
necessary and this tool is not a substitute. The product says so once, at first
run, plainly.

The word "interpreter" should not appear in any description of this tool except
to say what it is not. That is not marketing caution; it is the consistent
position of Deaf community organisations and interpreter associations, and the
reason for it is that people do come to rely on tools like this, in exactly the
situations where being wrong is most costly.

## Sign recognition is not implemented

The current recogniser matches about six hand configurations by geometry. It is
labelled `DemoGestureRecognizer`, it exists so the pipeline can be run and
debugged, and the overlay shows a red banner whenever it is active.

Real sign recognition is genuinely hard and the difficulty is easy to
underestimate. ASL is not a sequence of hand shapes:

- Grammar is carried in **movement and space** — verb agreement is expressed by
  where a sign is directed, which requires tracking referents established
  earlier in the conversation.
- **Non-manual markers** are grammar, not affect. Eyebrow position distinguishes
  a yes/no question from a wh-question; a headshake carries negation scope. Two
  signs can be identical in the hands and differ only in the face.
- **Coarticulation**: in connected signing, signs blend into their neighbours,
  so a model trained on isolated citation forms degrades sharply on real
  conversation.
- **Variation**: regional variation, Black ASL, one-handed signers, signers who
  use a wheelchair. Public datasets are studio-lit, front-facing and
  demographically narrow, which is why PLAN.md §7 treats own data collection as
  non-optional.

Published continuous ASL translation results are in the low single digits to low
teens BLEU-4. A system claiming fluent open-vocabulary sign translation today is
almost always doing isolated classification over a small vocabulary.

## Recognition failures are asymmetric

A missed sign is a gap. A *wrongly recognised* sign is words placed in a Deaf
person's mouth, in their name, in front of their colleagues. Those are not
equally bad, and the design reflects that at four points:

1. **Abstention.** Below the confidence threshold the recogniser emits
   `⟨unclear⟩` rather than a guess.
2. **Visible gaps.** `[…]` reaches the final caption. It is never filled in.
3. **The fabrication guard.** Content words in an assembled sentence must trace
   back to a recognised sign, or the sentence is rejected.
4. **Review before send.** The person who signed sees the text first.

If you are tempted to relax any of these to make a demo smoother, that is the
tradeoff being made — smoother demo, higher chance of misrepresenting someone.

## Calibration is not the same as confidence

The confidence numbers shown are only meaningful if a model's temperature was
fitted on **held-out signers**. Same-signer splits inflate accuracy enormously
and are the most common way sign recognition results get overstated. The ONNX
loader warns when a model ships without a fitted temperature, because in that
case the abstention threshold does not mean what it appears to mean.

## Platform fragility

Meet's DOM is obfuscated and changes without notice. Our selectors target ARIA
roles and labels rather than class names, which helps, but they will break.
`health()` surfaces what is currently working; the overlay tells the user rather
than failing silently. Budget ongoing maintenance for this — it is a permanent
tax, not a one-time cost.

The virtual camera and microphone paths are the ones that depend on nobody's
permission, which is why the plan treats them as first-class rather than as
fallbacks.

## What no amount of engineering fixes

PLAN.md §11 requires paid Deaf co-designers with decision authority over
vocabulary, UX, and how confidence is presented — not an advisory board
consulted after the architecture is settled. The seed lexicon in
`packages/core/src/lexicon.ts` was written by a hearing developer and every
entry in it is provisional. `MEETING_LEXICON_BSL` is deliberately empty:
translating the ASL list would bake in precisely the assumption that ASL and BSL
are variants of one language, which they are not.

No amount of code closes that gap, and this codebase should not be read as
having closed it.
