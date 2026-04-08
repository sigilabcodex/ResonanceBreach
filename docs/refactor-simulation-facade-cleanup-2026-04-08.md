# Simulation facade cleanup refactor — 2026-04-08

## 1) What I read before editing

Per task requirements, I reviewed the following before making changes:

- `README.md`
- `docs/architecture.md`
- `docs/world-model.md`
- `docs/species.md`
- `docs/repo-audit-2026-04-01.md`
- `docs/modularization-preview-2026-04-01.md`
- `docs/refactor-spawning-extraction-2026-04-01.md`
- `docs/refactor-lifecycle-extraction-2026-04-03.md`
- `docs/refactor-species-extraction-2026-04-03.md`
- `src/sim/ecology/simulation.ts`
- `src/sim/ecology/spawning/*`
- `src/sim/ecology/lifecycle/*`
- `src/sim/ecology/species/*`

## 2) Understanding of current modularization state

- Spawning logic has already been extracted into `spawning/` with a runtime adapter context.
- Lifecycle transition/persistence logic has already been extracted into `lifecycle/`.
- Per-species behavior handlers have already been extracted into `species/`.
- `simulation.ts` remains the mutation owner and update-order coordinator, but still contained secondary helpers around:
  - environmental field math and diffusion
  - ecology stats aggregation and energy calculation
  - hotspot diagnostics summary formatting

## 3) Responsibilities still inside `simulation.ts` before this pass

The major remaining extractable responsibilities I identified (without changing behavior) were:

- **Environment/substrate field helper logic**:
  - field-grid indexing and interpolation
  - environmental field initialization
  - local field application falloff writes
  - per-step diffusion/relaxation update
- **Stats aggregation logic**:
  - simulation energy gain/loss from local ecology stats + active tool fields
  - garden stat rollup from entities/terrain/particles/local stats
- **Diagnostics formatting helper**:
  - top hotspot summary string assembly from species timings and query counts

## 4) What was extracted in this pass

### New environment module

Added `src/sim/ecology/environment/fields.ts` with focused environmental-field helpers:

- `fieldIndex(...)`
- `initializeEnvironmentalFields(...)`
- `sampleEnvironmentalFields(...)`
- `affectEnvironment(...)`
- `updateEnvironmentalFields(...)`

`Simulation` now delegates those responsibilities through narrow contexts while retaining ownership of buffers and mutation timing.

### New stats module

Added `src/sim/ecology/stats/`:

- `types.ts` with `LocalEcologyStats`
- `ecologyStats.ts` with:
  - `updateSimulationEnergy(...)`
  - `computeGardenStats(...)`

`Simulation.update()` still controls ordering and calls, but no longer carries the full energy/stat formula bodies.

### New diagnostics helper module

Added `src/sim/ecology/diagnostics/hotspots.ts` with:

- `buildHotspotSummary(...)`

`Simulation` now delegates hotspot summary assembly to this module.

### Simulation facade adjustments

In `simulation.ts`:

- Kept world mutation ownership and update order unchanged.
- Replaced in-file environment/stats/diagnostics helper implementations with delegated module calls.
- Adopted shared `LocalEcologyStats` type for local update accumulation paths.

## 5) What was intentionally left in `simulation.ts` and why

I intentionally left the following in `simulation.ts`:

- **World mutation ownership** and all core mutable collections/maps.
- **Main `update()` sequencing** exactly as current pipeline order.
- **Snapshot/event boundary** (`getSnapshot()` + queue drain semantics).
- **Tool behavior and world interaction orchestration** (`deployToolField`, `triggerDisrupt`, mutation-heavy helper calls).
- **Spatial bucket ownership/query plumbing** and entity/particle/residue indexing.

These are still central coordination/mutation concerns that should remain in the facade until further targeted extraction passes.

## 6) Remaining risks / technical debt

- `simulation.ts` is still large and still includes multiple query/helper families (target finding, spawn suitability, bucket traversal, attention logic).
- Runtime adapter contexts (`createSpeciesRuntimeContext`, `createSpawningRuntimeContext`) remain broad and can continue to drift.
- Tool-field application behavior (`applyToolFields`) and disruptive effects remain embedded and are a likely next extraction seam.
- Characterization tests are still limited; behavior safety currently relies on preserving formulas/order exactly.

## 7) Recommended next modularization target after this pass

Most practical next target:

- **Extract tool-field and simulation-side event helper policy** into focused modules (e.g., `ecology/tools/` and/or `ecology/events/`) while keeping mutation ownership and call order in `Simulation`.

Secondary target after that:

- Extract selected query/runtime helper clusters (food/bloom/residue targeting + reusable bucket-query wrappers) behind a narrower “query context” to reduce facade method surface area.
