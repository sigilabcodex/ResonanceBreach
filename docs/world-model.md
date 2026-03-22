# World model

## Overview

Resonance Garden presents the world as a wrapped continuous surface read primarily through lines. The terrain pass avoids pulsing blobs and visible tiles; instead it uses contour-like bands, flow lines, and low-contrast drift so the camera feels embedded in a living map rather than aimed at a board.

## Continuous world field

The simulation substrate is driven by a shared **world field** abstraction.

### Structural layers

- **Elevation field** shapes ridges, highlands, slopes, and traversability.
- **Moisture field** shapes wet channels, lakes, calm low pockets, and fluid-biased motion.
- **Fertility field** shapes bloom-friendly ground, residue response, and long-term growth potential.
- **Flow field** is derived from directional noise plus downhill tendencies so motion follows terrain rather than a repeated pattern.

These layers are sampled continuously at entity positions, terrain sample points, residue zones, and tool interactions. Visual terrain, ecology, and light audio hooks all read the same substrate.

## Habitat specialization

This pass derives explicit ecological habitats from the continuous field without introducing a grid map.

### Wetland / water zones

Wet zones emerge where moisture, low slope, and basin structure overlap.

- likely to contain calmer water-like channels or pooled low pockets
- produce smoother directional flow and softer horizontal or curved line motion
- bias particles and mobile creatures toward fluid drift
- favor decomposer persistence and moisture-rich ecological recovery

### Highlands / ridges

Highlands emerge where elevation, slope, contour pressure, and roughness stack together.

- represented by tighter, denser contour logic
- reduce traversability without sealing the map into a maze
- push many species away from ridge crests or slow them when crossing
- act as open obstacles that shape clustering, drift paths, and spawn suitability

### Fertile basins / lowlands

Basins emerge where low elevation, calmer slope, fertility, moisture, and residue support overlap.

- form the most favorable rooted-growth habitat
- accumulate stronger nutrient and stability values over time
- become natural bloom centers and grazer destinations
- provide obvious “life gathers here” ecological pockets

Each field sample now exposes both a dominant habitat and blended habitat weights, so future species can hook into the same rules without changing the substrate model.

## Terrain affects ecology

Habitats are systemic, not just visual.

### Spawning

- Rooted Blooms strongly prefer fertile basins and avoid harsh ridges.
- Pollinator Drifters can spawn across wetland and basin-adjacent space, but avoid dominant highland bands.
- Decomposers prefer wet or basin-rich zones with nutrient support.
- Grazers favor basin corridors and avoid steep wet or ridge-heavy terrain.

### Growth and persistence

- Blooms gain stronger growth, fruiting, and local enrichment in basins.
- Wet support modestly helps blooms, but water-heavy ground is still less ideal than fertile lowland.
- Highland pressure increases stress for rooted growth and reduces general persistence.
- Decomposers gain stability and energy in moist or basin-like nutrient pockets.

### Movement

- Wet zones produce smoother flow-following movement.
- Highlands increase slope resistance and create readable movement constraints.
- Basins pull species toward nutrient and bloom concentrations.
- Mobile species still remain free-roaming overall; the world stays open and explorable.

## Wrapped world topology

The world is toroidal on both axes.

- Moving past the right edge re-enters on the left.
- Moving past the bottom re-enters on the top.
- Entity motion, particles, tool placement, field sampling, residue influence, camera movement, and audio salience all use wrapped coordinates.
- Distance tests use shortest wrapped deltas, so neighbors across a seam still behave as local neighbors.
- Rendering resolves positions relative to the camera with wrapped deltas, which keeps seams visually unobtrusive even when the camera is near a world edge.

The goal is not to expose a visible tiling seam. The goal is to make the world feel like one continuous sheet of terrain and life.

## Topography as a line field

Terrain remains visualized only through line work.

### Terrain cues

- **Wetland / water zones** read as smoother, softer flow lines with gentler parallel direction.
- **Basins** read as curved, calmer contour groupings with more hospitable spacing.
- **Highlands / ridges** read as tighter, denser, more structured contour bands.
- **Transition zones** stay blended so the map remains natural rather than segmented.

### What was removed

- no terrain fill gradients
- no pulsing shading tied to terrain patches
- no interference-like circular substrate artifacts
- no shader-style background noise layer
- no visible tile or biome grid

## Rendering layer separation

The world is rendered in clear visual strata.

1. **Terrain lines** — subtle contours that reveal ridges, basins, and wet structure.
2. **Environmental flows** — water-like and nutrient-like directional lines that clarify habitat character.
3. **Lifeforms and events** — entities, residue, particles, and tool feedback with stronger contrast.

Terrain should support reading the world, not compete with organisms for attention.

## Audio hooks

This is a light pass only.

- wetland-heavy camera regions slightly soften and smooth the ambient bed
- highland-heavy regions thin the bed slightly
- basin-heavy regions add a fuller, more grounded ambience

The goal is subtle habitat character, not a separate soundscape per biome.

## Stability goals

The current pass still prioritizes calm motion and stable performance.

- Habitat classes are derived from existing field samples rather than a second map system.
- Terrain rendering still uses procedural line generation rather than heavy per-pixel shading.
- Habitat logic reuses shared field evaluations at terrain samples and entity positions.
- Species systems are specialized by habitat preference instead of being broadly redesigned.
