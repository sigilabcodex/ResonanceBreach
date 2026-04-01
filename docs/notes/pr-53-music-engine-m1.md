# PR 53 – Music Engine M1 foundation

## Intent

M1 adds a dedicated `src/music/` subsystem that sits alongside (not inside) the existing audio engine. The new data flow is:

`simulation snapshot/events -> world feature extraction -> conductor state -> phrase planning -> scheduling`

This keeps music architecture separate from direct event-to-sound triggering and preserves the current restrained ambient audio behavior.

## What M1 implements

- New music subsystem modules with typed boundaries:
  - `analysis/` world-to-music features
  - `engine/` transport + conductor + engine coordinator
  - `harmony/` scale definitions + pitch helpers + harmonic field builder
  - `phrase/` motif and phrase planning primitives
  - `events/` scheduling and lookahead timeline windows
  - `instruments/` instrument profile abstraction
  - `presets/` default ensemble profile set
  - `types/` shared music contracts
- Slow-moving transport/conductor state that tracks density, intensity, tonal center, mode, silence bias, phrase bias, and ensemble activation.
- Phrase and scheduling primitives with first-class rest support.
- App-loop integration through `App` calling `music.updateFromSnapshot(...)` each frame.

## What M1 intentionally defers

- No direct WebAudio rendering path for scheduled musical notes yet.
- No advanced composition/motif memory engine.
- No mixer redesign or replacement of `src/audio/audioEngine.ts`.
- No large UI/HUD surface for music internals beyond debug-readiness.

## Why this shape

- Keeps architecture aligned with the project's modular-direction refactor.
- Enables incremental M2/M3 work where performer/routing can be added without entangling simulation and direct sound output.
- Preserves existing simulation/audio behavior while introducing explicit procedural-music seams.
