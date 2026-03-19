import type { EntityType } from '../config';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Entity {
  id: number;
  type: EntityType;
  position: Vec2;
  velocity: Vec2;
  energy: number;
  phase: number;
  resonance: number;
  age: number;
}

export interface StabilizerZone {
  active: boolean;
  position: Vec2;
  radius: number;
  charge: number;
}

export interface SimulationSnapshot {
  entities: Entity[];
  stability: number;
  pressure: number;
  avgResonance: number;
  zone: StabilizerZone;
  time: number;
  lost: boolean;
}
