# PR #47 — First Foreground Instrument Families (Design / Dev Note)

## Pre-coding inspection summary

### 1) Current note-event playback path

- Foreground transients are emitted via `AudioEngine.triggerEventTone` for world/ecological events and `AudioEngine.playPhraseNote` for phrase agents.
- Both paths currently create a single oscillator + filter + ADSR gain chain and then route either to `music`, `atmosphere`, `rawEcology`, `phraseBus`, or `selectionUi`-related buses.
- `NoteEvent` already carries `instrumentFamilyHint`, `roleHint`, and source metadata, and ADSR shaping is centralized via `createEnvelopeByDensity` + `scheduleAdsrGain`.

### 2) Existing synth voice behavior

- Existing timbral differentiation is currently modest:
  - oscillator waveform selection by broad timbral family,
  - simple filter type/Q/frequency scaling,
  - a generic ADSR envelope with little family-specific shaping.
- Environmental pulses are similarly lightweight and mostly sine/triangle-based.
- Phrase voices are still close to generic single-oscillator tones.

### 3) Bus structure and interpretation modes

- Bus structure is already split into `music`, `atmosphere`, `rawEcology`, and `selectionUi` with dedicated control gains.
- Interpretation mode (`raw`, `hybrid`, `musical`) already influences quantization/probability/intensity and some duration/filter choices.
- This means instrument-family logic can be added at the transient-voice synthesis layer without reworking core bus topology.

## Reusable synthesis primitives already present

- Strong reusable primitives already exist and will be reused:
  - note gating and probabilistic triggering,
  - pulse alignment (`alignToSoftPulse`),
  - ADSR scheduling (`scheduleAdsrGain`),
  - harmonic quantization and role-zoned pitch assignment,
  - role-aware instrument selection (`chooseInstrumentForRole`).
- This PR should extend descriptor/profile data and synthesis parameterization rather than replacing these systems.

## Clean insertion points for instrument-family logic

1. `src/audio/instruments.ts`
   - extend instrument descriptors with explicit family identity and profile metadata (register preference + timbral profile data).
2. `src/audio/audioEngine.ts`
   - centralize family-specific synth settings in one helper,
   - use that helper in both event and phrase note playback paths,
   - keep existing buses, timing, harmony quantization, and interpretation logic intact.

## What current musical voices still lack

- Clear, repeatable family-level identity across different event sources.
- A mapping from role to instrument that is role-aware but still probabilistic.
- More audible differences in attack shape/brightness/body between phrase notes and event transients.

## Instrument-family representation for this PR

Implement 6 lightweight foreground instrument families:

1. **soft-pad**
2. **bell-chime**
3. **soft-pluck**
4. **mellow-mallet**
5. **reed-lead**
6. **soft-bass-pulse**

Each family will explicitly define:

- envelope character,
- register preference,
- timbral profile,
- density tendency,
- role affinity.

Representation approach:

- Add `foregroundFamily` and `registerPreference` metadata to `InstrumentDescriptor`.
- Keep existing descriptor fields (`roleAffinity`, `rhythmicTendency`, `envelopeCharacter`, `pitchRange`, etc.) and reuse them for probabilistic selection and constraints.

## What this PR will implement

- First concrete family set with 6 descriptor-backed families.
- Family-aware synthesis parameterization (waveform, filter type, Q, brightness scaling, subtle detune/thickness behavior).
- Family-aware envelope shaping in note-event construction.
- Role-aware but probabilistic family routing through existing role affinity weighting.
- Listening validation notes documenting audible differences and remaining rough edges.

## What this PR intentionally defers

- Sample-based or multi-layered instrument engine.
- Complex modulation matrix / per-family effects chains.
- Hard-binding one species to exactly one instrument forever.
- Large orchestration rewrite of bed/ecology background layers.
