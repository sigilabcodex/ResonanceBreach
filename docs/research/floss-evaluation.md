# FLOSS Evaluation for ResonanceBreach

## Purpose

This document evaluates a small set of FLOSS tools and external design ideas that may become relevant to ResonanceBreach later.

It does **not** recommend immediate adoption. The project is still in a foundational phase, and preserving clean internal seams matters more than adding capability quickly.

## Evaluation criteria

Each candidate is judged by:
- what problem it would solve here
- whether the same thing could be implemented internally with reasonable effort
- dependency size and conceptual weight
- API stability and long-term risk
- lock-in risk
- how easily it could sit behind an internal adapter
- whether it should be rejected, postponed, prototyped later, or adopted only for one narrow responsibility

## Project-specific assumptions

Current project direction suggests:
- simulation meaning should stay custom
- species behavior should stay custom
- audio mapping should stay custom even if synthesis helpers change
- rendering should avoid deep framework dependence unless the visual payoff is substantial
- continuous field logic is central and should not be scattered through unrelated code

## Summary recommendations

### Most promising narrow candidates
- **FastNoiseLite** — potentially useful as a narrow field-generation helper if current custom field code becomes cumbersome
- **Tone.js** — potentially useful only if Web Audio scheduling / pooling complexity becomes a clear maintenance problem
- **bitECS** — conceptually useful as a data-layout reference, but only if performance or systemic complexity later justify it

### Candidates to treat cautiously
- **Planck.js** — maybe useful for a constrained prototype branch, but likely too heavy for current motion needs
- **Yuka** — useful as a source of steering ideas more than as a dependency to adopt
- **three.js ecosystem tools** — only relevant for tightly scoped rendering or post-FX experiments, not as a general architectural direction

### Areas that should remain custom for now
- field semantics and ecological meaning
- species traits and lifecycle logic
- behavior scoring, memory, and state transitions
- world-to-sound mapping rules
- salience and attention logic

## Candidate evaluations

## FastNoiseLite

### What problem it would solve
FastNoiseLite could help with:
- layered coherent noise generation
- domain warping
- scalar field variation for terrain, fertility, flow bias, and anomaly regions
- reducing the amount of low-level noise code maintained internally

### Could we implement this ourselves?
Partially, yes.

Simple value noise, gradient noise, and hand-rolled layered fields are all feasible internally. The question is not basic possibility. The question is whether maintaining richer combinations such as warping and multiple field modes becomes distracting.

### Dependency size / conceptual weight
Relatively low. It is a focused utility rather than a worldview.

### API stability and long-term risk
Moderate to low risk, assuming usage stays narrow. Noise sampling is a stable problem domain.

### Lock-in risk
Low if isolated behind a field-sampler adapter. High only if noise types and library-specific concepts leak into gameplay rules everywhere.

### Isolation potential
Good. This is exactly the kind of dependency that can sit behind a tiny internal interface.

### Recommendation
**Consider for a future prototype branch** or **adopt later for one narrow responsibility** if the custom field stack becomes messy.

### ResonanceBreach-specific caution
Even if adopted, the meanings of the fields must remain internal. A noise library should provide raw variation, not define ecology.

## Tone.js

### What problem it would solve
Tone.js could help with:
- scheduling and timing utilities
- pooled synth graph management
- higher-level routing and envelopes
- reducing Web Audio boilerplate

### Could we implement this ourselves?
To a degree, yes. The project already has a clear audio direction centered on salience, grouping, and constrained voices. Direct Web Audio remains viable, especially while the audio model is still evolving.

### Dependency size / conceptual weight
Medium. Tone.js is not enormous by modern standards, but it does bring a distinct way of thinking about browser audio.

### API stability and long-term risk
Moderate. Tone.js has been around for a long time, which is good. But it is still a meaningful abstraction layer, and browser-audio-specific abstractions can become friction if the project wants unusual control later.

