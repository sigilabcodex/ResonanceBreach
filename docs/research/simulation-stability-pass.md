# Simulation Stability Pass

## Main bottlenecks found

- **Terrain modifier growth was the largest time-growth risk.** `seedTerrain()` could create many overlapping modifiers from healthy plants, decomposers, and grow fields, while every field sample walked the modifier list. That makes update cost grow with session length instead of with visible entity count.
- **Target acquisition work was happening too often.** Pollinators, grazers, and decomposers could rescan nearby buckets every simulation step even when they already had a valid target.
- **Field sampling was repeated heavily inside a single step.** The same world positions were sampled multiple times for movement, ecology scoring, terrain samples, and attention work.
- **Fixed-step recovery had no safety rail.** When update cost spiked, the frame loop could keep stacking simulation steps and spiral into long catch-up frames.
- **Attention diagnostics were too shallow.** The existing overlay did not expose transient counts, query pressure, or whether the sim was dropping time to stay responsive.

## What was fixed

- Added **simulation diagnostics** for species timings, query counts, transient counts, target reuse/retarget activity, terrain modifier pressure, and hotspot summaries.
- Added **safe fixed-step recovery** in the app loop:
  - max sim steps per frame
  - accumulated lag clamp
  - dropped-time tracking
  - capped-step indicator in the debug overlay
- Switched terrain modifiers to **bucketed local queries** and **nearby merge/reuse** so repeated seeding does not grow the active modifier list as aggressively.
- Added **per-step field sample memoization** so repeated calls at the same position do not recompute the entire field stack.
- Added **target reuse windows** for pollinators, grazers, and decomposers so they keep valid local targets briefly instead of fully rescanning every step.
- Reduced a few avoidable costs:
  - only compute nearby food or residue influence for species that actually use it
  - avoid repeated `additions.filter(...)` scans during spawning
  - decimate expensive attention-related related-entity refreshes

## Future work

- If update time still climbs under extreme interaction spam, the next likely candidate is a **shared spatial query cache** for more ecology systems.
- The current diagnostics are intentionally compact; a deeper pass could add **rolling averages and per-system min/max history**.
- Audio is now timed in the overlay, but if it becomes material in live sessions we should split out **foreground scoring vs event synthesis** as separate counters.
