import { MODE_PRIORITY } from '../harmony/scales';
import { buildHarmonicField } from '../harmony/pitch';
import type { MusicConductorState, MusicTransportState, MusicWorldFeatures } from '../types/music';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class MusicConductor {
  private state: MusicConductorState = {
    density: 0.26,
    intensity: 0.24,
    tonalCenter: 50,
    mode: 'dorian',
    harmonicField: buildHarmonicField(50, 'dorian', 0.2),
    silenceBias: 0.35,
    phraseBias: 0.6,
    ensemble: {
      pad: 0.7,
      pluck: 0.45,
      bell: 0.32,
      low: 0.64,
      texture: 0.28,
    },
  };

  reset(): void {
    this.state = {
      density: 0.26,
      intensity: 0.24,
      tonalCenter: 50,
      mode: 'dorian',
      harmonicField: buildHarmonicField(50, 'dorian', 0.2),
      silenceBias: 0.35,
      phraseBias: 0.6,
      ensemble: {
        pad: 0.7,
        pluck: 0.45,
        bell: 0.32,
        low: 0.64,
        texture: 0.28,
      },
    };
  }

  update(features: MusicWorldFeatures, transport: MusicTransportState): MusicConductorState {
    const targetIntensity = clamp(features.activity * 0.55 + features.recentEventEnergy * 0.45, 0.1, 0.9);
    const targetDensity = clamp(features.entityDensity * 0.5 + features.biodiversity * 0.3 + features.fruit * 0.2, 0.12, 0.88);

    const phraseEdge = transport.phraseProgress < 0.05;
    if (phraseEdge) {
      const modeIndex = Math.floor(clamp(features.growth * 0.7 + features.threat * 0.3, 0, 0.999) * MODE_PRIORITY.length);
      this.state.mode = MODE_PRIORITY[modeIndex] ?? this.state.mode;

      const tonalDrift = Math.round((features.nutrients - 0.5) * 3 + (features.eventBias.death - 0.15) * -2);
      this.state.tonalCenter = clamp(this.state.tonalCenter + tonalDrift, 45, 57);
    }

    this.state.intensity = lerp(this.state.intensity, targetIntensity, 0.04);
    this.state.density = lerp(this.state.density, targetDensity, 0.03);
    this.state.silenceBias = clamp(1 - this.state.density * 0.8 - this.state.intensity * 0.4 + features.stability * 0.25, 0.08, 0.78);
    this.state.phraseBias = clamp(0.35 + features.growth * 0.35 + features.eventBias.fruiting * 0.3, 0.2, 0.95);
    this.state.ensemble = {
      pad: clamp(0.55 + features.stability * 0.4, 0.3, 1),
      pluck: clamp(0.2 + features.activity * 0.7, 0.15, 0.95),
      bell: clamp(0.15 + features.fruit * 0.8, 0.08, 0.9),
      low: clamp(0.35 + features.entityDensity * 0.6, 0.25, 1),
      texture: clamp(0.1 + features.recentEventEnergy * 0.8, 0.08, 0.82),
    };
    this.state.harmonicField = buildHarmonicField(this.state.tonalCenter, this.state.mode, this.state.intensity);

    return { ...this.state, harmonicField: { ...this.state.harmonicField, register: { ...this.state.harmonicField.register }, chordDegrees: [...this.state.harmonicField.chordDegrees] } };
  }

  getState(): MusicConductorState {
    return { ...this.state, harmonicField: { ...this.state.harmonicField, register: { ...this.state.harmonicField.register }, chordDegrees: [...this.state.harmonicField.chordDegrees] } };
  }
}