### Lock-in risk
Medium. There is a real risk that synthesis design, timing assumptions, and voice lifecycle become Tone-shaped.

### Isolation potential
Moderate if used narrowly for voice control or scheduling. Poor if it becomes the whole audio architecture.

### Recommendation
**Postpone**. If direct Web Audio becomes a maintenance burden, consider Tone.js only for **one narrow responsibility** such as scheduling or pooled voice helpers.

### ResonanceBreach-specific caution
The project's important audio layer is not synth convenience; it is world-to-sound interpretation. That interpretive layer should remain custom no matter what.

## Planck.js

### What problem it would solve
Planck.js could help with:
- rigid-body integration
- collision shapes
- contact resolution
- impulses and constraints

### Could we implement this ourselves?
For current needs, probably yes.

The project does not currently appear to need full rigid-body simulation. Soft drift, steering, inertia, and selective collision avoidance can likely be handled with simpler custom motion code for quite a while.

### Dependency size / conceptual weight
Medium to high relative to likely benefit. Physics engines bring many assumptions that may not match the project's soft ecological motion.

### API stability and long-term risk
Moderate. Physics concepts are stable, but the issue is less API churn than conceptual overreach.

### Lock-in risk
Medium. Once collision and motion semantics are written around a physics engine, it becomes harder to return to custom motion.

### Isolation potential
Possible, but only if kept to a very narrow motion subsystem.

### Recommendation
**Postpone**. At most, **consider for a future prototype branch** if the project later needs dense collisions, constraints, or richer physical interactions that clearly exceed simple custom integration.

### ResonanceBreach-specific caution
The risk is not technical impossibility. The risk is introducing a rigid-body worldview into a project whose motion may be better expressed as fields, drag, clustering, and ecological temperament.

## bitECS

### What problem it would solve
bitECS could help with:
- data-oriented storage
- cache-friendly component updates
- cleaner separation of update passes
- scaling entity counts if simulation complexity grows

### Could we implement this ourselves?
Conceptually, yes. A lighter internal approach may be sufficient:
- arrays of focused records
- subsystem-specific tables
- explicit update passes
- trait registries

A full ECS library is not the only way to get some ECS benefits.

### Dependency size / conceptual weight
Medium. bitECS is lighter than many ECS frameworks, but ECS still shapes how people think about the whole simulation.

### API stability and long-term risk
Moderate. Even if the package stays stable, adopting ECS early can create internal lock-in because it changes how every new feature is modeled.

### Lock-in risk
High conceptually, even if the runtime package is small.

### Isolation potential
Limited. ECS tends to become a foundational architecture rather than a leaf dependency.

### Recommendation
**Postpone**, but keep **ECS-like ideas conceptually in mind**. If data-layout pain becomes real, prototype the storage model carefully before adding a library.

### ResonanceBreach-specific caution
The project is still clarifying world semantics. This is the wrong moment to let storage ideology outrun design clarity.

## Yuka

### What problem it would solve
Yuka could help with:
- classic steering behaviors
- target pursuit and evasion
- neighborhood interactions
- basic game-AI utilities

### Could we implement this ourselves?
Very likely yes.

Seek, flee, wander, separation, arrival, orbiting, and field bias are all straightforward enough to implement internally, especially because ResonanceBreach needs project-specific tuning rather than generic game defaults.

### Dependency size / conceptual weight
Medium. Not huge, but heavier than the likely value for current needs.

### API stability and long-term risk
Moderate. The larger issue is not churn, but fit.

### Lock-in risk
Medium. Steering code is easy to absorb into the mental model of the library that supplies it.

### Isolation potential
Fair if used purely as a reference or narrow helper, but questionable as a long-term dependency.

### Recommendation
**Reject as a default dependency for now**. Keep it as a **reference source** or possibly compare against it in a prototype branch.

### ResonanceBreach-specific caution
The project's "AI" should emerge from ecology and species temperament, not from importing a general-purpose game-agent toolbox and working backward.

