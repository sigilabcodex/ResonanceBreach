import type { Entity } from '../../../types/world';
import type { FieldSample } from '../../fields/types';
import type { SpeciesLocalStats, SpeciesRuntimeContext } from './types';
import { clamp, lerp } from './shared';

export const updatePlant = (
  context: SpeciesRuntimeContext,
  entity: Entity,
  sample: FieldSample,
  dt: number,
  localStats: SpeciesLocalStats,
): void => {
  const anchor = entity.anchor ?? entity.position;
  const anchorDelta = context.delta(entity.position, anchor);
  entity.velocity.x = lerp(entity.velocity.x, -anchorDelta.x * (entity.type === 'canopy' ? 0.028 : 0.02) + sample.flow.x * 0.012 + sample.moistureGradient.x * (entity.type === 'ephemeral' ? 3.2 : 2.8) - sample.gradient.x * (entity.type === 'canopy' ? 2 : 2.4), dt * (entity.type === 'canopy' ? 0.35 : 0.5));
  entity.velocity.y = lerp(entity.velocity.y, -anchorDelta.y * (entity.type === 'canopy' ? 0.028 : 0.02) + sample.flow.y * 0.012 + sample.moistureGradient.y * (entity.type === 'ephemeral' ? 3.2 : 2.8) - sample.gradient.y * (entity.type === 'canopy' ? 2 : 2.4), dt * (entity.type === 'canopy' ? 0.35 : 0.5));
  entity.position = context.wrapPosition({
    x: entity.position.x + entity.velocity.x * dt,
    y: entity.position.y + entity.velocity.y * dt,
  });

  const basinBoost = context.habitatMatch(sample, 'basin');
  const wetBoost = context.habitatMatch(sample, 'wetland');
  const ridgeStress = context.habitatPenalty(sample, 'highland');
  const preferredTemperature = entity.type === 'ephemeral' ? 0.68 : entity.type === 'canopy' ? 0.42 : 0.54;
  const temperatureComfort = clamp(1 - Math.abs(sample.temperature - preferredTemperature) * (entity.type === 'canopy' ? 1.35 : 1.55), 0, 1);
  const nutrientDemand = entity.type === 'ephemeral' ? 0.05 : entity.type === 'canopy' ? 0.07 : 0.045;
  const fertilityScore = sample.fertility * (entity.type === 'canopy' ? 0.34 : 0.42)
    + sample.nutrient * (entity.type === 'ephemeral' ? 0.48 : entity.type === 'canopy' ? 0.44 : 0.38)
    + sample.moisture * (entity.type === 'ephemeral' ? 0.16 : 0.12)
    + entity.pollination * (entity.type === 'canopy' ? 0.14 : 0.16)
    + basinBoost * (entity.type === 'canopy' ? 0.18 : 0.22)
    + wetBoost * (entity.type === 'ephemeral' ? 0.12 : 0.08)
    + temperatureComfort * 0.18;
  const stress = (1 - sample.traversability) * 0.04
    + sample.slope * (entity.type === 'canopy' ? 0.02 : 0.028)
    + ridgeStress * (entity.type === 'ephemeral' ? 0.06 : 0.08)
    + (sample.terrain === 'solid' ? 0.06 : sample.terrain === 'water' ? (entity.type === 'ephemeral' ? 0.01 : 0.016) : 0)
    + Math.max(0, 0.38 - fertilityScore) * (entity.type === 'ephemeral' ? 0.04 : 0.05)
    + Math.max(0, 0.42 - temperatureComfort) * (entity.type === 'ephemeral' ? 0.05 : 0.04);

  context.affectEnvironment(entity.position, 40 + entity.size * 2.6, -nutrientDemand * dt * (0.7 + entity.growth * 0.4), entity.type === 'ephemeral' ? 0.01 * dt : entity.type === 'canopy' ? -0.005 * dt : 0.002 * dt);

  entity.growth = clamp(entity.growth + dt * (fertilityScore * (entity.type === 'ephemeral' ? 0.07 : entity.type === 'canopy' ? 0.038 : 0.05) - stress), 0, 1.8);
  entity.energy = clamp(entity.energy + dt * (fertilityScore * (entity.type === 'canopy' ? 0.068 : 0.08) - stress * 1.22), 0, 1.4);
  entity.food = clamp(entity.food + dt * (sample.nutrient * (entity.type === 'ephemeral' ? 0.08 : entity.type === 'canopy' ? 0.075 : 0.065) + sample.fertility * 0.04 - stress * 0.82), 0, 1.5);
  entity.harmony = clamp(lerp(entity.harmony, 0.34 + sample.resonance * 0.32 + sample.moisture * 0.08 + entity.pollination * 0.12 + temperatureComfort * 0.08, dt * 0.08), 0, 1.2);

  if (fertilityScore > 0.6 && entity.stage !== 'birth') {
    context.seedTerrain(entity.position, 48 + entity.size * (entity.type === 'canopy' ? 3.2 : 2.4), 0.008 * dt, entity.type === 'ephemeral' ? 0.005 * dt : 0.003 * dt, -0.001 * dt, entity.type === 'canopy' ? 3.6 : 2.6);
  }

  const fruitingHealth = fertilityScore * 0.34 + entity.energy * 0.24 + entity.food * 0.16 + entity.growth * 0.14 + entity.pollination * 0.08 + temperatureComfort * 0.12;
  if (
    entity.stage === 'mature'
    && entity.fruitCooldown <= 0
    && fruitingHealth > (entity.type === 'ephemeral' ? 0.66 : entity.type === 'canopy' ? 0.78 : 0.72)
    && entity.pollination > (entity.type === 'canopy' ? 0.52 : 0.42)
    && entity.energy > (entity.type === 'ephemeral' ? 0.62 : 0.74)
    && entity.food > (entity.type === 'ephemeral' ? 0.58 : 0.7)
    && sample.terrain !== 'solid'
  ) {
    const fruitCount = entity.type === 'canopy' ? (sample.nutrient > 0.42 ? 4 : 3) : entity.type === 'ephemeral' ? 1 : sample.nutrient > 0.42 ? 2 : 1;
    for (let i = 0; i < fruitCount; i += 1) {
      context.spawnParticle(entity.position, entity.size * (entity.type === 'canopy' ? 3.2 : 2.6), 'fruit', false, entity.id);
      localStats.fruit += 1;
    }
    entity.fruitCooldown = context.randomRange(entity.type === 'ephemeral' ? 7 : entity.type === 'canopy' ? 18 : 12, entity.type === 'ephemeral' ? 12 : entity.type === 'canopy' ? 28 : 20);
    entity.energy *= entity.type === 'ephemeral' ? 0.84 : 0.9;
    entity.food *= entity.type === 'ephemeral' ? 0.86 : 0.92;
    entity.visualState = 'reproducing';
    entity.visualPulse = 0.42;
    context.incrementFruitingBursts();
    context.emitBurst('birth', entity.position, 8 + entity.size * 0.7, 0.12 + entity.hueShift * 0.04);
    context.emitWorldEvent({ type: 'fruitCreated', time: context.now, position: { ...entity.position }, sourceEntityId: entity.id, count: fruitCount });
  }

  const propaguleChance = entity.type === 'ephemeral' ? 0.24 : entity.type === 'canopy' ? 0.06 : 0.1;
  if (entity.stage !== 'birth' && entity.pollination > 0.4 && entity.energy > 0.56 && context.random() < dt * propaguleChance * clamp(sample.nutrient + temperatureComfort, 0.4, 1.4)) {
    context.spawnPropagule(entity.position, entity.type === 'canopy' ? 'seed' : 'spore', entity.type, entity.id, entity.type === 'canopy' ? 0.56 : 0.38);
    entity.pollination *= entity.type === 'ephemeral' ? 0.88 : 0.92;
  }

  if (entity.stage === 'decay' && (fertilityScore < 0.34 || entity.energy < 0.28 || temperatureComfort < 0.22)) {
    entity.visualState = 'dying';
    entity.visualPulse = Math.max(entity.visualPulse, 0.18);
    entity.energy = clamp(entity.energy - dt * (entity.type === 'ephemeral' ? 0.022 : 0.015), 0, 1.4);
  }
};
