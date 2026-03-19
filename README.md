# ResonanceBreach

ResonanceBreach is a minimalist browser-based prototype about observing, containing, and navigating an abstract systemic breach. This pass slows the simulation down, introduces readable temporal phases, differentiates entity roles, and adds direct control over camera space and simulation time.

## What changed in this iteration

- **Continuous phase progression:** the field now evolves through calm, anomaly, emergence, pressure, and breach states with gradual blending instead of hard mode switches.
- **Clear entity roles:** harmonic nodes stabilize space, anomalies appear first as flickering distortions, and breach entities arrive later as rhythmic propagators with distinct motion and structure.
- **Slower pacing:** spawn rates, escalation, and motion have all been reduced to create more contemplative observation windows.
- **Camera navigation:** the field can now be explored with zoom and panning for local inspection or strategic overview.
- **Time control:** players can temporarily slow the system down or accelerate it to study phase changes and pressure spikes.
- **Rhythmic pressure audio:** once breach entities emerge, the soundscape gains a subtle pulse that intensifies with instability.

## System phases

The simulation continuously blends between five phases:

1. **Calm** – mostly harmonic nodes, slow drift, low distortion.
2. **Anomaly** – rare distortions begin to flicker into the field.
3. **Emergence** – the first breach entities appear.
4. **Pressure** – breach reproduction increases and rhythmic pulsing becomes more present.
5. **Breach** – instability dominates and containment becomes fragile.

These phases are not discrete levels. They overlap and crossfade based on elapsed time, field instability, and containment pressure.

## Entity roles

- **Harmonic nodes** – ambient and stable. They drift gently and reinforce coherence.
- **Anomalies** – subtle distortions rather than full circles. They flicker, shear, and mark unstable emergence points.
- **Breach entities** – visually and behaviorally distinct geometric intrusions that propagate more aggressively and pulse with the rising system rhythm.

## Controls

- **Left click / drag:** project the containment zone.
- **Mouse wheel:** zoom in and out.
- **Right click / drag:** pan the camera.
- **WASD / Arrow keys:** pan the camera.
- **Hold Shift:** slow time to `0.5×`.
- **Hold Space:** fast-forward to `2×`.
- **R:** restart immediately.
- **Restart button:** reseed the simulation.

Audio begins after the first user interaction to comply with browser autoplay restrictions.

## Running the prototype

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

## Architecture overview

- `src/app.ts` – app bootstrap, camera/time controls, and fixed-timestep loop.
- `src/sim/simulation.ts` – phase blending, entity role behavior, spawning, stability, and containment response.
- `src/render/renderer.ts` – camera-aware canvas rendering for field regions, anomalies, breach forms, and containment feedback.
- `src/audio/audioEngine.ts` – generative ambient audio with rhythmic pressure mapped to breach escalation.
- `src/input/playerInput.ts` – pointer, wheel, keyboard camera movement, and time-control handling.
- `src/ui/hud.ts` – HUD for stability, current phase, entities, and controls.
- `src/config.ts` – global simulation, camera, and timing constants.

## Design notes

- The prototype remains abstract, geometric, and continuous.
- The focus of this pass is clarity, pacing, and readable evolution rather than feature complexity.
- Future iterations can deepen intervention mechanics without losing the minimal visual direction.
