# Agent Behavior Blueprint

## Purpose

This document sketches a conservative path from "things that spawn and die" toward entities that seem to inhabit the world.

"AI" here does **not** mean heavy machine learning, large planning systems, or conventional enemy stacks. It means lightweight behavioral intelligence built from local sensing, short memory, stable tendencies, and simple state transitions.

The aim is to produce entities that feel situated in the ResonanceBreach world:
- aware of nearby conditions
- shaped by substrate and flow
- different by species
- capable of recurring habits
- readable in motion, sound, and lifecycle

## Design stance

Behavior should remain:
- local rather than globally omniscient
- mostly deterministic with limited noise
- cheap enough to run on many entities
- explainable during debugging
- expressive through composition of small rules

A good result is not "smart enemies." A good result is a world where entities appear to belong where they are.

## Core behavioral model

Each entity can be thought of as combining five layers:

1. **Traits** — persistent species and individual tendencies.
2. **Perception** — what the entity can currently sense nearby.
3. **Memory** — what it briefly remembers.
4. **State** — what mode it is currently in.
5. **Intent** — what it is trying to do this moment.

This keeps behavior understandable without requiring deep planners.

## 1. Traits

Traits should define long-lived tendencies rather than fully scripted behavior.

Examples:
- preferred terrain or field ranges
- attraction to blooms, residue, fruit, crowds, or emptiness
- comfort with flow strength
- fear threshold
- curiosity level
- persistence before giving up on a target
- reproduction caution
- turn responsiveness
- tolerance for crowding

### Species differentiation
Species should differ primarily through trait profiles and state priorities, not completely separate AI architectures.

Examples:
- **Rooted Bloom**: no roaming, strong fertility preference, low event responsiveness, high local persistence
- **Pollinator Drifter**: attraction to blooms and fruit, moderate flock tendency, curiosity toward novelty, quick retargeting
- **Decomposer**: attraction to residue and low-energy zones, low urgency, comfort in dense regions, weak social interest
- **Later Grazer**: stronger feeding drive, avoidance of threat signatures, more persistent pursuit of food
- **Later Predator or hazard-like entity**: sparse, deliberate, stronger directional sensing, larger caution radius from counter-threats

This approach supports many species classes without requiring many bespoke systems.

## 2. Perception

Perception should stay simple, local, and intentionally partial.

### Recommended sensing channels

#### Radius-based neighborhood sensing
Useful for detecting:
- nearby entities
- fruit / residue / feed particles
- attractors or hazards
- crowd density

This should be the default sensing mode because it is cheap and robust.

#### Directional sensing
Some species should care not just that something exists, but where it is.

Useful forms:
- front-biased awareness cone
- stronger weighting for the current heading
- weaker awareness behind the entity

This is helpful for:
- pursuit
- fleeing
- keeping motion from feeling omnidirectional and robotic

#### Environmental sampling
Entities should also sense the substrate they inhabit.

Useful sampled values:
- terrain resistance
- fertility / nutrient richness
- local flow direction
- instability or anomaly intensity
- local occlusion or density estimate

#### Event sensitivity
Entities may briefly respond to recent disturbances such as:
- nearby feeding
- death / residue creation
- tool pulses
- sudden local crowding

This can be modeled as temporary stimulus spikes rather than a general event bus dependency inside every behavior rule.

### What to avoid
Avoid giving every entity perfect knowledge of the whole world, explicit pathfinding over the whole map, or high-cost line-of-sight systems unless the project later proves they are necessary.

## 3. Memory

Short-term memory is one of the cheapest ways to make entities feel intentional.

### Useful memory types

#### Last interesting target
Examples:
- last fruit patch
- last residue source
- last safe fertile pocket
- last threat location

#### Recent success or failure
Examples:
- recently fed here
- recently found nothing here
- recently got disrupted here

#### State dwell time
Track how long the entity has been:
- wandering
- feeding
- fleeing
- resting
- searching

This helps prevent twitchy state switching.

### Memory rules
Memory should:
- decay over time
- be local and approximate
- store only a few salient facts
- bias behavior rather than dictate it absolutely

### Why this matters
Without memory, entities tend to look reactive but shallow. With a small memory model, they can appear to revisit, avoid, hesitate, or commit.

## 4. State logic

A full behavior tree is probably unnecessary at this stage. A small state machine with weighted transitions is more appropriate.

### Suggested base states
- **idle drift**
- **searching**
- **approaching**
- **feeding / harvesting**
- **avoiding / fleeing**
- **resting / settling**
- **reproducing / spawning**
- **declining / dying**

Rooted species may use a reduced version of this set.

### Transition principles
State changes should be driven by:
- local perception thresholds
- energy or vitality bands
- recent memory
- species traits
- minimum dwell times

