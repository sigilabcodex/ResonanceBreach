
---

## `docs/audio-system.md`

```markdown
# ResonanceBreach — Audio System

## Goal

The audio system should feel ecological, perceptual, and musical.

It should not behave like:
- one raw oscillator per entity
- constant cacophony
- flat global ambience with no spatial meaning

It should behave more like:
- an auditory ecosystem
- attention-driven hearing
- layered environmental music

---

## Design Principles

1. **Perceptual filtering**
   The player should hear what matters most, not every sound equally.

2. **Layered representation**
   Distant complexity should collapse into grouped textures.

3. **Musical coherence**
   Species and zones should share harmonic rules.

4. **Focus reveals detail**
   The focus tool should isolate and clarify local sound.

5. **Efficiency**
   Use grouped voices and pooled synth resources.

---

## Audio Layers

### Layer A — Global Bed
Very quiet, always present.

Represents:
- world mood
- global ecological stability
- large-scale environmental tone

Examples:
- soft filtered drone
- slow harmonic wash
- almost subliminal air/water texture

---

### Layer B — Zone / Biome Voices
One voice per meaningful zone or cluster.

Examples:
- plant field drone
- water/current texture
- fertile region shimmer
- dense terrain muffled resonance

These are not individual creature voices.

---

### Layer C — Salient Agents
Only a small number of individual entities get foreground sound.

Candidates:
- nearest visible organisms
- focused organisms
- rare entities
- predators
- mating/reproduction events
- feeding events

---

### Layer D — Events
Short sounds for:
- feeding
- pollination
- reproduction
- death
- residue creation
- tool usage
- future breach anomalies

---

## Salience System

Each potential sound source receives a score.

### Suggested factors

- distance to camera
- inside focus circle
- species importance
- rarity
- current activity
- interaction relevance
- danger / anomaly level

### Result
Only the highest-scoring sources become foreground voices.

All others are:
- grouped
- heavily filtered
- attenuated
- ignored

---

## Grouping Rules

### Example: flock of pollinators
When close:
- some individual flutter/chirp sounds

When far:
- grouped as one fluttering texture or rhythmic cluster

### Example: plant patch
When close:
- subtle layered tones, maybe individual detail

When far:
- one soft harmonic drone

This mimics real-world perception.

---

## Harmonic Coherence

The garden should operate within a constrained harmonic world.

### Recommended approach
Use a scale or modal set per world state or biome.

Examples:
- calm garden: suspended or pentatonic palette
- watery zone: wider intervals and more open spacing
- dense/soil-rich zone: lower clustered tones
- future anomaly zones: detuned or altered subset

### Species mapping

- rooted plants:
  long tones, roots, fifths, open consonances

- pollinators:
  short upper tones, chirps, flutter fragments

- grazers:
  midrange pulses, softer repeated motifs

- predators:
  sparse, low or tension-bearing tones

- decomposers:
  granular, quiet, close-to-noise textures

---

## Distance Behavior

Distance should affect more than volume.

### When far away:
- sources merge
- transients soften
- harmony averages out
- fine detail disappears

### When close:
- texture separates
- individual gestures emerge
- micro-rhythms become audible

---

## Focus Tool Audio Behavior

The focus tool should function like a microscope.

### Inside focus:
- louder
- brighter
- more detailed
- less grouped

### Outside focus:
- dimmed
- low-pass filtered
- quieter
- more merged into ambience

---

## Performance Strategy

Avoid:
- hundreds of simultaneous WebAudio voices

Prefer:
- pooled synths
- grouped renderers
- capped foreground voices
- event-based transient synthesis
- low-rate control updates where possible

---

## Near-Term Implementation Goals

1. Create `audioEngine.ts`
2. Create salience scoring
3. Create grouped biome voices
4. Create a constrained harmony module
5. Make focus tool isolate audio correctly
