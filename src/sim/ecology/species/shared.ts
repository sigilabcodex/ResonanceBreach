import type { FieldSample } from '../../fields/types';
import type { HabitatType } from '../../../config';

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};
export const habitatMatch = (sample: FieldSample, preferred: HabitatType): number => sample.habitatWeights[preferred];
export const habitatPenalty = (sample: FieldSample, avoided: HabitatType): number => sample.habitatWeights[avoided];
