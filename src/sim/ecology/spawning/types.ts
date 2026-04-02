import type { EntityType, HabitatType } from '../../../config';
import type { FieldSample } from '../../fields/types';
import type { Entity, FeedParticle, Propagule, Residue, Vec2 } from '../../../types/world';
import type { WorldEventInput } from '../../events';

export interface SpawningRuntimeContext {
  readonly rootBloomTypes: ReadonlySet<EntityType>;
  readonly maxBySpecies: Readonly<Record<EntityType, number>>;
  readonly now: number;
  readonly entities: Entity[];
  getPropagules(): Propagule[];
  setPropagules(propagules: Propagule[]): void;
  sampleField(x: number, y: number): FieldSample;
  wrapPosition(position: Vec2): Vec2;
  countEntities(): Record<EntityType, number>;
  getNeighborsAtPosition(position: Vec2, radius: number): Entity[];
  getNeighborsByEntity(entity: Entity, radius: number): Entity[];
  getEntitySpawnSuitability(type: EntityType, sample: FieldSample): number;
  findNearbySpawnPoint(origin: Vec2, radius: number, predicate: (sample: FieldSample) => boolean): Vec2;
  findFoodTarget(position: Vec2, radius: number, filter?: (particle: FeedParticle) => boolean): FeedParticle | null;
  findResidueTarget(position: Vec2, radius: number): Residue | null;
  createEntity(type: EntityType, position: Vec2): Entity;
  spawnPropagule(position: Vec2, kind: Propagule['kind'], species: EntityType, sourceEntityId?: number, nutrientBoost?: number): void;
  emitBurst(type: 'feed' | 'birth' | 'death' | 'disrupt', position: Vec2, radius: number, hue: number): void;
  emitWorldEvent(event: WorldEventInput): void;
  removePropaguleById(id: number): void;
  affectEnvironment(position: Vec2, radius: number, nutrientDelta: number, temperatureDelta: number): void;
  random(): number;
  randomRange(min: number, max: number): number;
  incrementGerminations(): void;
  incrementPropagulesCreated(): void;
}

export const habitatMatch = (sample: FieldSample, preferred: HabitatType) => sample.habitatWeights[preferred];
export const habitatPenalty = (sample: FieldSample, avoided: HabitatType) => sample.habitatWeights[avoided];

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
