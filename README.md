# ResonanceBreach

ResonanceBreach is a minimalist browser-based experimental game prototype about containing an abstract multidimensional breach. The current pass pushes the project away from a sparse reactive screensaver and toward a living systemic field: unstable pockets form, local outbreaks chain together, and the player now works against chambered spatial pressure instead of a flat open plane.

## Prototype Direction

This pass is focused on a stronger propagation-control fantasy while keeping the presentation abstract, dark, and elegant.

### What changed in this iteration

- **Regional outbreaks:** resonance now accumulates inside local chambers, creating visible instability pockets and clustered spawns instead of mostly uniform global drift.
- **Pseudo-maze topology:** the field is divided into soft containment cells with directional flow and gate-like barrier segments that create bottlenecks, corridors, and local crises without becoming a literal maze.
- **More expressive entities:** entities now exhibit attraction, repulsion, swirl, charge-up behavior, and outbreak priming so dangerous regions can be read before they cascade.
- **Stronger containment feel:** the stabilizer zone now produces a clearer pulse, stronger local recovery, and more legible entity displacement and cooling.
- **Richer atmosphere:** visuals distinguish calm, resonant, and unstable regions more clearly, and the audio now behaves like a layered generative ambient bed that roughens as the breach worsens.

## Core Loop

The player manages a drifting field of geometric entities whose local alignments create resonance, chamber pressure, outbreaks, and systemic collapse risk.

The central game state is **stability** in `[0, 1]`:

- `1` = coherent, calm, controlled field.
- `0` = containment failure and loss state.

Stability continuously drives gameplay pressure, visuals, and audio.

## Controls

- **Click / press and drag:** project a containment zone.
- **R:** restart immediately.
- **Restart button:** reseed the field with a fresh run.

Audio begins after the first user interaction to comply with browser autoplay restrictions.

## Current Prototype Features

- chambered simulation field with soft barriers, gates, and flow-biased regions;
- clustered resonance logic with outbreak-prone hotspots and local chain reactions;
- procedural entities with pre-spawn charge states, attraction/repulsion influence, and signal-like motion;
- a temporary containment tool with stronger feedback and local recovery response;
- layered ambient WebAudio that stays airy and harmonic in stable states, then grows denser and rougher during instability;
- a minimal HUD showing stability, entity count, and active instability pockets.

## Running the Prototype

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

## Architecture Overview

- `src/app.ts` – app bootstrap and fixed-timestep loop.
- `src/sim/simulation.ts` – chamber topology, entity behavior, outbreak logic, stability, and containment response.
- `src/render/renderer.ts` – procedural canvas rendering for regions, barriers, hotspots, entities, and containment feedback.
- `src/audio/audioEngine.ts` – layered generative ambient WebAudio system mapped to stability and outbreak risk.
- `src/input/playerInput.ts` – mouse / pointer and keyboard controls.
- `src/ui/hud.ts` – minimal DOM HUD for stability and pocket readouts.
- `src/config.ts` – global tuning constants and topology dimensions.

## Design Notes

- The prototype is **not** intended to be a literal clone of classic propagation-control games.
- The simulation should instead evoke escalating intervention pressure through abstract systems, visible local crises, and recoverable pockets.
- The goal for future passes is to deepen identity and decision-making without abandoning the minimalist presentation.
