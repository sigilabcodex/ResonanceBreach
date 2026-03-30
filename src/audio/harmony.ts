import type { EcologicalMusicState, EcologicalVoiceRole } from './ecologicalMusic';
import type { SimulationSnapshot } from '../types/world';

type HarmonyLayer = 'bed' | 'plant' | 'cluster' | 'mobile' | 'event' | 'water';
export type HarmonicPitchRole = EcologicalVoiceRole | 'rooted' | 'drifter' | 'predator' | 'decomposer' | 'mixed';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

const MODES = {
  ionianPentatonic: [0, 2, 4, 7, 9],
  suspendedPentatonic: [0, 2, 5, 7, 9],
  dorianPentatonic: [0, 2, 3, 7, 10],
  aeolianPentatonic: [0, 3, 5, 7, 10],
  lydianPentatonic: [0, 4, 6, 7, 11],
} as const;

const LAYER_DEGREES: Record<HarmonyLayer, number[]> = {
  bed: [0, 1, 2],
  plant: [0, 1, 2, 1],
  cluster: [1, 2, 3, 2],
  mobile: [2, 3, 4, 3],
  event: [0, 2, 4, 3],
  water: [0, 1, 3],
};

const ROLE_PITCH_ZONES: Record<HarmonicPitchRole, { min: number; max: number; center: number }> = {
  bloom: { min: 58, max: 89, center: 73 },
  rooted: { min: 52, max: 82, center: 68 },
  grazer: { min: 45, max: 74, center: 58 },
  pollinator: { min: 63, max: 94, center: 81 },
  drifter: { min: 64, max: 96, center: 84 },
  predator: { min: 34, max: 62, center: 47 },
  decomposer: { min: 36, max: 66, center: 49 },
  decay: { min: 38, max: 67, center: 50 },
  mixed: { min: 44, max: 84, center: 64 },
};

const MODE_ORDER: (keyof typeof MODES)[] = ['suspendedPentatonic', 'dorianPentatonic', 'ionianPentatonic', 'lydianPentatonic'];

export interface HarmonicEmphasis {
  stable: number[];
  tension: number[];
}

export interface HarmonicField {
  driftPhase: number;
  driftAmount: number;
  tonicDriftSemitones: number;
  degreeWeights: number[];
  stableDegreeWeights: number[];
  emphasis: HarmonicEmphasis;
  rolePitchZones: Record<HarmonicPitchRole, { min: number; max: number; center: number }>;
}

export interface HarmonyState {
  modeName: keyof typeof MODES;
  rootMidi: number;
  rootHz: number;
  mode: number[];
  field: HarmonicField;
}

const chooseMode = (snapshot: SimulationSnapshot, ecological?: EcologicalMusicState): keyof typeof MODES => {
  const { stability, threat, harmony } = snapshot.stats;
  if (ecological?.composition.mode === 'degraded') return 'aeolianPentatonic';
  if (ecological?.composition.mode === 'active') return 'ionianPentatonic';
  if (ecological?.composition.mode === 'tense') return 'dorianPentatonic';
  if (ecological?.composition.mode === 'fertile') return 'lydianPentatonic';
  if (threat > 0.3) return 'dorianPentatonic';
  if (stability > 0.62 && harmony > 0.5) return 'ionianPentatonic';
  return 'suspendedPentatonic';
};

const slowRotateMode = (
  baseMode: keyof typeof MODES,
  snapshot: SimulationSnapshot,
  ecological?: EcologicalMusicState,
): keyof typeof MODES => {
  const richness = ecological?.interpretation.harmonicRichness ?? snapshot.stats.harmony;
  const speed = 0.0012 + (ecological?.composition.evolutionSpeed ?? 0.1) * 0.0016;
  const phase = snapshot.time * speed + richness * 0.7;
  const wobble = Math.sin(phase * Math.PI * 2);
  if (Math.abs(wobble) < 0.76) return baseMode;
  const idx = MODE_ORDER.indexOf(baseMode);
  if (idx < 0) return baseMode;
  const direction = wobble > 0 ? 1 : -1;
  const nextIndex = clamp(idx + direction, 0, MODE_ORDER.length - 1);
  return MODE_ORDER[nextIndex];
};

const createField = (snapshot: SimulationSnapshot, ecological: EcologicalMusicState | undefined, mode: number[]): HarmonicField => {
  const stability = ecological?.interpretation.stability ?? snapshot.stats.stability;
  const tension = ecological?.interpretation.tension ?? snapshot.stats.threat;
  const richness = ecological?.interpretation.harmonicRichness ?? snapshot.stats.harmony;
  const driftSource = ecological?.composition.harmonicDrift ?? 0.1;
  const driftAmount = clamp(0.06 + driftSource * 0.2, 0.06, 0.24);
  const driftPhase = snapshot.time * (0.0018 + (ecological?.composition.evolutionSpeed ?? 0.1) * 0.0024) + richness * 0.8;

  const stableWeights = mode.map((_, idx) => {
    if (idx === 0) return 1.16;
    if (idx === 2) return 0.86;
    if (idx === 3) return 0.68;
    return 0.42;
  });
  const tensionWeights = mode.map((_, idx) => {
    if (idx === 1 || idx === 4) return 0.56;
    return 0.28;
  });

  const degreeWeights = mode.map((_, idx) => {
    const degreeNorm = idx / Math.max(1, mode.length - 1);
    const driftWave = 0.5 + Math.sin((driftPhase + degreeNorm * 0.64) * Math.PI * 2) * 0.5;
    const driftBias = driftWave * driftAmount;
    const calmLift = (1 - tension) * stableWeights[idx] * 0.34;
    const tensionLift = tension * tensionWeights[idx] * 0.18;
    const stabilityLift = stability * (idx === 0 || idx === 2 ? 0.2 : 0.08);
    return 0.14 + stableWeights[idx] * 0.26 + driftBias + calmLift + tensionLift + stabilityLift;
  });

  const stableDegreeWeights = mode.map((_, idx) => stableWeights[idx] + (1 - tension) * 0.2 + stability * 0.14);

  return {
    driftPhase,
    driftAmount,
    tonicDriftSemitones: Math.sin(driftPhase * Math.PI * 2) * (0.2 + driftAmount * 0.8),
    degreeWeights,
    stableDegreeWeights,
    emphasis: {
      stable: stableWeights,
      tension: tensionWeights,
    },
    rolePitchZones: ROLE_PITCH_ZONES,
  };
};

