# Future Integration Seams

## Purpose

This document defines the architectural seams ResonanceBreach should preserve now so future experiments with FLOSS tools remain possible without locking the project into any one library.

These seams are conceptual and interface-oriented. They are not a request to implement a new abstraction layer immediately. The main goal is to avoid baking specific algorithms or external APIs directly into unrelated systems.

## Why seams matter now

The project is still refining its identity as:
- a continuous wrapped world
- a field-driven ecology
- an audiovisual instrument
- a future game-like space with more species and risk layers

That means some future integrations may be useful, but only if they can be introduced locally. If the current code tangles field sampling, motion, behavior, sound, and rendering into one update path, every future experiment becomes an architectural rewrite.

## Seam 1: Field sampler

### Responsibility
Provide read-only access to continuous environmental values at world positions.

### What it should answer
At a given wrapped position, systems may need:
- terrain class or passability
- nutrient value
- moisture or fertility
- scalar pressure values
- vector flow direction
- local turbulence or instability
- attractor influence

### Why preserve this seam
Many future features depend on field sampling:
- movement drift
- species habitat preference
- spawning suitability
- sound mapping
- shader accents
- future anomaly zones

### What should stay decoupled
The caller should not need to know:
- whether values come from procedural noise, cached cells, splines, or authored masks
- whether noise is custom or from a library such as FastNoiseLite
- how many layers are blended internally

### Guidance
Preserve the idea that systems ask for sampled values, not for direct access to terrain implementation details.

## Seam 2: Motion system

### Responsibility
Advance positions and velocities while respecting wrapped space and environmental resistance.

### Possible future responsibilities
- inertia and damping
- soft collision response
- flock spacing or clustering impulses
- terrain drag
- attractor pull
- simple rigid-body integration for select entities

### Why preserve this seam
Motion is where a physics library might someday be tested. It is also where custom motion may remain sufficient.

### What should stay decoupled
Species logic should express intent such as:
- seek
- avoid
- orbit
- drift
- slow down

It should not need to care whether movement is resolved by:
- a custom integrator
- simple pairwise collision code
- a narrow physics helper
- a library such as Planck.js in an isolated experiment

### Guidance
Keep behavior decisions separate from low-level movement resolution. That makes it possible to prototype richer motion without rewriting species rules.

## Seam 3: Agent behavior layer

### Responsibility
Translate local perception and internal state into movement intent, action intent, and activity state.

### Inputs it should conceptually read
- nearby entities
- nearby residue / food / hazards
- sampled field values
- short-term memory
- species traits
- lifecycle stage
- recent events affecting the entity

### Outputs it should conceptually produce
- desired direction or steering impulses
- target preference weights
- current activity state
- trigger requests such as feed, fruit, flee, rest, or investigate

### Why preserve this seam
This is where future experiments with small AI helpers could happen. It is also the layer most worth keeping custom because it encodes the project's personality.

### What should stay decoupled
Rendering and audio should consume resulting state, not embed behavior rules. Motion should consume intents, not decide species temperament. World generation should not know how agents reason.

## Seam 4: Audio mapping layer

### Responsibility
Map world state and events into sound control data.

### Important distinction
Audio mapping is not the same as audio synthesis.

The mapping layer should decide things like:
- what is salient
- which entities or zones deserve sound attention
- which scalar values drive pitch, filter, density, or spatial spread
- how focus or attention reshapes the mix
- when state-based continuity should dominate over one-shot event accents

### Why preserve this seam
This keeps ResonanceBreach free to:
- continue with direct Web Audio
- prototype Tone.js only as a control/scheduling layer
- add future spatialization selectively
- revise synthesis design without touching simulation semantics

### What should stay decoupled
The simulation should never depend on audio framework objects. Audio should observe world state and event streams, not push logic back into them.

## Seam 5: Rendering / post-FX layer

### Responsibility
Turn the world snapshot into perception, framing, and surface character.

### Likely future concerns
- focus-based masking
- lensing or vignette distortion
- subtle non-rectangular framing
- flow-sensitive line work
- low-cost shader treatments
- possible future spatial depth cues

### Why preserve this seam
Rendering experimentation should remain cheap. The project may want stronger shader or post-processing work later, but should not need to alter core simulation data structures just to try it.

### What should stay decoupled
Simulation should provide stable world values and activity cues. Rendering decides how those are perceived.

That separation is especially important if the project later explores:
- more shader-heavy terrain rendering
- post-processing in a three.js layer
- off-screen compositing for microscope-like focus effects

## Seam 6: Species definition / trait layer

### Responsibility
Describe what differs between classes of entities without duplicating all update logic.

### Likely contents
- habitat preference
- field sensitivity
- movement temperament
- feeding priorities
- reproduction conditions
- decay profile
- salience hints for sound and rendering
- tolerance for risk, isolation, or crowding

### Why preserve this seam
Species differentiation should grow without forcing one-off code paths everywhere. This also creates a natural place to keep behavior custom even if some lower-level helpers are borrowed externally.

## Seam 7: Event stream

### Responsibility
Expose discrete meaningful changes without making every consumer poll deep simulation state.

### Why it matters
The event stream is already useful for audio and can later support:
- debugging
- replay summaries
- ecology inspection tools
- species tuning
- risk escalation cues

### Guidance
Keep events small, typed, and descriptive. Avoid turning the event layer into the simulation itself.

## Near-term rule of thumb

When adding or adjusting systems now, prefer code shapes that preserve these questions:
- Can this system read a sampled field instead of raw terrain internals?
- Can behavior express intent without caring how movement is integrated?
- Can audio react to world state rather than own it?
- Can rendering reinterpret world data without modifying the simulation?
- Can species differences live in traits or small policies rather than branching everywhere?

If the answer stays yes, future integration remains feasible without immediate dependency adoption.
