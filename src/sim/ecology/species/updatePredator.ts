import { clamp, habitatMatch, lerp, smoothstep } from './shared';
import type { SpeciesBehaviorContext, SpeciesUpdateInput } from './types';

export const updatePredator = (
  context: SpeciesBehaviorContext,
  { entity, sample, neighbors, dt, localStats }: SpeciesUpdateInput,
): void => {
  const hungerNeed = clamp((0.62 - entity.energy) * 0.72 + (0.56 - entity.food) * 0.92, 0, 1.2);

  let loudestSignal;
  let loudestScore = 0;
  for (const other of neighbors) {
    if (other.id === entity.id) continue;
    const offset = context.delta(entity.position, other.position);
    const distance = Math.max(1, Math.hypot(offset.x, offset.y));
    const amplitude = clamp(other.visualPulse * 0.52 + other.activity * 0.3 + other.energy * 0.1, 0, 1.4);
    const repetitiveness = clamp(other.acousticPattern * 0.7 + other.pulse * 0.3, 0, 1.2);
    const irregularity = clamp(Math.abs(other.acousticPattern - other.pulse), 0, 1);
    const regularity = 1 - irregularity * 0.7;
    const silenceCover = clamp(0.34 - other.activity * 0.14 - other.visualPulse * 0.22, 0, 0.26);
    const score = Math.max(0, (amplitude * 0.64 + repetitiveness * 0.46) * regularity - silenceCover) * clamp(1 - distance / 320, 0, 1);
    if (score > loudestScore) {
      loudestScore = score;
      loudestSignal = other;
    }
  }

  entity.acousticPressure = lerp(entity.acousticPressure, loudestScore, dt * 0.6);
  entity.acousticPattern = lerp(entity.acousticPattern, loudestSignal ? loudestSignal.acousticPattern : 0.2, dt * 0.35);
  const opportunity = clamp(entity.acousticPressure * 0.62 + loudestScore * 0.38, 0, 1.4);
  if (entity.predatorState === 'resting') {
    if (hungerNeed > 0.64 || (hungerNeed > 0.4 && opportunity > 0.42)) {
      entity.predatorState = 'hunting';
    }
  } else if (hungerNeed < 0.24 && opportunity < 0.2) {
    entity.predatorState = 'resting';
  }
  const hunting = entity.predatorState === 'hunting';

  const basinBias = habitatMatch(sample, 'basin');
  entity.velocity.x += sample.flow.x * dt * 0.022 + sample.fertilityGradient.x * dt * (1.2 + basinBias * 1.4) - sample.gradient.x * dt * 1.8;
  entity.velocity.y += sample.flow.y * dt * 0.022 + sample.fertilityGradient.y * dt * (1.2 + basinBias * 1.4) - sample.gradient.y * dt * 1.8;

  if (hunting && loudestSignal && loudestScore > 0.24) {
    const offset = context.delta(entity.position, loudestSignal.position);
    const distance = Math.max(1, Math.hypot(offset.x, offset.y));
    const pull = smoothstep(320, 0, distance) * (6 + loudestScore * 8);
    entity.velocity.x += (offset.x / distance) * pull * dt;
    entity.velocity.y += (offset.y / distance) * pull * dt;
    entity.targetId = loudestSignal.id;
    entity.targetKind = 'signal';
    entity.activity = lerp(entity.activity, 0.5 + loudestScore * 0.4, dt * 1.8);
    localStats.threat += dt * (0.03 + loudestScore * 0.18);
    if (distance < 26) {
      entity.food = clamp(entity.food + dt * 0.24, 0, 1.4);
    }
  } else {
    entity.targetId = undefined;
    entity.targetKind = undefined;
    const driftTheta = context.time * 0.01 + entity.id * 0.36;
    entity.velocity.x += Math.cos(driftTheta) * dt * (hunting ? 0.28 : 0.18);
    entity.velocity.y += Math.sin(driftTheta * 0.8) * dt * (hunting ? 0.24 : 0.16);
    entity.activity = lerp(entity.activity, hunting ? 0.2 : 0.06, dt * 1.6);
  }

  entity.velocity.x *= Math.pow(0.964, dt * 60);
  entity.velocity.y *= Math.pow(0.964, dt * 60);
  entity.position = context.wrapPosition({
    x: entity.position.x + entity.velocity.x * dt * (0.26 + entity.activity * 0.34),
    y: entity.position.y + entity.velocity.y * dt * (0.26 + entity.activity * 0.34),
  });
  entity.energy = clamp(entity.energy + dt * (hunting ? -0.011 : 0.0024), 0, 1.2);
  entity.harmony = clamp(lerp(entity.harmony, 0.14 + sample.resonance * 0.2, dt * 0.04), 0, 1.1);
};
