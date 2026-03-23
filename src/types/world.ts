import type { EntityType, HabitatType, LifecycleStage, TerrainType, ToolType } from '../config';
import type { WorldEvent } from '../sim/events';

export interface Vec2 {
  x: number;
  y: number;
}

export interface WorldDimensions {
  width: number;
  height: number;
  wrapped: boolean;
}

export interface TerrainCell {
  index: number;
  center: Vec2;
  radius: number;
  terrain: TerrainType;
  habitat: HabitatType;
  habitatWeights: {
    wetland: number;
    highland: number;
    basin: number;
  };
  density: number;
  fertility: number;
  moisture: number;
  traversability: number;
  slope: number;
  stability: number;
  flow: Vec2;
  flowTendency: Vec2;
  gradient: Vec2;
  fertilityGradient: Vec2;
  moistureGradient: Vec2;
  resonance: number;
  height: number;
  roughness: number;
  hue: number;
  nutrient: number;
  temperature: number;
}

export interface Attractor {
  id: number;
  position: Vec2;
  strength: number;
  orbit: number;
  radius: number;
  hue: number;
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
  visualState: 'idle' | 'feeding' | 'reproducing' | 'dying';
  visualPulse: number;
  boundaryFade: number;
  activity: number;
  activityBias: number;
  food: number;
  fruitCooldown: number;
  vitality: number;
  pollination: number;
  memory: number;
  targetId?: number;
  targetKind?: 'bloom' | 'fruit' | 'feed' | 'residue' | 'seed' | 'signal';
  retargetTimer?: number;
  trail: Vec2[];
}

export interface ToolFeedback {
  id: number;
  tool: ToolType;
  position: Vec2;
  intensity: number;
}

export interface ToolField {
  id: number;
  tool: ToolType;
  position: Vec2;
  radius: number;
  strength: number;
  duration: number;
  age: number;
  pulse: number;
  delay?: number;
  exploded?: boolean;
}

export interface FeedParticle {
  id: number;
  kind: 'fruit' | 'feed';
  position: Vec2;
  velocity: Vec2;
  energy: number;
  age: number;
  duration: number;
  radius: number;
  sourceEntityId?: number;
}

export interface Residue {
  id: number;
  position: Vec2;
  nutrient: number;
  age: number;
  duration: number;
  radius: number;
  sourceType?: EntityType;
  richness: number;
}

export interface Propagule {
  id: number;
  kind: 'seed' | 'spore';
  species: EntityType;
  position: Vec2;
  velocity: Vec2;
  age: number;
  dormancy: number;
  viability: number;
  nutrient: number;
  sourceEntityId?: number;
}

export interface EventBurst {
  id: number;
  type: 'feed' | 'birth' | 'death' | 'disrupt';
  position: Vec2;
  radius: number;
  age: number;
  duration: number;
  hue: number;
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

export type AttentionMode = 'none' | 'entity' | 'region';

export interface AttentionState {
  mode: AttentionMode;
  entityId: number | null;
  position: Vec2;
  radius: number;
  strength: number;
  relatedEntityIds: number[];
  dragging: boolean;
  dragStart: Vec2 | null;
  dragCurrent: Vec2 | null;
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
  focus: number;
  nutrients: number;
  fruit: number;
  temperature: number;
}

export interface PerformanceStats {
  fps: number;
  frameTimeMs: number;
  updateTimeMs: number;
  renderTimeMs: number;
  drawCallEstimate: number;
  simSteps: number;
  audioUpdateTimeMs: number;
  simStepCapped: boolean;
  droppedSimTimeMs: number;
  simAccumulatorMs: number;
}

export interface SimulationDiagnostics {
  speciesUpdateTimeMs: Record<EntityType, number>;
  lifecycleTransitions: {
    propagulesCreated: number;
    germinations: number;
    deaths: number;
    fruitingBursts: number;
  };
  queryCounts: {
    neighbors: number;
    foodSearches: number;
    bloomSearches: number;
    grazerBloomSearches: number;
    residueSearches: number;
    terrainSamples: number;
    residueInfluenceSamples: number;
    terrainModifierChecks: number;
    attentionRefreshes: number;
    focusSelections: number;
    targetReuses: number;
    targetRetargets: number;
  };
  counts: {
    entities: number;
    fruit: number;
    feed: number;
    residues: number;
    propagules: number;
    particles: number;
    terrainModifiers: number;
    focusedEntities: number;
  };
  timingsMs: {
    attention: number;
    spawning: number;
  };
  topHotspots: string[];
}

export interface WorldNotifications {
  recent: string[];
}

export interface WorldState {
  dimensions: WorldDimensions;
  entities: Entity[];
  terrain: TerrainCell[];
  attractors: Attractor[];
  fields: ToolField[];
  particles: FeedParticle[];
  residues: Residue[];
  propagules: Propagule[];
  bursts: EventBurst[];
  stats: GardenStats;
  tool: ToolState;
  attention: AttentionState;
  camera: CameraState;
  time: number;
  timeScale: number;
  unlockedProgress: number;
  energy: number;
  events: WorldEvent[];
  notifications: WorldNotifications;
  diagnostics: SimulationDiagnostics;
}

export type SimulationSnapshot = WorldState;
