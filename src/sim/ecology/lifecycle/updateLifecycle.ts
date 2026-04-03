import type { Entity } from '../../../types/world';
import { computeLifecycleProgress, computeLifecycleStage } from './types';
import type { LifecycleRuntimeContext } from './types';

export const updateLifecycle = (
  entity: Entity,
  dt: number,
  context: LifecycleRuntimeContext,
): void => {
  entity.age += dt;
  entity.pulse = Math.max(0, entity.pulse - dt * 0.28);
  entity.visualPulse = Math.max(0, entity.visualPulse - dt * 0.44);
  entity.reproductionCooldown = Math.max(0, entity.reproductionCooldown - dt);
  entity.fruitCooldown = Math.max(0, entity.fruitCooldown - dt);
  entity.soundCooldown = Math.max(0, entity.soundCooldown - dt);
  entity.stageProgress = computeLifecycleProgress(entity, context.rootBloomTypes);
  entity.stage = computeLifecycleStage(entity.stageProgress);
  if (entity.visualPulse <= 0.03 && entity.visualState !== 'dying') entity.visualState = 'idle';
};
