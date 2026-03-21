# Controlled performance optimization pass

## Observed bottlenecks

1. **Terrain sampling was regenerated on every fixed simulation step.**
   The terrain sample set is used for rendering and audio summaries, but it was being rebuilt every `Simulation.update()` even though its motion is slow and does not drive entity behavior directly.

2. **Repeated local-neighborhood scans were fully linear.**
   Entity neighbor checks, food lookups, bloom targeting, and residue targeting/influence repeatedly scanned full collections inside per-entity update paths.

3. **Rendering work continued for off-screen content.**
   Terrain contours/flows, fields, bursts, residues, auras, and entity trails were still traced even when their wrapped positions were well outside the canvas.

## Changes made

- Added a toggleable debug overlay with FPS, frame time, simulation steps, entity count, update time, render time, and draw-call estimate.
- Added keyboard toggle support for the debug overlay (`F3` or `` ` ``), while preserving the existing settings toggle.
- Throttled terrain sample regeneration to 15 Hz, which preserves the same visual style while removing unnecessary per-step CPU work.
- Added lightweight spatial buckets for entities, particles, and residues so hot local queries only inspect nearby buckets instead of whole collections.
- Added render-time visibility culling for world-space elements and accumulated a draw-call estimate for the overlay.
- Removed an avoidable temporary `waterCells` allocation in audio salience summarization.

## Expected impact

- Lower CPU time in the simulation/update path during dense scenes.
- More stable frame pacing because expensive terrain refreshes no longer happen every fixed step.
- Lower render-thread overhead from skipping off-screen geometry and trails.
- Better visibility into update vs render costs for future tuning.

## Suggested next steps

- Profile `WorldFieldModel.sample()` directly; if it dominates frame time, consider a small per-step sample cache keyed by quantized world positions.
- If entity counts grow beyond current design targets, replace the remaining array-returning neighbor helpers with count/iterator variants to cut allocations further.
- If terrain still dominates rendering on low-end CPUs, consider prebuilding static `Path2D` batches per terrain refresh and only retracing animated overlays.
