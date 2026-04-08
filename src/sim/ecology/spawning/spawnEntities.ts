import type { EntityType } from '../../../config';
import type { SpawningRuntimeContext } from './types';
import { clamp, habitatMatch, habitatPenalty } from './types';

export const spawnEntities = (context: SpawningRuntimeContext, dt: number): void => {
  const counts = context.countEntities();
  const additions = [];
  const pendingCounts: Record<EntityType, number> = {
    flocker: 0,
    cluster: 0,
    plant: 0,
    ephemeral: 0,
    canopy: 0,
    grazer: 0,
    parasite: 0,
    predator: 0,
  };

  for (const entity of context.entities) {
    if (entity.reproductionCooldown > 0) continue;
    const localDensity = context.getNeighborsByEntity(
      entity,
      context.rootBloomTypes.has(entity.type) ? 150 : entity.type === 'cluster' ? 100 : entity.type === 'grazer' ? 120 : 130,
    ).length;
    const localSample = context.sampleField(entity.position.x, entity.position.y);
    let producedEntity;
    let producedPropagule = false;

    if (
      entity.type === 'plant'
      && entity.stage !== 'birth'
      && entity.pollination > 0.58
      && entity.food > 0.72
      && entity.energy > 0.74
      && localSample.fertility > 0.42
      && localSample.moisture > 0.24
      && habitatMatch(localSample, 'basin') > 0.3
      && habitatPenalty(localSample, 'highland') < 0.54
      && counts.plant + pendingCounts.plant < context.maxBySpecies.plant
    ) {
      const birthRate = dt * clamp(0.008 + entity.pollination * 0.018 + localSample.fertility * 0.012 - localDensity * 0.005, 0.002, 0.04);
      if (context.random() <= birthRate) {
        context.spawnPropagule(
          context.findNearbySpawnPoint(entity.position, 84, (sample) => sample.fertility > 0.44 && sample.moisture > 0.26 && habitatMatch(sample, 'basin') > 0.34 && habitatPenalty(sample, 'highland') < 0.46 && sample.slope < 0.58),
          'seed',
          'plant',
          entity.id,
          0.48,
        );
        pendingCounts.plant += 1;
        producedPropagule = true;
        entity.reproductionCooldown = context.randomRange(24, 34);
        entity.pollination *= 0.58;
        entity.food *= 0.82;
        entity.energy *= 0.88;
      }
    } else if (
      entity.type === 'ephemeral'
      && entity.stage !== 'birth'
      && entity.pollination > 0.34
      && entity.energy > 0.54
      && localSample.temperature > 0.52
      && counts.ephemeral + pendingCounts.ephemeral < context.maxBySpecies.ephemeral
    ) {
      const birthRate = dt * clamp(0.016 + localSample.temperature * 0.02 + localSample.nutrient * 0.016 - localDensity * 0.006, 0.004, 0.06);
      if (context.random() <= birthRate) {
        context.spawnPropagule(
          context.findNearbySpawnPoint(entity.position, 96, (sample) => sample.temperature > 0.54 && sample.nutrient > 0.34 && sample.moisture > 0.24),
          'spore',
          'ephemeral',
          entity.id,
          0.34,
        );
        pendingCounts.ephemeral += 1;
        producedPropagule = true;
        entity.reproductionCooldown = context.randomRange(10, 18);
        entity.energy *= 0.86;
        entity.food *= 0.84;
      }
    } else if (
      entity.type === 'canopy'
      && entity.stage === 'mature'
      && entity.pollination > 0.62
      && entity.energy > 0.82
      && localSample.nutrient > 0.46
      && counts.canopy + pendingCounts.canopy < context.maxBySpecies.canopy
    ) {
      const birthRate = dt * clamp(0.004 + localSample.nutrient * 0.01 + entity.food * 0.008 - localDensity * 0.004, 0.001, 0.018);
      if (context.random() <= birthRate) {
        context.spawnPropagule(
          context.findNearbySpawnPoint(entity.position, 130, (sample) => sample.nutrient > 0.46 && Math.abs(sample.temperature - 0.42) < 0.22 && habitatPenalty(sample, 'highland') < 0.62),
          'seed',
          'canopy',
          entity.id,
          0.6,
        );
        pendingCounts.canopy += 1;
        producedPropagule = true;
        entity.reproductionCooldown = context.randomRange(32, 44);
        entity.energy *= 0.9;
        entity.food *= 0.88;
      }
    } else if (
      entity.type === 'flocker'
      && entity.stage !== 'birth'
      && entity.food > 0.74
      && entity.energy > 0.72
      && entity.memory > 0.3
      && localSample.traversability > 0.24
      && habitatPenalty(localSample, 'highland') < 0.72
      && counts.flocker + pendingCounts.flocker < context.maxBySpecies.flocker
    ) {
      const birthRate = dt * clamp(0.008 + entity.memory * 0.014 + localSample.moisture * 0.008 + habitatMatch(localSample, 'wetland') * 0.008 + habitatMatch(localSample, 'basin') * 0.006 - localDensity * 0.006, 0.001, 0.03);
      if (context.random() <= birthRate) {
        const position = context.findNearbySpawnPoint(entity.position, 62, (sample) => sample.moisture > 0.32 && sample.slope < 0.56 && sample.traversability > 0.24 && habitatPenalty(sample, 'highland') < 0.58);
        producedEntity = context.createEntity('flocker', position);
        additions.push(producedEntity);
        pendingCounts.flocker += 1;
        entity.reproductionCooldown = context.randomRange(20, 30);
        entity.food *= 0.7;
        entity.energy *= 0.82;
      }
    } else if (
      entity.type === 'grazer'
      && entity.stage !== 'birth'
      && entity.food > 0.84
      && entity.energy > 0.8
      && entity.memory > 0.28
      && localSample.traversability > 0.22
      && habitatMatch(localSample, 'basin') > 0.24
      && counts.grazer + pendingCounts.grazer < context.maxBySpecies.grazer
    ) {
      const nearbyFruit = context.findFoodTarget(entity.position, 180, (particle) => particle.kind === 'fruit');
      const birthRate = dt * clamp(0.006 + entity.food * 0.012 + entity.energy * 0.012 + habitatMatch(localSample, 'basin') * 0.01 - habitatPenalty(localSample, 'wetland') * 0.006 + (nearbyFruit ? 0.008 : 0) - localDensity * 0.007, 0.001, 0.024);
      if (context.random() <= birthRate) {
        const origin = nearbyFruit?.position ?? entity.position;
        const position = context.findNearbySpawnPoint(origin, 54, (terrain) => terrain.traversability > 0.24 && terrain.fertility > 0.34 && habitatMatch(terrain, 'basin') > 0.26 && habitatPenalty(terrain, 'wetland') < 0.5 && habitatPenalty(terrain, 'highland') < 0.54 && terrain.slope < 0.58);
        producedEntity = context.createEntity('grazer', position);
        additions.push(producedEntity);
        pendingCounts.grazer += 1;
        entity.reproductionCooldown = context.randomRange(28, 40);
        entity.food *= 0.62;
        entity.energy *= 0.74;
      }
    } else if (
      entity.type === 'cluster'
      && entity.stage !== 'birth'
      && entity.food > 0.6
      && entity.energy > 0.58
      && entity.memory > 0.34
      && counts.cluster + pendingCounts.cluster < context.maxBySpecies.cluster
    ) {
      const nearbyResidue = context.findResidueTarget(entity.position, 140);
      const birthRate = dt * clamp(0.006 + entity.memory * 0.012 + (nearbyResidue ? nearbyResidue.richness * 0.01 : 0) + habitatMatch(localSample, 'wetland') * 0.008 + habitatMatch(localSample, 'basin') * 0.005 - habitatPenalty(localSample, 'highland') * 0.01 - localDensity * 0.006, 0.001, 0.024);
      if (context.random() <= birthRate) {
        const origin = nearbyResidue?.position ?? entity.position;
        context.spawnPropagule(
          context.findNearbySpawnPoint(origin, 48, (sample) => sample.nutrient > 0.2 && sample.traversability > 0.1 && habitatPenalty(sample, 'highland') < 0.68 && sample.slope < 0.7),
          'spore',
          'cluster',
          entity.id,
          0.4,
        );
        pendingCounts.cluster += 1;
        producedPropagule = true;
        entity.reproductionCooldown = context.randomRange(22, 34);
        entity.food *= 0.72;
        entity.energy *= 0.84;
      }
    } else if (
      entity.type === 'parasite'
      && entity.stage !== 'birth'
      && entity.energy > 0.72
      && entity.memory > 0.22
      && localSample.temperature > 0.48
      && counts.parasite + pendingCounts.parasite < context.maxBySpecies.parasite
    ) {
      const birthRate = dt * clamp(0.004 + localSample.temperature * 0.012 + localSample.nutrient * 0.006 - localDensity * 0.006, 0.001, 0.018);
      if (context.random() <= birthRate) {
        context.spawnPropagule(
          context.findNearbySpawnPoint(entity.position, 60, (sample) => sample.temperature > 0.5 && sample.fertility > 0.24 && habitatPenalty(sample, 'highland') < 0.62),
          'spore',
          'parasite',
          entity.id,
          0.3,
        );
        pendingCounts.parasite += 1;
        producedPropagule = true;
        entity.reproductionCooldown = context.randomRange(24, 36);
        entity.energy *= 0.9;
        entity.food *= 0.88;
      }
    } else {
      continue;
    }

    entity.visualState = 'reproducing';
    entity.visualPulse = 0.8;
    context.emitBurst('birth', entity.position, 14 + entity.size, 0.34 + entity.hueShift * 0.05);
    if (producedEntity) {
      context.emitWorldEvent({ type: 'entityBorn', time: context.now, position: { ...producedEntity.position }, entityType: producedEntity.type, entityId: producedEntity.id });
    } else if (producedPropagule) {
      context.incrementPropagulesCreated();
    }
  }

  context.entities.push(...additions);
};
