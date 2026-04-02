# Spawning extraction note — 2026-04-01

## What was extracted

The spawning-focused logic was extracted from `src/sim/ecology/simulation.ts` into a new `spawning/` module group:

- `src/sim/ecology/spawning/updatePropagules.ts`
  - contains the previous `Simulation.updatePropagules(dt)` body for propagule drift, dormancy/viability progression, germination checks, and expiration handling.
- `src/sim/ecology/spawning/spawnEntities.ts`
  - contains the previous `Simulation.spawnEntities(dt)` branch ladder for species reproduction decisions, direct offspring spawning, propagule production, and associated birth/progress diagnostics effects.
- `src/sim/ecology/spawning/types.ts`
  - defines a narrow `SpawningRuntimeContext` interface and small shared helper utilities used by the extracted spawning modules.

`Simulation` now delegates to these modules via `createSpawningRuntimeContext()` while preserving update order and mutable ownership in the `Simulation` facade.

## What was intentionally left in `simulation.ts`

To keep this as a safe inward extraction (not a behavior rewrite), the following remain in `Simulation`:

- all mutable world state ownership and storage
- all helper/query implementations used by spawning (`sampleField`, neighbor queries, suitability helpers, target searches, entity/propagule creation, event emission)
- `update()` orchestration order and sequencing
- snapshot/event queue semantics (`getSnapshot()` and event draining)
- non-spawning lifecycle/species/tool/environment logic

## Risks or limitations still remaining

- `createSpawningRuntimeContext()` is still a relatively large adapter surface and can drift as spawning dependencies evolve.
- spawning rules are still a long species branch ladder (now extracted, but not decomposed by species yet).
- spawning modules still rely on many simulation callbacks, so coupling is reduced but not minimal.
- this extraction does not yet add focused characterization tests for spawn invariants.

## Suggested next extraction

Next safe step: split species reproduction rules inside `spawning/spawnEntities.ts` into per-species rule functions (e.g., `spawnPlant`, `spawnEphemeral`, etc.) behind the same context interface, keeping the same runtime behavior and call order.
