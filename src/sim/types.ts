import type { EntityType, ToolType, ZoneType } from '../config';

export interface Vec2 {
  x: number;
  y: number;
}

export interface ResonanceState {
  alignment: number;
  harmony: number;
  dissonance: number;
}

export interface Entity {
  id: number;
  type: EntityType;
  position: Vec2;
  velocity: Vec2;
  heading: number;
  size: number;
  energy: number;
  growth: number;
  resonance: number;
  phase: number;
  pulse: number;
  tone: number;
  age: number;
  life: number;
  zoneAffinity: number;
  wander: number;
  anchor?: Vec2;
  cooldown?: number;
}

export interface ZoneCell {
  index: number;
  col: number;
  row: number;
  center: Vec2;
  bounds: { x: number; y: number; width: number; height: number };
  weights: Record<ZoneType, number>;
  flow: Vec2;
  shimmer: number;
}

export interface ToolState {
  active: ToolType;
  unlocked: ToolType[];
  pulse: number;
  worldPosition: Vec2;
  radius: number;
  strength: number;
  visible: boolean;
}

export interface CameraState {
  center: Vec2;
  zoom: number;
}

export interface GardenStats {
  harmony: number;
  activity: number;
  mystery: number;
  growth: number;
}

export interface SimulationSnapshot {
  entities: Entity[];
  zones: ZoneCell[];
  stats: GardenStats;
  tool: ToolState;
  camera: CameraState;
  time: number;
  timeScale: number;
  anomalyPulse: number;
  narrativeHint: number;
}
