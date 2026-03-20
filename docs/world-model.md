# World model

## Overview

The world now uses a wrapped "bubble surface" topology instead of a boxed tank. Internally it is toroidal: positions, camera movement, tool placement, particles, and ecology sampling all wrap on both axes. The important presentation goal is not to show a looping tile, but to make the space feel like one large continuous surface.

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

Topography is continuous and sampled procedurally from layered low-frequency noise.

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

The terrain pass intentionally avoids a visible grid.

### Visual direction

- soft gradients for broad regions
- low-contrast contour/isoline rings
- sparse vector-like flow strands
- muted gray-blue / gray-green accents
- no flashing or high-frequency patterns

### Stability goals

To keep motion calm and readable:

- sample anchors are stable rather than jittering each frame
- contour wobble is very low amplitude and low frequency
- background structure uses thin low-contrast lines
- camera movement interpolates across wrapped space using shortest-path deltas
- focus visualization dims the outside while gently clarifying the interior

## Focus tool behavior

The observe tool is treated more like a microscope aperture:

- the outside world is dimmed
- the inside of the focus circle is clearer and slightly brighter
- subtle ring detail reinforces the inspection zone without redesigning the tool

## Scope notes

This pass is intentionally limited to world topology, environmental forces, topography, and calmer rendering. It preserves the current entity ecosystem/tools/audio foundation while making the world feel larger, softer, and more continuous.
