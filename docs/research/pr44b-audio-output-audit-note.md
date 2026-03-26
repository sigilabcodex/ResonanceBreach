# PR44B Audio Output Audit (pre-code)

## What is currently audible

From code-path inspection, the current engine reliably produces a low-level ecological substrate:

- continuous bed/noise routed to the **atmosphere** bus (`bedGain`, `bedNoiseGain`)
- ecological role voices (`bloom/grazer/pollinator/decay`) routed to **raw ecology**
- event tones split between selection/UI, raw, atmosphere, or music depending on role/mode
- phrase-note transients routed to **music** through `phraseBus`

## What is missing

A clearly audible **foreground musical layer** is not guaranteed:

1. Foreground entity voices are currently routed to `busLayout.rawEcology`, not `busLayout.music`, so they read as substrate detail instead of a distinct musical foreground.
2. Foreground and phrase gains are conservative (low amplitudes plus squared volume mapping and multiple gain stages), which can make musical material easy to miss.
3. Bus balancing biases can let raw/atmosphere dominate unless the user aggressively raises music controls.

## Gain/routing issues identified

- **Routing mismatch:** `foregroundVoices` are created with destination `busLayout.rawEcology`.
- **Low phrase emphasis:** `phraseBus.gain` is low and phrase-note envelopes are modest.
- **Compounded attenuation:** per-voice gain × bus gain × bus control gain × master gain × master control gain can suppress audible music if any stage is moderate.
- **Slider wiring check:** settings appear wired correctly to control nodes (`masterControl`, `musicControl`, `rawEcologyControl`, `atmosphereControl`, `selectionUiControl`) via `applyLiveControls`, but the net staging still leaves music understated.

## Audio-context startup/resume behavior

- Startup uses `ensureStarted()` and user interaction hooks (`onInteract`, tool selection) to satisfy browser autoplay rules.
- If the context is suspended, `ensureStarted()` resumes it.
- No hard blocker found here; the primary issue is staging/routing/audibility rather than context start failure.

## This PR will fix

1. Route foreground entity voices through the **music bus**.
2. Rebalance gain staging so music is clearly foreground while preserving ecology/atmosphere support.
3. Raise phrase/motif audibility and add a minimal always-audible musical foreground cell when interpretation is hybrid/musical.
4. Keep settings controls live and meaningful with clearer per-bus impact.
