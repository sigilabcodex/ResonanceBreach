# PR #52 — Camera, Zoom, and Large-World Perception Design Note

## Inspection summary (before coding)

### Current camera/zoom behavior
- Camera zoom is currently multiplicative per wheel event with a linear wheel mapping: `newZoom = currentZoom * (1 - deltaY * CAMERA_ZOOM_SPEED)` and then clamped between `CAMERA_MIN_ZOOM` and `CAMERA_MAX_ZOOM`. This effectively creates coarse wheel behavior at far ranges and fragile response spikes on large wheel deltas.
- Camera smoothing is already present (`CAMERA_SMOOTHING`), but zoom semantics are still a single-range linear-like control surface and do not explicitly model multi-scale traversal.
- World projection scale is `max(viewWidth/WORLD_WIDTH, viewHeight/WORLD_HEIGHT) * zoom`, with toroidal wrapping in both axes.

### World coordinate / scale constraints
- World extent is currently `3600 x 2400`, which limits macro-scale separation of clusters and contributes to repeated feeling under wrap.
- Terrain sample layout is fixed (`TERRAIN_SAMPLE_COLS = 22`, `TERRAIN_SAMPLE_ROWS = 14`), so macro geography has relatively low structural room when world size is constrained.

### Terrain + readability + artifacts
- Terrain rendering already has major/minor contour strokes and micro patterns, but at far zoom there is still a lot of medium-frequency information competing for attention.
- The backdrop is atmospheric, but the world plane does not strongly communicate depth anchoring (reads as floating in places).
- Existing contour hierarchy is present but can be strengthened so major structures remain legible when zoomed out.

### Entity rendering / density handling
- Entities are always drawn with full shape logic once visible. There is no explicit zoom-dependent entity LOD stage that swaps to lower-cost/far-readable marks.
- Motion trails can contribute visual clutter at far zoom.

## Problems to solve in this PR
1. Zoom curve lacks explicit multi-scale control and deep-inspection + macro-overview behavior.
2. Effective world scale is limited and wrapped repetition becomes perceptible.
3. Missing zoom-aware LOD strategy for terrain detail and entity complexity.
4. Weak anchoring cues for “grounded terrain” perception.

## Proposed multi-scale camera approach
- Move wheel zoom math to an exponential/log-style model (`zoom *= exp(-deltaY * sensitivity)`) to make zoom progression smoother and consistent across scales.
- Expand zoom range to support deeper close inspection and broader far overview.
- Keep pointer-anchored zoom centering and smoothing so interaction feel remains stable.
- Introduce zoom bands:
  - **Far**: suppress micro detail, simplify entities, highlight macro contour / large structures.
  - **Mid**: balanced contour + region readability.
  - **Close**: full entity detail and micro terrain expression.

## What this PR will implement
- Exponential zoom wheel mapping with safer behavior on large deltas.
- Wider zoom envelope for both close and far exploration.
- Increased world dimensions to improve perceived scale and reduce repetition pressure.
- Basic LOD in renderer for entity simplification and terrain detail balancing by zoom.
- Stronger terrain hierarchy and subtle world-space anchoring cues (gradient/shading emphasis).

## Out of scope
- Infinite/chunk streaming.
- Full renderer architecture rewrite.
- Heavy lighting/shadow pipelines.
- Fundamental terrain-system redesign.
