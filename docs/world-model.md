# World model

## Overview

Resonance Garden now presents the world as a wrapped continuous surface made primarily from lines. The terrain pass no longer relies on pulsing shaded blobs or circular interference patterns. Instead, the world reads through contour-like bands, flow lines, and slow field drift so the camera feels embedded inside a larger living substrate rather than pointed at a rectangular board.

## Continuous world field

The simulation substrate is now driven by an explicit **world field** abstraction instead of a visible terrain lattice.

### Structural layers

- **Elevation field** drives basins, ridges, slope, and traversability.
- **Moisture field** determines wet channels, water-biased movement, and calmer lowlands.
- **Fertility field** determines growth potential, bloom-rich zones, and nutrient-friendly spawning.
- **Flow field** is derived from directional noise and downhill tendencies so motion follows the terrain instead of a repeated interference pattern.

These layers are sampled continuously at entity positions, terrain sample points, residue zones, and tool interactions. The renderer only draws line work, but ecology reads the same scalar/vector field that visuals are derived from.

## Wrapped world topology

The world is toroidal on both axes.

- Moving past the right edge re-enters on the left.
- Moving past the bottom re-enters on the top.
- Entity motion, particles, tool placement, field sampling, residue influence, camera movement, and audio salience all use wrapped coordinates.
- Distance tests use shortest wrapped deltas, so neighbors across a seam still behave as local neighbors.
- Rendering resolves positions relative to the camera with wrapped deltas, which keeps seams visually unobtrusive even when the camera is near a world edge.

The goal is not to expose a visible tiling seam. The goal is to make the world feel like one continuous sheet of motion and life.

## Topography as a line field

Terrain is now represented visually only through thin line work.

### Terrain cues

- **Flat / open areas** read as sparse, gently spaced contour arcs.
- **Valleys / basins** read as converging curved lines and calmer inward structure.
- **Raised / solid regions** read as denser, tighter curvature.
- **Water** reads as smoother, more parallel flow lines with slightly stronger directional continuity.

### What was removed

- no terrain fill gradients
- no pulsing shading tied to terrain patches
- no interference-like circular substrate artifacts
- no shader-style background noise layer

### What remains procedural

The field sampler still produces continuous environmental values for ecology and motion, but the renderer interprets those values as:

- contour-like lines
- curvature bands
- flow lines
- density variation through spacing and count rather than fills

This keeps the ecology layer intact while changing perception of the surface.

## Rendering layer separation

The world is rendered in clear visual strata.

1. **Terrain lines** — subtle contour and curvature lines that define topography without overpowering the scene.
2. **Environmental flows** — water-like or nutrient-like directional lines that drift more visibly than the substrate.
3. **Lifeforms and events** — entities, residue, particles, and tool feedback with stronger contrast so they remain legible against the terrain.

Terrain should support reading the world, not compete with organisms for attention.

## Scale perception

The world should feel larger than the viewport.

This pass supports that through:

- slow drift in terrain sample placement
- layered line motion with subtle parallax in the backdrop
- wrapped camera-relative rendering instead of exposed bounds
- reduced visual anchoring to a fixed screen-centered rectangle

The intended effect is being inside a broad moving surface, not looking at a contained playfield.

## Attention behavior

Observe has been replaced by an ATTENTION system inspired by RTS selection.

- Clicking an entity selects it as the current attention target.
- The camera can softly follow that organism.
- Dragging defines a persistent listening region in world space.
- Clicking empty space clears attention and returns to the global mix.

The perception target is deliberate selective listening: clear intent, readable focus, and less apparent randomness.

## Lightweight settings system

A minimal settings panel now exposes:

### Audio

- master volume
- ambience volume
- entity volume

### Visuals

- terrain lines on/off
- motion trails on/off
- debug overlays on/off
- reduce motion on/off

The settings system is intentionally lightweight and stays within the existing restrained HUD style.

## Stability goals

The current pass prioritizes calm, readable motion and stable performance.

- Terrain rendering uses procedural line generation rather than heavy per-pixel shading.
- Motion remains low-frequency to avoid flicker and strobing.
- The ecology/species layer is preserved rather than redesigned.
- Wrapped presentation reduces the feeling of hitting a world boundary.
