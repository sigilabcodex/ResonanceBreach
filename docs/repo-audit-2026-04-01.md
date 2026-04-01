# ResonanceBreach Repository Audit — 2026-04-01

## 1. Executive summary

### What the repo currently is
ResonanceBreach is currently a **single-process browser simulation** with a strong real-time loop, explicit world state object, and rich audiovisual rendering pass. It is no longer a tiny sketch: it contains a dense ecological sim, a large renderer, a large audio engine, and a substantial HUD/settings layer. In practice, however, major behavior still concentrates in a few very large files (`simulation.ts`, `renderer.ts`, `audioEngine.ts`, `hud.ts`), which creates architectural fragility.

### What it is trying to become
The code and docs align on the high-level target: a calm ecological gardening sandbox that can later support stronger tension systems (breach/campaign pressure). The implemented systems (terrain field model, propagules/residue loop, attention modes, event queue, interpretation modes in audio) are meaningful foundations toward that target.

### Main blockers
1. **God modules** dominate core systems, limiting safe iteration velocity.
2. **Documentation drift**: several design notes describe interaction/audio states that no longer match runtime.
3. **Audio “musicalization” is partial**: substantial harmonic scaffolding exists, but synthesis remains mostly oscillator/filter modulation with weak phrase-level compositional identity.
4. **Ecology still fragile under unattended long-run** for higher-order consumers and pressure species (especially predator path, currently disabled by config).
5. **Terrain legibility is philosophically coherent but perceptually under-communicative** at gameplay level (zones are implied rather than decisively readable).

### Main opportunities
1. Existing world-field architecture is strong enough to support zone-driven systemic design.
2. Event queue + attention model provides clean hooks for campaign/breach and richer UI explanation.
3. Audio bus + interpretation architecture provides a clean seam for introducing a dedicated composition layer.
4. Current simulation has enough species/state richness to evolve into true gardener gameplay if resource/tool loops are promoted from implicit to explicit.

---

## 2. Documented intent vs actual implementation

### 2.1 Architecture

**Docs claim**
- Modular boundaries: app orchestration, sim ownership, render/audio snapshot consumers, interaction intent translation.
- Explicit world model ownership and typed event queue.

**Code reality**
- The boundary concept is real and useful (`App` orchestrates; `Simulation` owns world; renderer/audio consume snapshot).
- But internal modularity is uneven: `src/sim/ecology/simulation.ts` (~2668 lines), `src/audio/audioEngine.ts` (~1999), `src/render/renderer.ts` (~1264), `src/ui/hud.ts` (~905).
- Compatibility exports exist (`src/sim/simulation.ts`, `src/sim/types.ts`, `src/app.ts`, `src/app/config.ts`) and are minimal; not harmful alone but indicate ongoing migration layering.

**Confidence:** High.

**Gaps / mismatches**
- Architectural intent is accurate at macro level, but implementation remains monolithic at subsystem internals.
- “Simulation split into lifecycle/feeding/reproduction/death modules” is still planned, not realized.

### 2.2 Ecology

**Docs claim**
- Multi-species lifecycle with propagules, nutrients/temperature fields, residue/decomposer recovery loop, dynamic balance.

**Code reality**
- This is mostly true: propagule entities exist; nutrient and temperature fields are simulated and diffused; residue is generated/consumed; several species-specific update functions exist.
- Predator architecture exists in code (`updatePredator` and predator references across systems) but predators are effectively disabled by configuration (`INITIAL_PREDATOR_COUNT = 0`, `MAX_PREDATORS = 0`).

**Confidence:** High.

**Gaps / mismatches**
- Documented canonical species in README highlight 3 species, while simulation actually includes 8 entity types (with predator disabled).
- Ecology depth is present in mechanisms but not yet robustly tuned for unattended persistence under all species mixes.

### 2.3 Terrain / world model

**Docs claim**
- Continuous wrapped world, habitat derivation (wetland/highland/basin), no visible grid, layered line rendering.

**Code reality**
- Strong match. `WorldFieldModel` computes blended terrain/habitat and flow from procedural layers; simulation and rendering both sample same substrate.
- World wrap is consistently handled via wrapped deltas in sim, camera, rendering, and salience.

**Confidence:** High.

**Gaps / mismatches**
- Docs emphasize readability of terrain cues; in runtime, cues are subtle enough that gameplay-legible zone differentiation remains weak unless user already understands system semantics.

### 2.4 Audio / music

**Docs claim**
- Layered architecture with bed, grouped zone voices, capped foreground voices, event integration, explicit harmony and interpretation modes.

