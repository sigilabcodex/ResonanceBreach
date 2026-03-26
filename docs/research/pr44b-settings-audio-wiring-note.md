# PR #44B Design/Dev Note — settings wiring and real-time audio control feedback

## What is currently broken or misleading

After inspecting `src/ui/hud.ts`, `src/app/game.ts`, and `src/audio/audioEngine.ts`:

1. **Settings sliders are persisted and propagated, but the effective gain range is constrained so heavily that controls can feel decorative.**
   - Sliders update app settings immediately (`Hud` -> `onSettingsChange` -> `App.applySettings`), and those settings are passed into `AudioEngine.update(...)` each frame.
   - However, gain mapping and clamps keep significant minimum loudness even at slider `0`:
     - `mapVolume(0)` returns `0.18` (not silence).
     - Bus targets are clamped with non-trivial floors (e.g. `music/raw/atmosphere` min `0.12`).
     - Master gain target has a large base term and still multiplies by nonzero mapped volume.
   - Result: users can move sliders but still hear strong output, which feels unreliable/fake.

2. **No explicit, immediate settings-to-engine control layer exists for buses/master.**
   - Current behavior folds settings into high-level composition formulas only.
   - There is no dedicated "control gain" stage (master / ambience / entity / bus trims) that directly represents UI values in the live graph.

3. **Entity and ambience paths are only partially represented by intended sliders.**
   - `entityVolume` affects some foreground/phrase/event computations, but not as a strict, clearly-audible top-level trim for all entity-related content.
   - `ambienceVolume` feeds bed/ecology formulas, but because of floors/clamps, low settings do not reliably communicate “off/very low”.

## What is decorative vs. real today

- **Real and wired today**: settings state, local storage persistence, and per-frame propagation into audio update.
- **Effectively decorative in practice**: low-end behavior of master/bus/ambience/entity controls due to hard floors and clamp minima that prevent clear attenuation.

## Real audio integration points

- Audio graph integration exists in `AudioEngine`:
  - Master output: `master -> limiter -> destination`.
  - Bus graph: `music`, `atmosphere`, `rawEcology`, `selectionUi` in `AudioBusLayout`.
  - Source groups:
    - ambience bed -> `atmosphere`
    - ecological + foreground voices -> `rawEcology`
    - phrase/event musical layers -> `music` / `selectionUi`
- These are the correct integration seams for reliable settings control.

## What this PR will fix

1. Add a **direct control-gain layer** in the audio engine so settings map to real node gain trims (master + bus-level trims) in real time.
2. Remove misleading loudness floors for user-facing controls so `0` can reach near-silence and low values are clearly audible as low.
3. Keep smoothing, but shorten control-response constants so slider movement is immediately perceptible.
4. Preserve settings persistence/session behavior and ensure open/close settings interactions do not reset values.
