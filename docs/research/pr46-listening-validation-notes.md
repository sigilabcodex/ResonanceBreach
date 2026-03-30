# PR #46 listening validation notes

Date: 2026-03-29

## Validation approach

- Ran a production build to verify TypeScript/audio code compiles after harmonic-field changes.
- Manual code-path audit for pitch entry points:
  - global bed / ecological voices / foreground / lead
  - phrase notes
  - world event notes
  - selection and tool tones
- Checked that strict snapping is concentrated in musical note events while continuous raw ecology remains comparatively loose.

## Observed improvements

1. **Musical note events now stay in one tonal world**
   - Phrase, event, selection, and tool note paths all pass through harmony-aware role-zone snapping.
   - This sharply reduces accidental out-of-field tones in the foreground layer.

2. **Pleasantness bias is explicit**
   - Degree scoring now combines stable anchors + dynamic degree weights + mild tension weighting.
   - Tonic/stable members are naturally favored while still allowing occasional color tones.

3. **Slow tonal drift is calmer and more continuous**
   - Very slow mode rotation and tonic-adjacent drift create long-horizon evolution.
   - No abrupt progression/chord-engine behavior was introduced.

4. **Role-aware register identity is stronger**
   - Added dedicated pitch zones for rooted/drifter/predator/decomposer in addition to ecological roles.
   - Event and phrase paths now map role semantics into those zones before rendering pitch.

5. **Raw ecology remains less rigid**
   - Continuous bed/ecology oscillators still use lower pitch-tightness than musical note events.
   - The system preserves ecological unpredictability and textural motion.

## Remaining caveats

- Predators/decomposers remain intentionally darker/rougher by timbre; this is now mostly timbral edge rather than tonal collision.
- Further listening polish can tune role-zone boundaries and degree weights by ear over longer sessions.
