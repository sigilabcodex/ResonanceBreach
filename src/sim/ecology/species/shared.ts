import type { HabitatType } from '../../../config';
import type { FieldSample } from '../../fields/types';

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};
export const habitatMatch = (sample: FieldSample, preferred: HabitatType) => sample.habitatWeights[preferred];
export const habitatPenalty = (sample: FieldSample, avoided: HabitatType) => sample.habitatWeights[avoided];
