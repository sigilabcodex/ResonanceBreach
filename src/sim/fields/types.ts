import type { TerrainType } from '../../config';
import type { Vec2 } from '../../types/world';

export interface FieldSample {
  terrain: TerrainType;
  fertility: number;
  stability: number;
  density: number;
  resonance: number;
  roughness: number;
  flow: Vec2;
  hue: number;
  nutrient: number;
}

export interface TerrainModifier {
  id: number;
  position: Vec2;
  radius: number;
  fertility: number;
  moisture: number;
  solidity: number;
  age: number;
  duration: number;
}
