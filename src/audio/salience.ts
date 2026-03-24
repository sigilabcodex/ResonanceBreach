import type { Entity, SimulationSnapshot, TerrainCell, Vec2 } from '../types/world';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const wrappedDistance = (a: Vec2, b: Vec2, width: number, height: number) => {
  const dxRaw = a.x - b.x;
  const dyRaw = a.y - b.y;
  const dx = Math.abs(dxRaw) > width * 0.5 ? width - Math.abs(dxRaw) : Math.abs(dxRaw);
  const dy = Math.abs(dyRaw) > height * 0.5 ? height - Math.abs(dyRaw) : Math.abs(dyRaw);
  return Math.hypot(dx, dy);
};

const ENTITY_IMPORTANCE: Record<Entity['type'], number> = {
  plant: 0.58,
  ephemeral: 0.62,
  canopy: 0.66,
  flocker: 0.78,
  cluster: 0.48,
  grazer: 0.88,
  parasite: 0.7,
  predator: 0.95,
};

const ECOLOGICAL_WEIGHT: Record<Entity['type'], number> = {
  plant: 0.84,
  ephemeral: 0.9,
  canopy: 0.86,
  flocker: 0.56,
  cluster: 0.72,
  grazer: 0.78,
  parasite: 0.74,
  predator: 0.82,
};

export interface AudioFocusContext {
  active: boolean;
  mode: 'none' | 'entity' | 'region';
  center: Vec2;
  radius: number;
  intensity: number;
  entityId: number | null;
  relatedEntityIds: Set<number>;
}

