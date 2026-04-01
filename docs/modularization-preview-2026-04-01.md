# ResonanceBreach Modularization Preview — 2026-04-01

## 1) Executive summary

Modularization is needed now because the project already has solid macro-boundaries (App orchestrates, Simulation owns mutable world, Renderer/Audio consume snapshots), but the day-to-day implementation risk is concentrated in four very large subsystem files. The current sizes (`simulation.ts` 2668 lines, `audioEngine.ts` 2005, `renderer.ts` 1264, `hud.ts` 905) indicate that future feature work will keep increasing coupling unless we split by responsibility with adapter seams first.

### Why now

- The architecture already has stable contracts we can preserve (`Simulation.getSnapshot()` as snapshot/event boundary, HUD + Audio + Renderer as consumers).
- The files are now large enough that “small changes” regularly touch unrelated concerns (e.g., simulation behavior + events + diagnostics in one edit).
- Upcoming ecology/audio/readability work will become slower and riskier unless we reduce per-file cognitive load.

### Highest-risk subsystems

1. **Simulation (`src/sim/ecology/simulation.ts`)**: highest risk due to mutable state ownership, lifecycle logic, tool effects, spawn rules, event emission, and diagnostics all interleaved.
2. **Audio (`src/audio/audioEngine.ts`)**: high risk because runtime graph setup, interpretation, event reactions, voice rendering, long-form phrase logic, and mix policy are in one class.
3. **Rendering (`src/render/renderer.ts`)**: medium-high risk from many visual responsibilities coupled to LOD/readability tuning in one render pass.
4. **HUD (`src/ui/hud.ts`)**: medium risk; many DOM, settings, messaging, inspection, and debug concerns are centralized.

### What should happen first

**First extraction should be simulation spawning + lifecycle transitions** (without changing behavior): isolate propagule update + species spawn decision logic into dedicated modules behind a simulation-owned adapter.

---

## 2) Current monolith map

## A. `src/sim/ecology/simulation.ts`

### Major responsibilities today

- World mutation owner and fixed-step simulation pipeline.
- Attention state lifecycle (entity follow/region selection).
- Environmental fields (nutrient/temperature), terrain modifiers, particle/residue/propagule/burst updates.
- Species behavior dispatch and per-species update methods.
- Tool field application and energy/tool unlocking.
- Spawning/reproduction/death/event emission.
- Diagnostics and performance counters.

### Internal conceptual sections (as implemented)

- **Frame pipeline orchestration** (`update` ordering and survivor loop).
- **Attention and wrapping helpers**.
- **Environment + substrate updates**.
- **Spatial buckets and target-query helpers**.
- **Entity creation/behavior/reproduction/death**.
- **Tool effects + event emission**.
- **Stats/diagnostics reporting**.

### Should become separate modules

- `environment/`: nutrient + temperature fields, terrain modifier lifecycle.
- `lifecycle/`: stage/progress, persistence/death, transitions.
- `species/`: per-species behavior handlers + shared creature utilities.
- `spawning/`: propagule evolution, germination, species spawn decisions.
- `ecologyBalance/`: energy/stats aggregation and balancing helpers.
- `events/`: simulation-side event emit wrappers and burst/tool feedback policy.
- `diagnostics/`: query counters, species timing accumulation, hotspot summaries.

### Should remain centralized for now

- `Simulation` class as **single mutation owner** of world state.
- Main `update(dt)` pipeline order (temporarily), but delegating steps to extracted modules.
- Snapshot boundary (`getSnapshot`) and event queue draining semantics.

## B. `src/audio/audioEngine.ts`

### Major responsibilities today

- WebAudio graph bootstrap and pooled voice creation.
- Per-frame audio update orchestration.
- Harmony + long-form + phrase-agent progression.
- Salience scoring use, foreground/grouped voice assignment.
- Event intake and transient/event/tool tones.
- Bus/mix levels and live settings application.

### Internal conceptual sections

- **Graph lifecycle** (`start`, pooled voices, buses, limiter).
- **State update spine** (`update` orchestration).
- **Layer renderers** (global bed, ecological/grouped voices, foreground, lead voices).
- **Musical interpretation/event mapping**.
- **Phrase/long-form control**.
- **Output mix + debug status**.

### Should become separate modules

- `sonification/`: grouped ecological + foreground snapshot-to-voice mapping.
- `musicEngine/`: phrase agents, long-form state, motif/cadence decisions.
- `ambient/`: global bed and region habitat ambience.
- `feedback/`: tool tones, selection responses, short event accents.
- `mix/`: bus targets, master shaping, live-control mapping, debug metering.

