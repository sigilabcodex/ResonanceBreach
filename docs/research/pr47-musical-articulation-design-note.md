# PR #47 follow-up — Foreground musical articulation, timing, and phrase legibility

Date: 2026-03-30

## Mandatory pre-coding inspection summary

Inspected before coding:

- `src/audio/audioEngine.ts`
  - event note path (`triggerEventTone`)
  - phrase-agent scheduling (`updatePhraseAgents`) and playback (`playPhraseNote`)
  - environmental pulse note path (`processEnvironmentalPulse` / `processEcologicalAudioEvent`)
  - family profile mapping (`getInstrumentVoiceProfile`)
  - shared note creation (`createNoteEvent`)
- `src/audio/noteEvents.ts`
  - envelope construction (`createEnvelopeByDensity`)
  - soft pulse alignment (`alignToSoftPulse`)
  - cooldown gate utility (`shouldTriggerNote`)
- Existing notes:
  - `docs/research/pr46-harmonic-field-design-note.md`
  - `docs/research/pr46-listening-validation-notes.md`
  - `docs/research/pr47-instrument-families-design-note.md`
  - `docs/research/pr47-listening-validation-notes.md`

## Why output still does not read strongly as music

1. **Event density is still too permissive**
   - `triggerEventTone` gates mainly by per-source key and modest cooldowns, so bursts of nearby ecological events can still become too many audible notes.
   - Environmental pulses fire regularly with limited phrase-level context, contributing ongoing transient activity.

2. **Phrase grouping can smear instead of breathe**
   - Phrase agents can launch frequently and with limited global phrase spacing coordination.
   - Inter-note spacing (`nextDuration * 0.92`) can cause slight overlap/continuity rather than clear articulation + rest.

3. **Envelope body remains too sustained for some families**
   - Existing ADSR defaults keep moderate sustain/release even for nominally percussive families.
   - Family differences exist but are still close enough that foreground lines can blur into a harmonic cloud.

4. **Timing coherence exists but onset clutter remains**
   - Soft-pulse alignment is present, but high note availability can still create micro-overlap and reduce onset legibility.

## Where articulation/timing will be strengthened

1. **Envelope articulation tightening**
   - Shorten percussive and rounded tails.
   - Keep pad/reed breathing, but reduce sustained masking.
   - Push bass-pulse toward clearer pulse behavior.

2. **Global spacing + local density discipline**
   - Add soft global onset spacing checks.
   - Add short rolling density limits so not every eligible event becomes a note.
   - Add phrase-level cooldown windows between phrase launches.

3. **Phrase legibility improvements**
   - Bias phrase fragments to 2–4 notes.
   - Increase inter-note rest proportion.
   - Ensure phrase endings have recoverable silence before the next launch.

4. **Soft pulse reinforcement without rigid sequencing**
   - Keep loose pulse alignment, but reduce arbitrary overlap by controlling onset admission and phrase scheduling.

## Planned implementation in this PR

- Update `createEnvelopeByDensity` in `src/audio/noteEvents.ts` for clearer family-shaped articulation.
- Add lightweight onset-density controls in `src/audio/audioEngine.ts` and apply to event/phrase/environment pulse note paths.
- Strengthen phrase-agent scheduling in `src/audio/audioEngine.ts` to produce clearer short fragments with breathing gaps.
- Keep six foreground families, role-aware routing, interpretation modes, and bus architecture intact.

## Out of scope

- Full sequencer/composer timeline system.
- Rigid BPM quantization or DAW-like lockstep timing.
- Replacing raw/ambient ecology bed behavior.
- Adding many new instruments or heavy DSP dependencies.
