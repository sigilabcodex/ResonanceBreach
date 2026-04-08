import type { HabitatType } from '../../../config';
import type { FieldSample } from '../../fields/types';
import type { WorldEventInput } from '../../events';
import type { Entity, FeedParticle, Residue, Vec2 } from '../../../types/world';

export interface SpeciesLocalStats {
  harmony: number;
  activity: number;
  threat: number;
  stability: number;
  interactions: number;
  focus: number;
  nutrients: number;
  fruit: number;
  temperature: number;
}

export interface SpeciesRuntimeContext {
  readonly now: number;
  delta(a: Vec2, b: Vec2): Vec2;
  wrapPosition(position: Vec2): Vec2;
  habitatMatch(sample: FieldSample, preferred: HabitatType): number;
  habitatPenalty(sample: FieldSample, avoided: HabitatType): number;
  shouldReuseTarget(entity: Entity): boolean;
  scheduleRetarget(entity: Entity, urgency?: number): void;
  getTrackedParticleTarget(entity: Entity, radius: number, predicate: (particle: FeedParticle) => boolean): FeedParticle | undefined;
  getTrackedResidueTarget(entity: Entity, radius: number): Residue | undefined;
  getTrackedBloomTarget(entity: Entity, radius: number, grazer?: boolean): Entity | undefined;
  findFoodTarget(position: Vec2, radius: number, predicate: (particle: FeedParticle) => boolean): FeedParticle | undefined;
  findBloomTarget(position: Vec2): Entity | undefined;
  findGrazerBloomTarget(position: Vec2): Entity | undefined;
  findResidueTarget(position: Vec2): Residue | undefined;
  consumeParticle(
    entity: Entity,
    particle: FeedParticle,
    dt: number,
    seekRadius: number,
    pullRadius: number,
    fruitPull: number,
    feedPull: number,
    gain: number,
    localStats: SpeciesLocalStats,
  ): void;
  computePairResonance(a: Entity, b: Entity, proximity: number): { harmony: number; dissonance: number };
  affectEnvironment(position: Vec2, radius: number, nutrientDelta: number, temperatureDelta: number): void;
  seedTerrain(position: Vec2, radius: number, fertility: number, moisture: number, solidity: number, duration: number): void;
  spawnParticle(origin: Vec2, spread: number, kind: FeedParticle['kind'], initial: boolean, sourceEntityId?: number): void;
  emitBurst(type: 'feed' | 'birth' | 'death' | 'disrupt', position: Vec2, radius: number, hue: number): void;
  emitWorldEvent(event: WorldEventInput): void;
  spawnPropagule(position: Vec2, kind: 'seed' | 'spore', species: Entity['type'], sourceEntityId?: number, nutrient?: number): void;
  spawnResidue(position: Vec2, nutrient: number, sourceType?: Entity['type']): void;
  random(): number;
  randomRange(min: number, max: number): number;
  shouldEmitSound(entity: Entity, dt: number, baseRate: number, contextWeight: number): boolean;
  incrementTargetRetargets(): void;
  incrementFruitingBursts(): void;
}
