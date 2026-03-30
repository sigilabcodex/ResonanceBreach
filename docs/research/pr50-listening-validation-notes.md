# PR #50 Listening Validation Notes — Long-form evolution + anti-loop behavior

## Validation method

- Static code-path validation of long-form control flow and smoothing behavior.
- Build verification via `npm run build`.
- Expected-audible-behavior review based on parameter ranges, smoothing rates, and modulation periods.

## What changed for long listening

1. **Motif family rotation**
   - Phrase agents now select motif material from a rotating family set, with family index influenced by session epoch, world climate, source species, and slow phase drift.
   - Existing motif memory remains, but blends with family rotation to preserve recognizability while reducing obvious short-pool looping.

2. **Instrument prominence drift**
   - Instrument selection now includes a long-form prominence factor derived from calm/tension/fertility/decay/activity/open/rough state plus region signature (wetland/highland/basin/water).
   - Selection remains role-aware but evolves over time with ecology and listener place.

3. **Harmonic color evolution**
   - Harmony now accepts long-form context and adds macro-breathing terms to mode drift, modal color drift, and root drift.
   - This extends prior harmonic-field motion without introducing abrupt section switching.

4. **World-state long-form mapping**
   - A smoothed long-form state is derived each update from ecological interpretation + local terrain/habitat region signature.
   - Calm/fertile worlds favor warmer, more open behavior; high tension/decay increase roughness and darker role emphasis; activity increases motion/brightness.

## Expected listening outcomes (10–20+ minutes)

- Reduced perception of small-loop motif repetition due to family rotation epochs and memory blending.
- Gradual timbral rebalancing across instrument families as ecological state and place change.
- More audible long-form tonal breathing and color shifts while preserving tonal identity.
- Stronger perceived coupling between macro ecological shifts and musical evolution.

## Notes / limitations

- This pass intentionally keeps procedural coherence and avoids explicit song-section architecture.
- A dedicated runtime ear-pass is still recommended after merge to fine-tune drift depth and prominence curves per instrument family.
