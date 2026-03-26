import type { EcologicalMusicState, EcologicalVoiceRole } from './ecologicalMusic';
import type { SimulationSnapshot } from '../types/world';

type HarmonyLayer = 'bed' | 'plant' | 'cluster' | 'mobile' | 'event' | 'water';

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

const ROLE_PITCH_ZONES: Record<EcologicalVoiceRole, { min: number; max: number; center: number }> = {
  bloom: { min: 56, max: 88, center: 72 },
  grazer: { min: 45, max: 74, center: 58 },
  pollinator: { min: 60, max: 92, center: 79 },
  decay: { min: 38, max: 67, center: 50 },
};

const MODE_ORDER: (keyof typeof MODES)[] = ['suspendedPentatonic', 'dorianPentatonic', 'ionianPentatonic', 'lydianPentatonic'];

export interface HarmonicField {
  driftPhase: number;
  driftAmount: number;
  degreeWeights: number[];
  stableDegreeWeights: number[];
  rolePitchZones: Record<EcologicalVoiceRole, { min: number; max: number; center: number }>;
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
  const speed = 0.003 + (ecological?.composition.evolutionSpeed ?? 0.1) * 0.004;
  const phase = snapshot.time * speed + richness * 0.7;
  const wobble = Math.sin(phase * Math.PI * 2);
  if (Math.abs(wobble) < 0.65) return baseMode;
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
  const driftAmount = clamp(0.08 + driftSource * 0.22, 0.08, 0.3);
  const driftPhase = snapshot.time * (0.004 + (ecological?.composition.evolutionSpeed ?? 0.1) * 0.006) + richness * 0.8;

  const weights = mode.map((_, idx) => {
    const degreeNorm = idx / Math.max(1, mode.length - 1);
    const tonicBias = idx === 0 ? 0.44 : idx === 2 ? 0.2 : idx === 3 ? 0.16 : 0.08;
    const calmBias = (1 - tension) * (idx === 1 ? 0.08 : idx === 4 ? 0.06 : 0.12);
    const driftWave = 0.5 + Math.sin((driftPhase + degreeNorm * 0.7) * Math.PI * 2) * 0.5;
    const driftBias = driftWave * driftAmount;
    const stabilityBias = stability * (idx === 0 || idx === 2 ? 0.2 : 0.08);
    return tonicBias + calmBias + driftBias + stabilityBias;
  });

  const stableDegreeWeights = mode.map((_, idx) => {
    const stableBase = idx === 0 ? 1 : idx === 2 ? 0.7 : idx === 3 ? 0.56 : 0.36;
    return stableBase + (1 - tension) * 0.22;
  });

  return {
    driftPhase,
    driftAmount,
    degreeWeights: weights,
    stableDegreeWeights,
    rolePitchZones: ROLE_PITCH_ZONES,
  };
};

export const createHarmonyState = (snapshot: SimulationSnapshot, ecological?: EcologicalMusicState): HarmonyState => {
  const baseMode = chooseMode(snapshot, ecological);
  const modeName = slowRotateMode(baseMode, snapshot, ecological);
  const rootMidi = ecological
    ? ecological.composition.tonalCenter
    : Math.round(38 + snapshot.stats.nutrients * 4 + snapshot.stats.growth * 3 + snapshot.stats.harmony * 2 - snapshot.stats.threat * 3);
  const mode = [...MODES[modeName]];
  return {
    modeName,
    rootMidi,
    rootHz: midiToHz(rootMidi),
    mode,
    field: createField(snapshot, ecological, mode),
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
    const score = weights[i] * (0.4 + tightness * 0.6) + contourWeight * (1.2 - tightness);
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
      harmony.field.degreeWeights.map((weight, idx) => weight * (idx === contourDegreeIndex ? 1.1 : 1)),
      normalized,
      clamp(tightness, 0, 1),
    )
    : contourDegreeIndex;

  const blend = clamp(tightness, 0, 1);
  const finalDegree = Math.round(lerp(harmony.mode[contourDegreeIndex], harmony.mode[selectedDegreeIndex], blend));
  return midiToHz(harmony.rootMidi + finalDegree + degreeOctave * 12);
};

export const quantizeToRoleZone = (
  midi: number,
  harmony: HarmonyState,
  role: EcologicalVoiceRole,
  tightness: number,
): number => {
  const zone = harmony.field.rolePitchZones[role];
  const clampedMidi = clamp(midi, zone.min, zone.max);
  const nearestOctave = Math.round((clampedMidi - harmony.rootMidi) / 12);
  const octaveRoot = harmony.rootMidi + nearestOctave * 12;
  const candidates = harmony.mode
    .map((degree) => octaveRoot + degree)
    .concat(harmony.mode.map((degree) => octaveRoot + degree - 12), harmony.mode.map((degree) => octaveRoot + degree + 12))
    .map((candidate) => ({
      midi: candidate,
      score: Math.abs(candidate - clampedMidi) * (1.2 - tightness)
        + Math.abs(candidate - zone.center) * (0.2 + tightness * 0.6),
    }))
    .sort((a, b) => a.score - b.score);
  return candidates[0]?.midi ?? clampedMidi;
};
