# Species behavior extraction — 2026-04-08

## Goal
Extract species behavior logic from `src/sim/ecology/simulation.ts` into focused modules without changing gameplay, spawning, lifecycle, or update ordering.

## What changed

### New module boundary
Created `src/sim/ecology/species/` with extracted behavior modules:

- `updatePlant.ts`
- `updatePollinator.ts`
- `updateGrazer.ts`
- `updateDecomposer.ts`
- `updateParasite.ts`
- `updatePredator.ts`

### Shared helpers
Created `src/sim/ecology/species/shared.ts` with behavior-local utility functions:

- `clamp`
- `lerp`
- `smoothstep`
- `habitatMatch`
- `habitatPenalty`

### Narrow context
Created `src/sim/ecology/species/types.ts` to define:

- `SpeciesBehaviorContext`
- `SpeciesLocalStats`
- `SpeciesUpdateInput`
- `PlantUpdateInput`

This keeps `simulation.ts` as owner of world mutation, update order, and snapshot production, while species modules operate via a constrained callback/context contract.

### simulation.ts delegation
`simulation.ts` now imports extracted behavior modules and delegates behavior execution through `speciesBehaviorContext`.

- Update order in `Simulation.update()` is unchanged.
- Behavior formulas and thresholds are unchanged.
- Spawn and lifecycle code paths remain in `simulation.ts`.

## Validation
- `npm run build`
- TypeScript compile clean (no TS errors)

## Notes
This step intentionally preserves behavior parity. It is a structural extraction only.
