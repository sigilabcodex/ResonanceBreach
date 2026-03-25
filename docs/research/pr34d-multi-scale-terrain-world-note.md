# PR #34D Design/Dev Note — Multi-scale terrain world

## Current terrain scale model

The terrain pipeline currently centers on `WorldFieldModel.sampleLayers()` and `WorldFieldModel.sample()` in `src/sim/fields/worldField.ts`.

- A single warped coordinate domain (`nx/ny -> warpedX/warpedY`) drives all core fields.
- Elevation/moisture/fertility/roughness/density/contour are each composed from a few FBM/ridge samples, but they are still effectively tied to one shared domain scale progression.
- Terrain cells are generated in `Simulation.createTerrainSamples()` (`src/sim/ecology/simulation.ts`) and rendered as contour + micro pattern strokes in `Renderer.drawTerrain()` (`src/render/renderer.ts`).

So while there are layered octaves, the world reads more like one blended field than an explicit hierarchy of macro/meso/micro geography.

## Likely causes of visible repetition

The main repetition risk appears to come from a combination of:

1. **Wrapped finite world extent** (`WORLD_WIDTH` / `WORLD_HEIGHT`) with continuous field sampling.
2. **Shared domain coupling** where most fields derive from similarly warped coordinates, which can make patterns echo across zoom levels.
3. **No explicit zoom-aware detail weighting in terrain rendering**: micro features are always active at roughly similar strength regardless of zoom.

This creates a “single-scale” impression: zoomed-out views show structural echoes, while zoomed-in views do not gain enough distinct fine structure.

## Proposed multi-scale solution

Introduce explicit hierarchical terrain components and propagate them through terrain sampling/rendering:

- **Macro field** (very low frequency): broad basins/ridges/land masses, with low drift and strong stability.
- **Meso field** (mid frequency): regional corridors, slope organization, habitat transitions.
- **Micro field** (high frequency): local roughness/detail, gated by zoom in rendering.

Implementation approach:

1. Refactor `sampleLayers()` to compute explicit `macro`, `meso`, `micro` fields from distinct frequency bands.
2. Use those scale fields to derive elevation/moisture/fertility/roughness/contour with clearer role separation.
3. Apply lightweight anti-repetition techniques:
   - multi-stage non-periodic domain warp,
   - seed offsets per scale band,
   - larger macro sampling span,
   - reduced high-frequency dominance in macro composition.
4. Expose macro/meso/micro values in `FieldSample`/`TerrainCell`.
5. Update renderer terrain pass to:
   - preserve macro legibility when zoomed out,
   - increase micro expression only when zoomed in,
   - reduce micro stroke/pattern prominence at low zoom.

## What this PR will and will not do

### Will do
- Add explicit 3-scale terrain hierarchy (macro/meso/micro).
- Improve large-scale readability and reduce obvious repeated structure.
- Make micro visual detail zoom-sensitive.
- Keep changes modular in field model + terrain sampling/rendering.

### Will not do
- No chunk/infinite streaming.
- No climate simulation system.
- No major renderer architecture rewrite.
- No entity-count scaling tied to world size.
