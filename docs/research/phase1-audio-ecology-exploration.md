# Phase 1 Audio Ecology Exploration Notes

## Repository understanding snapshot (pre-implementation)

### What is currently working
- **Audio architecture:** `AudioEngine` runs a layered, pooled WebAudio graph with a global bed, 4 grouped ecological voices, 3 foreground voices, and transient event tones. The graph is mostly static after startup and updated via parameter smoothing each frame.
- **Entity update loop:** `Simulation.update()` runs a fixed pipeline of field updates, entity behavior updates (`applyEntityBehavior` -> species-specific handlers), stat aggregation, and event queue draining.
- **How sound is generated now:**
  - Continuous layers are driven from `snapshot` state (`updateGlobalBed`, `updateEcologicalVoices`, `updateForegroundVoices`).
  - Event sounds are emitted from world events (`entityFed`, `entityDied`, `fruitCreated`, etc.) in `processEvents()`.
- **Current trigger model:** mostly indirect; entities trigger sim events, audio reacts to events + salience polling.
- **Roles/states/lifecycle already present:**
  - Entity role by species/type (`plant`, `flocker`, `grazer`, `cluster`, etc.).
  - Lifecycle stages (`birth`, `growth`, `mature`, `decay`).
  - Visual/behavioral activity state (`idle`, `feeding`, `reproducing`, `dying`).
  - ATTENTION model supports selected entity or region with related entities.

### Gaps relative to this Phase 1 prompt
- **Perceptual attenuation:** distance and zoom influence salience, but no explicit medium-like frequency-dependent attenuation curve tied to listener perception.
- **Selection identity response:** selecting an entity changes salience/focus but does not emit a contextual, procedural acknowledgement phrase.
- **Phrase agents:** no phrase-based melodic agents with play/pause/listen/adapt cycle exist.
- **Polyphony density control:** foreground voices are capped, but no explicit global voice allocator across priorities (selected/nearby/phrases/texture).
- **Background atmosphere:** current bed is oscillator-driven and fairly continuous; lacks breathing pulse/silence/noise texture emphasis.
- **Predator acoustic sensitivity:** predator behavior currently short-circuits to near-inactive placeholder and does not respond to acoustic patterns.
- **Sound as behavior:** many sonic events are emitted from hard event hooks; no explicit silence-valid, probabilistic emission layer per entity.