export const createHarmonyState = (snapshot: SimulationSnapshot, ecological?: EcologicalMusicState): HarmonyState => {
  const baseMode = chooseMode(snapshot, ecological);
  const modeName = slowRotateMode(baseMode, snapshot, ecological);
  const baseRootMidi = ecological
    ? ecological.composition.tonalCenter
    : Math.round(38 + snapshot.stats.nutrients * 4 + snapshot.stats.growth * 3 + snapshot.stats.harmony * 2 - snapshot.stats.threat * 3);
  const mode = [...MODES[modeName]];
  const field = createField(snapshot, ecological, mode);
  const driftedRoot = Math.round(baseRootMidi + clamp(field.tonicDriftSemitones, -1.2, 1.2));
  const rootMidi = clamp(driftedRoot, 30, 62);
  return {
    modeName,
    rootMidi,
    rootHz: midiToHz(rootMidi),
    mode,
    field,
  };
};

const chooseDegreeIndex = (weights: number[], contour: number, tightness: number): number => {
  const normalized = clamp(contour, 0, 1);
  const contourIndex = normalized * Math.max(1, weights.length - 1);
  if (tightness <= 0) return Math.round(contourIndex);

  let bestIndex = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < weights.length; i += 1) {
    const shapeDistance = Math.abs(i - contourIndex) / Math.max(1, weights.length - 1);
    const contourWeight = 1 - shapeDistance;
    const score = weights[i] * (0.46 + tightness * 0.6) + contourWeight * (1.18 - tightness);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
};

export const getHarmonyFrequency = (
  harmony: HarmonyState,
  layer: HarmonyLayer,
  contour: number,
  octaveOffset = 0,
  tightness = 0.8,
): number => {
  const degrees = LAYER_DEGREES[layer];
  const normalized = clamp(contour, 0, 1);
  const degreeSlot = Math.min(degrees.length - 1, Math.round(normalized * (degrees.length - 1)));
  const layerDegree = degrees[degreeSlot];
  const degreeOctave = Math.floor(layerDegree / harmony.mode.length) + octaveOffset;
  const contourDegreeIndex = layerDegree % harmony.mode.length;

  const selectedDegreeIndex = tightness > 0
    ? chooseDegreeIndex(
      harmony.field.degreeWeights.map((weight, idx) => {
        const layerAnchor = idx === contourDegreeIndex ? 1.12 : 1;
        const stableLift = harmony.field.stableDegreeWeights[idx] * 0.16;
        return (weight + stableLift) * layerAnchor;
      }),
      normalized,
      clamp(tightness, 0, 1),
    )
    : contourDegreeIndex;

  const blend = clamp(tightness, 0, 1);
  const finalDegree = Math.round(lerp(harmony.mode[contourDegreeIndex], harmony.mode[selectedDegreeIndex], blend));
  return midiToHz(harmony.rootMidi + finalDegree + degreeOctave * 12);
};

export const snapMidiToHarmony = (
  midi: number,
  harmony: HarmonyState,
  role: HarmonicPitchRole,
  tightness: number,
): number => {
  const zone = harmony.field.rolePitchZones[role] ?? harmony.field.rolePitchZones.mixed;
  const clampedMidi = clamp(midi, zone.min, zone.max);
  const minOct = Math.floor((zone.min - harmony.rootMidi) / 12) - 1;
  const maxOct = Math.ceil((zone.max - harmony.rootMidi) / 12) + 1;
  const snappedTightness = clamp(tightness, 0, 1);

  let bestMidi = clampedMidi;
  let bestScore = -Infinity;

  for (let octave = minOct; octave <= maxOct; octave += 1) {
    const octaveRoot = harmony.rootMidi + octave * 12;
    for (let degreeIndex = 0; degreeIndex < harmony.mode.length; degreeIndex += 1) {
      const candidate = octaveRoot + harmony.mode[degreeIndex];
      if (candidate < zone.min - 12 || candidate > zone.max + 12) continue;

      const dist = Math.abs(candidate - clampedMidi);
      const centerDist = Math.abs(candidate - zone.center);
      const pleasantness = harmony.field.degreeWeights[degreeIndex] * 0.54
        + harmony.field.stableDegreeWeights[degreeIndex] * 0.32
        + harmony.field.emphasis.stable[degreeIndex] * 0.22
        - harmony.field.emphasis.tension[degreeIndex] * 0.1;
      const score = pleasantness * (0.6 + snappedTightness * 0.75)
        - dist * (1.24 - snappedTightness * 0.76)
        - centerDist * (0.14 + snappedTightness * 0.46);

      if (score > bestScore) {
        bestScore = score;
        bestMidi = candidate;
      }
    }
  }

  return clamp(bestMidi, zone.min, zone.max);
};

export const quantizeToRoleZone = (
  midi: number,
  harmony: HarmonyState,
  role: HarmonicPitchRole,
  tightness: number,
): number => snapMidiToHarmony(midi, harmony, role, tightness);