**Code reality**
- All of these are materially implemented: bus layout, salience scoring, harmonic quantization, interpretation modes (`raw/hybrid/musical`), event mapping, instrumentation descriptors.
- However, many “instrument” concepts remain metadata over oscillator-based synthesis. Composition identity is still emergent from parameter modulation rather than robust phrase grammar/cadence architecture.

**Confidence:** High.

**Gaps / mismatches**
- “Musical mode” is real but not yet a distinct composition engine. It is better described as a **musicality-biased interpretation layer** on top of ecological sonification.

### 2.5 UI / player interaction

**Docs claim**
- Interaction model moving toward RTS-like attention and gesture-based tool use.

**Code reality**
- Current `App` gesture mapping does contextual tool selection on tap/drag/alternate button and preserves attention hold/region behavior.
- HUD currently emphasizes “World gestures,” not an explicit old tool grid.

**Confidence:** High.

**Gaps / mismatches**
- Some design note docs (e.g., prior gesture note) appear stale relative to current runtime implementation and can mislead future contributors.

---

## 3. Current subsystem map

### 3.1 App bootstrap / game loop
- Entry: `src/main.ts` -> `bootstrap()`.
- `src/app/bootstrap.ts` mounts app and starts `App`.
- `src/app/game.ts` owns fixed timestep loop, camera smoothing, input updates, sim stepping, audio update, HUD update, render call.

### 3.2 World state ownership
- `Simulation` owns canonical mutable `world` (`createWorldState()`), including entities, terrain samples, fields, particles, residues, propagules, bursts, stats, tool/attention/camera, events/notifications.
- `getSnapshot()` drains event queue into `world.events` and builds notifications, then returns world snapshot object.

### 3.3 Simulation update pipeline
- `update(dt)` performs (in order): environment fields, attractors, terrain modifiers, tool fields, particles, residues, propagules, bursts, terrain sample refresh, bucket rebuilds, per-entity behavior, persistence/death, attention sync, spawning, energy/stats update, diagnostics.
- Species behavior dispatch: rooted (`updatePlant`) vs creature (`updatePollinator`, `updateGrazer`, `updateDecomposer`, `updateParasite`, `updatePredator`).

### 3.4 Rendering pipeline
- `Renderer.render(...)` draws backdrop, depth cues, terrain contours/micro-patterns, environmental flow lines, entities by type, particles/residues/bursts/fields, attention overlays, tool preview, minimal overlay text.
- Rendering is snapshot-consuming and does not mutate simulation state.

### 3.5 Audio pipeline
- `AudioEngine.update(snapshot, settings)` computes ecological music state, harmony state, salience ranking, foreground voice selection, grouped zone summaries, bed updates, event-triggered tones, phrase/selection/tool cues, and bus gain management.
- Mapping chain: world events -> ecological audio events -> interpreter (`raw/hybrid/musical`) -> note/voice scheduling.

### 3.6 Interaction / tool pipeline
- `PlayerInput` normalizes pointer + keyboard into gesture callbacks.
- `App` translates gestures into semantic tool engagement and context-driven tool choice.
- `Simulation` enforces unlock gating/energy costs and deploys tool fields/attention regions.

### 3.7 UI/HUD/settings pipeline
- `Hud` creates DOM overlay, panel toggles, settings panel, debug/perf displays, interpretation toast, inspection card.
- Settings persisted in localStorage via `settings.ts`; `App.applySettings` syncs audio + HUD.

---

## 4. Ecology audit

### Implemented species and actual behaviors
Implemented entity types in config/sim: `plant`, `ephemeral`, `canopy`, `flocker`, `cluster`, `grazer`, `parasite`, `predator`.
- Rooted species: growth/fruiting/pollination/reproduction via propagules.
- Mobile pollinators: target blooms/food, support bloom pollination.
- Grazers: consume fruit/bloom surplus, create pressure.
- Decomposers/parasites: residue-oriented recycling/pressure dynamics.
- Predator: signal/hunting behavior present but runtime-disabled by caps.

### Lifecycle depth
Strengths:
- Stage progression (`birth/growth/mature/decay`) with energy/food/stability interactions.
- Death creates residue; residue feeds nutrient return; propagules can preserve memory of prior populations.
- Environmental fields and habitat suitability influence spawning/persistence.

Limitations:
- Behavioral complexity is concentrated in hand-tuned heuristics; no shared species schema/DSL yet.
- Some trophic links remain asymmetric or weakly observable from player perspective.

