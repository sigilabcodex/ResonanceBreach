import type { EntityType, LifecycleStage } from '../../../config';
import type { Entity, Vec2 } from '../../../types/world';
import type { WorldEventInput } from '../../events';

export interface LifecycleRuntimeContext {
  readonly now: number;
  readonly rootBloomTypes: ReadonlySet<EntityType>;
  random(): number;
  spawnResidue(position: Vec2, nutrient: number, source: EntityType): void;
  spawnPropagule(position: Vec2, kind: 'seed' | 'spore', species: EntityType, sourceEntityId?: number, nutrientBoost?: number): void;
  emitBurst(type: 'feed' | 'birth' | 'death' | 'disrupt', position: Vec2, radius: number, hue: number): void;
  emitWorldEvent(event: WorldEventInput): void;
  incrementDeaths(): void;
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const computeLifecycleStage = (progress: number): LifecycleStage => {
  if (progress < 0.2) return 'birth';
  if (progress < 0.48) return 'growth';
  if (progress < 0.82) return 'mature';
  return 'decay';
};

export const computeLifecycleProgress = (
  entity: Entity,
  rootBloomTypes: ReadonlySet<EntityType>,
): number => {
  if (rootBloomTypes.has(entity.type)) {
    const bloomHealth = clamp(entity.growth * 0.46 + entity.pollination * 0.28 + entity.energy * 0.16 + entity.food * 0.1, 0, 1);
    const ageWeight = clamp(entity.age / entity.lifeSpan, 0, 1);
    return clamp(ageWeight * (entity.type === 'ephemeral' ? 0.5 : entity.type === 'canopy' ? 0.28 : 0.36) + bloomHealth * (entity.type === 'ephemeral' ? 0.5 : entity.type === 'canopy' ? 0.72 : 0.64), 0, 1);
  }
  if (entity.type === 'cluster') {
    const decayArc = clamp(entity.age / entity.lifeSpan, 0, 1);
    return clamp(decayArc * 0.48 + entity.growth * 0.3 + entity.memory * 0.22, 0, 1);
  }
  if (entity.type === 'grazer') {
    const grazeArc = clamp(entity.age / entity.lifeSpan, 0, 1);
    return clamp(grazeArc * 0.4 + entity.energy * 0.28 + entity.food * 0.26 + entity.growth * 0.06, 0, 1);
  }
  const driftArc = clamp(entity.age / entity.lifeSpan, 0, 1);
  return clamp(driftArc * 0.42 + entity.energy * 0.24 + entity.food * 0.22 + entity.memory * 0.12, 0, 1);
};
