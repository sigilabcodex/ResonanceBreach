import type { Entity } from '../../../types/world';
import type { FieldSample } from '../../fields/types';
import type { SpeciesLocalStats, SpeciesRuntimeContext } from './types';
import { clamp, lerp, smoothstep } from './shared';

export const updateGrazer = (
  context: SpeciesRuntimeContext,
  entity: Entity,
  sample: FieldSample,
  neighbors: Entity[],
  dt: number,
  localStats: SpeciesLocalStats,
): void => {
  const nearestFruit = context.shouldReuseTarget(entity)
    ? context.getTrackedParticleTarget(entity, 300, (particle) => particle.kind === 'fruit')
    : undefined;
  const bloomTarget = nearestFruit
    ? undefined
    : context.shouldReuseTarget(entity)
      ? context.getTrackedBloomTarget(entity, 260, true)
      : undefined;
  const activeFruit = nearestFruit ?? context.findFoodTarget(entity.position, 300, (particle) => particle.kind === 'fruit');
  const activeBloomTarget = activeFruit ? undefined : (bloomTarget ?? context.findGrazerBloomTarget(entity.position));
  if (!nearestFruit && !bloomTarget) context.incrementTargetRetargets();

  const basinPull = context.habitatMatch(sample, 'basin');
  const wetPenalty = context.habitatPenalty(sample, 'wetland');
  const ridgePenalty = context.habitatPenalty(sample, 'highland');
  entity.velocity.x += sample.flow.x * dt * 0.024 + sample.fertilityGradient.x * dt * (3.6 + basinPull * 4.2) - sample.gradient.x * dt * (2.6 + ridgePenalty * 3.8);
  entity.velocity.y += sample.flow.y * dt * 0.024 + sample.fertilityGradient.y * dt * (3.6 + basinPull * 4.2) - sample.gradient.y * dt * (2.6 + ridgePenalty * 3.8);

  let separationX = 0;
  let separationY = 0;
  let grazerCount = 0;
  for (const other of neighbors) {
    if (other.type !== 'grazer') continue;
    const offset = context.delta(entity.position, other.position);
    const dist = Math.hypot(offset.x, offset.y) || 1;
    const proximity = clamp(1 - dist / 120, 0, 1);
    if (proximity <= 0) continue;
    grazerCount += 1;
    separationX -= (offset.x / dist) * proximity * proximity;
    separationY -= (offset.y / dist) * proximity * proximity;
  }

  const strideTheta = context.now * (0.014 + entity.activityBias * 0.008) + entity.id * 0.43;
  entity.velocity.x += Math.cos(strideTheta) * dt * 0.72;
  entity.velocity.y += Math.sin(strideTheta * 0.82) * dt * 0.56;

  if (activeFruit) {
    context.consumeParticle(entity, activeFruit, dt, 300, 300, 22, 22, 0.34, localStats);
    entity.memory = clamp(entity.memory + dt * 0.08, 0, 1.2);
    context.scheduleRetarget(entity, 1.4);
  } else if (activeBloomTarget) {
    const offset = context.delta(entity.position, activeBloomTarget.position);
    const dist = Math.hypot(offset.x, offset.y) || 1;
    const pull = smoothstep(260, 0, dist) * 14;
    entity.velocity.x += (offset.x / dist) * pull * dt;
    entity.velocity.y += (offset.y / dist) * pull * dt;
    entity.targetId = activeBloomTarget.id;
    entity.targetKind = 'bloom';
    context.scheduleRetarget(entity, 1.1);

    if (dist < entity.size + activeBloomTarget.size + 10) {
      const browseAmount = Math.min(dt * 0.12, activeBloomTarget.pollination * 0.1 + activeBloomTarget.energy * 0.04);
      activeBloomTarget.pollination = clamp(activeBloomTarget.pollination - browseAmount * 0.3, 0, 1.8);
      activeBloomTarget.energy = clamp(activeBloomTarget.energy - browseAmount * 0.08, 0, 1.5);
      activeBloomTarget.visualState = 'feeding';
      activeBloomTarget.visualPulse = Math.max(activeBloomTarget.visualPulse, 0.18);
      entity.energy = clamp(entity.energy + browseAmount * 0.72, 0, 1.5);
      entity.food = clamp(entity.food + browseAmount * 0.84, 0, 1.6);
      entity.growth = clamp(entity.growth + browseAmount * 0.2, 0, 1.8);
      entity.visualState = 'feeding';
      entity.visualPulse = Math.max(entity.visualPulse, 0.38);
      entity.pulse = Math.max(entity.pulse, 0.22);
      entity.acousticPressure = clamp(entity.acousticPressure + browseAmount * 0.26, 0, 1.4);
      if (context.shouldEmitSound(entity, dt, 1.6, 1 + browseAmount * 4)) {
        context.emitBurst('feed', entity.position, 9 + entity.size * 0.8, 0.12 + entity.hueShift * 0.03);
        context.emitWorldEvent({ type: 'entityFed', time: context.now, position: { ...entity.position }, entityType: entity.type, entityId: entity.id, foodKind: 'fruit' });
      }
    }
  } else {
    entity.targetId = undefined;
    entity.targetKind = undefined;
    context.scheduleRetarget(entity, 0.68);
    entity.energy = clamp(entity.energy - dt * 0.006, 0, 1.5);
    entity.stability = clamp(entity.stability - dt * 0.008, 0, 1.2);
    if (entity.energy < 0.24 || entity.food < 0.22) {
      entity.visualState = 'dying';
      entity.visualPulse = Math.max(entity.visualPulse, 0.18);
    }
  }

  if (grazerCount > 0) {
    entity.velocity.x += separationX * dt * 6.2;
    entity.velocity.y += separationY * dt * 6.2;
  }

  if (sample.terrain === 'fertile' || basinPull > 0.38) {
    entity.stability = clamp(entity.stability + dt * (0.008 + basinPull * 0.014), 0, 1.2);
    entity.energy = clamp(entity.energy + dt * basinPull * 0.012, 0, 1.5);
  } else if (sample.terrain === 'solid' || sample.traversability < 0.22 || ridgePenalty > 0.7) {
    entity.energy = clamp(entity.energy - dt * (0.016 + ridgePenalty * 0.022), 0, 1.5);
    entity.stability = clamp(entity.stability - dt * (0.016 + ridgePenalty * 0.024), 0, 1.2);
  } else if (sample.terrain === 'water' || wetPenalty > 0.44) {
    entity.velocity.x += sample.moistureGradient.x * dt * 1.1;
    entity.velocity.y += sample.moistureGradient.y * dt * 1.1;
    entity.energy = clamp(entity.energy - dt * (0.01 + wetPenalty * 0.016), 0, 1.5);
  }

  entity.harmony = clamp(lerp(entity.harmony, 0.24 + sample.resonance * 0.22 + entity.food * 0.16, dt * 0.05), 0, 1.1);
  entity.velocity.x *= Math.pow(0.957, dt * 60);
  entity.velocity.y *= Math.pow(0.957, dt * 60);
  entity.position = context.wrapPosition({
    x: entity.position.x + entity.velocity.x * dt * (0.28 + entity.activity * 0.34),
    y: entity.position.y + entity.velocity.y * dt * (0.28 + entity.activity * 0.34),
  });
};