### Should remain centralized for now

- Single `AudioEngine` public API (`start`, `update`, `reset`, settings methods).
- Core audio-node ownership/lifecycle in one top-level class to avoid teardown bugs.
- Existing harmony/salience external module contracts.

## C. `src/render/renderer.ts`

### Major responsibilities today

- View transform and wrapped coordinate projection.
- Backdrop + terrain contour + environmental flow rendering.
- Entity, aura, particle/residue/field/burst rendering.
- Attention overlays and tool preview.
- Minimal performance/draw-call accounting.

### Internal conceptual sections

- **View and LOD math**.
- **Terrain/backdrop/readability pass**.
- **World-object passes (entities/effects/tools)**.
- **Attention overlays**.
- **Overlay text/debug hook surface**.

### Should become separate modules

- `terrain/`: backdrop, contour strokes, micro-patterns, flow lines.
- `entities/`: glyph/aura and species visual renderers.
- `overlays/`: attention world markers, tool previews, overlay labels.
- `readability/`: LOD strategy and optional clarity helpers (future toggles).
- `fx/`: particles/residue/bursts/field visuals.

### Should remain centralized for now

- `Renderer.render(...)` as single ordered pass coordinator.
- Canvas/context ownership and resize behavior.

## D. `src/ui/hud.ts`

### Major responsibilities today

- HUD DOM composition and panel orchestration.
- Settings controls and settings state synchronization.
- Simulation status + hint messaging.
- Attention inspection card and region summaries.
- Debug/perf/audio diagnostic panel rendering.

### Internal conceptual sections

- **Shell/panel visibility and docking state**.
- **Settings control factory + emit path**.
- **Runtime summary update path**.
- **Inspection card logic**.
- **Debug overlay generation**.

### Should become separate modules

- `panels/`: dock + panel visibility/collapse orchestration.
- `settings/`: control factories, bindings, settings emit/sync.
- `inspection/`: entity/region attention card generation.
- `notifications/`: hint/interpretation overlay messaging.

### Should remain centralized for now

- `Hud` public facade (`attach`, `update`, `syncSettings`, `toggleMinimalHud`).
- Root DOM container ownership.

---

## 3) Proposed target architecture

Use a **facade + module-pack** layout where each subsystem keeps one public coordinator while internal modules become focused workers.

```text
src/sim/ecology/
  simulation.ts                # facade + mutation owner + update order
  environment/
  lifecycle/
  species/
  spawning/
  ecologyBalance/
  events/
  diagnostics/

src/audio/
  audioEngine.ts               # facade + graph ownership + orchestration
  sonification/
  musicEngine/
  ambient/
  feedback/
  mix/

src/render/
  renderer.ts                  # facade + pass order + canvas lifecycle
  terrain/
  entities/
  overlays/
  readability/
  fx/

src/ui/
  hud.ts                       # facade + root wiring
  panels/
  settings/
  inspection/
  notifications/
```

Design rule: **extract inward first** (private functions -> module helpers) before changing public call sites.

---

## 4) Migration strategy (safe order)

## Phase 0 — Preconditions (recommended now)

1. Freeze behavioral contracts in writing (snapshot semantics, event queue semantics, wrap math helpers, tool behavior expectations).
2. Add targeted characterization checks around simulation spawn/death/event counts and audio update stability (non-golden but invariant checks).

## Phase 1 — Simulation first (highest leverage)

1. Extract `spawning/propagules.ts` from `updatePropagules` logic.
2. Extract `spawning/speciesSpawnRules.ts` from `spawnEntities` branch ladder.
3. Keep all mutation through a narrow context object passed from `Simulation` (world references + helper callbacks).
4. Keep `Simulation.update()` order unchanged; only replace in-file bodies with delegated calls.

**Adapter/facade strategy:**
- Introduce internal interfaces like `SimulationMutationContext` and `SimulationQueryContext`.
- New modules call context methods (`createEntity`, `emitWorldEvent`, `sampleField`) instead of importing world directly.
- `Simulation` continues to own actual arrays/maps and event queue.

## Phase 2 — Audio decomposition

1. Extract `ambient/updateGlobalBed.ts` and `sonification/updateEcologicalVoices.ts` first (least policy risk).
2. Extract `feedback/eventProcessing.ts` for `processEvents/processEcologicalAudioEvent/triggerEventTone` cluster.
3. Extract `mix/applyMixTargets.ts` for bus/master targeting.
4. Move phrase/long-form logic into `musicEngine/` last in audio phase.

