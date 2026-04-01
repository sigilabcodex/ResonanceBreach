import type { WorldEvent } from '../../sim/events';
import type { SimulationSnapshot } from '../../types/world';
import type { MusicWorldFeatures } from '../types/music';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const eventAccumulator = (events: WorldEvent[], worldTime: number) => {
  const bias = { birth: 0, death: 0, feeding: 0, tool: 0, residue: 0, fruiting: 0 };
  let energy = 0;

  for (const event of events) {
    const freshness = clamp(1 - (worldTime - event.time) / 8, 0, 1);
    switch (event.type) {
      case 'entityBorn':
        bias.birth += 0.8 * freshness;
        energy += 0.25 * freshness;
        break;
      case 'entityDied':
        bias.death += 1 * freshness;
        energy += 0.35 * freshness;
        break;
      case 'entityFed':
        bias.feeding += 0.7 * freshness;
        energy += 0.2 * freshness;
        break;
      case 'toolUsed':
        bias.tool += event.blocked ? 0.2 * freshness : 0.9 * freshness;
        energy += 0.4 * freshness;
        break;
      case 'residueCreated':
        bias.residue += 0.65 * freshness;
        energy += 0.25 * freshness;
        break;
      case 'fruitCreated':
        bias.fruiting += 0.75 * freshness;
        energy += 0.3 * freshness;
        break;
    }
  }

  const total = Math.max(1, bias.birth + bias.death + bias.feeding + bias.tool + bias.residue + bias.fruiting);
  return {
    energy: clamp(energy, 0, 1),
    bias: {
      birth: bias.birth / total,
      death: bias.death / total,
      feeding: bias.feeding / total,
      tool: bias.tool / total,
      residue: bias.residue / total,
      fruiting: bias.fruiting / total,
    },
  };
};

export class WorldMusicFeatureExtractor {
  private last: MusicWorldFeatures | null = null;

  reset(): void {
    this.last = null;
  }

  extract(snapshot: SimulationSnapshot): MusicWorldFeatures {
    const speciesCounts = snapshot.entities.reduce<MusicWorldFeatures['speciesDistribution']>((acc, entity) => {
      acc[entity.type] = (acc[entity.type] ?? 0) + 1;
      return acc;
    }, {});
    const events = eventAccumulator(snapshot.events, snapshot.time);
    const raw: MusicWorldFeatures = {
      time: snapshot.time,
      activity: snapshot.stats.activity,
      stability: snapshot.stats.stability,
      growth: snapshot.stats.growth,
      threat: snapshot.stats.threat,
      biodiversity: snapshot.stats.biodiversity,
      nutrients: snapshot.stats.nutrients,
      fruit: snapshot.stats.fruit,
      energy: snapshot.stats.energy,
      entityDensity: clamp(snapshot.entities.length / 140, 0, 1),
      residueDensity: clamp(snapshot.residues.length / 80, 0, 1),
      speciesDistribution: speciesCounts,
      recentEventEnergy: events.energy,
      eventBias: events.bias,
    };

    if (!this.last) {
      this.last = raw;
      return raw;
    }

    const smoothed: MusicWorldFeatures = {
      ...raw,
      activity: lerp(this.last.activity, raw.activity, 0.18),
      stability: lerp(this.last.stability, raw.stability, 0.12),
      growth: lerp(this.last.growth, raw.growth, 0.12),
      threat: lerp(this.last.threat, raw.threat, 0.2),
      biodiversity: lerp(this.last.biodiversity, raw.biodiversity, 0.1),
      nutrients: lerp(this.last.nutrients, raw.nutrients, 0.08),
      fruit: lerp(this.last.fruit, raw.fruit, 0.1),
      energy: lerp(this.last.energy, raw.energy, 0.08),
      entityDensity: lerp(this.last.entityDensity, raw.entityDensity, 0.1),
      residueDensity: lerp(this.last.residueDensity, raw.residueDensity, 0.1),
      recentEventEnergy: lerp(this.last.recentEventEnergy, raw.recentEventEnergy, 0.24),
      eventBias: {
        birth: lerp(this.last.eventBias.birth, raw.eventBias.birth, 0.2),
        death: lerp(this.last.eventBias.death, raw.eventBias.death, 0.2),
        feeding: lerp(this.last.eventBias.feeding, raw.eventBias.feeding, 0.2),
        tool: lerp(this.last.eventBias.tool, raw.eventBias.tool, 0.2),
        residue: lerp(this.last.eventBias.residue, raw.eventBias.residue, 0.2),
        fruiting: lerp(this.last.eventBias.fruiting, raw.eventBias.fruiting, 0.2),
      },
    };

    this.last = smoothed;
    return smoothed;
  }
}
