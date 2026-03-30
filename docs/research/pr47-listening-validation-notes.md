# PR #47 — Listening Validation Notes

## Setup

- Build completed with TypeScript + Vite to verify code integrity.
- Validation focus was foreground transient/event and phrase-agent layers in `hybrid` and `musical` interpretation modes.

## Observed timbral differentiation goals

The new family set should read as a compact ambient ensemble:

1. **Soft Pad** — low-mid, long, diffused support.
2. **Bell Chime** — high, airy, brief accents.
3. **Soft Pluck** — articulate but gentle motion cues.
4. **Mellow Mallet** — rounded rhythmic punctuation.
5. **Reed Lead** — breathy/nasal mid-register line color.
6. **Soft Bass Pulse** — subdued low anchoring pulses.

## Route/role behavior check

- Role-aware selection remains probabilistic through weighted affinity selection.
- Decomposer/atmosphere-leaning outcomes continue to prefer atmosphere/raw ecology routing where appropriate.
- Phrase-agent playback now uses role-driven instrument selection instead of hardcoded oscillator-family assumptions.

## Expected audible improvements vs previous pass

- Less “single generic oscillator” feel across phrase vs event notes.
- Better contrast between high percussive accents (bell/pluck/mallet) and sustained textures (pad/reed/bass pulse).
- More coherent ensemble identity while preserving underlying ecological bed.

## Deferred / next listening pass

- Fine-tune per-family balance once interactive long-form listening is done in runtime.
- Consider tiny per-family modulation (e.g., gentle tremolo or filtered noise blend) only if needed after real-world listening sessions.
