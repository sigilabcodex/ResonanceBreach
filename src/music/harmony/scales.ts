import type { MusicScaleMode } from '../types/music';

export const SCALE_INTERVALS: Record<MusicScaleMode, number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
};

export const MODE_PRIORITY: MusicScaleMode[] = ['dorian', 'ionian', 'aeolian', 'mixolydian', 'lydian', 'pentatonicMajor', 'pentatonicMinor'];
