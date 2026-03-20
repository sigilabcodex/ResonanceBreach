# ResonanceBreach Architecture

## Current intent

ResonanceBreach is moving from a fast prototype toward a more disciplined simulation architecture. The immediate goal is not to solve every ecological or gameplay problem at once. The goal is to make future iteration safer by clarifying ownership, boundaries, and extension points.

## Directional principles

- **Continuous wrapped world:** the long-term world model is a continuous wrapped space rather than a visible grid. Internal sampling structures are allowed, but they should remain implementation details.
- **Field-based ecology:** organisms react to terrain, nutrients, flow, attractors, tools, and later anomaly fields.
- **Lifecycle-driven entities:** species are defined by growth, feeding, reproduction, death, and return to residue.
- **Modular subsystems:** simulation, rendering, audio, and interaction should be independently understandable.
- **Future breach cosmology:** the current garden is a local layer inside a broader bubble/breach cosmology that can add stranger fields and species later.

## Implemented module layout

```text
src/
  app/
    bootstrap.ts      # application startup
    game.ts           # frame loop and subsystem orchestration
    config.ts         # compatibility export for shared config

  sim/
    ecology/
      simulation.ts   # main simulation update pipeline
    fields/
      types.ts        # field sampler and terrain modifier types
    events.ts         # typed world events and notification helpers
    random.ts         # seeded RNG
    simulation.ts     # compatibility export
    types.ts          # compatibility export
    world.ts          # central world model factories

  interaction/
    input.ts          # input handling mapped to world-space intents
    tools.ts          # tool metadata shared by UI and systems

  render/
    renderer.ts       # rendering consumes snapshots only

  audio/
    audioEngine.ts    # audio reacts to snapshots and events

  types/
    world.ts          # shared world-facing types
```

## World model

The central world model now owns:

- world dimensions and wrap intent
- entities
- sampled terrain cells
- attractors and tool fields
- particles, residue, and visual bursts
- camera and tool state
- simulation time, time scale, and energy
- lightweight typed events and derived notifications

This keeps the simulation state explicit and makes it easier for future agents to inspect or extend one part of the world without reverse-engineering the whole app.

## Subsystem boundaries

### App / bootstrap
Responsible for startup, the fixed timestep loop, camera smoothing, and wiring subsystems together.

### Simulation
Owns the evolving world state. Simulation should be able to step forward without a renderer or audio engine attached.

### Rendering
Consumes world snapshots. It should visualize terrain, organisms, tools, and feedback, but it should not author simulation state.

### Audio
Consumes world snapshots and event streams. Audio should interpret salience and state, not drive births, deaths, or movement directly.

### Interaction
Translates user intent into tool and camera actions. Interaction should not contain ecological rules.

## Event layer

A lightweight typed event queue now exists for world-facing events such as:

- `entityBorn`
- `entityFed`
- `entityDied`
- `toolUsed`
- `residueCreated`

These events are intentionally small. They are primarily for audio, HUD messaging, and future logging, replay, analytics, or species debugging.

## Near-term follow-up work

1. Split the large simulation update into field, lifecycle, feeding, reproduction, and death modules.
2. Replace prototype entity labels with clearer species modules and registries.
3. Gradually move terrain sampling into dedicated field modules.
4. Introduce decomposer-specific behavior and richer residue flow.
5. Add bubble/breach event types without leaking those concerns into rendering.
