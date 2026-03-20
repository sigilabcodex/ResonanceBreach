# ResonanceBreach — Architecture Notes

## Purpose

ResonanceBreach is a world-driven simulation game built around:

- a continuous wrapped world ("bubble" topology)
- ecological entities with lifecycles
- field-based movement and terrain influence
- perceptual audio instead of one-sound-per-entity
- tool-based interaction layered on top of a living system

This document defines the architectural direction so future work remains coherent.

---

## Core Principles

1. **Simulation first**
   The world must behave meaningfully even without rendering or audio.

2. **Separation of concerns**
   Simulation, rendering, audio, and interaction should be modular.

3. **Field-based world**
   The world is not a grid. Internally, helper sampling structures are allowed, but the user-facing world must feel continuous and organic.

4. **Perceptual layering**
   Audio and rendering should emphasize salience, grouping, and clarity rather than raw quantity.

5. **Gradual complexity**
   Start with a few species and systems, then expand.

---

## High-Level Subsystems

### 1. World Simulation
Responsible for:
- entity state
- lifecycle updates
- movement
- feeding
- reproduction
- death and residue
- field sampling

### 2. Fields
Continuous or sampled layers that influence behavior:
- nutrient field
- moisture field
- flow field
- gravity / attractor field
- terrain resistance / density field

### 3. Rendering
Responsible for:
- topography visualization
- organism glyph rendering
- camera and zoom
- focus tool visualization
- effects and subtle feedback

### 4. Audio
Responsible for:
- global ambience
- grouped biome/cluster voices
- salient entity voices
- interaction/event sounds
- harmonic coherence
- perceptual filtering by distance/focus/salience

### 5. Interaction
Responsible for:
- focus tool
- grow/feed/repel/disrupt tools
- tool costs
- future progression and unlocks

---

## Proposed Directory Structure

```text
src/
  app/
    bootstrap.ts
    game.ts
    config.ts

  sim/
    world.ts
    update.ts
    clock.ts
    events.ts

    fields/
      fieldTypes.ts
      nutrientField.ts
      moistureField.ts
      flowField.ts
      attractorField.ts
      terrainField.ts

    ecology/
      feeding.ts
      reproduction.ts
      lifecycle.ts
      death.ts
      flocking.ts

    species/
      speciesRegistry.ts
      plant.ts
      grazer.ts
      pollinator.ts
      decomposer.ts
      predator.ts

  render/
    renderer.ts
    camera.ts
    palette.ts
    terrainRenderer.ts
    contourRenderer.ts
    organismRenderer.ts
    effectsRenderer.ts
    uiRenderer.ts

  audio/
    audioEngine.ts
    mixer.ts
    salience.ts
    harmony.ts
    groupedVoices.ts
    eventSounds.ts
    spatial.ts

  interaction/
    input.ts
    tools.ts
    focusTool.ts
    growTool.ts
    feedTool.ts
    repelTool.ts
    disruptTool.ts

  types/
    entity.ts
    world.ts
    fields.ts
    audio.ts
    tools.ts
    species.ts
