import type { Entity, SimulationSnapshot, TerrainCell, Vec2 } from '../types/world';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const ENTITY_IMPORTANCE: Record<Entity['type'], number> = {
  plant: 0.45,
  flocker: 0.72,
  cluster: 0.64,
  predator: 0.95,
};

const ECOLOGICAL_WEIGHT: Record<Entity['type'], number> = {
  plant: 0.78,
  flocker: 0.52,
  cluster: 0.66,
  predator: 0.82,
};

export interface AudioFocusContext {
  active: boolean;
  center: Vec2;
  radius: number;
  intensity: number;
}

export interface ScoredEntity {
  entity: Entity;
  distance: number;
  cameraCloseness: number;
  focusCloseness: number;
  insideFocus: boolean;
  score: number;
  detail: number;
}

export interface ZoneSummary {
  key: string;
  kind: 'rooted' | 'mobile' | 'cluster' | 'predator' | 'water';
  count: number;
  position: Vec2;
  activity: number;
  density: number;
  detail: number;
  tone: number;
  resonance: number;
}

const getDistance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

export const createAudioFocusContext = (snapshot: SimulationSnapshot): AudioFocusContext => {
  const active = snapshot.tool.active === 'observe' && (snapshot.tool.visible || snapshot.tool.strength > 0.18 || snapshot.stats.focus > 0.04);
  const intensity = active ? clamp(snapshot.tool.strength * 0.7 + snapshot.stats.focus * 0.8 + (snapshot.tool.visible ? 0.15 : 0), 0, 1) : 0;
  return {
    active,
    center: active ? { ...snapshot.tool.worldPosition } : { ...snapshot.camera.center },
    radius: active ? snapshot.tool.radius * (0.92 + intensity * 0.28) : 0,
    intensity,
  };
};

export const scoreEntities = (
  snapshot: SimulationSnapshot,
  focus: AudioFocusContext,
  entityPriority: ReadonlyMap<number, number>,
): ScoredEntity[] => {
  const hearingRadius = 300 + 420 / snapshot.camera.zoom;
  const zoomDetail = clamp((snapshot.camera.zoom - 0.32) / (2.8 - 0.32), 0, 1);

  return snapshot.entities.map((entity) => {
    const distance = getDistance(entity.position, snapshot.camera.center);
    const cameraCloseness = 1 - clamp(distance / hearingRadius, 0, 1);
    const focusDistance = focus.active ? getDistance(entity.position, focus.center) : Infinity;
    const focusCloseness = focus.active ? 1 - clamp(focusDistance / focus.radius, 0, 1) : 0;
    const insideFocus = focus.active && focusDistance <= focus.radius;
    const activityScore = clamp(entity.activity, 0, 1);
    const rarityScore = entity.type === 'predator' ? 1 : entity.type === 'cluster' ? 0.7 : entity.type === 'plant' ? 0.42 : 0.58;
    const ecologicalScore = clamp(
      entity.growth * 0.22 + entity.resonance * ECOLOGICAL_WEIGHT[entity.type] * 0.34 + entity.harmony * 0.18 + entity.energy * 0.16,
      0,
      1,
    );
    const interactionScore = entity.visualState === 'idle'
      ? entity.pulse * 0.2
      : entity.visualState === 'dying'
        ? 1
        : entity.visualState === 'feeding'
          ? 0.78
          : 0.66;
    const priorityScore = clamp(entityPriority.get(entity.id) ?? 0, 0, 1);
    const focusBonus = insideFocus ? 0.32 + focus.intensity * 0.36 : focus.active ? -0.08 - focus.intensity * 0.18 : 0;
    const score = clamp(
      cameraCloseness * 0.3
        + activityScore * 0.18
        + ENTITY_IMPORTANCE[entity.type] * 0.12
        + rarityScore * 0.1
        + ecologicalScore * 0.12
        + interactionScore * 0.1
        + priorityScore * 0.18
        + focusCloseness * 0.12
        + focusBonus,
      0,
      2,
    );
    const detail = clamp(cameraCloseness * 0.65 + focusCloseness * 0.55 + zoomDetail * 0.5, 0, 1.5);

    return { entity, distance, cameraCloseness, focusCloseness, insideFocus, score, detail };
  });
};

