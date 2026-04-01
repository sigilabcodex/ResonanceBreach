import type { EcologicalMusicState } from '../audio/ecologicalMusic';
import type { HarmonyState } from '../audio/harmony';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface PhraseInfluence {
  density: number;
  calmness: number;
  activity: number;
  registerBias: number;
}

export interface ScheduledPhraseNote {
  beatOffset: number;
  midi: number;
  durationBeats: number;
  velocity: number;
  voice: 'pad' | 'chime' | 'pluck';
}

const choose = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)] ?? items[0];

const chooseVoice = (density: number): 'pad' | 'chime' | 'pluck' => {
  if (density < 0.28) return Math.random() < 0.72 ? 'pad' : 'chime';
  if (density < 0.56) return Math.random() < 0.4 ? 'pad' : (Math.random() < 0.5 ? 'pluck' : 'chime');
  return Math.random() < 0.55 ? 'pluck' : 'chime';
};

const safeDegree = (harmony: HarmonyState, degreeBias = 0): number => {
  const safeDegrees = [0, 2, 3, 1];
  const idx = clamp(Math.round((Math.random() * 0.7 + degreeBias * 0.3) * (safeDegrees.length - 1)), 0, safeDegrees.length - 1);
  const degree = safeDegrees[idx] ?? 0;
  return harmony.mode[degree % harmony.mode.length] ?? harmony.mode[0] ?? 0;
};

export const derivePhraseInfluence = (music: EcologicalMusicState): PhraseInfluence => {
  const calmness = clamp(music.interpretation.stability * 0.7 + (1 - music.interpretation.tension) * 0.3, 0, 1);
  const density = clamp(music.composition.rhythmDensity * 0.6 + music.interpretation.localActivity * 0.25 + (1 - calmness) * 0.15, 0.08, 0.7);
  const registerBias = clamp(0.46 + music.interpretation.harmonicRichness * 0.2 - music.interpretation.decayPresence * 0.18, 0.12, 0.84);
  return {
    density,
    calmness,
    activity: clamp(music.interpretation.globalActivity, 0, 1),
    registerBias,
  };
};

export const generatePhrase = (
  harmony: HarmonyState,
  influence: PhraseInfluence,
  phraseBeats: number,
): ScheduledPhraseNote[] => {
  const silenceChance = clamp(0.24 + influence.calmness * 0.36 - influence.density * 0.2, 0.2, 0.72);
  if (Math.random() < silenceChance) return [];

  const noteCount = influence.density < 0.3 ? 1 + (Math.random() < 0.35 ? 1 : 0) : 2 + (Math.random() < influence.density * 0.4 ? 1 : 0);
  const offsets = phraseBeats <= 6 ? [0, 2, 4] : [0, 1.5, 3, 5, 6.5];
  const notes: ScheduledPhraseNote[] = [];
  let motifAnchor = choose([0, 1, 2]);

  for (let i = 0; i < noteCount; i += 1) {
    const beatOffset = offsets[i] ?? (i * 2);
    const octave = influence.registerBias > 0.6 ? 5 : influence.registerBias < 0.3 ? 3 : 4;
    const degree = safeDegree(harmony, motifAnchor / 3);
    const contourShift = choose([-2, 0, 0, 2]);
    const midi = harmony.rootMidi + degree + octave * 12 - 48 + contourShift;
    const durationBeats = choose([0.5, 0.75, 1, 1.5]);
    const velocity = clamp(0.16 + influence.activity * 0.16 + (1 - influence.calmness) * 0.08 + Math.random() * 0.1, 0.14, 0.5);

    notes.push({
      beatOffset,
      midi,
      durationBeats,
      velocity,
      voice: i === 0 && Math.random() < 0.35 ? 'pad' : chooseVoice(influence.density),
    });

    motifAnchor = (motifAnchor + choose([-1, 0, 1, 1])) % 4;
  }

  return notes;
};
