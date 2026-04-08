import type { FieldSample } from '../../fields/types';
import type { WorldEventInput } from '../../events';
import type { Entity, EventBurst, FeedParticle, Residue, Vec2 } from '../../../types/world';
import type { EntityType } from '../../../config';

export type SpeciesLocalStats = {
  harmony: number;
  activity: number;
  threat: number;
  stability: number;
  interactions: number;
  focus: number;
  nutrients: number;
  fruit: number;
  temperature: number;
};

export type SpeciesTargetPredicate = (particle: FeedParticle) => boolean;

export interface SpeciesBehaviorContext {
  readonly time: number;
  readonly rng: { next(): number; range(min: number, max: number): number };
  readonly diagnostics: { queryCounts: { targetRetargets: number }; lifecycleTransitions: { fruitingBursts: number } };
  delta(from: Vec2, to: Vec2): Vec2;
  wrapPosition(position: Vec2): Vec2;
  affectEnvironment(position: Vec2, radius: number, nutrientDelta: number, temperatureDelta: number): void;
  seedTerrain(position: Vec2, radius: number, fertilityDelta: number, moistureDelta: number, traversabilityDelta: number, softness: number): void;
  spawnParticle(position: Vec2, radius: number, kind: FeedParticle['kind'], fromTool?: boolean, sourceEntityId?: number): void;
  spawnPropagule(position: Vec2, kind: 'seed' | 'spore', species: Entity['type'], sourceEntityId: number, nutrient: number): void;
  spawnResidue(position: Vec2, nutrient: number, source?: EntityType): void;
  emitBurst(type: EventBurst['type'], position: Vec2, radius: number, intensity: number): void;
  emitWorldEvent(input: WorldEventInput): void;
  shouldEmitSound(entity: Entity, dt: number, baseRate: number, contextWeight: number): boolean;
  scheduleRetarget(entity: Entity, duration: number): void;
  shouldReuseTarget(entity: Entity): boolean;
  consumeParticle(entity: Entity, particle: FeedParticle, dt: number, range: number, approach: number, consumeDistance: number, settleDistance: number, gainScale: number, localStats: SpeciesLocalStats): void;
  getTrackedParticleTarget(entity: Entity, maxDistance: number, predicate: SpeciesTargetPredicate): FeedParticle | undefined;
  getTrackedBloomTarget(entity: Entity, maxDistance: number, requireMature?: boolean): Entity | undefined;
  getTrackedResidueTarget(entity: Entity, maxDistance: number): Residue | undefined;
  findFoodTarget(position: Vec2, maxDistance: number, predicate: SpeciesTargetPredicate): FeedParticle | undefined;
  findBloomTarget(position: Vec2): Entity | undefined;
  findGrazerBloomTarget(position: Vec2): Entity | undefined;
  findResidueTarget(position: Vec2): Residue | undefined;
  computePairResonance(entity: Entity, other: Entity, proximity: number): { harmony: number; dissonance: number };
}

export interface SpeciesUpdateInput {
  entity: Entity;
  sample: FieldSample;
  neighbors: Entity[];
  dt: number;
  localStats: SpeciesLocalStats;
}

export interface PlantUpdateInput {
  entity: Entity;
  sample: FieldSample;
  dt: number;
  localStats: SpeciesLocalStats;
}
