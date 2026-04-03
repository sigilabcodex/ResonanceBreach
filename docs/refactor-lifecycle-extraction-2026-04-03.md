# Lifecycle extraction refactor — 2026-04-03

## What was extracted

The lifecycle / persistence / death-transition logic was extracted from `src/sim/ecology/simulation.ts` into a dedicated lifecycle module pack:

- `src/sim/ecology/lifecycle/types.ts`
  - lifecycle context interface (`LifecycleRuntimeContext`)
  - shared lifecycle helpers (`computeLifecycleProgress`, `computeLifecycleStage`, local `clamp`)
- `src/sim/ecology/lifecycle/updateLifecycle.ts`
  - per-entity lifecycle tick updates (age, cooldowns, visual pulse decay, stage/progress refresh)
- `src/sim/ecology/lifecycle/persistence.ts`
  - persistence gate (`shouldPersist`)
  - death transition handler (`handleDeathTransition`) including residue, propagules, burst, and event emission

`Simulation` remains the sole owner of mutable world state by supplying a runtime context adapter and delegating lifecycle decisions to extracted functions.

## What remains in simulation.ts

`simulation.ts` still owns:

- update pipeline ordering in `Simulation.update()`
- all mutable world collections and indices
- event queue ownership and `getSnapshot()` drain semantics
- species behavior updates, tool fields, environmental fields, terrain sampling, bucket rebuilds, and stats/diagnostics orchestration
- spawning context and extracted spawning-step invocation

Lifecycle computation is now delegated, but lifecycle wiring is still orchestrated inside the existing per-entity loop.

## Risks / limitations still remaining

- `simulation.ts` is still a large orchestration file with many responsibilities.
- lifecycle extraction currently uses adapter calls that are created from the `Simulation` instance; this preserves behavior but still couples modules to simulation-owned helper methods.
- some death handling still occurs inside non-lifecycle phases (for example disrupt effects), though now routed through the lifecycle death-transition module.

## Recommended next extraction target after lifecycle

The safest next extraction target is **species behavior dispatch + per-species behavior handlers** into a `species/` module pack, while preserving:

- `Simulation` world mutation ownership
- the current update order
- existing event/snapshot semantics

A secondary candidate is extracting **field/environment update phases** (`updateEnvironmentalFields`, terrain modifiers, residue/particles passes) after species extraction stabilizes.
