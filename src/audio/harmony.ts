import type { EcologicalMusicState } from './ecologicalMusic';
import type { SimulationSnapshot } from '../types/world';

type HarmonyLayer = 'bed' | 'plant' | 'cluster' | 'mobile' | 'event' | 'water';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
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

export interface HarmonyState {
  modeName: keyof typeof MODES;
  rootMidi: number;
  rootHz: number;
  mode: number[];
}

export const createHarmonyState = (snapshot: SimulationSnapshot, ecological?: EcologicalMusicState): HarmonyState => {
  const { stability, threat, nutrients, harmony, growth } = snapshot.stats;
  const modeName: keyof typeof MODES = ecological?.composition.mode === 'degraded'
    ? 'aeolianPentatonic'
    : ecological?.composition.mode === 'tense'
      ? 'dorianPentatonic'
      : ecological?.composition.mode === 'fertile'
        ? 'lydianPentatonic'
        : threat > 0.3
          ? 'dorianPentatonic'
          : stability > 0.62 && harmony > 0.5
            ? 'ionianPentatonic'
            : 'suspendedPentatonic';
  const rootMidi = ecological
    ? ecological.composition.tonalCenter
    : Math.round(38 + nutrients * 4 + growth * 3 + harmony * 2 - threat * 3);
  return {
    modeName,
    rootMidi,
    rootHz: midiToHz(rootMidi),
    mode: [...MODES[modeName]],
  };
};

export const getHarmonyFrequency = (
  harmony: HarmonyState,
  layer: HarmonyLayer,
  contour: number,
  octaveOffset = 0,
): number => {
  const degrees = LAYER_DEGREES[layer];
  const normalized = clamp(contour, 0, 1);
  const degreeIndex = Math.min(degrees.length - 1, Math.round(normalized * (degrees.length - 1)));
  const modeDegree = degrees[degreeIndex] % harmony.mode.length;
  const octaveLift = Math.floor(degrees[degreeIndex] / harmony.mode.length) + octaveOffset;
  return midiToHz(harmony.rootMidi + harmony.mode[modeDegree] + octaveLift * 12);
};
