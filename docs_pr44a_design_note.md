# PR #44A Design/Dev Note — Interpretation controls and contrast

## What exists today (inspected before coding)

- Interpretation mode cycling already exists on `M` in the app input flow (`raw -> hybrid -> musical`) and calls `AudioEngine.setInterpretationMode(...)`.
- `AudioEngine` maintains an internal `interpretationBlend` (`musicification`) and smooths to a per-mode target over time.
- Bus-level balancing is already present (`music`, `rawEcology`, `atmosphere`) but only subtly shifted by interpretation blend.
- Settings UI currently exposes only broad audio sliders (`master`, `ambience`, `entity`) and does **not** expose interpretation mode/musicification or per-bus controls.

## Why the modes can still sound too similar

1. Existing bus deltas are small and centered close together, so overall timbral mass remains similar.
2. Phrase/orchestration behavior is not strongly mode-shaped enough (phrasing still present in raw, not strongly emphasized in musical).
3. Interpretation controls are mostly hidden behind the `M` hotkey and subtle status text, so users miss discoverability.
4. No direct bus controls in Settings means users cannot push contrast themselves.

## What this PR will change

- Add explicit **Interpretation** controls in Settings:
  - Mode selector (Raw/Hybrid/Musical)
  - Musicification slider (0..1) as an advanced bias on top of mode defaults.
- Add explicit **bus sliders** in Settings:
  - Music bus level
  - Raw ecology bus level
  - Atmosphere bus level
- Increase audible mode contrast while preserving smoothing:
  - Stronger mode-dependent bus targeting
  - Lower phrase grouping and orchestration influence in Raw
  - Moderate behavior in Hybrid
  - Strong phrase/call-response/orchestration emphasis in Musical
- Add visible, subtle mode feedback overlay when mode/interpretation changes, including mode + musicification + bus emphasis.

## Out of scope

- No full mixer redesign.
- No removal of hotkeys.
- No architecture rewrite of event routing or synthesis graph.
- No abrupt switching (transitions remain smoothed).
