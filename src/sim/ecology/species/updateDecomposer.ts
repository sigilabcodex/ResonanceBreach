import { clamp, habitatMatch, habitatPenalty, lerp, smoothstep } from './shared';
import type { SpeciesBehaviorContext, SpeciesUpdateInput } from './types';

export const updateDecomposer = (
  context: SpeciesBehaviorContext,
  { entity, sample, neighbors, dt, localStats }: SpeciesUpdateInput,
): void => {
  const residue = context.shouldReuseTarget(entity)
    ? context.getTrackedResidueTarget(entity, 260)
    : undefined;
  const activeResidue = residue ?? context.findResidueTarget(entity.position);
  if (!residue) context.diagnostics.queryCounts.targetRetargets += 1;
  const targetOffset = activeResidue ? context.delta(entity.position, activeResidue.position) : undefined;
  const targetDistance = activeResidue ? Math.hypot(targetOffset!.x, targetOffset!.y) : Infinity;

  const wetBias = habitatMatch(sample, 'wetland');
  const basinBias = habitatMatch(sample, 'basin');
  const ridgePenalty = habitatPenalty(sample, 'highland');
  entity.velocity.x += sample.flow.x * dt * (0.026 + wetBias * 0.02) + sample.nutrient * sample.fertilityGradient.x * dt * (3.8 + basinBias * 2.2) - sample.gradient.x * dt * (2 + ridgePenalty * 3.2);
  entity.velocity.y += sample.flow.y * dt * (0.026 + wetBias * 0.02) + sample.nutrient * sample.fertilityGradient.y * dt * (3.8 + basinBias * 2.2) - sample.gradient.y * dt * (2 + ridgePenalty * 3.2);

  if (activeResidue && targetOffset && targetDistance < 260) {
    const dist = targetDistance || 1;
    const nx = targetOffset.x / dist;
    const ny = targetOffset.y / dist;
    const tangentX = -ny;
    const tangentY = nx;
    const creep = smoothstep(260, 0, dist) * 8;
    entity.velocity.x += (nx * creep + tangentX * 1.2) * dt;
    entity.velocity.y += (ny * creep + tangentY * 1.2) * dt;
    entity.targetId = activeResidue.id;
    entity.targetKind = 'residue';
    context.scheduleRetarget(entity, 1.1);

    if (dist < activeResidue.radius * 0.46 + entity.size + 10) {
      const consumed = Math.min(activeResidue.nutrient, dt * (0.045 + entity.appetite * 0.018));
      activeResidue.nutrient = clamp(activeResidue.nutrient - consumed, 0, 1.2);
      activeResidue.richness = clamp(activeResidue.richness - consumed * 0.65, 0, 1.4);
      entity.energy = clamp(entity.energy + consumed * 0.84, 0, 1.4);
      entity.food = clamp(entity.food + consumed * 0.66, 0, 1.5);
      entity.growth = clamp(entity.growth + consumed * 0.46, 0, 1.8);
      entity.memory = clamp(entity.memory + consumed * 0.7, 0, 1.2);
      entity.visualState = 'feeding';
      entity.visualPulse = Math.max(entity.visualPulse, 0.24);
      context.seedTerrain(activeResidue.position, activeResidue.radius * 0.54, consumed * 0.42, consumed * 0.08, -consumed * 0.02, 5.2);
      localStats.nutrients += consumed * 8;
    }
  } else {
    entity.targetId = undefined;
    entity.targetKind = undefined;
    context.scheduleRetarget(entity, 0.72);
    const crawlTheta = context.time * (0.012 + entity.activityBias * 0.01) + entity.id * 0.4;
    entity.velocity.x += Math.cos(crawlTheta) * dt * 0.55;
    entity.velocity.y += Math.sin(crawlTheta * 0.76) * dt * 0.42;
    entity.energy = clamp(entity.energy - dt * 0.004, 0, 1.3);
  }

  for (const other of neighbors) {
    if (other.type !== 'cluster') continue;
    const offset = context.delta(entity.position, other.position);
    const dist = Math.hypot(offset.x, offset.y) || 1;
    const proximity = clamp(1 - dist / 110, 0, 1);
    entity.velocity.x -= (offset.x / dist) * proximity * proximity * dt * 1.8;
    entity.velocity.y -= (offset.y / dist) * proximity * proximity * dt * 1.8;
  }

  if (sample.terrain === 'dense' || wetBias > 0.34 || basinBias > 0.34) {
    entity.stability = clamp(entity.stability + dt * (0.01 + wetBias * 0.018 + basinBias * 0.012), 0, 1.2);
    entity.energy = clamp(entity.energy + dt * (0.004 + wetBias * 0.008 + basinBias * 0.006), 0, 1.4);
  } else if (sample.terrain === 'solid' || sample.traversability < 0.24 || ridgePenalty > 0.64) {
    entity.energy = clamp(entity.energy - dt * (0.008 + ridgePenalty * 0.014), 0, 1.4);
  }

  entity.harmony = clamp(lerp(entity.harmony, 0.18 + sample.resonance * 0.24 + entity.memory * 0.08, dt * 0.06), 0, 1.1);
  entity.velocity.x *= Math.pow(0.965, dt * 60);
  entity.velocity.y *= Math.pow(0.965, dt * 60);
  entity.position = context.wrapPosition({
    x: entity.position.x + entity.velocity.x * dt * (0.3 + entity.activity * 0.4),
    y: entity.position.y + entity.velocity.y * dt * (0.3 + entity.activity * 0.4),
  });
};
