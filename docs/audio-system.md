# ResonanceBreach Audio System

## Goal

The audio system should feel ecological, perceptual, and musically coherent. It should summarize the world, not narrate every particle or entity literally.

## Core constraints

- **Perceptual filtering:** not every organism deserves an isolated voice.
- **Grouped voices:** distant or low-salience activity should collapse into shared layers.
- **Salience-based foreground:** only the most important local activity should surface as detail.
- **Harmonic coherence:** the world should sit inside a constrained tonal language.
- **Focus isolation:** the focus tool should clarify a local pocket and reduce wider clutter.

## Current layering direction

### 1. Ambient bed
A quiet continuous layer that tracks overall ecological stability and world mood.

### 2. Plant / field layer
A grouped harmonic layer for rooted life and nutrient-rich zones.

### 3. Creature layer
A capped foreground layer for the most active non-plant entities near the player context.

### 4. Event layer
Short transient sounds driven by typed world events such as feeding, births, deaths, residue creation, and tool use.

## Salience model

Near-term salience should consider:

- camera distance
- focus-circle inclusion
- organism activity
- species role
- ecological rarity
- immediate interaction relevance

This keeps the audible scene readable even as the ecosystem grows.

## Harmonic approach

The garden should prefer a stable harmonic palette with small shifts based on nutrients, growth, focus, and tension.

Suggested mapping:

- **rooted bloom:** low, stable, consonant tones
- **pollinator drifter:** short bright gestures and fluttering motion
- **decomposer:** muted, textural, granular, or filtered tones
- **later grazer:** midrange pulse or soft motif
- **later predator:** sparse tension-bearing accents

## Focus tool behavior

When focus is active:

- local detail becomes brighter and clearer
- grouped outer layers are damped or filtered
- the foreground should feel more isolated, not louder in every band

## Future work

1. Separate harmony and salience logic into dedicated modules.
2. Add biome grouping so water, fertile zones, and dense terrain have clearer shared identities.
3. Introduce decomposer and residue textures.
4. Add bubble/breach anomaly voicing without abandoning perceptual restraint.