export interface ScoredEntity {
  entity: Entity;
  distance: number;
  cameraCloseness: number;
  attentionCloseness: number;
  insideAttention: boolean;
  isPrimary: boolean;
  isRelated: boolean;
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

export const createAudioFocusContext = (snapshot: SimulationSnapshot): AudioFocusContext => {
  const active = snapshot.attention.mode !== 'none';
  return {
    active,
    mode: snapshot.attention.mode,
    center: active ? { ...snapshot.attention.position } : { ...snapshot.camera.center },
    radius: active ? snapshot.attention.radius : 0,
    intensity: active ? clamp(snapshot.attention.strength, 0, 1) : 0,
    entityId: snapshot.attention.entityId,
    relatedEntityIds: new Set(snapshot.attention.relatedEntityIds),
  };
};

export const scoreEntities = (
  snapshot: SimulationSnapshot,
  focus: AudioFocusContext,
  entityPriority: ReadonlyMap<number, number>,
): ScoredEntity[] => {
  const hearingRadius = 340 + 520 / snapshot.camera.zoom;
  const zoomDetail = clamp((snapshot.camera.zoom - 0.24) / (2.4 - 0.24), 0, 1);

  return snapshot.entities.map((entity) => {
    const distance = wrappedDistance(entity.position, snapshot.camera.center, snapshot.dimensions.width, snapshot.dimensions.height);
    const cameraCloseness = 1 - clamp(distance / hearingRadius, 0, 1);
    const attentionDistance = focus.active ? wrappedDistance(entity.position, focus.center, snapshot.dimensions.width, snapshot.dimensions.height) : Infinity;
    const attentionCloseness = focus.active && focus.radius > 0 ? 1 - clamp(attentionDistance / focus.radius, 0, 1) : 0;
    const insideAttention = focus.active && attentionDistance <= focus.radius;
    const isPrimary = focus.mode === 'entity' && focus.entityId === entity.id;
    const isRelated = focus.mode === 'entity' && focus.relatedEntityIds.has(entity.id);
    const activityScore = clamp(entity.activity, 0, 1);
    const rarityScore = entity.type === 'predator' ? 1 : entity.type === 'grazer' ? 0.82 : entity.type === 'parasite' ? 0.76 : entity.type === 'cluster' ? 0.52 : entity.type === 'canopy' ? 0.72 : entity.type === 'ephemeral' ? 0.66 : entity.type === 'plant' ? 0.58 : 0.64;
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

    let attentionBonus = 0;
    if (focus.mode === 'entity') {
      attentionBonus = isPrimary
        ? 1.2 + focus.intensity * 0.16
        : isRelated
          ? 0.24 + attentionCloseness * 0.4 + focus.intensity * 0.14
          : -0.14 + attentionCloseness * 0.05;
    } else if (focus.mode === 'region') {
      attentionBonus = insideAttention
        ? 0.44 + attentionCloseness * 0.4 + focus.intensity * 0.12
        : -0.18 - focus.intensity * 0.14;
    }

    const score = clamp(
      cameraCloseness * 0.3
        + activityScore * 0.16
        + ENTITY_IMPORTANCE[entity.type] * 0.1
        + rarityScore * 0.08
        + ecologicalScore * 0.11
        + interactionScore * 0.09
        + priorityScore * 0.2
        + attentionCloseness * (focus.mode === 'region' ? 0.24 : 0.18)
        + attentionBonus,
      0,
      2.4,
    );

    const detail = clamp(
      cameraCloseness * 0.76
        + zoomDetail * 0.58
        + attentionCloseness * (focus.mode === 'entity' ? 0.82 : 0.56)
        + (isPrimary ? 0.58 : isRelated ? 0.18 : 0),
      0,
      2,
    );

    return { entity, distance, cameraCloseness, attentionCloseness, insideAttention, isPrimary, isRelated, score, detail };
  });
};

export const selectForegroundVoices = (scored: ScoredEntity[], maxVoices: number): ScoredEntity[] => scored
  .filter((entry) => entry.score > 0.4 || entry.isPrimary)
  .sort((a, b) => b.score - a.score)
  .reduce<ScoredEntity[]>((selected, entry) => {
    if (selected.length >= maxVoices) return selected;
    if (entry.isPrimary) return [entry, ...selected.filter((candidate) => !candidate.isPrimary)].slice(0, maxVoices);
    if (selected.some((candidate) => candidate.entity.id === entry.entity.id)) return selected;
    // Bias the limited foreground pool toward nearby entities when there is no primary focus.
    if (!entry.isPrimary && !entry.isRelated && entry.cameraCloseness < 0.2 && selected.length >= Math.max(1, maxVoices - 1)) return selected;
    selected.push(entry);
    return selected;
  }, []);

const zoneKindForEntity = (entity: Entity): ZoneSummary['kind'] => {
  if (entity.type === 'plant' || entity.type === 'ephemeral' || entity.type === 'canopy') return 'rooted';
  if (entity.type === 'cluster' || entity.type === 'parasite') return 'cluster';
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
  const bucketSize = 260;
  const regionFocusActive = snapshot.attention.mode === 'region' && snapshot.attention.radius > 0;
  const regionCenter = snapshot.attention.position;
  const regionRadius = snapshot.attention.radius;

  for (const entry of scored) {
    if (foregroundIds.has(entry.entity.id)) continue;
    const regionDistance = regionFocusActive
      ? wrappedDistance(entry.entity.position, regionCenter, snapshot.dimensions.width, snapshot.dimensions.height)
      : Infinity;
    const regionWeight = regionFocusActive
      ? clamp(1.2 - regionDistance / Math.max(regionRadius * 1.1, 1), 0.18, 1.36)
      : 1;
    if (regionFocusActive && regionDistance > regionRadius * 1.3 && entry.score < 0.62) continue;
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
    existing.density += entry.score * (1.08 - clamp(entry.detail * 0.52, 0, 0.6)) * regionWeight;
    existing.detail += entry.detail * (0.82 + regionWeight * 0.28);
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

  const waterZone = buildWaterSummary(
    snapshot.terrain,
    regionFocusActive ? regionCenter : snapshot.camera.center,
    snapshot.dimensions.width,
    snapshot.dimensions.height,
  );
  return waterZone ? [waterZone, ...zones].slice(0, 3) : zones.slice(0, 3);
};

const buildWaterSummary = (terrain: TerrainCell[], cameraCenter: Vec2, worldWidth: number, worldHeight: number): ZoneSummary | null => {
  let weightedX = 0;
  let weightedY = 0;
  let totalWeight = 0;
  let flow = 0;
  let tone = 0;
  let resonance = 0;
  let waterCellCount = 0;

  for (const cell of terrain) {
    if (cell.terrain !== 'water') continue;
    waterCellCount += 1;
    const distance = wrappedDistance(cell.center, cameraCenter, worldWidth, worldHeight);
    const weight = 1.4 - clamp(distance / 1200, 0, 1);
    weightedX += cell.center.x * weight;
    weightedY += cell.center.y * weight;
    totalWeight += weight;
    flow += Math.hypot(cell.flow.x, cell.flow.y) * weight;
    tone += cell.hue * weight;
    resonance += cell.resonance * weight;
  }

  if (totalWeight <= 0 || waterCellCount === 0) return null;

  return {
    key: 'water:global',
    kind: 'water',
    count: waterCellCount,
    position: { x: weightedX / totalWeight, y: weightedY / totalWeight },
    activity: clamp(flow / totalWeight / 30, 0, 1),
    density: clamp(totalWeight / 12, 0.24, 1.4),
    detail: 0.28,
    tone: tone / totalWeight,
    resonance: resonance / totalWeight,
  };
};
