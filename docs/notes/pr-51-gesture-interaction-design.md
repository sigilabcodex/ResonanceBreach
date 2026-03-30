# PR #51 design/dev note — gesture-first world interaction

## Current interaction model (inspected)

- Interaction is currently tool-first:
  - HUD left panel renders a persistent "Field tools" grid with ATTENTION / Grow / Feed / Repel / Disrupt buttons (`src/ui/hud.ts`).
  - Number keys `1–5` explicitly select tools (`src/interaction/input.ts`).
  - Pointer input then applies whichever tool is currently active (`src/interaction/input.ts`, `src/sim/ecology/simulation.ts`).
- Simulation logic is already robust and should be preserved:
  - `setTool` switches the active tool and preserves unlock gating.
  - `setToolEngaged` applies tool fields, with special drag/selection behavior for `observe`.
  - Existing feedback channels (`tool.feedback`, bursts/events) already drive visual/audio responses.
- UX issue: the core action loop depends on explicit panel/tool switching and reads as a debug/operator console rather than embodied world touch.

## Core tools to preserve conceptually

- `observe` → attention / listening / following entities.
- `grow` → fertility support / seeding-like enrichment.
- `feed` → release food particles.
- `repel` → directional spacing influence.
- `disrupt` → stronger alternate intervention.

These stay internally as-is and remain unlock-gated; only trigger mapping changes.

## Proposed gesture mapping

- **Primary click/tap** → context-sensitive "nurture" action (`grow` or `feed`).
- **Primary hold** → `observe` attention mode (entity focus or listening region via drag release behavior already in sim).
- **Primary drag** → directional influence stamping (defaults to `repel`, can context-switch where useful).
- **Alternate gesture (right-click or Shift+left)**:
  - tap → stronger alternate (`repel`/`disrupt` by context + unlock state),
  - drag → repel sweep.

## Context sensitivity approach

Use local world context at pointer location from the current snapshot:

- nearby entity density,
- local terrain fertility/nutrients,
- global threat/energy,
- unlocked tool set.

Context chooses between semantically equivalent intentions (e.g., `grow` vs `feed`, `repel` vs `disrupt`) without forcing manual tool selection.

## What this PR will implement

1. Gesture-aware pointer state in input handling (tap/hold/drag + alternate gesture path).
2. Gesture-to-tool remapping layer in app runtime (context inference + unlock-safe fallback).
3. HUD simplification:
   - remove dominant tool button grid,
   - replace with compact gesture legend + lightweight state messaging.
4. Preserve existing simulation internals and tool logic by invoking existing `setTool` + `setToolEngaged` pathways.
5. Keep existing visual/audio feedback pipeline by reusing current tool feedback + event outputs.

## Out of scope for this PR

- Full HUD redesign or removal of all panels.
- Rewriting simulation tool internals.
- New complex control schemes beyond simple tap/hold/drag/alternate mappings.
- Major renderer/audio architecture changes.