### Persistence / extinction / reproduction balance
- There is meaningful anti-runaway logic (cooldowns, local density checks, habitat penalties, caps).
- However, persistence risk remains for “higher instability” species when local resources collapse.
- Predators cannot be evaluated in production mode due to zero initial/max caps.

### Can ecology survive unattended?
- Partially yes for core loops (blooms/pollinators/decomposers), but not yet confidently as a self-correcting, long-horizon ecology across all species.
- Recovery mechanics exist; robustness still heavily parameter-sensitive.

### Support for future richer lifeform diversity
- Good substrate: field sampling, habitat weights, propagules, residue, event queue, tool effects.
- Major blocker: adding more species into current monolithic simulation file will accelerate entanglement unless species architecture is modularized first.

### Missing for true gardening gameplay
1. Explicit player-facing resource economy (inventory/seeds/harvest outputs) is absent.
2. Tool consequences are mostly immediate fields; long-horizon planning affordances are weak.
3. No persistent goals/contracts/quests to scaffold “gardener/shaper” role.
4. Ecological intervention history is not surfaced as a clear ledger/trace.

### Canonical species architecture recommendation
- Keep current species as behavioral references but move toward:
  - species registry with declarative traits + modular behavior hooks,
  - shared lifecycle/resource interfaces,
  - explicit trophic role contracts,
  - debug observability per species (reproduction success, mortality causes, starvation windows).

---

## 5. Terrain and world readability audit

### Internal representation
- Terrain comes from `WorldFieldModel` with layered noise-derived elevation/moisture/fertility/roughness + derived habitat weights and flow vectors.
- Simulation terrain samples cached and refreshed at cadence; field sampling reused across systems.

### Rendering representation
- Contour-like line rendering with major/minor bands, micro-patterns, flow lines, backdrop parallax, and subtle world-depth grid cues.
- Strong artistic cohesion with “line-field world” design intent.

### Zone/habitat legibility
- Systemically present but visually low-contrast in many camera states.
- Basin/highland/wetland distinctions are often discoverable only through entity behavior or debug understanding, not immediate map readability.

### Wrapped world impact
- Wrap implementation quality is good and seam-safe.
- For orientation/legibility, toroidal continuity can reduce landmark anchoring; players may struggle to form durable mental maps without stronger macro landmarks.

### Rendering philosophy vs clearer regions
- Current philosophy (subtle, non-tiled, organic) is aesthetically aligned with calm mode.
- But campaign/breach and stronger gardening agency will likely need **selective legibility amplification** (e.g., controlled zone edge hints, habitat overlays on demand, stronger local landmarks).

### Causes of visual muddiness/ambiguity
1. Terrain lines and background cues share similar luminance range.
2. Habitat transitions are highly blended, reducing categorical readability.
3. Entity/readability cues can be overwhelmed when zoomed out by contour density.
4. Subtle palette may under-serve actionable decision-making.

### Recommended direction
- **Modify, don’t replace.** Preserve line-field identity while introducing optional readability layers:
  - habitat legibility mode (temporary overlay or contour tint boost),
  - ecological pressure overlays (nutrient/temperature/threat),
  - stronger sparse landmarks generated from field extrema.

---

## 6. Audio / music audit

### Current actual audio architecture
- Mature by prototype standards: pooled voices, bus routing, limiter, harmony state, salience ranking, interpretation modes, and event mapping.
- Practical performance controls are present (voice caps, pooling, grouped summaries).

### Is “musical mode” real?
- **Real but partial.** It changes quantization/intensity/timbral bias and uses harmony-aware mappings.
- It is not yet a fully separate composition engine with phrase forms, sectional planning, and thematic continuity independent from event density.

### Current drivers of harmony/rhythm/instrumentation
- Harmony: pentatonic mode selection + tonal center derived from ecological stats and long-form state.
- Rhythm: pulse gating, phrase agents, event-triggered note scheduling.
- Instrumentation: descriptor registry influences profile selection, but synthesis remains mostly oscillator/filter envelopes.

### Why output may still feel noise/installation-like
1. Strong dependence on reactive micro-events and local salience fluctuations.
2. Limited phrase-level narrative and cadence resolution.
3. Timbre family differences are subtle within oscillator-based synthesis.
4. Multiple layers compete in similar spectral/emotional space.

### Architectural blockers to more musical result
1. Composition logic still embedded in giant `audioEngine.ts`.
2. No explicit timeline/section manager (A/B sections, transitions, cadence planning).
3. No clear hard separation between sonification and score composition responsibilities.