export const selectForegroundVoices = (scored: ScoredEntity[], maxVoices: number): ScoredEntity[] => scored
  .filter((entry) => entry.score > 0.48)
  .sort((a, b) => b.score - a.score)
  .slice(0, maxVoices);

const zoneKindForEntity = (entity: Entity): ZoneSummary['kind'] => {
  if (entity.type === 'plant') return 'rooted';
  if (entity.type === 'cluster') return 'cluster';
  if (entity.type === 'predator') return 'predator';
  return 'mobile';
};

export const buildZoneSummaries = (
  snapshot: SimulationSnapshot,
  scored: ScoredEntity[],
  foreground: ScoredEntity[],
): ZoneSummary[] => {
  const foregroundIds = new Set(foreground.map((entry) => entry.entity.id));
  const buckets = new Map<string, ZoneSummary>();
  const bucketSize = 240;

  for (const entry of scored) {
    if (foregroundIds.has(entry.entity.id)) continue;
    const bucketX = Math.floor(entry.entity.position.x / bucketSize);
    const bucketY = Math.floor(entry.entity.position.y / bucketSize);
    const kind = zoneKindForEntity(entry.entity);
    const key = `${kind}:${bucketX}:${bucketY}`;
    const existing = buckets.get(key) ?? {
      key,
      kind,
      count: 0,
      position: { x: 0, y: 0 },
      activity: 0,
      density: 0,
      detail: 0,
      tone: 0,
      resonance: 0,
    };

    existing.count += 1;
    existing.position.x += entry.entity.position.x;
    existing.position.y += entry.entity.position.y;
    existing.activity += entry.entity.activity;
    existing.density += entry.score * (1.1 - clamp(entry.detail * 0.45, 0, 0.55));
    existing.detail += entry.detail;
    existing.tone += entry.entity.tone;
    existing.resonance += entry.entity.resonance;
    buckets.set(key, existing);
  }

  const zones = [...buckets.values()]
    .filter((zone) => zone.count >= 2)
    .map((zone) => ({
      ...zone,
      position: { x: zone.position.x / zone.count, y: zone.position.y / zone.count },
      activity: zone.activity / zone.count,
      density: zone.density,
      detail: zone.detail / zone.count,
      tone: zone.tone / zone.count,
      resonance: zone.resonance / zone.count,
    }))
    .sort((a, b) => b.density - a.density);

  const waterZone = buildWaterSummary(snapshot.terrain, snapshot.camera.center);
  return waterZone ? [waterZone, ...zones].slice(0, 3) : zones.slice(0, 3);
};

const buildWaterSummary = (terrain: TerrainCell[], cameraCenter: Vec2): ZoneSummary | null => {
  const waterCells = terrain.filter((cell) => cell.terrain === 'water');
  if (waterCells.length === 0) return null;

  let weightedX = 0;
  let weightedY = 0;
  let totalWeight = 0;
  let flow = 0;
  let tone = 0;
  let resonance = 0;

  for (const cell of waterCells) {
    const distance = Math.hypot(cell.center.x - cameraCenter.x, cell.center.y - cameraCenter.y);
    const weight = 1.4 - clamp(distance / 1200, 0, 1);
    weightedX += cell.center.x * weight;
    weightedY += cell.center.y * weight;
    totalWeight += weight;
    flow += Math.hypot(cell.flow.x, cell.flow.y) * weight;
    tone += cell.hue * weight;
    resonance += cell.resonance * weight;
  }

  if (totalWeight <= 0) return null;

  return {
    key: 'water:global',
    kind: 'water',
    count: waterCells.length,
    position: { x: weightedX / totalWeight, y: weightedY / totalWeight },
    activity: clamp(flow / totalWeight / 30, 0, 1),
    density: clamp(totalWeight / 12, 0.24, 1.4),
    detail: 0.28,
    tone: tone / totalWeight,
    resonance: resonance / totalWeight,
  };
};
