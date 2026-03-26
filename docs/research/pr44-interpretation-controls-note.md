# PR #44 — User-facing interpretation controls (design/dev note)

## Current interpretation mode flow

- Musical interpretation modes are defined as `raw | hybrid | musical` in `src/audio/musicalInterpreter.ts`.
- `AudioEngine` owns the active mode (`interpretationMode`) and constructs a mode-specific interpreter via `createMusicalInterpreter(mode)`.
- The interpreter is consumed when ecological events are mapped into musical gestures (`processEcologicalEvent` path), while many synthesis and routing decisions in `AudioEngine` also branch on `interpretationMode`.
- The mode currently defaults to `raw` and can be changed through `AudioEngine.setInterpretationMode`, but there is no user-facing control wired to this method.

## Clean input/control hook points

- **Input layer:** `PlayerInput` (`src/interaction/input.ts`) already handles lightweight global keyboard controls (`R`, `H`, `O`, debug toggle, tool hotkeys). This is the cleanest place for a minimal mode-cycle action.
- **App orchestration:** `App` (`src/app/game.ts`) is the bridge between input, audio, and HUD, so it should own mode cycling and call into `AudioEngine`.
- **Feedback/UI:** `Hud` (`src/ui/hud.ts`) already surfaces concise status rows and minimal overlay text. Adding a small interpretation row + compact minimal-HUD hint keeps this consistent without adding a settings panel.

## Minimal implementation plan

1. Add a single keyboard control (`M`) to cycle `raw → hybrid → musical → raw`.
2. Add subtle interpretation feedback in HUD:
   - one status row in the right panel,
   - minimal HUD hint includes current mode and hotkey.
3. Smooth transitions by introducing a continuous internal `musicification` blend in `AudioEngine` (`0..1`) that eases toward the selected mode target and drives bus-level balancing (music / atmosphere / raw ecology) and related gain shaping.
4. Keep architecture small:
   - no new full settings UI,
   - no reset/restart on mode switch,
   - preserve existing interpreter behavior while smoothing mix-level transition.
