# PR #41 Design/Development Note — Musical Interpretation Layer Foundation

## Current audio architecture (before this PR)

The current pipeline in `AudioEngine` is effectively:

simulation snapshot + world events -> direct synthesis/control decisions in `audioEngine.ts` -> master/limiter -> output.

Key observations from inspection:

- **Entity and world event generation** happens in `src/sim/events.ts` and arrives in snapshots as `snapshot.events`.
- **Sound synthesis** is currently tightly coupled inside `src/audio/audioEngine.ts`:
  - bed oscillators/noise,
  - pooled ecological voices,
  - pooled foreground voices,
  - transient event/tool/selection tones,
  - phrase agents.
- **Roles/state/lifecycle influence** is present through:
  - ecological composition and role profiles in `src/audio/ecologicalMusic.ts`,
  - harmony mapping in `src/audio/harmony.ts`,
  - salience/focus selection in `src/audio/salience.ts`,
  - direct per-event transient mappings in `AudioEngine.triggerEventTone`.
- **Mix/output buses** currently exist as a minimal structure (`master`, `eventBus`, `phraseBus`, plus per-layer gains), but there is no explicit modular bus model for future orchestration/musical routing.

## Best integration points for a musical interpretation layer

To preserve existing behavior while creating extensibility:

1. **At the world event boundary**
   - Convert `WorldEvent` values into an internal ecological audio event abstraction.
   - This decouples simulation event semantics from final synth gestures.

2. **Inside `AudioEngine.processEvents`**
   - Insert a musical interpreter call between event intake and transient synthesis triggers.
   - This keeps current event timing behavior but allows mode-based reinterpretation.

3. **At audio initialization**
   - Introduce a dedicated bus layer object and route existing sublayers through named buses:
     - `music`, `atmosphere`, `rawEcology`, `selectionUi`.

4. **In audio module boundaries**
   - Add a lightweight instrument descriptor registry now (metadata-only), so later PRs can route interpreted gestures to descriptor-backed instruments.

## What this PR implements

- A new ecological audio event abstraction and mapper module.
- A musical interpreter interface with explicit `raw | hybrid | musical` support and a default interpreter implementation.
- A descriptor/registry foundation for future instrument palettes (metadata only, no sampler/instrument engine).
- A modular mix-bus foundation with named buses and backward-compatible gain defaults.
- Integration of the new architecture into `AudioEngine` with current behavior preserved.

## What this PR explicitly does NOT implement yet

- No full replacement of existing synth voice logic.
- No full event-to-instrument orchestrator.
- No 8–12 fully realized instrument voices/samplers.
- No large rewrite of harmony/ecological rendering internals.
- No invasive simulation event model changes.

This is an architectural seam-creation pass so future PRs can "musicify" the ecology without regressing current sound output.
