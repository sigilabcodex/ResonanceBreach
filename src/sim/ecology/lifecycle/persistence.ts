import type { Entity } from '../../../types/world';
import { clamp } from './types';
import type { LifecycleRuntimeContext } from './types';

export const shouldPersist = (
  entity: Entity,
  context: LifecycleRuntimeContext,
): boolean => {
  if (entity.energy <= 0.04 || entity.food <= 0.03) return false;
  if (entity.stageProgress >= 1 && entity.energy < 0.2) return false;
  if (!context.rootBloomTypes.has(entity.type) && entity.stability <= 0.04) return false;
  return true;
};

export const handleDeathTransition = (
  entity: Entity,
  context: LifecycleRuntimeContext,
): void => {
  context.spawnResidue(entity.position, clamp(0.26 + entity.growth * 0.3 + entity.vitality * 0.24 + entity.pollination * 0.1, 0.18, 1), entity.type);
  context.incrementDeaths();
  if (context.rootBloomTypes.has(entity.type) && context.random() < 0.72) {
    context.spawnPropagule(entity.position, entity.type === 'canopy' ? 'seed' : 'spore', entity.type, entity.id, 0.32);
  }
  if (entity.type === 'cluster' || entity.type === 'parasite') {
    context.spawnPropagule(entity.position, 'spore', entity.type, entity.id, 0.24);
  }
  context.emitBurst('death', entity.position, 18 + entity.size * 1.4, 0.88 + entity.hueShift * 0.03);
  context.emitWorldEvent({ type: 'entityDied', time: context.now, position: { ...entity.position }, entityType: entity.type, entityId: entity.id });
};
