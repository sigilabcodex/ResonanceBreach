# PR #48 Listening Validation Notes — Harmonic field + tonal drift

## What was validated

- Foreground and lead continuous voices now pass through role-aware harmonic snapping (`rooted`, `drifter`, `grazer`, `decomposer`, `predator`), reducing out-of-zone pitch jumps.
- Environmental pulse pitch now prefers the current live harmony (when present) and is role-snapped, so ambient punctuation remains in the same tonal world.
- Event tones now use the active world harmony when available instead of always spawning an isolated ad-hoc harmony state.
- Harmonic field weighting now further favors tonic/stable degrees and limits tonic drift amplitude via `rootStability` and `consonanceBias`.

## Expected audible effect

- More coherent long-form tonal climate across phrase, event, and continuous layers.
- Noticeably fewer accidental dissonant outliers in foreground notes.
- More stable low/mid grounding for grazer/decomposer/predator gestures.
- Upper agile behavior remains available for drifter/pollinator materials.
- Slow modal color movement remains subtle and ecology-driven.

## Notes

- This pass intentionally avoids chord progression logic and keeps modal-pentatonic procedural behavior.
- Additional ear-pass balancing (post-merge) may still tune per-role filter brightness and velocity trim.
