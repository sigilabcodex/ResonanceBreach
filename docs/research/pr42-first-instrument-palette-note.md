# PR #42 Design/Development Note — First Instrument Palette + Ecological Role Routing

## Current architecture summary (inspection before implementation)

From `docs/audio-system.md`, `docs/research/pr41-musical-interpretation-layer-note.md`, and the current audio modules, the architecture now has the right seams but still mostly produces generic synthesis output:

- `musicalEvents.ts` maps world events into ecological audio event abstractions with tags/intensity.
- `musicalInterpreter.ts` applies `raw | hybrid | musical` interpretation to produce a `MusicalGesture`.
- `instruments.ts` provides descriptor metadata + registry, but descriptors are not yet driving concrete synthesis/routing choices.
- `audioBuses.ts` provides named buses (`music`, `atmosphere`, `rawEcology`, `selectionUi`).
- `audioEngine.ts` integrates all of the above, but event synthesis still collapses to mostly fixed per-event oscillator/filter settings in `triggerEventTone`, plus a generic environmental pulse transient.

## Where interpreted events currently collapse into generic behavior

The largest collapse point is `AudioEngine.processEcologicalAudioEvent`:

- it interprets events with mode,
- but for world events it still routes into `triggerEventTone` (fixed mapping by event type),
- and for environmental pulses it emits one generic sine/lowpass transient.

So the interpretation layer exists, but role/instrument identity is not yet shaping real output.

## Safest integration point for first-pass orchestration

The safest first-pass orchestration seam is the transient path in `audioEngine.ts`:

1. keep existing pooled bed/ecology/foreground voices unchanged,
2. add a lightweight orchestration chooser that maps ecological roles + mode -> instrument descriptor,
3. use that selection to parameterize oscillator, envelope, filter, register, rhythmic feel, and bus routing for event transients.

This avoids rewriting the core engine while giving immediate audible contrast.

## What this PR will implement

- A modest first palette (6 lightweight instrument identities) in `instruments.ts` with clear role/timbre separation.
- Ecological role inference from ecological event tags/entity types.
- Probabilistic role-to-instrument routing that responds to interpretation mode.
- Mode-aware synthesis decisions for event/environmental transient gestures:
  - `raw`: minimal orchestration lift
  - `hybrid`: clear role influence with ecological roughness retained
  - `musical`: stronger instrument identity + more consonant/pleasant shaping
- Bus-aware routing that preserves separation (`music` vs `atmosphere` vs `rawEcology` vs `selectionUi`).
- Atmosphere remains subordinate (no extra dominant drone additions).

## What this PR will NOT implement yet

- No full instrument engine/sampler system.
- No phrase-level composition rewrite.
- No replacement of existing pooled ecological or foreground continuous voices.
- No large dependency or asset additions.
- No hard deterministic one-entity-one-instrument lock; routing remains probabilistic/flexible.
