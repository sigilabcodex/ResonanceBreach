import type { EntityType, LifecycleStage, TerrainType, ToolType } from '../config';

export interface Vec2 {
  x: number;
  y: number;
}

export interface TerrainCell {
  index: number;
  col: number;
  row: number;
  center: Vec2;
  bounds: { x: number; y: number; width: number; height: number };
  terrain: TerrainType;
  density: number;
  fertility: number;
  stability: number;
  flow: Vec2;
  resonance: number;
  height: number;
  roughness: number;
}

export interface Entity {
  id: number;
  type: EntityType;
  stage: LifecycleStage;
  position: Vec2;
  velocity: Vec2;
  heading: number;
  size: number;
  baseSize: number;
  energy: number;
  growth: number;
  resonance: number;
  harmony: number;
  stability: number;
  age: number;
  lifeSpan: number;
  stageProgress: number;
  reproductionCooldown: number;
  pulse: number;
  tone: number;
  shape: number;
  hueShift: number;
  terrainBias: number;
  clusterId: number;
  appetite: number;
  anchor?: Vec2;
}

export interface ToolFeedback {
  id: number;
  tool: ToolType;
  position: Vec2;
  intensity: number;
}

export interface ToolState {
  active: ToolType;
  unlocked: ToolType[];
  pulse: number;
  worldPosition: Vec2;
  radius: number;
  strength: number;
  visible: boolean;
  blocked: boolean;
  feedback?: ToolFeedback;
}

export interface CameraState {
  center: Vec2;
  zoom: number;
}

export interface GardenStats {
  harmony: number;
  activity: number;
  threat: number;
  growth: number;
  energy: number;
  stability: number;
  biodiversity: number;
}

export interface SimulationSnapshot {
  entities: Entity[];
  terrain: TerrainCell[];
  stats: GardenStats;
  tool: ToolState;
  camera: CameraState;
  time: number;
  timeScale: number;
  unlockedProgress: number;
}
