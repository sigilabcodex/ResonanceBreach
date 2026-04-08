import { ENERGY_MAX } from '../../../config';
import type { Entity, FeedParticle, GardenStats, TerrainCell, ToolField } from '../../../types/world';
import type { EntityType } from '../../../config';
import type { LocalEcologyStats } from './types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const updateSimulationEnergy = (
  energy: number,
  dt: number,
  localStats: LocalEcologyStats,
  fields: ToolField[],
): number => {
  const interactions = Math.max(1, localStats.interactions);
  const harmony = localStats.harmony / interactions;
  const stability = localStats.stability / interactions;
  const nutrientLift = localStats.nutrients / interactions;
  const gain = clamp(harmony * 0.24 + stability * 0.24 + nutrientLift * 0.22, 0, 1) * dt * 5.6;
  const loss = clamp(fields.filter((field) => field.tool !== 'observe').length * 0.03 + localStats.threat / interactions, 0, 1.2) * dt * 3.8;
  return clamp(energy + gain - loss, 0, ENERGY_MAX);
};

export const computeGardenStats = (
  energy: number,
  counts: Record<EntityType, number>,
  entities: Entity[],
  terrain: TerrainCell[],
  particles: FeedParticle[],
  localStats?: LocalEcologyStats,
): GardenStats => {
  const interactions = Math.max(1, localStats?.interactions ?? entities.length);
  const harmony = clamp((localStats?.harmony ?? entities.reduce((sum, entity) => sum + entity.harmony, 0)) / interactions, 0, 1);
  const activity = clamp((localStats?.activity ?? entities.reduce((sum, entity) => sum + entity.activity, 0)) / interactions, 0, 1);
  const threat = clamp((localStats?.threat ?? counts.predator * 0.06) / interactions, 0, 1);
  const stability = clamp((localStats?.stability ?? entities.reduce((sum, entity) => sum + entity.stability, 0)) / interactions, 0, 1);
  const growth = clamp(entities.reduce((sum, entity) => sum + entity.growth, 0) / Math.max(1, entities.length), 0, 1);
  const richness = [counts.flocker > 0, counts.cluster > 0, counts.plant > 0, counts.ephemeral > 0, counts.canopy > 0, counts.grazer > 0, counts.parasite > 0].filter(Boolean).length / 7;
  const focus = clamp((localStats?.focus ?? 0) / Math.max(1, entities.length * 0.7), 0, 1);
  const nutrients = clamp((localStats?.nutrients ?? terrain.reduce((sum, cell) => sum + cell.nutrient, 0)) / Math.max(1, terrain.length), 0, 1);
  const fruit = clamp(((localStats?.fruit ?? particles.filter((particle) => particle.kind === 'fruit').length) / 24), 0, 1);
  const temperature = clamp((localStats?.temperature ?? terrain.reduce((sum, cell) => sum + cell.temperature, 0)) / Math.max(1, terrain.length), 0, 1);

  return {
    harmony,
    activity,
    threat,
    growth,
    stability,
    biodiversity: clamp(richness * 0.72 + entities.length / 120, 0, 1),
    energy: energy / ENERGY_MAX,
    focus,
    nutrients,
    fruit,
    temperature,
  };
};
