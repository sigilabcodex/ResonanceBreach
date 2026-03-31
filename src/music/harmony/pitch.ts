import { SCALE_INTERVALS } from './scales';
import type { HarmonicField, MusicScaleMode } from '../types/music';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const degreeToMidi = (rootMidi: number, mode: MusicScaleMode, degree: number): number => {
  const intervals = SCALE_INTERVALS[mode];
  const degreeCount = intervals.length;
  const octave = Math.floor(degree / degreeCount);
  const normalizedDegree = ((degree % degreeCount) + degreeCount) % degreeCount;
  return rootMidi + octave * 12 + intervals[normalizedDegree];
};

export const clampMidiToRegister = (midi: number, field: HarmonicField, register: 'low' | 'mid' | 'high'): number => {
  const range = field.register[register];
  return clamp(midi, range - 6, range + 10);
};

export const buildHarmonicField = (rootMidi: number, mode: MusicScaleMode, tension: number): HarmonicField => ({
  rootMidi,
  mode,
  register: {
    low: rootMidi - 12,
    mid: rootMidi,
    high: rootMidi + 12,
  },
  chordDegrees: tension > 0.6 ? [0, 2, 4, 6] : [0, 2, 4],
  tension,
});
