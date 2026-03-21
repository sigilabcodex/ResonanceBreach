# ResonanceBreach Species Notes

## Purpose

This document now reflects the first canonical species pass implemented in the garden. The goal of this pass is clarity: three species with readable behavior, distinct morphology, and a visible nutrient loop.

## Core ecological rule

Death is not treated as hard deletion. Rooted Blooms and Pollinator Drifters leave residue, Decomposers work that residue, and the returned nutrients support future bloom growth.

## Canonical species pass 01

### Rooted Bloom

**Role**
- primary rooted producer
- long-lived visual anchor for the scene
- quiet harmonic bed contributor

**Implemented behavior**
- anchors to fertile terrain and drifts only slightly around its root point
- grows through seedling, growth, mature, and decay/residue-facing stages
- accumulates pollination from Pollinator Drifter visits
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
- preferentially targets blooms needing pollination
- curves around bloom targets rather than floating randomly
- also seeks fruit and feed particles when available
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
- crawls with slow filament-like motion
- consumes residue gradually instead of deleting it instantly
- converts residue into local terrain enrichment
- can spread near productive residue patches
- declines slowly when little residue is available

**Implemented visual direction**
- branching filament glyph
- low, substrate-adjacent silhouette
- faint motion trace and branching complexity as it matures

**Implemented audio role**
- darker, quieter grouped/foreground texture
- low-Q filtered tones that sit below drifter gestures

## Ecological loop now implemented

1. Rooted Blooms establish in fertile terrain.
2. Pollinator Drifters visit blooms and raise pollination / vitality.
3. Healthy blooms produce fruit.
4. Blooms and drifters can die under poor conditions.
5. Death creates residue instead of instant removal.
6. Decomposers seek and consume residue.
7. Residue consumption enriches local nutrients.
8. Improved nutrients support later bloom growth and continued fruiting.

## Current scope limits

This pass intentionally does **not** yet introduce:
- hostile fauna or breach entities
- major UI redesign
- a larger species roster
- highly specialized predator-prey loops

## Canonical species pass 02

### Grazer

**Role**
- grounded mobile forager
- consumes bloom fruit and edible growth
- converts producer surplus into visible mortality / residue

**Implemented behavior**
- seeks persistent fruit first, then browses mature productive blooms
- loses energy and food steadily when it cannot feed
- reproduces only after sustained successful grazing
- dies into residue rather than disappearing instantly

**Implemented visual direction**
- heavier, ribbed glyph with low trail
- warm, substrate-adjacent tone distinct from drifters

**Implemented audio role**
- midrange pulses and soft body movement tones
- quiet feeding ticks and calmer starvation/death falloff
