# PR44B Listening validation notes

## Validation setup

- Built the project with `npm run build` to ensure TypeScript + bundling integrity.
- Runtime listening validation in this environment is limited because CI shell has no browser audio output.

## What to validate in-browser

1. Start the app, perform one click/interaction to resume audio context.
2. Keep interpretation in **Hybrid** (default) and leave new default audio settings untouched.
3. Listen for three clear layers:
   - **Foreground musical layer** (now routed to music bus): pitched, stable, musically constrained voices.
   - **Phrase/motif transients**: short melodic gestures from active entities.
   - **Ecological substrate**: bed/noise and ecological role voices still present beneath music.
4. Drag audio sliders in settings and verify real-time response:
   - Master volume changes entire output.
   - Music bus level now strongly changes the audible foreground.
   - Raw ecology and atmosphere sliders reshape bed/supporting layers without removing music.

## Expected audible result after this PR

- Foreground music is clearly audible at startup defaults.
- Ecology/noise remains as supporting substrate rather than dominating the mix.
- Interpretation transitions still work (`raw`, `hybrid`, `musical`) with stronger contrast between substrate and musical layer.
