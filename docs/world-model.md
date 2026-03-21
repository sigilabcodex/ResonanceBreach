# World model

## Overview

The world uses a wrapped "bubble surface" topology instead of a boxed tank. Internally it is toroidal: positions, camera movement, tool placement, particles, ecology sampling, and audio salience all wrap on both axes. The important presentation goal is not to show a looping tile, but to make the space feel like one large continuous surface that extends past the viewport.

## Wrapped / bubble topology

- The simulation stores world dimensions as a wrapped space.
- All major position systems use wrapped coordinates:
  - entity motion
  - particle drift
  - tool fields
  - attractors
  - camera pan / zoom anchoring
  - terrain and residue influence sampling
- Distance checks use shortest wrapped deltas so interactions across a seam behave like local neighbors.
- Rendering also resolves objects relative to the camera using wrapped deltas. This keeps the seam visually unobtrusive even when the camera is near an edge.

## Flow fields and attractors

Large-scale motion now comes from world fields instead of edge pressure.

### Flow fields

The procedural field sampler generates slow low-frequency currents from:

- basin/moisture structure
- height and roughness
- global drift terms
- slowly evolving angular flow

This produces broad currents that move water regions more strongly, fertile regions more gently, dense regions only slightly, and solid regions barely at all.

### Attractors

Attractors are long-radius centers with two components:

- inward pull
- tangential orbital drift

They move slowly over time and are also wrapped, so entities can orbit and re-encounter the same broad structures naturally without hitting a wall.

## Topography layers

Topography is continuous and sampled procedurally from layered low-frequency fields with warping. The direction for this pass is deliberately non-cellular: no repeated circular substrate, no visible tile rhythm, and no regular wallpaper-like patterning.

### Regions

- **Water**: strongest current transport and open drifting space.
- **Fertile**: calmer movement with stronger nutrient support.
- **Dense**: resistant regions that damp velocity and act like ecological thickets.
- **Solid**: impassable or highly resistant ridges/plates with minimal flow.

### Ecological effects

- Water improves large-scale transport.
- Fertile regions support growth, nutrients, and fruiting.
- Dense regions slow moving organisms and increase resistance.
- Solid regions suppress movement and reduce stability/energy.
- Residues and grow/disrupt tools continue to modify terrain locally.

## Rendering principles for terrain

The terrain pass intentionally avoids a visible grid and avoids presenting the world as a centered bright rectangle.

### Visual direction

- soft gradients for broad regions
- sparse low-contrast contour/isoline fragments
- warped flow bands and irregular patches
- muted gray-blue / gray-green accents
- no flashing or high-frequency patterns
- camera framing fills the viewport so the world reads as continuous rather than as a bounded field

### Stability goals

To keep motion calm and readable:

- sample anchors are stable rather than jittering each frame
- contour wobble is very low amplitude and low frequency
- background structure uses thin low-contrast lines
- camera movement interpolates across wrapped space using shortest-path deltas
- focus visualization dims and muffles the outside while brightening and clarifying the interior

## Focus tool behavior

The observe tool is treated like a microscope or magnifying lens:

- outside the circle:
  - dimmer
  - less visually assertive
  - lower-detail
  - more muffled in audio
- inside the circle:
  - brighter
  - clearer
  - more detailed
  - more audible

The intended perception is selective attention, not inversion. The focus effect should obviously privilege the interior and subdue the exterior.

## Early ecological viability goals

This tuning pass is intentionally conservative: it does not add new ecological systems or rewrite species roles. Instead it improves the opening state so the world feels inhabited for longer before scarcity emerges.

Current viability goals:

- higher starting nutrients in fertile and water-adjacent zones
- slightly stronger initial food / energy reserves for lifeforms
- gentler early starvation pressure
- better rooted-life establishment in fertile terrain
- enough nearby audible activity to make the opening state feel alive without becoming cacophonous

## Scope notes

This pass is intentionally limited to world topology, environmental forces, topography, focus presentation, early viability, and restrained audio legibility. It preserves the current entity ecosystem/tools/audio foundation while making the world feel larger, softer, calmer, and more inhabited.