This means a pollinator might shift from searching to approaching when bloom signals exceed a threshold, but only after a minimum search duration. A grazer might flee when threat exceeds comfort, but calm down gradually instead of snapping instantly back to feeding.

### Why not pure randomness
Randomness is useful for variation, but state logic should still be interpretable. If behavior cannot be explained in a sentence, tuning will become painful.

## 5. Intent and steering

Behavior output should be low-level intent, not direct teleport-like control.

### Suggested steering primitives
- seek target
- flee target
- wander with inertia
- align loosely with nearby motion
- separate from crowding
- orbit a source
- slow near destination
- bias along or against flow
- anchor to a home radius

These can be blended with species-specific weights.

### Attraction / repulsion as the default language
A large amount of believable behavior can be expressed as weighted attraction and repulsion toward:
- food
- residue
- blooms
- kin
- crowding
- hazards
- strong flow
- hostile signatures
- player interventions

This matches the project's field-oriented worldview and keeps the implementation conceptually consistent.

### Keep steering separate from locomotion
Intent should describe desired motion; the motion system should decide how velocity and collisions are resolved.

## 6. Environmental response

Entities should visibly respond to the world, not just to other entities.

Useful responses:
- slowing in dense or resistant terrain
- preferring calmer fertile pockets for feeding or spawning
- riding strong flow when lightweight
- resisting flow when rooted or heavy
- avoiding high-instability regions unless species-specific traits say otherwise

This is important because ResonanceBreach is not just an entity sandbox. The substrate itself is part of the drama.

## 7. Species-specific tendencies

Species should feel different even before complex mechanics exist.

### Rooted Bloom
- senses local fertility and crowding
- remembers recent stress and nourishment
- shifts between dormancy, growth, fruiting, and decline
- reacts strongly to stable favorable ground, weakly to distant stimuli

### Pollinator Drifter
- senses blooms, fruit, light crowding, and local flow
- remembers recently rewarding patches
- alternates between drift, inspect, feed, and regroup states
- should feel curious rather than militaristic

### Decomposer
- senses residue density, decay zones, and lower-competition spaces
- remembers productive residue sites longer than other species
- moves slowly, with persistence and little social response
- should make dead matter feel ecologically inhabited rather than deleted

### Later Grazer
- senses food, crowd pressure, and threat cues
- remembers feeding patches and recent danger
- alternates between roaming, grazing, evasive retreat, and reproduction preparation
- should add pressure without turning the simulation into constant pursuit

### Future hostile or risk entities
If later hostile forms appear, they should still obey the same ecology-first framework.

They may differ by:
- larger sensing radius
- stronger directional commitment
- longer memory for prey or disturbance
- stronger repulsion effects on other species
- more salient audio / rendering cues

But they should still remain:
- low in count
- easy to read
- ecologically situated rather than purely gamey antagonists

## 8. Lifecycle persistence

To feel inhabited, entities should not seem to reset their personality every frame.

Useful persistent properties:
- age
- energy / vitality
- recent nourishment
- stress accumulation
- home affinity or birthplace bias
- species trait offsets
- memory residues from recent success or danger

This persistence matters more than adding complex decision logic.

## 9. Suggested implementation direction later

Not for this pass, but for future evolution, the safest order is:

1. Add species trait profiles.
2. Add perception summaries per entity.
3. Add a tiny short-term memory structure.
4. Introduce a small explicit activity-state layer.
5. Refactor movement to consume intent vectors rather than ad hoc impulses.
6. Only then evaluate whether any helper library is necessary.

This order keeps the project's behavior model understandable and preserves the option to stay custom.

## 10. External tool stance

### Yuka
Potential value:
- reusable steering primitives
- neighborhood and target behaviors

Concerns:
- conceptual weight may exceed actual needs
- the project likely only needs a subset of classic steering behaviors
- a custom set of seek / flee / wander / separation rules may be clearer and easier to tune

Recommendation:
- **Postpone**. Consider only as a reference or prototype-branch comparison, not a default dependency.

### ECS-style AI patterns
Potential value:
- clearer separation of perception, memory, and action updates

Concerns:
- architectural pressure before scale demands it
- can distract from the actual behavior vocabulary

Recommendation:
- **Conceptually useful, implementation postponed**.

## 11. What should remain custom for now

These areas are likely core project identity and should stay internal unless real evidence suggests otherwise:
- species trait definitions
- perception scoring rules
- local memory model
- activity state transitions
- attraction / repulsion weighting
- ecological meaning of danger, nourishment, and comfort
- mapping from behavior to audio salience and visual character

## Closing direction

The next stage of behavioral intelligence in ResonanceBreach should not chase sophistication for its own sake. It should make entities appear locally aware, temperamentally distinct, and ecologically placed.

If the world can produce the feeling that creatures inhabit currents, remember useful places, avoid disruption, gather where conditions suit them, and leave traces that matter, then the system will already have crossed an important threshold from prototype motion to believable presence.
