# ResonanceBreach

ResonanceBreach is a minimalist browser-based ecosystem prototype. This iteration turns the scene into a calmer Resonance Garden: fewer active entities, softer terrain, slower motion, clearer cause and effect, and a closed ecological loop built around fruit, feeding, death, residue, and soil renewal.

## Modular architecture phase

The project is now entering a more disciplined modular architecture phase. Current refactors are focused on clarifying subsystem boundaries, introducing an explicit world model and lightweight event layer, and making future ecology, rendering, and audio work easier to extend without re-entangling the prototype.

## What changed in this iteration

- **Calmer motion and visuals:** high-frequency pulsing, jitter, and dense overlays have been replaced with slower fades, softer gradients, and lower-frequency movement.
- **Organic topography:** the world now drifts through water, fertile, and solid regions with contour-like outlines and soft boundaries rather than grid-like or boxed structure.
- **Reduced density:** fewer entities are active at once, empty space is preserved, and only a subset of creatures visibly animate or sonify strongly at any given moment.
- **Closed ecological loop:** plants slowly produce fruit, creatures consume it and reproduce when fed, death leaves nutrient residue, and residue enriches the soil that supports later growth.
- **Tool redesign:** Resonance Focus is now hold-to-observe, Grow creates a persistent fertility field, Feed emits visible particles, Repel remains wave-like, and Disrupt is a delayed charge that bursts outward and perturbs terrain.
- **Audio hierarchy:** a quiet ambient bed sits underneath restrained plant drones and a small set of primary creature voices, with focus-based isolation and positional panning.

## Ecological loop

The garden now behaves as a slow closed loop:

1. **Plants** root in fertile zones and mature over time.
2. **Fruit** is produced gradually by healthy mature plants.
3. **Creatures** drift, seek fruit or feed particles, and reproduce after sustained feeding.
4. **Death** creates nutrient residue in place.
5. **Soil** absorbs that residue, improving local fertility and helping future plants grow.

## Terrain model

The terrain continuously drifts through three soft region types:

- **Water** – gentle flow fields and looser movement.
- **Fertile soil** – supports plant growth and nutrient retention.
- **Solid ground** – resists life and behaves as a soft impassable region.

Each region is rendered with soft gradients and subtle contour-like outlines rather than hard edges or visible cells.

## Controls

- **Left click + hold with Resonance Focus:** isolate a local area visually and sonically.
- **Left click with other tools:** place a persistent intervention field.
- **Mouse wheel:** zoom in and out.
- **Right click / drag:** pan the camera.
- **WASD / Arrow keys:** pan the camera.
- **Hold Shift:** slow time to `0.5×`.
- **Hold Space:** fast-forward to `2×`.
- **R:** restart immediately.
- **Restart button:** reseed the simulation.

Audio begins after the first user interaction to comply with browser autoplay restrictions.

## Running the prototype

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

## Architecture overview

- `src/app/bootstrap.ts` and `src/app/game.ts` – startup, fixed-timestep loop, and subsystem orchestration.
- `src/sim/world.ts` and `src/sim/ecology/simulation.ts` – explicit world state ownership and systemic updates.
- `src/sim/events.ts` – lightweight typed world events and notifications.
- `src/types/world.ts` – shared world-facing types used across systems.
- `src/render/renderer.ts` – terrain gradients, contour rendering, field overlays, entity drawing, and focus masking.
- `src/audio/audioEngine.ts` – restrained ambient, grouped layers, and event-reactive audio.
- `src/interaction/input.ts` and `src/interaction/tools.ts` – player input and shared tool metadata.
- `src/ui/hud.ts` – ecological HUD, tool explanations, and field notes.
- `src/config.ts` – global simulation, camera, timing, terrain, and tool constants.

## Design notes

- The experience is meant to feel comfortable to observe for long stretches.
- Visual and audio density are intentionally constrained.
- Interactions should be legible: feeding, growth, reproduction, disruption, death, and nutrient return are all surfaced more clearly.
