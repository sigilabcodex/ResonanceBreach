# PR #46 design/dev note — harmonic field and pleasant note selection

Date: 2026-03-29

## Mandatory inspection summary (pre-change)

Inspected before coding:

- note event system in `src/audio/noteEvents.ts` (ADSR, trigger gating, pulse alignment)
- pitch selection and scheduling in `src/audio/audioEngine.ts`
- role/species pitch behavior in `src/audio/audioEngine.ts` + `src/audio/ecologicalMusic.ts`
- interpretation mode logic in `src/audio/musicalInterpreter.ts` and `src/audio/audioEngine.ts`
- harmony helpers in `src/audio/harmony.ts`

## Current pitch behavior

1. Most tonal material routes through `getHarmonyFrequency(...)` in `harmony.ts`.
2. Harmony already has a root + mode + layer degree maps (mostly pentatonic-friendly).
3. Some musical notes are further constrained with `quantizeToRoleZone(...)` (not universal).
4. Raw ecology beds/foreground oscillators still follow looser contour mapping and are intentionally less constrained.
5. Interpretation mode changes bus mix/intensity/quantize feel, but not a strong explicit “pleasantness bias” policy at note-pick time.

## Where arbitrary/rough behavior still dominates

- Event/phrase/tool/selection paths can still lean on contour + local transforms without a shared explicit degree-emphasis profile.
- Quantization exists but is nearest-candidate biased; it does not explicitly prefer stable degrees (tonic/third/fifth-like anchors) over tension degrees.
- Harmonic drift exists mostly as per-degree weight wobble and mode rotation; tonic movement and climate emphasis are still limited.
- Role register constraints exist for ecological roles (`bloom/grazer/pollinator/decay`) but not as a wider pitch-role vocabulary that includes rooted/drifter/predator/decomposer semantics.

## Where to insert harmonic constraints safely

- Keep the global harmonic policy in `src/audio/harmony.ts`:
  - ambient-safe mode pool
  - harmonic emphasis (stable/tension degree weights)
  - weighted snapping helpers
  - slow tonal drift (degree emphasis + tonic-adjacent drift)
  - role-aware pitch zones
- Apply stronger constraints only to the musical foreground/event/phrase paths in `src/audio/audioEngine.ts`.
- Keep the raw ecology layer less constrained by using lower tightness and avoiding hard snapping for bed-like/continuous textures.

## PR #46 implementation scope

In scope:

1. global harmonic center refinements (mode + tonic + emphasis)
2. harmonic pleasantness bias for note choice
3. constrained/snapped note selection for musical note events
4. very slow tonal drift (modal color + tonic-adjacent movement)
5. expanded role-aware pitch zones used during snapping
6. listening validation notes update

Out of scope:

- chord-progression engine
- strict DAW-like quantization
- removing ecological unpredictability
- heavy dependencies or large architecture rewrite