### Iterate vs redesign?
- **Partial redesign recommended.** Keep existing buses/harmony/salience foundations, but split into explicit layers:
  1. ecological sonification (truthful system feedback),
  2. ambient bed (world continuity),
  3. music engine (phrase/form/harmony arc),
  4. UI/selection feedback (short tactical cues).

---

## 7. Gameplay direction audit

### Readiness: relaxing garden sandbox mode
- Moderate readiness. Core loop exists (growth → fruit → consumption → residue → decomposition → nutrient return) and feels aligned with calm sandbox goals.
- Missing: player progression framing, explicit gardening outcomes, and clear intervention planning tools.

### Readiness: future breach/campaign mode
- Low readiness in current runtime despite conceptual hooks.
- No active breach faction/system, no contamination spread model, no containment objective loop, no win/lose pressure arcs.

### Invasive/corrupting enemy ecology
- Foundations: event system, habitat fields, species architecture pattern, threat stat.
- Missing: canonical enemy ecology primitives (infection vectors, corruption fields, counterplay states, escalation clock).

### Resource loops (harvesting/seeds/fruit/tools/weapons)
- Internal ecology resources exist (energy, nutrients, fruit particles, propagules), but player-facing resource economy does not.
- No inventory, no harvest action, no seed placement loop, no crafting/weaponization path.

### Player-as-gardener interaction model
- Gesture remapping and attention are a strong step toward embodied interaction.
- Still lacks explicit gardener identity mechanics: planning horizon, deliberate planting/transplanting, ecological diagnostics tied to decisions.

---

## 8. Architecture health / technical debt

### Partial refactors / layering state
- Macro boundaries are cleaner than earlier prototypes.
- Internal subsystem decomposition remains incomplete.

### Overly large modules / ownership risks
- `src/sim/ecology/simulation.ts` is effectively a full game backend in one file.
- `src/audio/audioEngine.ts` similarly centralizes multiple conceptual layers.
- `renderer.ts` and `hud.ts` are also large and multi-responsibility.

### Duplicate logic / ambiguous ownership
- Multiple places implement wrapped delta helpers and interaction context logic.
- Some role naming diverges between docs/species labels and code type names (e.g., cluster/decomposer terminology).

### Contradicting styles / UI layers
- HUD is robust but heavy; risk of UI logic accreting into simulation semantics if not guarded.
- Some docs describe previous UI/tool paradigms no longer canonical.

### Dead/stale/compatibility residue
- Compatibility re-export files are intentionally present but can hide canonical import paths.
- Predator path is scaffolded in many systems while globally disabled by config; this is intentional staging but still a potential confusion source.

### Performance concerns
- Bucketization and stability passes appear to have addressed prior hotspots.
- Remaining risk is ongoing feature accretion in already-large per-frame systems without further modular splits.

### High-risk areas for future agent regressions
1. `simulation.ts` (coupled side effects across ecology/resource/events).
2. `audioEngine.ts` (mix/composition/sonification intertwined).
3. `renderer.ts` (visual identity + readability + perf tradeoffs tightly coupled).

---

## 9. Canonicalization recommendations

| Status | Keep / Refactor / Remove | Rationale |
|---|---|---|
| **KEEP as canonical** | `src/app/game.ts` orchestration loop | Clear runtime spine; good fixed-step and subsystem wiring. |
| **KEEP as canonical** | `src/sim/world.ts` + `src/types/world.ts` world-state contracts | Strong shared schema and ownership model. |
| **KEEP as canonical** | `src/sim/events.ts` world event queue | Essential seam for audio/UI/telemetry/campaign hooks. |
| **KEEP as canonical** | `src/sim/fields/worldField.ts` | Strong substrate model for ecology + rendering coherence. |
| **KEEP but refactor soon** | `src/sim/ecology/simulation.ts` | Critical but too large; split by pipeline stages/species modules. |
| **KEEP but refactor soon** | `src/audio/audioEngine.ts` | Good architecture seeds, but overloaded with too many concerns. |
| **KEEP but refactor soon** | `src/render/renderer.ts` | Preserve style; split terrain/entity/overlay passes and readability modes. |
| **PROVISIONAL / needs decision** | Predator subsystem in active branch | Implemented but disabled by caps; decide keep dormant vs remove until breach phase. |
| **PROVISIONAL / needs decision** | Interpretation “musical mode” naming | Currently implies stronger composition than delivered; either deepen or rename semantics. |
| **REMOVE / retire / archive** | Stale design notes that contradict current runtime interaction model | Prevent future contributor confusion; archive with “historical” label if kept. |

