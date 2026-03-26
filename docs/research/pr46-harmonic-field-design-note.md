# PR #46 design/dev note — harmonic field and pleasant note selection

## Current pitch behavior (pre-change inspection)

After inspecting `src/audio/audioEngine.ts`, `src/audio/harmony.ts`, `src/audio/ecologicalMusic.ts`, and `src/audio/musicalInterpreter.ts`:

- Pitch is primarily chosen through `getHarmonyFrequency(...)` from `harmony.ts`, which maps a normalized contour to a mode degree index and octave offset.
- The current harmony model provides:
  - a mode choice (`ionian/suspended/dorian/aeolian/lydian pentatonic`),
  - a root MIDI center,
  - layer-specific degree sequences (`bed/plant/cluster/mobile/event/water`).
- The ecological system (`ecologicalMusic.ts`) already computes slow-moving composition controls (`tonalCenter`, `harmonicDrift`, `mode`, `voice register/presence/motion`) from world state.
- Interpretation mode (`raw/hybrid/musical`) currently affects intensity/quantize/timbral bias and bus mixing, but **does not yet deeply change note selection quality**.

## Why the result still can drift away from “consistently musical”

- Pitch mapping is deterministic but still relatively coarse (contour-to-index), so multiple voices can land on less intentional combinations over time.
- There is no explicit “pleasantness bias” toward tonic/chord-like anchors versus tensions.
- Event/environment pulses still include direct raw frequency formulas in places (e.g., fixed Hz plus intensity terms) that bypass deeper harmonic logic.
- Slow drift exists in ecology metrics, but there is no explicit harmonic-climate layer that carries weighted degree emphasis over long timescales.
- Register tendencies exist partially (e.g., per-role register values), but role-aware ranges are not enforced as an explicit pitch-zone policy across musical voices.

## Where harmonic field should live

- `src/audio/harmony.ts` should host a lightweight global harmonic-field model:
  - tonic/root,
  - selected ambient-friendly scale/mode,
  - weighted degree bias (stable tones + consonant tensions),
  - slow drift phase/rate,
  - role-aware register zone hints.
- `src/audio/audioEngine.ts` should consume this field when generating musical notes and selectively loosen constraints for raw ecology layers.

## What this PR will implement

1. Extend harmony state with a harmonic field (degree weights, drift phase, role pitch zones).
2. Add pleasant note quantization/snapping helpers (MIDI-level snapping with weighted degree preference).
3. Route musical-layer note generation through harmonic snapping and role-aware register zones.
4. Add subtle slow harmonic drift (degree emphasis + gentle mode-family evolution).
5. Keep raw ecology layer less constrained than musical foreground by applying lower harmonic-tightness in raw interpretation.

## Out of scope for this PR

- Full chord-progression/composition engine.
- Full redesign of phrase architecture and all instruments.
- Genre-specific arranging rules or user-facing advanced harmony controls.
- Forcing all raw/noise/ecology layers into strict pitch quantization.

