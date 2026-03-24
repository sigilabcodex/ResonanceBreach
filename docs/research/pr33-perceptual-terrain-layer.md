# PR #33 — Perceptual Terrain Layer Exploration + Implementation Notes

## 1) Current Terrain Pipeline (Before PR #33 changes)

### Source field generation
Terrain signal is produced in `WorldFieldModel.sampleLayers()` and `WorldFieldModel.sample()`, which build layered scalar fields (elevation, moisture, fertility, roughness, density, contour, flow angle/bias) from warped FBM/value/ridge noise. These are transformed into derived gradients, habitat weights, flow vectors, and biome labels (`water`, `fertile`, `dense`, `solid`).

### Sampling for rendering
`EcologySimulation.createTerrainSamples()` generates a stable cloud of terrain samples using golden-ratio distribution + small deterministic jitter. Each sample stores center, radius, terrain class, gradients, flow, moisture, fertility, resonance, and related metrics.

### Render stage
`Renderer.render()` invokes:
1. `drawTerrain(...)` for contour-like line bands.
2. `drawEnvironmentalFlows(...)` for thin flow ribbons.

The existing lines already used local slope/flow/habitat data, but the output remained somewhat abstract and did not strongly expose moisture/ecology/wind as a readable map.

## 2) Identified Extension Points

1. **`Renderer.drawTerrain()`**
   - Main place to control contour density, spacing, thickness, and color.
   - Best hook for topographic readability and moisture-driven line logic.

2. **`Renderer.traceContourStroke()`**
   - Core contour geometry function.
   - Best hook for directional wind deformation and basin/water oscillation.

3. **`Renderer.drawEnvironmentalFlows()` / `traceFlowLine()`**
   - Existing flow visualization layer.
   - Best hook for subtle wind/wetland stream emphasis without adding UI.

4. **`WorldFieldModel.sample()`**
   - Ground truth of ecological scalar fields and gradients.
   - Already exposes enough variables (moisture/fertility/resonance/habitat/flow/slope) to drive the full perceptual terrain layer.

## 3) PR #33 Implementation Summary

### Contour-based terrain
- Kept contour-line rendering as primary geometry and increased map readability via:
  - stronger line-count shaping from slope + density + moisture,
  - moisture-aware spacing (wet areas denser, dry areas sparser),
  - subtle but clearer contour length scaling.

### Wind visualization via line deformation
- Added low-frequency wind drift in `traceContourStroke()` using flow direction alignment.
- Movement remains slow and stable to avoid flicker.

### Moisture representation
- Moisture now impacts:
  - contour line count,
  - spacing,
  - line weight,
  - wetland/basin flow-stream density.

### Ecological color layer
- Added ecological hue blending in `getEcologicalTerrainColor()`:
  - moisture/wetland/water -> blue range,
  - fertility/nutrient/basin -> green range,
  - roughness + low stability/highland (decay/noise proxy) -> red-purple range.
- Saturation is intentionally low for background coherence.

### Micro-pattern overlays
- Added `drawTerrainMicroPatterns()` with:
  - hatch strokes (terrain texture emphasis),
  - sparse dot overlays (resonance/nutrient activity cue).
- Patterns are lightweight and only drawn when texture strength passes a threshold.

### Water / basin behavior
- Basin/wetland influence now smooths contour behavior and adds gentle oscillation pulse.
- Water/basin zones also receive stronger but subtle flow-ribbon presence.

## 4) Performance Notes

- No heavy geometry buffers or 3D systems introduced.
- Reuses existing terrain sample count and immediate-mode canvas path drawing.
- Adds bounded per-sample work with thresholds for micro-pattern overlays.
- Continues using existing visibility culling (`isVisible`) and wrapped sampling.

## 5) Why this aligns with “living map of invisible forces”

- Wind is visible through directional contour drift rather than explicit arrows/UI.
- Moisture can be inferred from line density/spacing and basin smoothness.
- Ecological state is encoded as subtle, blended color tendencies.
- Hand-drawn style comes from hatching/dots rather than literal textures.