---

## 10. Proposed roadmap reset

### Phase 0: cleanup / audit closure
**Why first:** prevent further drift.
- Tag this audit as canonical reset doc.
- Mark stale docs as superseded/historical.
- Add architecture map diagram + ownership table.

**Gate to exit:** canonical source-of-truth docs and import paths agreed.

**Do NOT touch yet:** major behavior tuning.

### Phase 1: architecture stabilization
**Why next:** future feature work is unsafe without decomposition.
- Split simulation into modules: environment, lifecycle, species behaviors, spawning, stats/events.
- Split audio engine: sonification, score engine, mix/routing, feedback cues.
- Split renderer into terrain/readability/entity/overlay passes.

**Gate to exit:** no single runtime file > ~900 lines in core loops; behavior parity tests/manual checks pass.

**Do NOT touch yet:** breach mechanics or combat features.

### Phase 2: ecology depth pass
**Why now:** architecture can support focused balancing.
- Tune unattended persistence metrics.
- Define canonical trophic contracts and failure/recovery windows.
- Introduce ecology diagnostics for extinction cause analysis.

**Gate to exit:** unattended soak runs maintain dynamic but non-collapse ecology over target duration.

**Do NOT touch yet:** visual style overhaul.

### Phase 3: terrain/world readability pass
**Why now:** ecology tuning needs understandable world feedback.
- Add optional habitat/pressure overlays.
- Add landmark anchors without breaking subtle style.
- Improve legibility at multiple zoom levels.

**Gate to exit:** user can reliably identify fertile/wet/highland zones and likely species niches.

**Do NOT touch yet:** full campaign loops.

### Phase 4: true music engine pass
**Why now:** stable sim/terrain semantics can drive better composition.
- Add section/phrase manager and cadence logic.
- Separate ecological truth layer from musical narrative layer.
- Expand timbral identity beyond oscillator similarity.

**Gate to exit:** listening sessions demonstrate coherent musical arcs independent of event noise.

**Do NOT touch yet:** large external dependency adoption unless clearly justified.

### Phase 5: gardening gameplay tools/resources
**Why now:** sandbox identity requires player agency loops.
- Add explicit seeds/harvest/inventory/resource conversion.
- Add long-horizon gardener actions (planting plans, habitat sculpting intent).
- Improve feedback of intervention outcomes over time.

**Gate to exit:** player can set and achieve meaningful gardening goals without constant micromanagement.

**Do NOT touch yet:** high-pressure combat escalation.

### Phase 6: breach/campaign foundations
**Why last:** needs stable sandbox and clarity first.
- Introduce corruption/invasive ecology primitives.
- Add containment/escalation clocks and scenario objectives.
- Re-enable/reshape predator/enemy pressure under campaign rules.

**Gate to exit:** campaign pressure loops coexist with sandbox mode without collapsing design identity.

---

## 11. Agent guidance for future work

### Dangerous files to touch casually
- `src/sim/ecology/simulation.ts`
- `src/audio/audioEngine.ts`
- `src/render/renderer.ts`
- `src/ui/hud.ts`

### Must-read before editing
1. `docs/architecture.md`
2. `docs/world-model.md`
3. `docs/species.md`
4. `docs/audio-system.md`
5. This audit document.

### Architecture rules to preserve
- Simulation owns world mutation; render/audio consume snapshots.
- Event queue remains typed and lightweight.
- Wrapped-world math must stay consistent across sim/render/audio/input.
- Tool interaction semantics should stay in app/interaction layer, not ecology logic.

### Anti-patterns to avoid
- Adding new cross-cutting features directly into giant monolith files.
- Duplicating wrap/delta/field sampling logic without shared helpers.
- Using renderer or HUD as logic owners for simulation truths.
- Treating “musical mode” as solved and adding more reactive noise layers instead of composition structure.

### Always-run checks after significant edits
- `npm run build`
- Manual runtime sanity pass (`npm run dev`):
  - start audio after interaction,
  - verify attention select/region,
  - verify tool unlock progression,
  - verify no severe FPS regression,
  - verify notifications/debug overlay still update.

---

## Appendix: confidence and uncertainty notes

- Confidence is high on architecture/ecology/audio topology because source inspection was extensive and direct.
- Confidence is moderate on long-run ecological stability because this audit did not execute long-duration deterministic soak tests in multiple seeds.
- Confidence is moderate on player readability conclusions because they combine code inspection with limited visual observation snapshots rather than formal user testing.
