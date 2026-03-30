# PR #48 Design / Dev Note — Harmonic field for foreground musical layer

## Pre-coding inspection summary

### Current pitch behavior

- A global `HarmonyState` already exists (`createHarmonyState`) with:
  - root MIDI (`rootMidi`)
  - pentatonic/modal families
  - degree weighting and mild drift fields (`driftPhase`, `tonicDriftSemitones`, `degreeWeights`).
- Continuous layers (bed/ecological/foreground/lead) generally derive pitch via `getHarmonyFrequency(...)`.
- Event and phrase notes can be zone-snapped with `quantizeToRoleZone(...)`.
- Register tendencies exist in `ROLE_PITCH_ZONES` and ecological role registers.

### Why harmonic coherence is still limited

1. **Foreground musical climate is not consistently shared by all note sources**:
   - `triggerEventTone(...)` frequently builds a new ad-hoc harmony snapshot instead of using the current world harmony, so event notes can diverge from the live tonal context.
2. **Some continuous voices still use harmonic contour output directly without role-zone snapping**, which can weaken role-specific register identity and consonance consistency over long listening.
3. **Slow tonal drift exists but is mostly implicit in harmonic weights**, not explicitly exposed as a shared “harmonic climate” used by all foreground generators.

### Safe insertion points for constraints

- `src/audio/harmony.ts`
  - Extend harmonic-field metadata for stable-vs-tension weighting and drift behavior.
- `src/audio/audioEngine.ts`
  - Centralize role-aware snap application for foreground, ecological, lead, environmental pulse, event tones, selection tones, and phrase notes.
  - Reuse `this.lastHarmony` where possible so one tonal center governs concurrent layers.

## What this PR will implement

1. Strengthen the global harmonic field as a shared tonal climate (root/mode + stable/tension emphasis + slow drift metadata).
2. Increase harmonic bias toward tonic/stable degrees while still allowing controlled tension.
3. Apply role-aware pitch snapping more consistently in foreground musical generators.
4. Ensure event-generated notes prefer current live harmony rather than isolated ad-hoc harmony contexts.
5. Keep slow tonal drift subtle and ecology-responsive.

## Out of scope

- No full chord progression engine.
- No rigid hard-quantization of all ecological/noise material.
- No heavy DSP or dependency additions.
- No replacement of current interpretation/route architecture.
