# Species behavior extraction refactor — 2026-04-03

## What was extracted

Species behavior handlers were extracted from `src/sim/ecology/simulation.ts` into a dedicated species module pack:

- `src/sim/ecology/species/types.ts`
  - `SpeciesRuntimeContext` adapter interface used by species logic.
  - `SpeciesLocalStats` shared stats shape for per-entity updates.
- `src/sim/ecology/species/shared.ts`
  - shared math + habitat helpers (`clamp`, `lerp`, `smoothstep`, `habitatMatch`, `habitatPenalty`).
- `src/sim/ecology/species/updatePlant.ts`
- `src/sim/ecology/species/updatePollinator.ts`
- `src/sim/ecology/species/updateGrazer.ts`
- `src/sim/ecology/species/updateDecomposer.ts`
- `src/sim/ecology/species/updateParasite.ts`
- `src/sim/ecology/species/updatePredator.ts`

`Simulation` now delegates rooted/mobile species behavior to these modules via `createSpeciesRuntimeContext()` while remaining the single owner of mutable world state.

## What remains in `simulation.ts`

- update pipeline ordering in `Simulation.update()`
- world mutation ownership and collection/index management
- snapshot + event queue drain semantics in `getSnapshot()`
- environment/tool/terrain/particle/residue/propagule orchestration
- species support helpers and queries (targeting, neighborhood, world wrapping, field sampling, event emission)
- lifecycle + spawning adapter creation and invocation

## Risks / limitations still remaining

- `createSpeciesRuntimeContext()` is broad; further narrowing can reduce coupling risk.
- species modules still depend on many simulation-provided helper callbacks.
- `simulation.ts` remains a large orchestration file even after extraction.
- characterization tests for species behavior invariants are still missing.

## Recommended next extraction target after species

Next safest extraction target is the **environment and field update phase**:

- `updateEnvironmentalFields`
- `updateTerrainModifiers`
- `updateParticles`
- `updateResidues`
- related field/grid helper methods

This would further reduce `simulation.ts` size while preserving update order and snapshot/event contracts.
