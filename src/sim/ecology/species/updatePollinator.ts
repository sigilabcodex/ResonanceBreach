import type { Entity } from '../../../types/world';
import type { FieldSample } from '../../fields/types';
import type { SpeciesLocalStats, SpeciesRuntimeContext } from './types';
import { clamp, smoothstep } from './shared';

export const updatePollinator = (
  context: SpeciesRuntimeContext,
  entity: Entity,
  sample: FieldSample,
  neighbors: Entity[],
  dt: number,
  localStats: SpeciesLocalStats,
): void => {
  const nearestFood = context.shouldReuseTarget(entity)
    ? context.getTrackedParticleTarget(entity, 240, (particle) => particle.kind === 'fruit' || particle.kind === 'feed')
    : undefined;
  const bloomTarget = !nearestFood && context.shouldReuseTarget(entity)
    ? context.getTrackedBloomTarget(entity, 340)
    : undefined;
  const activeFood = nearestFood ?? (!bloomTarget
    ? context.findFoodTarget(entity.position, 240, (particle) => particle.kind === 'fruit' || particle.kind === 'feed')
    : undefined);
  const activeBloomTarget = activeFood ? undefined : (bloomTarget ?? context.findBloomTarget(entity.position));
  if (!nearestFood && !bloomTarget) context.incrementTargetRetargets();
  const nearestOffset = activeBloomTarget ? context.delta(entity.position, activeBloomTarget.position) : undefined;
  const nearestDistance = activeBloomTarget ? Math.hypot(nearestOffset!.x, nearestOffset!.y) : Infinity;

  let cohesionX = 0;
  let cohesionY = 0;
  let separationX = 0;
  let separationY = 0;
  let neighborCount = 0;

  for (const other of neighbors) {
    if (other.type !== 'flocker') continue;
    const offset = context.delta(entity.position, other.position);
    const dist = Math.hypot(offset.x, offset.y) || 1;
    const proximity = clamp(1 - dist / 150, 0, 1);
    if (proximity <= 0) continue;
    neighborCount += 1;
    cohesionX += offset.x * proximity;
    cohesionY += offset.y * proximity;
    separationX -= (offset.x / dist) * proximity * proximity;
    separationY -= (offset.y / dist) * proximity * proximity;
    const pair = context.computePairResonance(entity, other, proximity);
    entity.harmony = clamp(entity.harmony + (pair.harmony - pair.dissonance * 0.18) * dt * 0.08, 0, 1.2);
    entity.stability = clamp(entity.stability + (pair.harmony - pair.dissonance * 0.12) * dt * 0.04, 0, 1.2);
  }

  const wanderTheta = context.now * (0.03 + entity.activityBias * 0.028) + entity.id * 0.6;
  entity.velocity.x += Math.cos(wanderTheta) * dt * 1.6 * entity.activity;
  entity.velocity.y += Math.sin(wanderTheta * 0.85) * dt * 1.2 * entity.activity;
  const wetPull = context.habitatMatch(sample, 'wetland');
  const basinPull = context.habitatMatch(sample, 'basin');
  const ridgePush = context.habitatPenalty(sample, 'highland');
  entity.velocity.x += sample.flow.x * dt * (0.04 + wetPull * 0.08 + entity.activity * 0.06) + sample.fertilityGradient.x * dt * (5.8 + basinPull * 3.8) - sample.gradient.x * dt * (4.2 + ridgePush * 4.8);
  entity.velocity.y += sample.flow.y * dt * (0.04 + wetPull * 0.08 + entity.activity * 0.06) + sample.fertilityGradient.y * dt * (5.8 + basinPull * 3.8) - sample.gradient.y * dt * (4.2 + ridgePush * 4.8);

  if (activeBloomTarget && nearestOffset && nearestDistance < 320) {
    const dist = nearestDistance || 1;
    const nx = nearestOffset.x / dist;
    const ny = nearestOffset.y / dist;
    const tangentX = -ny;
    const tangentY = nx;
    const curve = 0.55 + Math.sin(context.now * 0.12 + entity.id) * 0.24;
    const pull = smoothstep(320, 0, dist) * 18;
    entity.velocity.x += (nx * pull + tangentX * curve * 8) * dt;
    entity.velocity.y += (ny * pull + tangentY * curve * 8) * dt;
    entity.targetId = activeBloomTarget.id;
    entity.targetKind = 'bloom';
    entity.memory = clamp(entity.memory + dt * 0.08, 0, 1.2);
    context.scheduleRetarget(entity, 1.15);

    if (dist < entity.size + activeBloomTarget.size + 14) {
      activeBloomTarget.pollination = clamp(activeBloomTarget.pollination + dt * 0.48, 0, 1.8);
      activeBloomTarget.energy = clamp(activeBloomTarget.energy + dt * 0.12, 0, 1.5);
      activeBloomTarget.growth = clamp(activeBloomTarget.growth + dt * 0.08, 0, 1.8);
      activeBloomTarget.visualState = 'feeding';
      activeBloomTarget.visualPulse = Math.max(activeBloomTarget.visualPulse, 0.22);
      entity.visualState = 'feeding';
      entity.visualPulse = Math.max(entity.visualPulse, 0.3);
      entity.energy = clamp(entity.energy + dt * 0.06, 0, 1.5);
      entity.food = clamp(entity.food + dt * 0.04, 0, 1.5);
      localStats.fruit += dt * 0.8;
    }
  } else if (activeFood) {
    context.consumeParticle(entity, activeFood, dt, 240, 190, 16, 12, 0.2, localStats);
    context.scheduleRetarget(entity, 1.35);
  } else {
    entity.targetId = undefined;
    entity.targetKind = undefined;
    context.scheduleRetarget(entity, 0.72);
  }

  if (neighborCount > 0) {
    const inv = 1 / neighborCount;
    entity.velocity.x += cohesionX * inv * dt * 0.012;
    entity.velocity.y += cohesionY * inv * dt * 0.012;
    entity.velocity.x += separationX * dt * 7.5;
    entity.velocity.y += separationY * dt * 7.5;
  }

  if (sample.traversability < 0.28 || sample.terrain === 'solid' || ridgePush > 0.72) {
    entity.velocity.x -= sample.gradient.x * dt * (10 + ridgePush * 8) + sample.flow.x * dt * 0.04;
    entity.velocity.y -= sample.gradient.y * dt * (10 + ridgePush * 8) + sample.flow.y * dt * 0.04;
    entity.energy -= dt * (0.016 + ridgePush * 0.018);
    entity.stability = clamp(entity.stability - dt * (0.024 + ridgePush * 0.028), 0, 1.2);
  } else if (sample.terrain === 'dense') {
    entity.velocity.x *= Math.pow(0.93, dt * 60);
    entity.velocity.y *= Math.pow(0.93, dt * 60);
    entity.stability = clamp(entity.stability + dt * 0.008, 0, 1.2);
  } else if (sample.terrain === 'fertile' || basinPull > 0.42) {
    entity.energy = clamp(entity.energy + dt * (0.008 + basinPull * 0.012), 0, 1.5);
  } else if (sample.terrain === 'water' || wetPull > 0.48) {
    entity.velocity.x += sample.moistureGradient.x * dt * (1.8 + wetPull * 1.2);
    entity.velocity.y += sample.moistureGradient.y * dt * (1.8 + wetPull * 1.2);
    entity.stability = clamp(entity.stability + dt * 0.006, 0, 1.2);
  }

  const damping = 0.982 - wetPull * 0.012 - ridgePush * 0.018;
  entity.velocity.x *= Math.pow(damping, dt * 60);
  entity.velocity.y *= Math.pow(damping, dt * 60);
  entity.position = context.wrapPosition({
    x: entity.position.x + entity.velocity.x * dt * (0.46 + entity.activity * 0.72),
    y: entity.position.y + entity.velocity.y * dt * (0.46 + entity.activity * 0.72),
  });
};
