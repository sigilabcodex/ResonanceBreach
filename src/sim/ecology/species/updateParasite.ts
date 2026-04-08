import { clamp, habitatPenalty, lerp, smoothstep } from './shared';
import type { SpeciesBehaviorContext, SpeciesUpdateInput } from './types';

export const updateParasite = (
  context: SpeciesBehaviorContext,
  { entity, sample, neighbors, dt, localStats }: SpeciesUpdateInput,
): void => {
  const host = context.shouldReuseTarget(entity)
    ? context.getTrackedBloomTarget(entity, 220)
    : undefined;
  const activeHost = host ?? context.findBloomTarget(entity.position);
  const warmth = clamp(1 - Math.abs(sample.temperature - 0.66) * 1.6, 0, 1);
  localStats.threat += dt * 0.04;
  const denseBias = sample.terrain === 'dense' ? 0.12 : 0;
  entity.velocity.x += sample.flow.x * dt * 0.018 + sample.fertilityGradient.x * dt * 2.2 - sample.gradient.x * dt * 1.2;
  entity.velocity.y += sample.flow.y * dt * 0.018 + sample.fertilityGradient.y * dt * 2.2 - sample.gradient.y * dt * 1.2;

  if (activeHost) {
    const offset = context.delta(entity.position, activeHost.position);
    const dist = Math.hypot(offset.x, offset.y) || 1;
    const pull = smoothstep(220, 0, dist) * 10;
    entity.velocity.x += (offset.x / dist) * pull * dt;
    entity.velocity.y += (offset.y / dist) * pull * dt;
    entity.targetId = activeHost.id;
    entity.targetKind = 'bloom';
    context.scheduleRetarget(entity, 1.15);
    if (dist < entity.size + activeHost.size + 12) {
      const siphon = Math.min(dt * 0.06, activeHost.energy * 0.04 + activeHost.food * 0.03 + activeHost.pollination * 0.02);
      activeHost.energy = clamp(activeHost.energy - siphon * 0.8, 0, 1.5);
      activeHost.food = clamp(activeHost.food - siphon * 0.4, 0, 1.6);
      activeHost.pollination = clamp(activeHost.pollination - siphon * 0.22, 0, 1.8);
      activeHost.visualState = 'dying';
      activeHost.visualPulse = Math.max(activeHost.visualPulse, 0.22);
      entity.energy = clamp(entity.energy + siphon * 1.1, 0, 1.4);
      entity.food = clamp(entity.food + siphon * 0.8, 0, 1.5);
      entity.growth = clamp(entity.growth + siphon * 0.36, 0, 1.8);
      entity.memory = clamp(entity.memory + siphon * 0.48, 0, 1.2);
      entity.visualState = 'feeding';
      entity.visualPulse = Math.max(entity.visualPulse, 0.28);
      context.affectEnvironment(entity.position, 36 + entity.size * 2, -siphon * 0.32, siphon * 0.06);
      if (context.rng.next() < dt * 0.8) {
        context.spawnResidue(entity.position, siphon * 0.28 + 0.04, 'parasite');
      }
    }
  } else {
    entity.targetId = undefined;
    entity.targetKind = undefined;
    const sway = context.time * (0.01 + entity.activityBias * 0.008) + entity.id * 0.37;
    entity.velocity.x += Math.cos(sway) * dt * 0.44;
    entity.velocity.y += Math.sin(sway * 0.81) * dt * 0.34;
    entity.energy = clamp(entity.energy - dt * 0.01, 0, 1.4);
    entity.food = clamp(entity.food - dt * 0.006, 0, 1.5);
  }

  for (const other of neighbors) {
    if (other.type !== 'parasite') continue;
    const offset = context.delta(entity.position, other.position);
    const dist = Math.hypot(offset.x, offset.y) || 1;
    const proximity = clamp(1 - dist / 80, 0, 1);
    entity.velocity.x -= (offset.x / dist) * proximity * proximity * dt * 2.2;
    entity.velocity.y -= (offset.y / dist) * proximity * proximity * dt * 2.2;
  }

  entity.harmony = clamp(lerp(entity.harmony, 0.16 + sample.resonance * 0.18 + warmth * 0.08 + denseBias, dt * 0.06), 0, 1.1);
  entity.stability = clamp(entity.stability + dt * (warmth * 0.012 + denseBias * 0.04 - habitatPenalty(sample, 'highland') * 0.018), 0, 1.2);
  entity.velocity.x *= Math.pow(0.968, dt * 60);
  entity.velocity.y *= Math.pow(0.968, dt * 60);
  entity.position = context.wrapPosition({
    x: entity.position.x + entity.velocity.x * dt * (0.24 + entity.activity * 0.28),
    y: entity.position.y + entity.velocity.y * dt * (0.24 + entity.activity * 0.28),
  });

  if (entity.stage !== 'birth' && entity.energy > 0.7 && warmth > 0.4 && context.rng.next() < dt * 0.08) {
    context.spawnPropagule(entity.position, 'spore', 'parasite', entity.id, 0.34);
    entity.energy *= 0.92;
  }
};
