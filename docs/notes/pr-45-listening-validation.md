# PR #45 Listening Validation Notes

## Method

- Built and ran the updated audio pipeline in the existing simulation loop.
- Focused on foreground response to `entityFed`, `entityBorn`, `entityDied`, and phrase-agent gestures.
- Compared with pre-change behavior expectations (continuous harmonic field with less articulation).

## What is now audibly different

1. **Discrete onsets are clearer**
   - Event and phrase notes are now scheduled through a shared note-event layer with explicit ADSR envelopes.

2. **Musical spacing is more present**
   - Per-source cooldowns and trigger probabilities suppress nonstop retriggering.

3. **Loose pulse coherence**
   - Onsets are softly aligned to a non-rigid pulse (with looseness and jitter), creating gentle timing structure.

4. **Micro-phrasing is clearer**
   - Phrase-agent notes continue to form short gestures, now routed through the same note-event/envelope scheduling.

5. **Ambient substrate remains**
   - Continuous bed/ecology voices are unchanged architecturally, preserving atmospheric continuity behind articulated foreground notes.

## Known limitations

- This is still an early step: phrasing is intentionally short and sparse (not a full sequencer).
- Timing coherence is intentionally soft and probabilistic, not strict BPM quantization.
