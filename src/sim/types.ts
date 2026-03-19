import type { EntityRole, SystemPhase } from '../config';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Entity {
  id: number;
  role: EntityRole;
  position: Vec2;
  velocity: Vec2;
  energy: number;
  phase: number;
  resonance: number;
  charge: number;
  cluster: number;
  driftBias: number;
  age: number;
  pulse: number;
  instability: number;
  lifespan: number;
}

export interface StabilizerZone {
  active: boolean;
  position: Vec2;
  radius: number;
  charge: number;
  pulse: number;
  recovery: number;
}

export interface FieldCell {
  index: number;
  col: number;
  row: number;
  center: Vec2;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  flow: Vec2;
  containment: number;
  instability: number;
  resonance: number;
  density: number;
  hazard: number;
}

export interface BarrierSegment {
  axis: 'vertical' | 'horizontal';
  position: number;
  spanStart: number;
  spanEnd: number;
  gateCenter: number;
  gateSize: number;
  strength: number;
}

export interface Hotspot {
  x: number;
  y: number;
  intensity: number;
  radius: number;
}

export interface PhaseState {
  current: SystemPhase;
  progress: number;
  blend: Record<SystemPhase, number>;
}

export interface CameraState {
  center: Vec2;
  zoom: number;
}

export interface SimulationSnapshot {
  entities: Entity[];
  field: FieldCell[];
  barriers: BarrierSegment[];
  hotspots: Hotspot[];
  stability: number;
  pressure: number;
  avgResonance: number;
  outbreakRisk: number;
  zone: StabilizerZone;
  time: number;
  lost: boolean;
  phaseState: PhaseState;
  rhythmicPressure: number;
  camera: CameraState;
  timeScale: number;
}
