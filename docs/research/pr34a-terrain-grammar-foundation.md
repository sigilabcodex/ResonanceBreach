# PR #34A — Terrain Grammar Foundation (Contours + Flow + 1 Pattern)

## A) Current system (analysis before implementation)

### Terrain generation pipeline
- `WorldFieldModel.sampleLayers()` builds scalar fields from warped procedural noise: elevation, moisture, fertility, roughness, density, contour, flow angle, and flow bias.
- `WorldFieldModel.sample()` derives gradients/slope, habitat weights (`wetland`, `highland`, `basin`), terrain class (`water`/`fertile`/`dense`/`solid`), and directional vectors (`flow`, `flowTendency`, downhill gradient).
- `Simulation.createTerrainSamples()` creates a distributed sample cloud (golden-ratio placement + jitter), then stores per-sample terrain attributes into `TerrainCell` for rendering.
- `Renderer.render()` draws terrain in two passes:
  - `drawTerrain()` for contour-like line bands.
  - `drawEnvironmentalFlows()` for flow ribbons.

### What data terrain visuals currently use
Existing terrain rendering already reads these per-sample fields:
- structure: `slope`, `height`, `roughness`, `density`, `radius`
- ecology: `moisture`, `fertility`, `nutrient`, `resonance`, `stability`, `habitatWeights`
- directionality: `flow`, `flowTendency`, `gradient`

### Current limitations
- Contours read as one blended layer; hierarchy between major landform lines vs minor detail is weak.
- Flow lines exist, but wind-direction coupling is not explicit enough as a readable grammar element.
- Secondary patterns currently mix multiple families (hatch + stipple-like dots) instead of a constrained single-family rule.
- Moisture affects output but not yet framed as explicit density/softness grammar mapping.

## B) Visual grammar summary (from translated rules)

Terrain grammar for this phase:
- **Region-driven structure:** each sample belongs to an ecological region expression via terrain/habitat weights.
- **Pattern family assignment:** one secondary family only in this PR (hatch *or* stipple).
- **Macro + micro layering:**
  - macro field drives major contour skeleton
  - detail field drives minor contour refinement
- **Contour hierarchy:** clear major vs minor contour classes, with different spacing/thickness.
- **Flow/ribbon zones:** directional line structures biased by wind-like field vectors, with subtle curvature.
- **Controlled imperfection:** low-amplitude wobble/jitter so terrain feels organic but calm.
- **Restraint:** dark, low-contrast, supportive background (entities/UI remain primary).

## C) Implementation plan (this PR only)

### Integration points
1. `Renderer.drawTerrain()`
   - split into major/minor contour passes using existing `TerrainCell` fields
2. `Renderer.traceContourStroke()`
   - preserve organic stroke behavior, add tier-specific scaling for major/minor
3. `Renderer.drawEnvironmentalFlows()` + `traceFlowLine()`
   - increase wind-field readability via `flowTendency` directional distortion
4. `Renderer.drawTerrainMicroPatterns()`
   - keep exactly one secondary family: **hatch** (dry-zone biased)

### Subset implemented in this PR
- ✅ contour hierarchy (major + minor)
- ✅ flow/ribbon directional structure with subtle wind curvature
- ✅ one secondary pattern family (hatch only)
- ✅ field mapping:
  - moisture → line density/softness
  - wind (`flowTendency`) → directional distortion
- ✅ restrained palette tuning (dark/subtle)

### Explicitly out of scope
- no renderer architecture rewrite
- no added dependencies
- no image/texture assets
- no full multi-family terrain taxonomy/classification system
- no bright/high-contrast terrain restyle