**Adapter/facade strategy:**
- Keep all WebAudio nodes private to `AudioEngine`.
- Pass immutable “render packets” to extracted modules (pre-resolved references + computed inputs).
- Avoid modules creating/destroying nodes initially; only parameter automation.

## Phase 3 — Rendering decomposition

1. Extract terrain pass (`drawTerrain`, contour tracing, micro-patterns, flows) into `terrain/`.
2. Extract entities + species draw methods into `entities/`.
3. Extract attention/tool overlays into `overlays/`.

**Adapter/facade strategy:**
- Keep one render context bundle (`ctx`, view helpers, wrap helpers, settings).
- Preserve draw order in `Renderer.render` exactly.

## Phase 4 — HUD decomposition

1. Extract settings control factories and settings sync logic.
2. Extract inspection summarization/rendering.
3. Extract hint/notification policy.

**Adapter/facade strategy:**
- Keep `Hud.update()` as orchestrator calling sub-renderers.
- Keep DOM node creation/ownership in facade until all modules stable.

## Global ordering rationale

**Simulation -> Audio -> Rendering -> HUD** minimizes risk because simulation semantics drive all downstream consumers; audio/render/hud can be modularized against a stable snapshot contract.

---

## 5) Regression risk analysis

## State ownership risks

- Extracted simulation modules accidentally mutating arrays outside intended order.
- Hidden dependence on `this.*` mutable fields in existing methods.

**Mitigation:** context objects + explicit phase APIs + no direct world imports.

## Event flow risks

- Event duplication/loss when moving emission code.
- `getSnapshot()` drain timing drift causing audio/HUD mismatch.

**Mitigation:** central event emitter adapter in simulation, plus assertions on event id monotonicity and per-step emission counts.

## Audio timing risks

- Phrase/event modules changing onset pacing or bus gain envelopes.
- Node lifecycle mistakes causing pops or silent output.

**Mitigation:** keep node ownership centralized; only move computation/automation code; keep onset limiter logic untouched until dedicated pass.

## Rendering/readability risks

- Draw-order changes causing reduced legibility or wrong blending.
- Wrapped positioning helper divergence across modules.

**Mitigation:** keep render pass order in facade; share one wrap/view utility module used by all render submodules.

## UI state sync risks

- Settings panel and runtime state diverging when moving control code.
- Attention inspection data stale if sourcing shifts.

**Mitigation:** single settings state source in `Hud`, extracted modules pure-render from snapshot + settings inputs.

---

## 6) “Do not break” invariants

1. **Simulation owns world mutation**; no mutation from renderer/audio/HUD modules.
2. **Renderer/audio remain snapshot consumers**; no hidden backchannels.
3. **Wrapped-world math remains consistent** for distance/position in sim, render, audio salience, and HUD region summaries.
4. **Event queue contract remains intact**: simulation emits -> snapshot drains once per frame -> consumers read drained events.
5. **Tool semantics stay stable** (observe/attention behavior, field effects, blocked behavior, unlock timing semantics).
6. **Update order remains functionally equivalent** during extraction phases.

---

## 7) First actual refactor recommendation (single best next task)

## Recommended next task (do this first)

**Extract simulation spawning into a module pack while preserving `Simulation` as owner.**

### Files

- Update: `src/sim/ecology/simulation.ts`
- Add: `src/sim/ecology/spawning/updatePropagules.ts`
- Add: `src/sim/ecology/spawning/spawnEntities.ts`
- Add: `src/sim/ecology/spawning/types.ts` (context interfaces only)

### Functions/sections to extract first

1. `updatePropagules(dt)` body into `spawning/updatePropagules.ts`.
2. `spawnEntities(dt)` body into `spawning/spawnEntities.ts`.
3. Keep helper calls (`sampleField`, `countEntities`, `findNearbySpawnPoint`, `emitWorldEvent`, `createEntity`, `spawnPropagule`) routed via context adapters.

### Why this is safest high-leverage move

- High leverage: removes one of the densest decision clusters in the largest file.
- Safer than species behavior extraction: spawn logic is phase-bounded and can be characterized by counts/events.
- Preserves all external contracts (`Simulation.update` and snapshot semantics unchanged).
- Creates reusable extraction pattern for later `species/` and `lifecycle/` modules.

---

## Recommended now vs later

### Recommended now

- Simulation spawning module extraction with adapter contexts.
- Audio ambient + grouped voice extraction (after simulation task lands).
- Render terrain pass extraction preserving order.

### Later (after first migration wave)

- Species registry/DSL-style behavior definitions.
- Dedicated audio composition timeline engine beyond current phrase agents.
- Optional readability overlays and macro-landmark generation for terrain.
- HUD feature-level split into independent mountable panels.
