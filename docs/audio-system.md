# ResonanceBreach Audio System

## Goal

The audio system should feel like an ecological listening model instead of a literal one-sound-per-entity simulation. The player should hear a quiet world bed, a few grouped zone textures, a tightly capped foreground, and event-driven accents that remain harmonically coherent.

## Implemented layer stack

### 1. Global bed

A very quiet always-on layer summarizes the whole garden state.

- two low-cost oscillators provide the stable foundation
- pitch follows the current harmony root and mode
- filter motion follows stability, harmony, growth, and threat
- the bed now stays reliably audible at normal listening levels so the world rarely drops toward near-silence
- the bed ducks only slightly when ATTENTION is emphasizing an entity or region, preserving environmental continuity

### 2. Grouped zone / cluster voices

Low-salience entities are collapsed into composite zone summaries instead of getting individual synths.

The pooled ecological roles are now tuned as a clearer ensemble rather than a generic grouped layer.

- **Bloom / rooted life:** warm sustained low-register harmonic ground
- **Pollinator / drifter:** light upper-register motion with delicate fragment-like emphasis
- **Grazer:** bodily midrange pulse with soft rhythmic weight
- **Decay / decomposer:** subtle textural bed that implies transformation without dominating
- only the strongest grouped roles are rendered at once using the existing pooled voices
- distance and zoom still soften or merge detail, but grouped voices remain musically legible at normal listening levels

### 3. Foreground salient voices

Only a small number of entities are allowed to speak individually.

- the foreground voice pool is capped at **3**
- candidates are scored every update
- only scores above the foreground threshold are eligible
- ATTENTION now gives more detail, brightness, and level to focused entities or regions without hard-muting the rest of the garden
- all remaining activity is grouped, attenuated, or omitted

### 4. Event sounds

Short transient sounds are driven by the world event layer.

Supported event types:

- `entityFed`
- `entityDied`
- `residueCreated`
- `toolUsed`

The audio engine keeps light ATTENTION feedback so selection changes feel intentional without becoming noisy.

## Salience model

Foreground selection is explicit and efficient. Each entity gets a salience score using:

- **distance to camera** via camera closeness within a hearing radius
- **attention inclusion** and proximity to the selected entity or listening region
- **current activity** from the sim state
- **species importance** using fixed per-type importance weights
- **ecological importance** from growth, resonance, harmony, and energy
- **interaction relevance** from visual state and pulse
- **event priority** from recent event-driven salience bumps

### Resulting behavior

- nearby, active, rare, or recently involved entities rise into the foreground
- the selected entity becomes dominant while nearby related organisms stay present
- entities inside a selected region are clarified while the outside world shifts toward ambience
- event-linked entities temporarily become more likely to surface

## Harmony system

The garden now uses a small explicit tonal vocabulary.

### Mode selection

The harmony module chooses one of a few constrained pentatonic-style modes based on garden state. The current ecological pass aims to make these states easier to hear:

- `ionianPentatonic`
- `suspendedPentatonic`
- `dorianPentatonic`
- `aeolianPentatonic`
- `lydianPentatonic`

### Current ecological state mapping

- **calm / stable:** restrained motion, warmer bloom bed, softer rhythmic emphasis
- **fertile / abundant:** brighter bloom and pollinator presence, slightly more open filters, fuller harmonic lift
- **active / busy:** clearer grazer pulse, more pollinator motion, stronger foreground lift
- **degraded / sparse:** thinner bloom support, more exposed decay texture, darker harmonic color

This keeps the current sound world expressive while leaving room for future corruption, anomaly, or enemy-tension layers to contrast against it.

### Root selection

The root shifts slowly using:

- nutrients
- growth
- harmony
- threat

### Layer mapping

- **global bed:** low stable scale degrees
- **plants / rooted life:** lower sustained tones
- **clusters / grouped zones:** averaged middle textures
- **mobile life:** brighter upper tones
- **event sounds:** short gestures quantized to the same note pool
- **water texture:** low filtered tones constrained to the active mode

This keeps the result calm and prevents arbitrary dissonance.

## Grouping by distance and attention

Distance now changes more than volume.

### At low detail / far camera

- many entities collapse into grouped zone summaries
- transient density is reduced
- filtering becomes darker
- fewer individual voices survive foreground selection

### At high detail / near camera

- local entities gain more detail weight
- individual foreground voices are more likely to emerge
- grouped layers become brighter and less smeared

### Attention interaction

ATTENTION behaves like an RTS-style listening model rather than a temporary lens.

Entity selection:

- the chosen organism becomes dominant
- nearby related organisms remain softly present
- filters open and gain rises for better intelligibility without muting the ecology around it

Region selection:

- entities inside the region are clearer
- internal balance is preserved instead of collapsing to one source
- the outside world remains present as softer ambience
- grouped voices inside the region gain modest foreground lift so inspection feels rewarding instead of merely louder

## Mix hierarchy and dynamic range

The current mix pass is explicitly organized into three layers:

- **Global bed:** always audible harmonic floor
- **Midground grouped ecology:** perceptible role-based ensemble voices at ordinary listening levels
- **Foreground salient voices:** selected, nearby, or event-promoted activity that rises above the bed without clipping it

Dynamic range is shaped through:

- slow swells in the bed and bloom layers
- role-dependent pulsing for grazer and pollinator activity
- mode-dependent prominence changes across calm, fertile, active, and degraded states
- restrained focus ducking rather than abrupt silencing

## Event integration

The engine responds to world events instead of relying only on raw polling.

- recent `entityFed` and `entityDied` events add temporary salience priority to the involved entity
- `residueCreated` produces a short constrained residue gesture
- `toolUsed` produces a harmonically constrained tool accent
- observe-tool feedback remains lightweight and separate so the microscope interaction is still tactile

This gives short-lived importance spikes without adding permanent voice cost.

## Performance strategy

The system avoids uncontrolled WebAudio growth.

### Voice limits

- **global bed:** 2 always-on oscillators
- **grouped ecological roles:** 4 pooled voices max
- **foreground salient voices:** 3 pooled voices max
- **events:** short-lived transient nodes only when events fire

### Efficiency rules

- no always-on synth per entity
- pooled oscillator voices are retuned instead of recreated every frame
- low-salience entities are summarized into groups
- recent event salience is stored in a tiny decaying map keyed by entity id
- tuning focuses on gain staging, filter shaping, and lightweight modulation rather than node-count growth

## Current files

Core implementation lives in:

- `src/audio/audioEngine.ts`
- `src/audio/harmony.ts`
- `src/audio/salience.ts`
- `src/audio/musicalEvents.ts`
- `src/audio/musicalInterpreter.ts`
- `src/audio/instruments.ts`
- `src/audio/audioBuses.ts`

These modules separate harmony selection, salience scoring, and pooled voice rendering so future audio passes can remain focused instead of sprawling.

## Musical interpretation architecture foundation

The engine now includes a lightweight intermediate architecture:

- simulation events -> **ecological audio events** (`musicalEvents.ts`)
- ecological audio events -> **musical interpreter** (`musicalInterpreter.ts`) with `raw | hybrid | musical` modes
- interpreted gestures -> existing transient/voice rendering
- explicit output routing via **named buses** (`audioBuses.ts`): `music`, `atmosphere`, `rawEcology`, `selectionUi`
- future-facing **instrument descriptors/registry** (`instruments.ts`) for role/timbre metadata without a full instrument engine yet
