# PR #50 Design / Dev Note — Long-form musical evolution and anti-loop behavior

## Pre-coding inspection summary

### Phrase generation / motif reuse

- Phrase agents currently launch short motifs (2–4 notes) based on either a remembered motif for the same entity or a small fallback shape (`[0, 1|2, -1, 3]`) with lightweight mutation.
- Phrase launch, spacing, and contour are responsive in the short term (density, interpretation blend, activity), but there is no explicit long-timescale family rotation.
- Result over 10–20+ minutes: recognizable reuse pockets appear because source motif families are narrow and seeded mostly by entity identity + local randomness.

### Harmonic field drift logic

- Harmonic climate already has drift (`driftPhase`, `tonicDriftSemitones`, `modalColorDrift`) and mode nudging via `slowRotateMode(...)`.
- Existing drift is subtle and coherent, but long-form shape is mostly sinusoidal and tied to local intensity/richness.
- Result over longer listening: harmonic movement can still feel “same-sized” because it lacks additional session-scale breathing layers linked to world ecology and place.

### Region-aware biasing

- Attention/focus biasing exists in salience and zone summaries.
- Phrase/event instrument selection is role-aware, but currently not strongly shaped by local habitat/terrain mix around listener focus (water/wetland/highland/basin).
- Result: place-awareness exists but does not produce a sustained region imprint over long listening arcs.

### Existing long-timescale modulation

- Smooth interpolation in ecological metrics and composition controls provides continuity.
- Harmony mode drift and tonal-center smoothing are present.
- Missing layer: dedicated long-form state (session-scale) to steer motif families, instrument prominence, and harmonic color together.

## Current sources of long-form repetition

1. Narrow motif seed pool and weak family-level rotation for phrase agents.
2. Instrument choice weights are mostly static by role + interpretation mode.
3. Harmonic drift is coherent but lacks additional world-driven macro-breathing dimensions.
4. Region influence on long-form orchestration is limited.

## Feasible slow variation layers

1. Add a **long-form climate state** in `AudioEngine` that evolves slowly from world calm/tension/fertility/decay/density plus listener-region signature.
2. Use that state to:
   - rotate phrase motif families at epoch boundaries,
   - bias contour behavior (arched/stepwise/ascending/descending families),
   - drift instrument-family prominence per orchestration role,
   - feed harmony with extra session-scale breathing inputs.
3. Keep all changes continuous and subtle (no abrupt section switching).

## What this PR will implement

1. Slow motif family rotation + contour profile drift for phrase agents.
2. Slow instrument prominence drift tied to calm/tension/fertility/decay/density, listener region, and time-in-session.
3. Harmonic color evolution extension with low-frequency breathing terms and world-state influence.
4. Stronger world-state long-form mapping (calm/open, active/bright, decay/darker edge, fertility/warm fullness) while preserving recognizability.
5. Listening-validation notes plus successful build.

## Out of scope

- No large composition timeline/arranger system.
- No hard soundtrack sections or abrupt scene cuts.
- No architecture rewrite of event/audio routing.
- No heavy new dependencies or DSP subsystems.
