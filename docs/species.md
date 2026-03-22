# ResonanceBreach Species Notes

## Purpose

This document reflects the current canonical ecology pass. The goal is clarity: readable species roles, a visible nutrient loop, and habitat specialization that makes terrain matter.

## Core ecological rule

Death is not treated as hard deletion. Rooted Blooms and mobile life leave residue, Decomposers work that residue, and returned nutrients support future bloom growth.

## Habitat specialization rules

The world now exposes three explicit habitat tendencies derived from the continuous field.

- **Wetland / water zones** — moisture-rich, calmer, more fluid terrain.
- **Highlands / ridges** — elevated, tighter, more difficult terrain.
- **Fertile basins / lowlands** — low, favorable, nutrient-rich growth pockets.

Species do not read habitat as a hard tile type. They read blended habitat weights, so transitions stay natural and future species can reuse the same hooks.

## Canonical species pass 01

### Rooted Bloom

**Role**
- primary rooted producer
- long-lived visual anchor for the scene
- quiet harmonic bed contributor

**Implemented behavior**
- anchors to basin-friendly fertile terrain and drifts only slightly around its root point
- grows through seedling, growth, mature, and decay/residue-facing stages
- accumulates pollination from Pollinator Drifter visits
- gains its best growth, fruiting, and local enrichment in fertile basins
- tolerates some wet support but dislikes harsh highland pressure
- emits gentle local fertility support when healthy
- fruits when mature, pollinated, and energetically stable
- decays into residue when conditions stay poor

**Implemented visual direction**
- rooted base with split lower strokes
- central stem / axis
- crown nodes that become more complex with maturity
- optional halo / fruit cue when pollinated or fruiting

**Implemented audio role**
- low, quiet harmonic drone layer
- stronger detail only when focused or foreground-salient

### Pollinator Drifter

**Role**
- agile mobile helper lifeform
- links blooms and fruit patches
- adds sparse bright gestures to the garden

**Implemented behavior**
- can cross most habitats, preserving open exploration
- preferentially clusters around bloom-rich basins
- uses wetland flow more readily than heavier species
- avoids dominant ridges and loses more efficiency crossing hard highland terrain
- seeks blooms needing pollination, then fruit/feed when useful
- increases bloom pollination, vitality, and growth during visits
- can reproduce after sustained successful foraging / visitation
- leaves residue when exhausted

**Implemented visual direction**
- petal / wing-like glyph silhouette
- soft dotted motion trace
- juvenile-to-mature growth adds stronger wing structure

**Implemented audio role**
- upper-register sparse voices and event chirps
- grouped at distance, clearer when near camera or inside focus

### Decomposer

**Role**
- low-profile recycler species
- closes the residue-to-nutrient part of the loop
- supplies subtle textural audio mass

**Implemented behavior**
- seeks nearby residue rather than free-roaming broadly
- prefers moist low ground and residue-rich fertile pockets
- crawls with slow filament-like motion
- consumes residue gradually instead of deleting it instantly
- converts residue into local terrain enrichment
- loses efficiency on high ridges and other hard terrain
- can spread near productive residue patches
- declines slowly when little residue is available

**Implemented visual direction**
- branching filament glyph
- low, substrate-adjacent silhouette
- faint motion trace and branching complexity as it matures

**Implemented audio role**
- darker, quieter grouped/foreground texture
- low-Q filtered tones that sit below drifter gestures

## Canonical species pass 02

### Grazer

**Role**
- grounded mobile forager
- consumes bloom fruit and edible growth
- converts producer surplus into visible mortality / residue

**Implemented behavior**
- seeks persistent fruit first, then browses mature productive blooms
- prefers fertile basins and lowland corridors where blooms gather
- avoids lingering in wet ground and pays a clearer cost crossing ridges
- reproduces only after sustained successful grazing in favorable habitat
- dies into residue rather than disappearing instantly

**Implemented visual direction**
- heavier, ribbed glyph with low trail
- warm, substrate-adjacent tone distinct from drifters

**Implemented audio role**
- midrange pulses and soft body movement tones
- quiet feeding ticks and calmer starvation/death falloff

## Ecological loop now implemented

1. Rooted Blooms establish in fertile basins.
2. Pollinator Drifters visit blooms and raise pollination / vitality.
3. Healthy blooms produce fruit.
4. Grazers and drifters convert surplus growth into movement, feeding, and mortality risk.
5. Blooms and mobile species can die under poor conditions or bad terrain fit.
6. Death creates residue instead of instant removal.
7. Decomposers seek and consume residue.
8. Residue consumption enriches wet and basin-adjacent terrain.
9. Improved nutrients support later bloom growth and continued fruiting.

## Current scope limits

This pass intentionally does **not** yet introduce:
- hostile fauna or breach entities
- major UI redesign
- a larger species roster
- highly specialized predator-prey loops
- hard biome borders or a visible world grid
