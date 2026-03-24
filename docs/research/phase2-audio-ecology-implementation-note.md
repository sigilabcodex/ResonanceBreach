# Phase 2 Audio Ecology Implementation Note (PR 31)

## Current findings

- Phase 1 already delivered a stable pooled audio architecture with salience-driven foreground selection, grouped ecological roles, phrase agents, event transients, and zoom/distance-aware attenuation.
- ATTENTION listening is already robust: entity and region focus are maintained in simulation state and consumed by audio salience scoring.
- Predators already track acoustic pressure/pattern and can bias movement toward louder/repetitive nearby organisms.
- Remaining gaps are mostly *quality* gaps, not missing-system gaps: identity acknowledgements are still short/simple, phrase motifs are still too disposable, and the bed can still mask detail when it sits too continuously.

## Risks

- Increasing expressivity can accidentally increase clutter if phrase and bed changes are not gated by silence windows.
- Stronger distance coloration can reduce intelligibility if high-frequency damping is too aggressive.
- Predator tension changes can feel gamey if hunting/rest transitions are too abrupt or too deterministic.

## What will change in this PR

1. Refine selected-entity acknowledgement voices to be more role/stage/state/context-sensitive, with per-entity variation memory to avoid obvious repetition.
2. Redesign the global bed to pulse and breathe with clearer silence windows and less constant tonal occupancy.
3. Refine phrase agents with motif memory/variation, contour shaping, and local density-aware spacing for improved melodic legibility.
4. Strengthen role-based orchestration by tightening rhythmic/spectral differentiation across bloom/grazer/pollinator/decay/predator-related behaviors.
5. Refine predator state transitions so hunting/resting depends on hunger and acoustic opportunity, with quiet/irregular prey reducing exposure.
6. Improve listener model distinction between near and far hearing, including clearer zoom-based detail falloff and locality coloration from nearby habitat.

## What will not change in this PR

- No full rewrite of the audio engine architecture.
- No heavy dependencies or external music middleware.
- No full combat loop or damage-heavy predator system.
- No separate soundtrack/sequencer layer detached from ecological simulation.