## three.js ecosystem tools

### What problem they would solve
Selected three.js tools could someday help with:
- shader pipelines
- post-processing passes
- off-screen compositing
- unusual camera or lens effects
- spatial audio integration in a richer scene graph

### Could we implement this ourselves?
Some parts yes, some parts no.

Small visual treatments may be simpler to implement directly in the existing rendering stack. More advanced shader orchestration could eventually benefit from a rendering framework if experiments outgrow the current approach.

### Dependency size / conceptual weight
Potentially high. The three.js ecosystem is broad, and visual tooling can quietly drag architecture along with it.

### API stability and long-term risk
Moderate. three.js is established, but ecosystem add-ons vary in quality and long-term stability.

### Lock-in risk
High if core rendering identity shifts around the toolset.

### Isolation potential
Reasonable only if used for tightly scoped visual experimentation.

### Recommendation
**Postpone**. Consider only for **narrow rendering or post-FX prototypes** with a clear visual target.

### ResonanceBreach-specific caution
The project wants stronger perception and framing, but not at the cost of replacing a legible rendering architecture with a sprawling scene-graph dependency stack.

## External ideas worth borrowing without necessarily importing code

### Steering behaviors
Worth borrowing conceptually:
- seek / flee
- separation / cohesion
- arrival
- wandering with inertia
- orbiting

Recommendation:
- **Borrow the ideas, keep the implementation custom for now**.

### Field-based motion
Worth emphasizing more strongly in-house:
- scalar and vector field sampling
- motion as response to substrate plus local intent
- attractor / repulsor composition

Recommendation:
- **Core project direction; keep custom**.

### Data-oriented update passes
Worth borrowing conceptually:
- clearer ownership of update phases
- compact data layout where needed
- explicit system boundaries

Recommendation:
- **Conceptually useful now, library adoption postponed**.

### Event-plus-state audio architecture
Worth preserving and extending:
- continuous world-state sonification
- event accents for local spikes
- salience filtering rather than one-voice-per-entity audio

Recommendation:
- **Core direction; remain custom even if helper libraries appear later**.

## Cross-cutting conclusions by focus area

## 1. Continuous field generation / substrate logic
Most promising external help: **FastNoiseLite**, if needed.

Best current stance:
- keep field semantics custom
- keep sampler interfaces clean
- only externalize low-level noise generation if internal code becomes cluttered

## 2. Agent behavior / lightweight AI
Best current stance:
- keep behavior custom
- borrow steering ideas selectively
- avoid heavy AI libraries
- do not import generic game-agent assumptions prematurely

## 3. Physics / motion support
Best current stance:
- start with custom inertia, damping, soft collisions, and clustering
- only test a physics library if real motion requirements outgrow simple methods

## 4. Sound architecture
Best current stance:
- keep world-to-sound mapping custom
- keep direct Web Audio unless scheduling / pooling becomes painful
- evaluate Tone.js later only as a helper, not as the foundation

## 5. Rendering / perception / camera feeling
Best current stance:
- push current rendering further first
- preserve room for shader and post-FX hooks
- avoid broad rendering ecosystem commitments until the visual target is sharper

## 6. Data-oriented architecture
Best current stance:
- keep ECS-like thinking as a planning tool
- postpone ECS library adoption until scale and profiling justify it

## Final recommendation

ResonanceBreach should remain conservative.

The most valuable move right now is not choosing libraries. It is preserving seams so future choices stay reversible.

If one external helper becomes worthwhile soon, **FastNoiseLite** is the least invasive candidate because it can be confined to low-level field generation. **Tone.js** is the next plausible helper, but only if browser-audio ergonomics become a real maintenance burden. **Planck.js**, **bitECS**, **Yuka**, and broader **three.js ecosystem** adoption all look premature unless a specific prototype branch demonstrates clear need.
