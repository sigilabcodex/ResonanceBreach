# ResonanceBreach Dependency Policy

## Purpose

This policy is for the next stage of ResonanceBreach while the project is still consolidating its simulation, rendering, and audio foundations. The goal is not to ban dependencies outright. The goal is to prevent a convenience-driven stack from hardening into long-term fragility.

## Core policy

### 1. Small and focused beats large and magical
A dependency should do one narrow job well.

Good candidates:
- a compact noise library
- a small collision helper
- a narrowly scoped audio utility if browser primitives become too cumbersome

Poor candidates:
- frameworks that try to own the entire simulation model
- toolkits that bundle rendering, AI, physics, asset formats, and workflow assumptions together
- libraries that are only attractive because they hide complexity we do not yet understand

### 2. Low dependency count is a feature
Every dependency adds:
- update overhead
- compatibility risk
- conceptual surface area for future contributors
- replacement cost when project direction changes

If a feature can be written internally in a small, stable, testable module, that is often the better choice.

### 3. Maintenance history matters more than hype
A package should only be considered if it shows signs of long-term viability:
- clear documentation
- a stable API or conservative release pattern
- understandable source code
- evidence that it can survive a quiet period without becoming unusable

Fast-moving ecosystem excitement is not a reason to adopt a dependency.

### 4. Every dependency must own one narrow responsibility
A package should not enter the project unless its responsibility can be described in one sentence.

Examples:
- "sample coherent noise fields"
- "resolve 2D rigid-body collisions"
- "provide a data-oriented storage layout"

If the description becomes "manage our entity model, motion, rendering assumptions, and interactions," the package is too invasive.

### 5. External tools should sit behind internal interfaces
Where possible, dependencies should be hidden behind small internal adapters.

Important future seams:
- field sampling
- motion / collision resolution
- agent behavior primitives
- audio mapping / voice control
- rendering post-processing hooks

This keeps the project free to replace a library later without rewriting world logic.

### 6. Prefer custom code when the custom code is short and stable
We should prefer internal implementation when the problem is:
- mathematically simple
- domain-specific to ResonanceBreach
- small enough to explain in one file or a few focused modules
- unlikely to need heavy external optimization

Examples likely worth keeping custom for now:
- steering combinations
- sensing and local memory rules
- species behavior policies
- state-to-sound mapping rules
- salience scoring

### 7. Do not add dependencies for one isolated convenience
If a package only saves a small amount of code in one place, it is probably not worth the long-term cost.

Typical anti-patterns:
- adding a full physics engine for a few soft collisions
- adding an ECS library before entity counts or data-layout pain justify it
- adding a large audio framework just to simplify a handful of synth nodes

### 8. Avoid stack fragmentation
ResonanceBreach should not become a pile of unrelated mini-ecosystems.

We should avoid situations where:
- AI logic follows one framework's worldview
- physics follows another
- audio follows a third
- rendering assumes a fourth

Subsystems can be separate without each being outsourced to a different ideology.

### 9. Postponement is a valid decision
A tool can be interesting without being appropriate now.

Default stance for this stage:
- document promising options
- preserve seams
- prototype later only when a real bottleneck appears
- avoid premature adoption during foundational restructuring

## Practical acceptance checklist

Before adopting any new dependency, the answer to most of these should be "yes":

- Does it solve a recurring problem rather than a one-off annoyance?
- Would the internal version be meaningfully harder to maintain?
- Can it be isolated behind an adapter?
- Can we replace it later without rewriting the whole project?
- Is its API understandable without adopting the library's worldview everywhere?
- Does it reduce risk more than it adds risk?
- Would we still choose it if we expected to keep this project alive for at least five years?

## Practical rejection signals

A dependency should usually be rejected or postponed if:
- it encourages architecture-first adoption before the problem exists
- it pulls the project toward a large framework stack
- it is mainly justified by trendiness or tutorial popularity
- it is difficult to inspect or reason about locally
- its responsibility overlaps too much with code we already control cleanly
- removing it later would be painful

## Current strategic stance

For the near term, ResonanceBreach should stay conservative:
- keep simulation rules, behavior logic, and world semantics custom
- consider small helper libraries only where they remove low-level math or browser API friction
- postpone broad framework adoption until actual scale or complexity demands it
- preserve internal seams now so later experimentation stays cheap
