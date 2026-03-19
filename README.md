# ResonanceBreach

ResonanceBreach is a minimalist browser-based experimental game prototype about containing an abstract multidimensional breach. The player manages a drifting field of geometric entities whose local alignments create resonance, growth, and systemic collapse pressure.

## Concept

The prototype is designed as an original hybrid of simulation, instrument, and arcade-like intervention:

- **Systemic pressure:** drifting entities influence nearby neighbors, amplify local resonance, and spawn more entities when unstable alignments persist.
- **Ambient flow:** the field stays in motion at all times, with smooth drift and pulsing relationships between particles.
- **Reactive clarity:** the player gets a single, direct stabilization tool that is simple to understand but expressive under pressure.

The central game state is **stability** in `[0, 1]`:

- `1` = coherent, calm, controlled field.
- `0` = catastrophic breach cascade and loss state.

Stability continuously drives gameplay pressure, visual intensity, and audio tension.

## Controls

- **Click / press and drag:** place a temporary stabilization zone.
- **R:** restart immediately.
- **Restart button:** reseed the field with a fresh run.

Audio begins after the first user interaction to comply with browser autoplay restrictions.

## Phase 1 Prototype Scope

This first playable prototype includes:

- a Vite + TypeScript single-page app;
- an HTML Canvas simulation field with bounded drifting entities;
- local resonance interactions that can create new entities;
- a continuous global stability meter that determines whether the breach is contained;
- a temporary stabilization zone that pushes entities apart, dampens resonance, and helps recover stability;
- procedural visuals that become harsher, flickery, and more distorted as stability drops;
- procedural WebAudio layers with a tonal bed and a reactive noise layer;
- a minimal HUD showing title, stability, entity count, controls, and restart access.

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
- `src/sim/simulation.ts` – entity simulation, resonance pressure, spawning, stability, and restart logic.
- `src/render/renderer.ts` – procedural canvas rendering and instability feedback.
- `src/audio/audioEngine.ts` – generative tonal/noise WebAudio layers mapped to system state.
- `src/input/playerInput.ts` – mouse / pointer and keyboard controls.
- `src/ui/hud.ts` – minimal DOM HUD.
- `src/config.ts` – tuning constants and shared configuration.

## Future Ideas / TODO

- Add multiple intervention tools with distinct tradeoffs.
- Introduce richer resonance classes, chain reactions, and spatial rules.
- Explore structured scenarios, waves, and level-like containment objectives.
- Prototype pseudo-3D or full 3D spatial breach visualizations.
- Expand the soundtrack into a richer multi-voice generative score.
- Track score, duration survived, and post-run instability analysis.
- Add advanced shaders or post-process distortion while keeping the abstract aesthetic.
