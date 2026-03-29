# PR #45 Design/Dev Note — Discrete musical events, envelopes, and phrasing

## Current cause of drone-like behavior

After inspecting `src/audio/audioEngine.ts` and related routing/interpreter files, the foreground/music layer still leans drone-like for three structural reasons:

1. **Continuous always-on oscillator pools**
   - `updateEcologicalVoices`, `updateForegroundVoices`, and `updateLeadVoices` continuously retune long-lived oscillators and move gain targets each frame.
   - This creates persistent harmonic energy with modulation, but limited hard note boundaries.

2. **Transient events exist, but are isolated and not phrase-driven**
   - `triggerEventTone` and `playPhraseNote` do create one-shot notes with attack/release ramps.
   - However, they are fired ad hoc, without a shared note-event abstraction, timing lattice, or explicit spacing constraints across sources.

3. **Phrase timing is loose but not explicitly pulse-aware across event sources**
   - `updatePhraseAgents` contains local motif logic, but event-triggered notes (`triggerEventTone`) do not share that phrase/timing policy.

## Safe insertion points for discrete event triggering

Primary insertion points identified:

- **`processEcologicalAudioEvent` → `triggerEventTone`**
  - This is the cleanest place to convert ecological events into structured note events.
- **`updatePhraseAgents` / `playPhraseNote`**
  - Already phrase-capable; can be upgraded to emit/use the same note-event abstraction.
- **No changes to ambient bed and continuous ecological substrate**
  - `updateGlobalBed` and long-form ecology voices should remain intact to preserve raw ecology layer.

## Role/species event triggering strategy

Use existing event/tag and entity role inference:

- `inferRoleFromEcologicalEvent` + entity types/tags map into note-event metadata (`role/source/instrument family hint`).
- Keep source-driven behavior (world events and phrase agents), avoiding a standalone sequencer.

## What this PR will implement

1. **Lightweight note-event abstraction** for foreground musical notes (pitch, duration, velocity, optional family/role/source metadata).
2. **Reusable ADSR envelope helper** applied to note playback (especially event + phrase notes).
3. **Soft pulse/timing gate** for note onset alignment (loose quantization, jitter preserved).
4. **Spacing/silence controls**: per-source cooldown + trigger probability so not all entities emit continuously.
5. **Minimal phrase grouping integration**: phrase agents emit 2–4 note gestures through the shared note-event path.

## Out of scope for this PR

- Full rewrite of the audio engine.
- Rigid BPM sequencer/DAW behavior.
- Removal of ambient/raw continuous ecology layers.
- Heavy external sequencing dependencies.
