import {
  ATTRACTOR_COUNT,
  CAMERA_MAX_ZOOM,
  CAMERA_MIN_ZOOM,
  ENERGY_START,
  INITIAL_CANOPY_COUNT,
  INITIAL_CLUSTER_COUNT,
  INITIAL_EPHEMERAL_COUNT,
  INITIAL_FLOCKER_COUNT,
  INITIAL_GRAZER_COUNT,
  INITIAL_PARASITE_COUNT,
  INITIAL_PLANT_COUNT,
  INITIAL_PREDATOR_COUNT,
  MAX_CANOPIES,
  MAX_CLUSTERS,
  MAX_EPHEMERALS,
  MAX_FLOCKERS,
  MAX_GRAZERS,
  MAX_PARASITES,
  MAX_PLANTS,
  NEIGHBOR_RADIUS,
  TERRAIN_SAMPLE_COLS,
  TERRAIN_SAMPLE_ROWS,
  TOOL_DURATION,
  TOOL_ENERGY_COST,
  TOOL_RADIUS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type EntityType,
  type HabitatType,
  type TerrainType,
  type ToolType,
} from '../../config';
import { Rng } from '../random';
import { WorldEventQueue, buildNotifications, type WorldEventInput } from '../events';
import { createDefaultAttentionState, createDefaultCamera, createDefaultDiagnostics, createDefaultStats, createDefaultToolState, createWorldState } from '../world';
import type { FieldSample, TerrainModifier } from '../fields/types';
import { WorldFieldModel } from '../fields/worldField';
import { handleDeathTransition, shouldPersist } from './lifecycle/persistence';
import type { LifecycleRuntimeContext } from './lifecycle/types';
import { computeLifecycleProgress, computeLifecycleStage } from './lifecycle/types';
import { updateLifecycle } from './lifecycle/updateLifecycle';
import { spawnEntities as spawnEntitiesStep } from './spawning/spawnEntities';
import { updatePropagules as updatePropagulesStep } from './spawning/updatePropagules';
import type { SpawningRuntimeContext } from './spawning/types';
import { updateDecomposer } from './species/updateDecomposer';
import { updateGrazer } from './species/updateGrazer';
import { updateParasite } from './species/updateParasite';
import { updatePlant } from './species/updatePlant';
import { updatePollinator } from './species/updatePollinator';
import { updatePredator } from './species/updatePredator';
import type { SpeciesLocalStats, SpeciesRuntimeContext } from './species/types';
import { buildHotspotSummary } from './diagnostics/hotspots';
import {
  affectEnvironment as affectEnvironmentStep,
  initializeEnvironmentalFields as initializeEnvironmentalFieldsStep,
  sampleEnvironmentalFields as sampleEnvironmentalFieldsStep,
  updateEnvironmentalFields as updateEnvironmentalFieldsStep,
  type EnvironmentalFieldGrid,
} from './environment/fields';
import { computeGardenStats, updateSimulationEnergy } from './stats/ecologyStats';
import type { LocalEcologyStats } from './stats/types';
import type {
  Attractor,
  AttentionState,
  CameraState,
  Entity,
  EventBurst,
  FeedParticle,
  GardenStats,
  Propagule,
  Residue,
  SimulationSnapshot,
  TerrainCell,
  ToolFeedback,
  ToolField,
  ToolState,
  Vec2,
  WorldState,
  SimulationDiagnostics,
} from '../../types/world';

const TWO_PI = Math.PI * 2;
const TERRAIN_SAMPLE_COUNT = TERRAIN_SAMPLE_COLS * TERRAIN_SAMPLE_ROWS;
const TERRAIN_SAMPLE_RADIUS = Math.min(WORLD_WIDTH / TERRAIN_SAMPLE_COLS, WORLD_HEIGHT / TERRAIN_SAMPLE_ROWS);
const GOLDEN_RATIO = 0.6180339887498948;
const TERRAIN_SAMPLE_REFRESH_INTERVAL = 1 / 15;
const ENTITY_BUCKET_SIZE = 220;
const PARTICLE_BUCKET_SIZE = 220;
const RESIDUE_BUCKET_SIZE = 220;
const TERRAIN_MODIFIER_BUCKET_SIZE = 240;
const ENTITY_BUCKET_COLS = Math.ceil(WORLD_WIDTH / ENTITY_BUCKET_SIZE);
const ENTITY_BUCKET_ROWS = Math.ceil(WORLD_HEIGHT / ENTITY_BUCKET_SIZE);
const PARTICLE_BUCKET_COLS = Math.ceil(WORLD_WIDTH / PARTICLE_BUCKET_SIZE);
const PARTICLE_BUCKET_ROWS = Math.ceil(WORLD_HEIGHT / PARTICLE_BUCKET_SIZE);
const RESIDUE_BUCKET_COLS = Math.ceil(WORLD_WIDTH / RESIDUE_BUCKET_SIZE);
const RESIDUE_BUCKET_ROWS = Math.ceil(WORLD_HEIGHT / RESIDUE_BUCKET_SIZE);
const TERRAIN_MODIFIER_BUCKET_COLS = Math.ceil(WORLD_WIDTH / TERRAIN_MODIFIER_BUCKET_SIZE);
const TERRAIN_MODIFIER_BUCKET_ROWS = Math.ceil(WORLD_HEIGHT / TERRAIN_MODIFIER_BUCKET_SIZE);
const TARGET_REUSE_INTERVAL = 0.24;
const FOCUS_REFRESH_INTERVAL = 0.16;
const TERRAIN_MODIFIER_QUERY_RADIUS = 260;
const FIELD_GRID_COLS = 48;
const FIELD_GRID_ROWS = 32;
const FIELD_GRID_SIZE = FIELD_GRID_COLS * FIELD_GRID_ROWS;
const FIELD_CELL_WIDTH = WORLD_WIDTH / FIELD_GRID_COLS;
const FIELD_CELL_HEIGHT = WORLD_HEIGHT / FIELD_GRID_ROWS;
const ENVIRONMENTAL_FIELD_GRID: EnvironmentalFieldGrid = {
  cols: FIELD_GRID_COLS,
  rows: FIELD_GRID_ROWS,
  cellWidth: FIELD_CELL_WIDTH,
  cellHeight: FIELD_CELL_HEIGHT,
  size: FIELD_GRID_SIZE,
};
const MAX_PROPAGULES = 320;
const ROOTED_BLOOM_TYPES: EntityType[] = ['plant', 'ephemeral', 'canopy'];
const ROOTED_BLOOM_TYPE_SET = new Set<EntityType>(ROOTED_BLOOM_TYPES);
const TOOL_UNLOCK_SCHEDULE: Array<{ tool: ToolType; time: number; energy: number }> = [
  { tool: 'observe', time: 0, energy: 0 },
  { tool: 'grow', time: 0, energy: 0 },
  { tool: 'feed', time: 12, energy: 28 },
  { tool: 'repel', time: 28, energy: 34 },
  { tool: 'disrupt', time: 48, energy: 40 },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};
const maxHabitatWeight = (sample: FieldSample) => Math.max(sample.habitatWeights.wetland, sample.habitatWeights.highland, sample.habitatWeights.basin);
const habitatMatch = (sample: FieldSample, preferred: HabitatType) => sample.habitatWeights[preferred];
const habitatPenalty = (sample: FieldSample, avoided: HabitatType) => sample.habitatWeights[avoided];
const fract = (value: number) => value - Math.floor(value);
const wrap = (value: number, size: number) => ((value % size) + size) % size;
const wrapDelta = (from: number, to: number, size: number) => {
  let delta = to - from;
  if (delta > size * 0.5) delta -= size;
  else if (delta < -size * 0.5) delta += size;
  return delta;
};
export class Simulation {
  private rng = new Rng(0xdecafbad);
  private readonly eventQueue = new WorldEventQueue();
  private readonly world: WorldState = createWorldState();
  private terrainModifiers: TerrainModifier[] = [];
  private readonly worldField = new WorldFieldModel();
  private nextId = 1;
  private nextClusterId = 1;
  private nextFeedbackId = 1;
  private nextFieldId = 1;
  private nextParticleId = 1;
  private nextBurstId = 1;
  private nextResidueId = 1;
  private nextPropaguleId = 1;
  private nextModifierId = 1;
  private attentionDragging = false;
  private terrainSampleTimer = 0;
  private readonly entityBuckets = new Map<string, Entity[]>();
  private readonly particleBuckets = new Map<string, FeedParticle[]>();
  private readonly residueBuckets = new Map<string, Residue[]>();
  private readonly propagulesById = new Map<number, Propagule>();
  private readonly terrainModifierBuckets = new Map<string, TerrainModifier[]>();
  private readonly entityBucketById = new Map<number, string>();
  private readonly terrainModifierBucketById = new Map<number, string>();
  private readonly entityById = new Map<number, Entity>();
  private readonly particleById = new Map<number, FeedParticle>();
  private readonly residueById = new Map<number, Residue>();
  private fieldSampleCache = new Map<string, FieldSample>();
  private nutrientField = new Float32Array(FIELD_GRID_SIZE);
  private nutrientBaseline = new Float32Array(FIELD_GRID_SIZE);
  private temperatureField = new Float32Array(FIELD_GRID_SIZE);
  private temperatureBaseline = new Float32Array(FIELD_GRID_SIZE);
  private diagnostics: SimulationDiagnostics = createDefaultDiagnostics();
  private attentionRefreshTimer = 0;
  private attentionPressEntityId: number | null = null;

  private get entities(): Entity[] { return this.world.entities; }
  private set entities(value: Entity[]) { this.world.entities = value; }

  private get terrain(): TerrainCell[] { return this.world.terrain; }
  private set terrain(value: TerrainCell[]) { this.world.terrain = value; }

  private get attractors(): Attractor[] { return this.world.attractors; }
  private set attractors(value: Attractor[]) { this.world.attractors = value; }

  private get fields(): ToolField[] { return this.world.fields; }
  private set fields(value: ToolField[]) { this.world.fields = value; }

  private get particles(): FeedParticle[] { return this.world.particles; }
  private set particles(value: FeedParticle[]) { this.world.particles = value; }

  private get residues(): Residue[] { return this.world.residues; }
  private set residues(value: Residue[]) { this.world.residues = value; }

  private get propagules(): Propagule[] { return this.world.propagules; }
  private set propagules(value: Propagule[]) { this.world.propagules = value; }

  private get bursts(): EventBurst[] { return this.world.bursts; }
  private set bursts(value: EventBurst[]) { this.world.bursts = value; }

  private get time(): number { return this.world.time; }
  private set time(value: number) { this.world.time = value; }

  private get timeScale(): number { return this.world.timeScale; }
  private set timeScale(value: number) { this.world.timeScale = value; }

  private get unlockedProgress(): number { return this.world.unlockedProgress; }
  private set unlockedProgress(value: number) { this.world.unlockedProgress = value; }

  private get energy(): number { return this.world.energy; }
  private set energy(value: number) { this.world.energy = value; }

  private get camera(): CameraState { return this.world.camera; }
  private set camera(value: CameraState) { this.world.camera = value; }

  private get tool(): ToolState { return this.world.tool; }
  private set tool(value: ToolState) { this.world.tool = value; }

  private get attention(): AttentionState { return this.world.attention; }
  private set attention(value: AttentionState) { this.world.attention = value; }

  private get stats(): GardenStats { return this.world.stats; }
  private set stats(value: GardenStats) { this.world.stats = value; }

  constructor() {
    this.reset();
  }

  reset(): void {
    this.rng = new Rng(0xdecafbad);
    this.entities = [];
    this.fields = [];
    this.particles = [];
    this.residues = [];
    this.propagules = [];
    this.bursts = [];
    this.terrainModifiers = [];
    this.nextId = 1;
    this.nextClusterId = 1;
    this.nextFeedbackId = 1;
    this.nextFieldId = 1;
    this.nextParticleId = 1;
    this.nextBurstId = 1;
    this.nextResidueId = 1;
    this.nextPropaguleId = 1;
    this.nextModifierId = 1;
    this.terrainSampleTimer = 0;
    this.entityBuckets.clear();
    this.entityBucketById.clear();
    this.particleBuckets.clear();
    this.residueBuckets.clear();
    this.terrainModifierBuckets.clear();
    this.terrainModifierBucketById.clear();
    this.entityById.clear();
    this.particleById.clear();
    this.residueById.clear();
    this.propagulesById.clear();
    this.fieldSampleCache.clear();
    this.diagnostics = createDefaultDiagnostics();
    this.attentionRefreshTimer = 0;
    this.attentionPressEntityId = null;
    this.time = 0;
    this.timeScale = 1;
    this.unlockedProgress = 0;
    this.energy = ENERGY_START;
    this.attentionDragging = false;
    this.camera = createDefaultCamera();
    this.tool = createDefaultToolState();
    this.attention = createDefaultAttentionState();
    this.stats = createDefaultStats();
    this.world.diagnostics = createDefaultDiagnostics();
    this.world.events = [];
    this.world.notifications = { recent: [] };
    this.initializeEnvironmentalFields();
    this.attractors = this.createAttractors();

    for (let i = 0; i < INITIAL_PLANT_COUNT; i += 1) this.entities.push(this.createEntity('plant', this.randomSpawnPointForEntity('plant')));
    for (let i = 0; i < INITIAL_EPHEMERAL_COUNT; i += 1) this.entities.push(this.createEntity('ephemeral', this.randomSpawnPointForEntity('ephemeral')));
    for (let i = 0; i < INITIAL_CANOPY_COUNT; i += 1) this.entities.push(this.createEntity('canopy', this.randomSpawnPointForEntity('canopy')));
    for (let i = 0; i < INITIAL_FLOCKER_COUNT; i += 1) this.entities.push(this.createEntity('flocker', this.randomSpawnPointForEntity('flocker')));
    for (let i = 0; i < INITIAL_CLUSTER_COUNT; i += 1) this.entities.push(this.createEntity('cluster', this.randomSpawnPointForEntity('cluster')));
    for (let i = 0; i < INITIAL_GRAZER_COUNT; i += 1) this.entities.push(this.createEntity('grazer', this.randomSpawnPointForEntity('grazer')));
    for (let i = 0; i < INITIAL_PARASITE_COUNT; i += 1) this.entities.push(this.createEntity('parasite', this.randomSpawnPointForEntity('parasite')));
    for (let i = 0; i < INITIAL_PREDATOR_COUNT; i += 1) this.entities.push(this.createEntity('predator', this.randomSpawnPointForEntity('predator')));
    this.seedInitialNutrients();
    this.rebuildParticleBuckets();
    this.rebuildResidueBuckets();
    this.rebuildEntityBuckets();

    this.terrain = this.createTerrainSamples();
    this.stats = this.computeStats();
  }

  setTool(type: ToolType): void {
    if (!this.tool.unlocked.includes(type)) return;

    this.tool.active = type;
    this.tool.radius = TOOL_RADIUS[type];
    this.tool.pulse = 1;
    this.tool.blocked = false;
    if (type !== 'observe') this.cancelAttentionDrag();
    this.emitToolFeedback(type, this.tool.worldPosition, type === 'observe' ? 0.22 : 0.38);
  }

  setToolEngaged(active: boolean, x: number, y: number): void {
    this.tool.visible = active || (x >= 0 && y >= 0);
    if (x >= 0 && y >= 0) {
      this.tool.worldPosition.x = wrap(x, WORLD_WIDTH);
      this.tool.worldPosition.y = wrap(y, WORLD_HEIGHT);
    }

    if (this.tool.active === 'observe') {
      if (!active) {
        this.finishAttentionDrag({ x: this.tool.worldPosition.x, y: this.tool.worldPosition.y });
        return;
      }

      this.beginAttentionDrag({ x: this.tool.worldPosition.x, y: this.tool.worldPosition.y });
      return;
    }

    if (!active) return;
    this.deployToolField(this.tool.active, this.tool.worldPosition);
  }

  hoverTool(x: number, y: number): void {
    if (x < 0 || y < 0) {
      this.tool.visible = false;
      if (!this.attentionDragging) this.cancelAttentionDrag();
      return;
    }

    this.tool.visible = true;
    this.tool.worldPosition.x = wrap(x, WORLD_WIDTH);
    this.tool.worldPosition.y = wrap(y, WORLD_HEIGHT);

    if (this.attentionDragging && this.tool.active === 'observe') {
      this.updateAttentionDrag({ x: this.tool.worldPosition.x, y: this.tool.worldPosition.y });
    }
  }

  setCamera(centerX: number, centerY: number, zoom: number): void {
    this.camera.center.x = wrap(centerX, WORLD_WIDTH);
    this.camera.center.y = wrap(centerY, WORLD_HEIGHT);
    this.camera.zoom = clamp(zoom, CAMERA_MIN_ZOOM, CAMERA_MAX_ZOOM);
  }

  setTimeScale(timeScale: number): void {
    this.timeScale = timeScale;
  }

  getCameraFollowTarget(): Vec2 | null {
    if (this.attention.mode !== 'entity' || this.attention.entityId === null) return null;
    const entity = this.entities.find((candidate) => candidate.id === this.attention.entityId);
    return entity ? { ...entity.position } : null;
  }

  update(dt: number): void {
    this.fieldSampleCache.clear();
    this.diagnostics = createDefaultDiagnostics();
    this.attentionRefreshTimer = Math.max(0, this.attentionRefreshTimer - dt);
    this.time += dt;
    this.tool.pulse = Math.max(0, this.tool.pulse - dt * 0.22);
    const attentionTargetStrength = this.attention.mode === 'none'
      ? 0.08
      : this.attention.mode === 'entity'
        ? 1
        : 0.92;
    const fieldStrength = this.fields.some((field) => field.tool === this.tool.active && field.tool !== 'observe') ? 1 : 0.12;
    this.tool.strength = lerp(this.tool.strength, this.tool.active === 'observe' ? attentionTargetStrength : fieldStrength, dt * 2.4);
    this.tool.blocked = false;

    this.unlockTools();
    this.updateEnvironmentalFields(dt);
    this.updateAttractors(dt);
    this.updateTerrainModifiers(dt);
    this.updateFields(dt);
    this.updateParticles(dt);
    this.updateResidues(dt);
    this.updatePropagules(dt);
    this.updateBursts(dt);
    this.refreshTerrainSamples(dt);
    this.rebuildParticleBuckets();
    this.rebuildResidueBuckets();
    this.rebuildEntityBuckets();
    this.diagnostics.counts.particles = this.particles.length;
    this.diagnostics.counts.feed = this.particles.filter((particle) => particle.kind === 'feed').length;
    this.diagnostics.counts.fruit = this.particles.length - this.diagnostics.counts.feed;
    this.diagnostics.counts.residues = this.residues.length;
    this.diagnostics.counts.propagules = this.propagules.length;
    this.diagnostics.counts.terrainModifiers = this.terrainModifiers.length;

    const survivors: Entity[] = [];
    const lifecycleContext = this.createLifecycleRuntimeContext();
    const localStats: LocalEcologyStats = { harmony: 0, activity: 0, threat: 0, stability: 0, interactions: 0, focus: 0, nutrients: 0, fruit: 0, temperature: 0 };

    for (let i = 0; i < this.entities.length; i += 1) {
      const entity = this.entities[i] as Entity;
      updateLifecycle(entity, dt, lifecycleContext);

      const sample = this.sampleField(entity.position.x, entity.position.y);
      const neighbors = this.getNeighbors(i, NEIGHBOR_RADIUS);
      const entityUpdateStart = performance.now();
      this.applyEntityBehavior(entity, sample, neighbors, dt, 0, localStats);
      this.diagnostics.speciesUpdateTimeMs[entity.type] += performance.now() - entityUpdateStart;

      const persists = shouldPersist(entity, lifecycleContext);
      if (persists) survivors.push(entity);
      else handleDeathTransition(entity, lifecycleContext);
      this.syncEntityBucket(entity, persists);
    }

    this.entities = survivors;
    const attentionStart = performance.now();
    this.syncAttentionState();
    this.diagnostics.timingsMs.attention = performance.now() - attentionStart;
    const spawnStart = performance.now();
    this.spawnEntities(dt);
    this.diagnostics.timingsMs.spawning = performance.now() - spawnStart;
    this.diagnostics.counts.entities = this.entities.length;
    this.updateEnergy(dt, localStats);
    this.stats = this.computeStats(localStats);
    this.unlockedProgress = this.tool.unlocked.length / TOOL_UNLOCK_SCHEDULE.length;
    this.diagnostics.counts.focusedEntities = this.attention.mode === 'entity'
      ? 1 + this.attention.relatedEntityIds.length
      : this.attention.mode === 'region'
        ? this.entities.filter((entity) => {
          const offset = this.delta(this.attention.position, entity.position);
          return Math.hypot(offset.x, offset.y) <= this.attention.radius;
        }).length
        : 0;
    this.diagnostics.topHotspots = this.buildHotspotSummary();
    this.world.diagnostics = this.diagnostics;
  }

  getSnapshot(): SimulationSnapshot {
    this.world.events = this.eventQueue.drain();
    this.world.notifications = buildNotifications(this.world.events);
    return this.world;
  }

  private wrapPosition(position: Vec2): Vec2 {
    return {
      x: wrap(position.x, WORLD_WIDTH),
      y: wrap(position.y, WORLD_HEIGHT),
    };
  }

  private beginAttentionDrag(position: Vec2): void {
    this.attentionDragging = true;
    this.tool.pulse = 1;
    this.attention.dragging = true;
    this.attention.dragStart = { ...position };
    this.attention.dragCurrent = { ...position };
    this.attentionPressEntityId = this.findEntityAt(position, 1.18)?.id ?? null;
  }

  private updateAttentionDrag(position: Vec2): void {
    if (!this.attentionDragging) return;
    this.attention.dragging = true;
    this.attention.dragCurrent = { ...position };
  }

  private finishAttentionDrag(position: Vec2): void {
    if (!this.attentionDragging) return;

    this.updateAttentionDrag(position);
    const start = this.attention.dragStart ?? position;
    const offset = this.delta(start, position);
    const distance = Math.hypot(offset.x, offset.y);
    const dragThreshold = clamp(26 / Math.max(this.camera.zoom, 0.35), 18, 60);

    this.attentionDragging = false;
    this.attention.dragging = false;

    if (distance >= dragThreshold) {
      const center = this.wrapPosition({
        x: start.x + offset.x * 0.5,
        y: start.y + offset.y * 0.5,
      });
      const radius = clamp(distance * 0.5, 84, TOOL_RADIUS.observe * 1.8);
      this.setRegionAttention(center, radius);
    } else {
      const entity = this.findEntityAt(position)
        ?? (this.attentionPressEntityId !== null ? this.findEntityByIdNear(this.attentionPressEntityId, start, 104) : undefined);
      if (entity) this.setEntityAttention(entity);
      else this.clearAttention();
    }

    this.attentionPressEntityId = null;
    this.attention.dragStart = null;
    this.attention.dragCurrent = null;
  }

  private cancelAttentionDrag(): void {
    this.attentionDragging = false;
    this.attention.dragging = false;
    this.attentionPressEntityId = null;
    this.attention.dragStart = null;
    this.attention.dragCurrent = null;
  }

  private clearAttention(): void {
    this.attention.mode = 'none';
    this.attention.entityId = null;
    this.attention.radius = TOOL_RADIUS.observe;
    this.attention.strength = 0;
    this.attention.relatedEntityIds = [];
    this.attention.position = { ...this.tool.worldPosition };
  }

  private setEntityAttention(entity: Entity): void {
    this.attention.mode = 'entity';
    this.attention.entityId = entity.id;
    this.attention.position = { ...entity.position };
    this.attention.radius = clamp(160 + entity.size * 8, 150, 240);
    this.attention.strength = 1;
    this.attention.relatedEntityIds = this.getRelatedEntityIds(entity);
  }

  private setRegionAttention(center: Vec2, radius: number): void {
    this.attention.mode = 'region';
    this.attention.entityId = null;
    this.attention.position = { ...center };
    this.attention.radius = radius;
    this.attention.strength = clamp(0.52 + radius / (TOOL_RADIUS.observe * 1.9), 0.58, 1);
    this.attention.relatedEntityIds = [];
  }

  private findEntityByIdNear(id: number, position: Vec2, slackRadius: number): Entity | undefined {
    const entity = this.entityById.get(id);
    if (!entity) return undefined;
    const offset = this.delta(position, entity.position);
    return Math.hypot(offset.x, offset.y) <= slackRadius ? entity : undefined;
  }

  private getRelatedEntityIds(entity: Entity): number[] {
    this.diagnostics.queryCounts.focusSelections += 1;
    return this.entities
      .filter((candidate) => candidate.id !== entity.id)
      .map((candidate) => ({
        id: candidate.id,
        distance: Math.hypot(this.delta(entity.position, candidate.position).x, this.delta(entity.position, candidate.position).y),
        weight: (candidate.type === entity.type ? 0.12 : 0) + candidate.activity * 0.08 + candidate.energy * 0.06,
      }))
      .filter((candidate) => candidate.distance <= 240)
      .sort((a, b) => (a.distance - a.weight * 40) - (b.distance - b.weight * 40))
      .slice(0, 4)
      .map((candidate) => candidate.id);
  }

  private findEntityAt(position: Vec2, radiusBias = 1): Entity | undefined {
    let best: Entity | undefined;
    let bestScore = Infinity;
    const pickRadius = clamp((28 / Math.max(this.camera.zoom, 0.3)) * radiusBias, 20, 92);

    for (const entity of this.entities) {
      const offset = this.delta(position, entity.position);
      const distance = Math.hypot(offset.x, offset.y);
      const threshold = pickRadius + entity.size * (entity.type === 'plant' ? 2.2 : entity.type === 'cluster' ? 1.8 : 1.55);
      if (distance > threshold) continue;
      const normalizedDistance = distance / Math.max(18, threshold);
      const score = normalizedDistance * 42
        - entity.activity * 4
        - entity.visualPulse * 5
        - entity.energy * 2
        - (this.attention.entityId === entity.id ? 3.5 : 0);
      if (score < bestScore) {
        best = entity;
        bestScore = score;
      }
    }

    return best;
  }

  private syncAttentionState(): void {
    if (this.attention.mode !== 'entity' || this.attention.entityId === null) return;

    const entity = this.entityById.get(this.attention.entityId);
    if (!entity) {
      this.clearAttention();
      return;
    }

    this.attention.position = { ...entity.position };
    this.attention.radius = clamp(160 + entity.size * 8, 150, 240);
    this.attention.strength = 1;
    if (this.attentionRefreshTimer <= 0) {
      this.diagnostics.queryCounts.attentionRefreshes += 1;
      this.attention.relatedEntityIds = this.getRelatedEntityIds(entity);
      this.attentionRefreshTimer = FOCUS_REFRESH_INTERVAL;
    }
  }

  private delta(a: Vec2, b: Vec2): Vec2 {
    return {
      x: wrapDelta(a.x, b.x, WORLD_WIDTH),
      y: wrapDelta(a.y, b.y, WORLD_HEIGHT),
    };
  }

  private createAttractors(): Attractor[] {
    const attractors: Attractor[] = [];
    for (let i = 0; i < ATTRACTOR_COUNT; i += 1) {
      const px = fract(0.19 + (i + 1) * GOLDEN_RATIO + this.rng.range(-0.04, 0.04));
      const py = fract(0.47 + (i + 1) * 0.754877666 + this.rng.range(-0.05, 0.05));
      const position = { x: px * WORLD_WIDTH, y: py * WORLD_HEIGHT };
      const sample = this.sampleField(position.x, position.y);
      attractors.push({
        id: i + 1,
        position,
        strength: this.rng.range(0.16, 0.36) * (0.8 + sample.resonance * 0.4),
        orbit: this.rng.range(-0.18, 0.18) + (sample.moisture - 0.5) * 0.08,
        radius: this.rng.range(360, 720) * (0.82 + sample.traversability * 0.36),
        hue: clamp(sample.hue + this.rng.range(-0.08, 0.08), 0.24, 0.82),
      });
    }
    return attractors;
  }

  private createTerrainSamples(): TerrainCell[] {
    const samples: TerrainCell[] = [];
    const drift = this.time * 0.00045;
    for (let index = 0; index < TERRAIN_SAMPLE_COUNT; index += 1) {
      const baseX = fract(0.17 + index * GOLDEN_RATIO + drift * 0.17) * WORLD_WIDTH;
      const baseY = fract(0.61 + index * 0.754877666 + drift * 0.11) * WORLD_HEIGHT;
      const jitterScale = TERRAIN_SAMPLE_RADIUS * 0.34;
      const jitterX = (this.sampleNoise(baseX * 0.00082, baseY * 0.00078, 13.7 + index * 0.07) - 0.5) * jitterScale;
      const jitterY = (this.sampleNoise(baseX * 0.00076, baseY * 0.00084, 21.4 + index * 0.05) - 0.5) * jitterScale;
      const center = {
        x: wrap(baseX + jitterX, WORLD_WIDTH),
        y: wrap(baseY + jitterY, WORLD_HEIGHT),
      };
      const sample = this.sampleField(center.x, center.y);
      const radiusNoise = this.sampleNoise(center.x * 0.00054, center.y * 0.00058, 4.2 + index * 0.03);
      samples.push({
        index,
        center,
        radius: TERRAIN_SAMPLE_RADIUS * (0.54 + radiusNoise * 0.22 + sample.slope * 0.18 + sample.habitatWeights.highland * 0.12 - sample.habitatWeights.wetland * 0.04),
        macro: sample.macro,
        meso: sample.meso,
        micro: sample.micro,
        terrain: sample.terrain,
        habitat: sample.habitat,
        habitatWeights: { ...sample.habitatWeights },
        density: sample.density,
        fertility: sample.fertility,
        moisture: sample.moisture,
        traversability: sample.traversability,
        slope: sample.slope,
        stability: sample.stability,
        flow: sample.flow,
        flowTendency: sample.flowTendency,
        gradient: sample.gradient,
        fertilityGradient: sample.fertilityGradient,
        moistureGradient: sample.moistureGradient,
        resonance: sample.resonance,
        roughness: sample.roughness,
        height: sample.elevation,
        hue: sample.hue,
        nutrient: sample.nutrient,
        temperature: sample.temperature,
      });
    }
    return samples;
  }

  private refreshTerrainSamples(dt: number): void {
    this.terrainSampleTimer -= dt;
    if (this.terrainSampleTimer > 0 && this.terrain.length > 0) return;
    this.terrain = this.createTerrainSamples();
    this.terrainSampleTimer = TERRAIN_SAMPLE_REFRESH_INTERVAL;
  }

  private initializeEnvironmentalFields(): void {
    const initialized = initializeEnvironmentalFieldsStep({
      grid: ENVIRONMENTAL_FIELD_GRID,
      sampleBaseField: (x, y) => this.worldField.sample(x, y, this.time, {
        residueInfluence: 0,
        modifiers: [],
        delta: (a, b) => this.delta(a, b),
      }),
    });
    this.nutrientField.set(initialized.nutrientField);
    this.nutrientBaseline.set(initialized.nutrientBaseline);
    this.temperatureField.set(initialized.temperatureField);
    this.temperatureBaseline.set(initialized.temperatureBaseline);
  }

  private sampleEnvironmentalFields(x: number, y: number): { nutrient: number; temperature: number } {
    return sampleEnvironmentalFieldsStep({
      grid: ENVIRONMENTAL_FIELD_GRID,
      buffers: {
        nutrientField: this.nutrientField,
        temperatureField: this.temperatureField,
      },
    }, x, y);
  }

  private affectEnvironment(position: Vec2, radius: number, nutrientDelta: number, temperatureDelta: number): void {
    affectEnvironmentStep({
      grid: ENVIRONMENTAL_FIELD_GRID,
      buffers: {
        nutrientField: this.nutrientField,
        temperatureField: this.temperatureField,
      },
      delta: (from, to) => this.delta(from, to),
    }, position, radius, nutrientDelta, temperatureDelta);
  }

  private updateEnvironmentalFields(dt: number): void {
    const nextFields = updateEnvironmentalFieldsStep(
      ENVIRONMENTAL_FIELD_GRID,
      {
        nutrientField: this.nutrientField,
        nutrientBaseline: this.nutrientBaseline,
        temperatureField: this.temperatureField,
        temperatureBaseline: this.temperatureBaseline,
      },
      dt,
    );
    this.nutrientField.set(nextFields.nutrientField);
    this.temperatureField.set(nextFields.temperatureField);
  }

  private bucketIndex(value: number, size: number, bucketSize: number, bucketCount: number): number {
    return Math.max(0, Math.min(bucketCount - 1, Math.floor(wrap(value, size) / bucketSize)));
  }

  private bucketKey(col: number, row: number): string {
    return `${col},${row}`;
  }

  private forEachNearbyBucket<T>(
    buckets: Map<string, T[]>,
    position: Vec2,
    radius: number,
    bucketSize: number,
    bucketCols: number,
    bucketRows: number,
    callback: (entry: T) => void,
  ): void {
    const minCol = Math.ceil(radius / bucketSize);
    const minRow = Math.ceil(radius / bucketSize);
    const centerCol = this.bucketIndex(position.x, WORLD_WIDTH, bucketSize, bucketCols);
    const centerRow = this.bucketIndex(position.y, WORLD_HEIGHT, bucketSize, bucketRows);

    for (let rowOffset = -minRow; rowOffset <= minRow; rowOffset += 1) {
      const row = (centerRow + rowOffset + bucketRows) % bucketRows;
      for (let colOffset = -minCol; colOffset <= minCol; colOffset += 1) {
        const col = (centerCol + colOffset + bucketCols) % bucketCols;
        const bucket = buckets.get(this.bucketKey(col, row));
        if (!bucket) continue;
        for (const entry of bucket) callback(entry);
      }
    }
  }

  private insertTerrainModifierBucket(modifier: TerrainModifier): void {
    const key = this.bucketKey(
      this.bucketIndex(modifier.position.x, WORLD_WIDTH, TERRAIN_MODIFIER_BUCKET_SIZE, TERRAIN_MODIFIER_BUCKET_COLS),
      this.bucketIndex(modifier.position.y, WORLD_HEIGHT, TERRAIN_MODIFIER_BUCKET_SIZE, TERRAIN_MODIFIER_BUCKET_ROWS),
    );
    const bucket = this.terrainModifierBuckets.get(key);
    if (bucket) bucket.push(modifier);
    else this.terrainModifierBuckets.set(key, [modifier]);
    this.terrainModifierBucketById.set(modifier.id, key);
  }

  private removeTerrainModifierBucket(modifier: TerrainModifier): void {
    const key = this.terrainModifierBucketById.get(modifier.id);
    if (!key) return;
    const bucket = this.terrainModifierBuckets.get(key);
    if (!bucket) return;
    const index = bucket.indexOf(modifier);
    if (index >= 0) bucket.splice(index, 1);
    if (bucket.length === 0) this.terrainModifierBuckets.delete(key);
    this.terrainModifierBucketById.delete(modifier.id);
  }

  private getNearbyTerrainModifiers(position: Vec2, radius = TERRAIN_MODIFIER_QUERY_RADIUS): TerrainModifier[] {
    const modifiers: TerrainModifier[] = [];
    this.forEachNearbyBucket(
      this.terrainModifierBuckets,
      position,
      radius,
      TERRAIN_MODIFIER_BUCKET_SIZE,
      TERRAIN_MODIFIER_BUCKET_COLS,
      TERRAIN_MODIFIER_BUCKET_ROWS,
      (modifier) => {
        const offset = this.delta(position, modifier.position);
        if (Math.hypot(offset.x, offset.y) <= modifier.radius + radius) modifiers.push(modifier);
      },
    );
    return modifiers;
  }

  private rebuildParticleBuckets(): void {
    this.particleBuckets.clear();
    this.particleById.clear();
    for (const particle of this.particles) {
      this.particleById.set(particle.id, particle);
      const key = this.bucketKey(
        this.bucketIndex(particle.position.x, WORLD_WIDTH, PARTICLE_BUCKET_SIZE, PARTICLE_BUCKET_COLS),
        this.bucketIndex(particle.position.y, WORLD_HEIGHT, PARTICLE_BUCKET_SIZE, PARTICLE_BUCKET_ROWS),
      );
      const bucket = this.particleBuckets.get(key);
      if (bucket) bucket.push(particle);
      else this.particleBuckets.set(key, [particle]);
    }
  }

  private rebuildResidueBuckets(): void {
    this.residueBuckets.clear();
    this.residueById.clear();
    for (const residue of this.residues) {
      this.residueById.set(residue.id, residue);
      const key = this.bucketKey(
        this.bucketIndex(residue.position.x, WORLD_WIDTH, RESIDUE_BUCKET_SIZE, RESIDUE_BUCKET_COLS),
        this.bucketIndex(residue.position.y, WORLD_HEIGHT, RESIDUE_BUCKET_SIZE, RESIDUE_BUCKET_ROWS),
      );
      const bucket = this.residueBuckets.get(key);
      if (bucket) bucket.push(residue);
      else this.residueBuckets.set(key, [residue]);
    }
  }

  private rebuildEntityBuckets(): void {
    this.entityBuckets.clear();
    this.entityBucketById.clear();
    this.entityById.clear();
    for (const entity of this.entities) this.insertEntityBucket(entity);
  }

  private insertEntityBucket(entity: Entity): void {
    const key = this.bucketKey(
      this.bucketIndex(entity.position.x, WORLD_WIDTH, ENTITY_BUCKET_SIZE, ENTITY_BUCKET_COLS),
      this.bucketIndex(entity.position.y, WORLD_HEIGHT, ENTITY_BUCKET_SIZE, ENTITY_BUCKET_ROWS),
    );
    const bucket = this.entityBuckets.get(key);
    if (bucket) bucket.push(entity);
    else this.entityBuckets.set(key, [entity]);
    this.entityBucketById.set(entity.id, key);
    this.entityById.set(entity.id, entity);
  }

  private removeEntityBucket(entity: Entity): void {
    const key = this.entityBucketById.get(entity.id);
    if (!key) return;
    const bucket = this.entityBuckets.get(key);
    if (!bucket) return;
    const index = bucket.indexOf(entity);
    if (index >= 0) bucket.splice(index, 1);
    if (bucket.length === 0) this.entityBuckets.delete(key);
    this.entityBucketById.delete(entity.id);
    this.entityById.delete(entity.id);
  }

  private syncEntityBucket(entity: Entity, persists: boolean): void {
    if (!persists) {
      this.removeEntityBucket(entity);
      return;
    }
    const nextKey = this.bucketKey(
      this.bucketIndex(entity.position.x, WORLD_WIDTH, ENTITY_BUCKET_SIZE, ENTITY_BUCKET_COLS),
      this.bucketIndex(entity.position.y, WORLD_HEIGHT, ENTITY_BUCKET_SIZE, ENTITY_BUCKET_ROWS),
    );
    const currentKey = this.entityBucketById.get(entity.id);
    if (currentKey === nextKey) return;
    this.removeEntityBucket(entity);
    this.insertEntityBucket(entity);
  }

  private shouldReuseTarget(entity: Entity): boolean {
    return (entity.retargetTimer ?? 0) > 0;
  }

  private scheduleRetarget(entity: Entity, urgency = 1): void {
    entity.retargetTimer = this.rng.range(TARGET_REUSE_INTERVAL * 0.6, TARGET_REUSE_INTERVAL * 1.2) / Math.max(0.6, urgency);
  }

  private getTrackedParticleTarget(
    entity: Entity,
    radius: number,
    predicate: (particle: FeedParticle) => boolean,
  ): FeedParticle | undefined {
    if (!entity.targetId || (entity.targetKind !== 'fruit' && entity.targetKind !== 'feed')) return undefined;
    const target = this.particleById.get(entity.targetId);
    if (!target || !predicate(target) || target.age >= target.duration) return undefined;
    const offset = this.delta(entity.position, target.position);
    if (Math.hypot(offset.x, offset.y) > radius) return undefined;
    this.diagnostics.queryCounts.targetReuses += 1;
    return target;
  }

  private getTrackedResidueTarget(entity: Entity, radius: number): Residue | undefined {
    if (!entity.targetId || entity.targetKind !== 'residue') return undefined;
    const target = this.residueById.get(entity.targetId);
    if (!target || target.nutrient <= 0.02 || target.age >= target.duration) return undefined;
    const offset = this.delta(entity.position, target.position);
    if (Math.hypot(offset.x, offset.y) > radius) return undefined;
    this.diagnostics.queryCounts.targetReuses += 1;
    return target;
  }

  private getTrackedBloomTarget(entity: Entity, radius: number, grazer = false): Entity | undefined {
    if (!entity.targetId || entity.targetKind !== 'bloom') return undefined;
    const target = this.entityById.get(entity.targetId);
    if (!target || !ROOTED_BLOOM_TYPES.includes(target.type)) return undefined;
    const offset = this.delta(entity.position, target.position);
    if (Math.hypot(offset.x, offset.y) > radius) return undefined;
    if (grazer && target.stage !== 'mature' && target.pollination < 0.18 && target.energy < 0.24) return undefined;
    this.diagnostics.queryCounts.targetReuses += 1;
    return target;
  }

  private createEntity(type: EntityType, position: Vec2): Entity {
    const baseSize = { flocker: 6.2, cluster: 8.4, plant: 8.2, ephemeral: 6.6, canopy: 10.6, grazer: 10.4, parasite: 7.2, predator: 11 }[type];
    const lifeSpan = { flocker: 124, cluster: 148, plant: 224, ephemeral: 92, canopy: 268, grazer: 162, parasite: 118, predator: 150 }[type];
    const tone = { flocker: 0.72, cluster: 0.22, plant: 0.3, ephemeral: 0.4, canopy: 0.24, grazer: 0.48, parasite: 0.58, predator: 0.74 }[type];
    const clusterId = type === 'cluster' ? this.nextClusterId++ : 0;
    const vitality = ROOTED_BLOOM_TYPES.includes(type)
      ? this.rng.range(type === 'ephemeral' ? 0.42 : type === 'canopy' ? 0.6 : 0.52, type === 'ephemeral' ? 0.68 : type === 'canopy' ? 0.9 : 0.82)
      : type === 'cluster'
        ? this.rng.range(0.46, 0.74)
        : type === 'grazer'
          ? this.rng.range(0.44, 0.68)
          : type === 'parasite'
            ? this.rng.range(0.36, 0.62)
            : this.rng.range(0.56, 0.86);
    const growth = type === 'plant'
      ? this.rng.range(0.22, 0.48)
      : type === 'ephemeral'
        ? this.rng.range(0.34, 0.62)
        : type === 'canopy'
          ? this.rng.range(0.12, 0.28)
          : type === 'cluster'
            ? this.rng.range(0.18, 0.42)
            : type === 'grazer'
              ? this.rng.range(0.14, 0.28)
              : type === 'parasite'
                ? this.rng.range(0.16, 0.34)
                : this.rng.range(0.16, 0.34);
    return {
      id: this.nextId++,
      type,
      stage: 'birth',
      position: { ...position },
      velocity: ROOTED_BLOOM_TYPES.includes(type) ? { x: 0, y: 0 } : this.randomVelocity(type === 'cluster' ? 1.6 : type === 'grazer' ? 1.3 : type === 'parasite' ? 0.9 : 2.8),
      heading: this.rng.range(0, TWO_PI),
      size: baseSize,
      baseSize,
      energy: clamp(vitality + this.rng.range(0.04, 0.16), 0, 1.2),
      growth,
      resonance: this.rng.range(type === 'cluster' ? 0.18 : type === 'grazer' ? 0.22 : type === 'parasite' ? 0.2 : 0.24, type === 'flocker' ? 0.82 : type === 'grazer' ? 0.64 : type === 'parasite' ? 0.58 : 0.72),
      harmony: this.rng.range(type === 'cluster' ? 0.18 : type === 'grazer' ? 0.28 : type === 'parasite' ? 0.18 : 0.4, type === 'flocker' ? 0.88 : type === 'grazer' ? 0.68 : type === 'parasite' ? 0.46 : 0.76),
      stability: this.rng.range(type === 'flocker' ? 0.42 : type === 'grazer' ? 0.52 : type === 'parasite' ? 0.38 : 0.56, type === 'cluster' ? 0.86 : type === 'grazer' ? 0.88 : type === 'parasite' ? 0.74 : 0.94),
      age: 0,
      lifeSpan: lifeSpan + this.rng.range(-14, 18),
      stageProgress: 0,
      reproductionCooldown: this.rng.range(ROOTED_BLOOM_TYPES.includes(type) ? 12 : type === 'grazer' ? 14 : 10, type === 'cluster' ? 18 : type === 'grazer' ? 26 : type === 'canopy' ? 34 : 24),
      pulse: 0,
      tone: clamp(tone + this.rng.range(-0.06, 0.06), 0, 1),
      shape: this.rng.range(0, 1),
      hueShift: this.rng.range(-0.18, 0.18),
      terrainBias: this.rng.range(-0.16, 0.16),
      clusterId,
      appetite: this.rng.range(type === 'cluster' ? 0.52 : type === 'grazer' ? 0.62 : type === 'parasite' ? 0.44 : 0.24, type === 'cluster' ? 1.08 : type === 'grazer' ? 0.98 : type === 'parasite' ? 0.82 : 0.92),
      anchor: ROOTED_BLOOM_TYPES.includes(type) ? { ...position } : undefined,
      visualState: 'idle',
      visualPulse: 0,
      boundaryFade: 1,
      activity: this.rng.range(ROOTED_BLOOM_TYPES.includes(type) ? (type === 'ephemeral' ? 0.12 : 0.08) : type === 'grazer' ? 0.18 : type === 'parasite' ? 0.12 : 0.14, type === 'cluster' ? 0.32 : type === 'grazer' ? 0.34 : type === 'parasite' ? 0.26 : 0.44),
      activityBias: this.rng.range(0, 1),
      food: this.rng.range(ROOTED_BLOOM_TYPES.includes(type) ? (type === 'canopy' ? 0.62 : 0.54) : type === 'grazer' ? 0.44 : type === 'parasite' ? 0.36 : 0.42, type === 'cluster' ? 0.88 : type === 'grazer' ? 0.74 : type === 'parasite' ? 0.62 : 0.76),
      fruitCooldown: this.rng.range(ROOTED_BLOOM_TYPES.includes(type) ? (type === 'canopy' ? 14 : 8) : type === 'grazer' ? 10 : 5, ROOTED_BLOOM_TYPES.includes(type) ? (type === 'canopy' ? 24 : 16) : type === 'grazer' ? 18 : 10),
      vitality,
      pollination: ROOTED_BLOOM_TYPES.includes(type) ? this.rng.range(type === 'canopy' ? 0.08 : 0.12, type === 'ephemeral' ? 0.42 : 0.34) : 0,
      memory: this.rng.range(type === 'grazer' ? 0.24 : type === 'parasite' ? 0.16 : 0.18, type === 'grazer' ? 0.52 : type === 'parasite' ? 0.42 : 0.44),
      soundCooldown: this.rng.range(0, 0.8),
      acousticPressure: this.rng.range(0.1, 0.4),
      acousticPattern: this.rng.range(0.1, 0.5),
      predatorState: 'resting',
      targetId: undefined,
      targetKind: undefined,
      retargetTimer: this.rng.range(0, TARGET_REUSE_INTERVAL),
      trail: [],
    };
  }

  private seedInitialNutrients(): void {
    for (let i = 0; i < 22; i += 1) {
      this.spawnParticle(this.randomTerrainPoint(i % 4 === 0 ? 'water' : 'fertile'), 120 + this.rng.range(0, 90), 'feed', true);
    }

    for (let i = 0; i < 10; i += 1) {
      this.spawnResidue(this.randomTerrainPoint('fertile'), this.rng.range(0.42, 0.72), 'plant');
    }

    for (let i = 0; i < 20; i += 1) {
      const species: EntityType = i % 5 === 0 ? 'canopy' : i % 3 === 0 ? 'ephemeral' : i % 2 === 0 ? 'plant' : 'cluster';
      this.spawnPropagule(this.randomSpawnPointForEntity(species), species === 'cluster' ? 'spore' : 'seed', species, undefined, 0.42);
    }
  }

  private deployToolField(tool: ToolType, position: Vec2): void {
    const cost = TOOL_ENERGY_COST[tool];
    if (this.energy < cost) {
      this.tool.blocked = true;
      this.tool.pulse = 1;
      this.emitToolFeedback(tool, position, 0.26);
      this.emitWorldEvent({ type: 'toolUsed', time: this.time, position: { ...position }, tool, blocked: true });
      return;
    }
    this.energy = Math.max(0, this.energy - cost);

    const field: ToolField = {
      id: this.nextFieldId++,
      tool,
      position: { ...position },
      radius: TOOL_RADIUS[tool],
      strength: 1,
      duration: TOOL_DURATION[tool],
      age: 0,
      pulse: 0.6,
      delay: tool === 'disrupt' ? 1.4 : 0,
      exploded: false,
    };
    this.fields.push(field);
    this.emitWorldEvent({ type: 'toolUsed', time: this.time, position: { ...position }, tool, blocked: false });
    this.tool.pulse = 1;
    this.tool.strength = 1;
    this.emitToolFeedback(tool, position, tool === 'disrupt' ? 0.66 : 0.48);

    if (tool === 'feed') {
      for (let i = 0; i < 14; i += 1) this.spawnParticle(field.position, field.radius * 0.7, 'feed', true);
    }
  }

  private updateAttractors(dt: number): void {
    for (const attractor of this.attractors) {
      attractor.position.x = wrap(attractor.position.x + Math.sin(this.time * 0.007 + attractor.id) * dt * 5, WORLD_WIDTH);
      attractor.position.y = wrap(attractor.position.y + Math.cos(this.time * 0.006 + attractor.id * 0.8) * dt * 4.2, WORLD_HEIGHT);
      attractor.orbit = lerp(attractor.orbit, Math.sin(this.time * 0.012 + attractor.id) * 0.16, dt * 0.12);
    }
  }

  private updateTerrainModifiers(dt: number): void {
    const active: TerrainModifier[] = [];
    for (const modifier of this.terrainModifiers) {
      modifier.age += dt;
      if (modifier.age < modifier.duration) active.push(modifier);
      else this.removeTerrainModifierBucket(modifier);
    }
    this.terrainModifiers = active;
  }

  private updateFields(dt: number): void {
    const active: ToolField[] = [];
    for (const field of this.fields) {
      field.age += dt;
      field.strength = clamp(1 - field.age / field.duration, 0, 1);
      field.pulse = lerp(field.pulse, 0.04, dt * 1.2);

      if (field.tool === 'feed' && this.rng.next() < dt * 2.6) {
        this.spawnParticle(field.position, field.radius * 0.52, 'feed', false);
      }

      if (field.tool === 'disrupt' && !field.exploded && field.age >= (field.delay ?? 0)) {
        field.exploded = true;
        this.triggerDisrupt(field);
      }

      if (field.age < field.duration) active.push(field);
    }
    this.fields = active;
  }

  private updateParticles(dt: number): void {
    const nextParticles: FeedParticle[] = [];
    for (const particle of this.particles) {
      particle.age += dt;
      const flow = this.sampleField(particle.position.x, particle.position.y).flow;
      particle.position = this.wrapPosition({
        x: particle.position.x + (particle.velocity.x + flow.x * 0.25) * dt,
        y: particle.position.y + (particle.velocity.y + flow.y * 0.25) * dt,
      });
      particle.velocity.x *= Math.pow(0.988, dt * 60);
      particle.velocity.y *= Math.pow(0.988, dt * 60);
      if (particle.age < particle.duration) nextParticles.push(particle);
    }
    this.particles = nextParticles;
  }

  private updateResidues(dt: number): void {
    const active: Residue[] = [];
    for (const residue of this.residues) {
      residue.age += dt;
      this.affectEnvironment(residue.position, residue.radius * 0.62, residue.nutrient * dt * 0.018, -dt * 0.002);
      residue.nutrient = clamp(residue.nutrient - dt * 0.006, 0, 1.2);
      residue.richness = clamp(residue.nutrient * (1 - residue.age / residue.duration), 0, 1.4);
      if (residue.age < residue.duration && residue.nutrient > 0.02) active.push(residue);
    }
    this.residues = active;
  }

  private updatePropagules(dt: number): void {
    updatePropagulesStep(this.createSpawningRuntimeContext(), dt);
  }

  private updateBursts(dt: number): void {
    this.bursts = this.bursts.filter((burst) => {
      burst.age += dt;
      return burst.age < burst.duration;
    });
  }

  private applyEntityBehavior(
    entity: Entity,
    sample: FieldSample,
    neighbors: Entity[],
    dt: number,
    focusWeight: number,
    localStats: LocalEcologyStats,
  ): void {
    const activityPulse = Math.sin(this.time * (0.018 + entity.activityBias * 0.015) + entity.id * 0.7) * 0.5 + 0.5;
    entity.retargetTimer = Math.max(0, (entity.retargetTimer ?? 0) - dt);
    const nearbyFood = entity.type === 'grazer' || entity.type === 'flocker' || entity.type === 'parasite' || entity.type === 'predator'
      ? this.countNearbyFood(entity.position, entity.type === 'flocker' ? 210 : 160)
      : 0;
    const nearbyResidue = entity.type === 'cluster' || entity.type === 'parasite' ? this.getResidueInfluence(entity.position.x, entity.position.y) : 0;
    const rooted = ROOTED_BLOOM_TYPES.includes(entity.type);
    const targetActivity = rooted
      ? 0.06 + sample.fertility * 0.08 + sample.nutrient * 0.14 + focusWeight * 0.08 + entity.pollination * 0.05 + (entity.type === 'ephemeral' ? 0.08 : entity.type === 'canopy' ? -0.01 : 0)
      : entity.type === 'cluster'
        ? 0.12 + activityPulse * 0.12 + nearbyResidue * 0.28 + focusWeight * 0.08
        : entity.type === 'grazer'
          ? 0.1 + activityPulse * 0.08 + nearbyFood * 0.3 + focusWeight * 0.16 + Math.max(0, 0.4 - entity.energy) * 0.18
          : entity.type === 'parasite'
            ? 0.1 + activityPulse * 0.08 + nearbyResidue * 0.08 + focusWeight * 0.12 + Math.max(0, 0.45 - entity.energy) * 0.24
            : 0.18 + activityPulse * 0.22 + nearbyFood * 0.24 + focusWeight * 0.18;
    entity.activity = lerp(entity.activity, clamp(targetActivity, 0.04, 1), dt * 0.7);
    entity.resonance = clamp(lerp(entity.resonance, 0.28 + sample.resonance * (entity.type === 'cluster' ? 0.46 : 0.72), dt * 0.12), 0, 1.3);
    entity.stability = clamp(lerp(entity.stability, 0.34 + sample.stability * 0.86 + (rooted ? sample.fertility * 0.08 : 0), dt * 0.08), 0, 1.2);
    entity.food = clamp(entity.food - dt * (rooted ? (entity.type === 'ephemeral' ? 0.0032 : entity.type === 'canopy' ? 0.0016 : 0.0022) : entity.type === 'cluster' ? 0.0052 : entity.type === 'grazer' ? 0.011 + entity.activity * 0.012 : entity.type === 'parasite' ? 0.006 + entity.activity * 0.008 : 0.008 + entity.activity * 0.01), 0, 1.6);
    entity.energy = clamp(entity.energy - dt * (rooted ? (entity.type === 'ephemeral' ? 0.0024 : entity.type === 'canopy' ? 0.001 : 0.0014) : entity.type === 'cluster' ? 0.0038 : entity.type === 'grazer' ? 0.009 + entity.activity * 0.01 : entity.type === 'parasite' ? 0.0064 + entity.activity * 0.007 : 0.005 + entity.activity * 0.008), 0, 1.6);
    entity.memory = clamp(entity.memory - dt * 0.012, 0, 1.2);
    entity.pollination = clamp(entity.pollination - dt * (rooted ? 0.012 : 0), 0, 1.6);

    this.applyToolFields(entity, dt);
    entity.boundaryFade = lerp(entity.boundaryFade, clamp(0.58 + sample.traversability * 0.42, 0.52, 1), dt * 0.24);

    if (rooted) this.updatePlant(entity, sample, dt, localStats);
    else this.updateCreature(entity, sample, neighbors, dt, localStats);

    entity.vitality = clamp(entity.energy * 0.55 + entity.food * 0.25 + entity.stability * 0.2, 0, 1.6);
    entity.stageProgress = computeLifecycleProgress(entity, ROOTED_BLOOM_TYPE_SET);
    entity.stage = computeLifecycleStage(entity.stageProgress);
    entity.size = clamp(entity.baseSize * (0.68 + entity.growth * 0.42 + entity.stageProgress * 0.24 + (rooted ? entity.pollination * 0.04 : entity.type === 'grazer' ? entity.food * 0.05 : 0)), entity.baseSize * 0.54, entity.baseSize * 2.1);
    entity.heading = Math.atan2(entity.velocity.y || 0.001, entity.velocity.x || 0.001);
    entity.acousticPattern = lerp(
      entity.acousticPattern,
      clamp(entity.pulse * 0.56 + entity.activity * 0.28 + (entity.visualState === 'feeding' ? 0.12 : 0), 0, 1.4),
      dt * 0.42,
    );
    this.updateTrail(entity);
    localStats.activity += entity.activity;
    localStats.harmony += entity.harmony;
    localStats.stability += entity.stability;
    localStats.interactions += 1;
    localStats.focus += focusWeight;
    localStats.nutrients += sample.nutrient;
    localStats.temperature += sample.temperature;
  }

  private updateCreature(
    entity: Entity,
    sample: FieldSample,
    neighbors: Entity[],
    dt: number,
    localStats: SpeciesLocalStats,
  ): void {
    const speciesContext = this.createSpeciesRuntimeContext();

    if (entity.type === 'cluster') {
      updateDecomposer(speciesContext, entity, sample, neighbors, dt, localStats);
      return;
    }
    if (entity.type === 'predator') {
      updatePredator(speciesContext, entity, sample, neighbors, dt, localStats);
      return;
    }
    if (entity.type === 'grazer') {
      updateGrazer(speciesContext, entity, sample, neighbors, dt, localStats);
      return;
    }
    if (entity.type === 'parasite') {
      updateParasite(speciesContext, entity, sample, neighbors, dt, localStats);
      return;
    }

    updatePollinator(speciesContext, entity, sample, neighbors, dt, localStats);
  }

  private shouldEmitSound(
    entity: Entity,
    dt: number,
    baseRate: number,
    contextWeight: number,
  ): boolean {
    if (entity.soundCooldown > 0) return false;
    const lifecycleWeight = entity.stage === 'mature' ? 1.15 : entity.stage === 'decay' ? 0.72 : 0.92;
    const stateWeight = entity.visualState === 'feeding'
      ? 1.2
      : entity.visualState === 'reproducing'
        ? 1.08
        : entity.visualState === 'dying'
          ? 0.42
          : 0.64;
    const silenceBias = clamp(0.72 - entity.activity * 0.38 - entity.energy * 0.16, 0.16, 0.82);
    const probability = clamp(
      dt * baseRate * contextWeight * lifecycleWeight * stateWeight * (1 - silenceBias * 0.55),
      0,
      0.92,
    );
    if (this.rng.next() >= probability) return false;
    entity.soundCooldown = this.rng.range(0.2, 1.1) * (entity.visualState === 'idle' ? 1.2 : 0.85);
    return true;
  }

  private createSpeciesRuntimeContext(): SpeciesRuntimeContext {
    return {
      now: this.time,
      delta: (a, b) => this.delta(a, b),
      wrapPosition: (position) => this.wrapPosition(position),
      habitatMatch,
      habitatPenalty,
      shouldReuseTarget: (entity) => this.shouldReuseTarget(entity),
      scheduleRetarget: (entity, urgency) => this.scheduleRetarget(entity, urgency),
      getTrackedParticleTarget: (entity, radius, predicate) => this.getTrackedParticleTarget(entity, radius, predicate),
      getTrackedResidueTarget: (entity, radius) => this.getTrackedResidueTarget(entity, radius),
      getTrackedBloomTarget: (entity, radius, grazer = false) => this.getTrackedBloomTarget(entity, radius, grazer),
      findFoodTarget: (position, radius, predicate) => this.findFoodTarget(position, radius, predicate),
      findBloomTarget: (position) => this.findBloomTarget(position),
      findGrazerBloomTarget: (position) => this.findGrazerBloomTarget(position),
      findResidueTarget: (position) => this.findResidueTarget(position),
      consumeParticle: (entity, particle, dt, seekRadius, pullRadius, fruitPull, feedPull, gain, localStats) => this.consumeParticle(entity, particle, dt, seekRadius, pullRadius, fruitPull, feedPull, gain, localStats),
      computePairResonance: (a, b, proximity) => this.computePairResonance(a, b, proximity),
      affectEnvironment: (position, radius, nutrientDelta, temperatureDelta) => this.affectEnvironment(position, radius, nutrientDelta, temperatureDelta),
      seedTerrain: (position, radius, fertility, moisture, solidity, duration) => this.seedTerrain(position, radius, fertility, moisture, solidity, duration),
      spawnParticle: (origin, spread, kind, initial, sourceEntityId) => this.spawnParticle(origin, spread, kind, initial, sourceEntityId),
      emitBurst: (type, position, radius, hue) => this.emitBurst(type, position, radius, hue),
      emitWorldEvent: (event) => this.emitWorldEvent(event),
      spawnPropagule: (position, kind, species, sourceEntityId, nutrient) => this.spawnPropagule(position, kind, species, sourceEntityId, nutrient),
      spawnResidue: (position, nutrient, sourceType) => this.spawnResidue(position, nutrient, sourceType),
      random: () => this.rng.next(),
      randomRange: (min, max) => this.rng.range(min, max),
      shouldEmitSound: (entity, dt, baseRate, contextWeight) => this.shouldEmitSound(entity, dt, baseRate, contextWeight),
      incrementTargetRetargets: () => {
        this.diagnostics.queryCounts.targetRetargets += 1;
      },
      incrementFruitingBursts: () => {
        this.diagnostics.lifecycleTransitions.fruitingBursts += 1;
      },
    };
  }

  private updatePlant(
    entity: Entity,
    sample: FieldSample,
    dt: number,
    localStats: SpeciesLocalStats,
  ): void {
    updatePlant(this.createSpeciesRuntimeContext(), entity, sample, dt, localStats);
  }

  private applyToolFields(
    entity: Entity,
    dt: number,
  ): void {
    for (const field of this.fields) {
      const offset = this.delta(entity.position, field.position);
      const dist = Math.hypot(offset.x, offset.y) || 1;
      if (dist > field.radius) continue;
      const falloff = smoothstep(field.radius, 0, dist) * Math.max(field.strength, 0.15);
      const nx = offset.x / dist;
      const ny = offset.y / dist;

      entity.pulse = Math.max(entity.pulse, 0.12 + falloff * 0.18);
      field.pulse = Math.max(field.pulse, falloff * 0.14);

      if (field.tool === 'grow') {
        entity.velocity.x += nx * dt * 9 * falloff;
        entity.velocity.y += ny * dt * 9 * falloff;
        if (ROOTED_BLOOM_TYPES.includes(entity.type)) {
          entity.energy = clamp(entity.energy + dt * 0.08 * falloff, 0, 1.5);
          entity.growth = clamp(entity.growth + dt * 0.1 * falloff, 0, 1.8);
          entity.pollination = clamp(entity.pollination + dt * 0.04 * falloff, 0, 1.8);
        } else if (entity.type === 'cluster') {
          entity.energy = clamp(entity.energy + dt * 0.04 * falloff, 0, 1.4);
          entity.memory = clamp(entity.memory + dt * 0.06 * falloff, 0, 1.2);
        } else {
          entity.stability = clamp(entity.stability + dt * 0.05 * falloff, 0, 1.2);
          if (entity.type === 'grazer') entity.energy = clamp(entity.energy + dt * 0.03 * falloff, 0, 1.5);
        }
        this.seedTerrain(field.position, field.radius * 0.8, 0.08 * dt, 0.04 * dt, -0.02 * dt, 2.8);
      } else if (field.tool === 'feed') {
        if (!ROOTED_BLOOM_TYPES.includes(entity.type)) entity.activity = clamp(entity.activity + dt * 0.14 * falloff, 0, 1);
        if (entity.type === 'flocker') entity.memory = clamp(entity.memory + dt * 0.08 * falloff, 0, 1.2);
        if (entity.type === 'grazer') entity.memory = clamp(entity.memory + dt * 0.1 * falloff, 0, 1.2);
      } else if (field.tool === 'repel') {
        const wave = smoothstep(0, field.radius, dist) * Math.max(field.strength, 0.2);
        entity.velocity.x -= nx * dt * 22 * wave;
        entity.velocity.y -= ny * dt * 22 * wave;
      } else if (field.tool === 'disrupt' && field.exploded) {
        entity.velocity.x -= nx * dt * 30 * falloff;
        entity.velocity.y -= ny * dt * 30 * falloff;
        entity.stability = clamp(entity.stability - dt * 0.08 * falloff, 0, 1.2);
      }
    }
  }

  private createLifecycleRuntimeContext(): LifecycleRuntimeContext {
    return {
      now: this.time,
      rootBloomTypes: ROOTED_BLOOM_TYPE_SET,
      random: () => this.rng.next(),
      spawnResidue: (position, nutrient, source) => this.spawnResidue(position, nutrient, source),
      spawnPropagule: (position, kind, species, sourceEntityId, nutrientBoost) =>
        this.spawnPropagule(position, kind, species, sourceEntityId, nutrientBoost),
      emitBurst: (type, position, radius, hue) => this.emitBurst(type, position, radius, hue),
      emitWorldEvent: (event) => this.emitWorldEvent(event),
      incrementDeaths: () => {
        this.diagnostics.lifecycleTransitions.deaths += 1;
      },
    };
  }

  private spawnEntities(dt: number): void {
    spawnEntitiesStep(this.createSpawningRuntimeContext(), dt);
  }

  private createSpawningRuntimeContext(): SpawningRuntimeContext {
    return {
      rootBloomTypes: ROOTED_BLOOM_TYPE_SET,
      maxBySpecies: {
        flocker: MAX_FLOCKERS,
        cluster: MAX_CLUSTERS,
        plant: MAX_PLANTS,
        ephemeral: MAX_EPHEMERALS,
        canopy: MAX_CANOPIES,
        grazer: MAX_GRAZERS,
        parasite: MAX_PARASITES,
        predator: Number.POSITIVE_INFINITY,
      },
      now: this.time,
      entities: this.entities,
      getPropagules: () => this.propagules,
      setPropagules: (propagules) => {
        this.propagules = propagules;
      },
      sampleField: (x, y) => this.sampleField(x, y),
      wrapPosition: (position) => this.wrapPosition(position),
      countEntities: () => this.countEntities(),
      getNeighborsAtPosition: (position, radius) => this.getNeighborsAtPosition(position, radius),
      getNeighborsByEntity: (entity, radius) => this.getNeighborsByEntity(entity, radius),
      getEntitySpawnSuitability: (type, sample) => this.getEntitySpawnSuitability(type, sample),
      findNearbySpawnPoint: (origin, radius, predicate) => this.findNearbySpawnPoint(origin, radius, predicate),
      findFoodTarget: (position, radius, filter) => this.findFoodTarget(position, radius, filter ?? (() => true)) ?? null,
      findResidueTarget: (position, radius) => this.findResidueTarget(position, radius) ?? null,
      createEntity: (type, position) => this.createEntity(type, position),
      spawnPropagule: (position, kind, species, sourceEntityId, nutrientBoost) =>
        this.spawnPropagule(position, kind, species, sourceEntityId, nutrientBoost),
      emitBurst: (type, position, radius, hue) => this.emitBurst(type, position, radius, hue),
      emitWorldEvent: (event) => this.emitWorldEvent(event),
      removePropaguleById: (id) => this.propagulesById.delete(id),
      affectEnvironment: (position, radius, nutrientDelta, temperatureDelta) =>
        this.affectEnvironment(position, radius, nutrientDelta, temperatureDelta),
      random: () => this.rng.next(),
      randomRange: (min, max) => this.rng.range(min, max),
      incrementGerminations: () => {
        this.diagnostics.lifecycleTransitions.germinations += 1;
      },
      incrementPropagulesCreated: () => {
        this.diagnostics.lifecycleTransitions.propagulesCreated += 1;
      },
    };
  }

  private updateEnergy(
    dt: number,
    localStats: LocalEcologyStats,
  ): void {
    this.energy = updateSimulationEnergy(this.energy, dt, localStats, this.fields);
  }

  private computeStats(localStats?: LocalEcologyStats): GardenStats {
    const counts = this.countEntities();
    return computeGardenStats(this.energy, counts, this.entities, this.terrain, this.particles, localStats);
  }

  private buildHotspotSummary(): string[] {
    return buildHotspotSummary(this.diagnostics);
  }

  private unlockTools(): void {
    for (const unlock of TOOL_UNLOCK_SCHEDULE) {
      if (this.time >= unlock.time && this.energy >= unlock.energy && !this.tool.unlocked.includes(unlock.tool)) {
        this.tool.unlocked = [...this.tool.unlocked, unlock.tool];
        this.tool.pulse = 1;
        this.emitToolFeedback(unlock.tool, this.tool.worldPosition, 0.5);
      }
    }
  }

  private sampleField(x: number, y: number): FieldSample {
    const worldX = wrap(x, WORLD_WIDTH);
    const worldY = wrap(y, WORLD_HEIGHT);
    const cacheKey = `${worldX.toFixed(2)}:${worldY.toFixed(2)}`;
    const cached = this.fieldSampleCache.get(cacheKey);
    if (cached) return cached;
    this.diagnostics.queryCounts.terrainSamples += 1;
    const modifiers = this.getNearbyTerrainModifiers({ x: worldX, y: worldY });
    this.diagnostics.queryCounts.terrainModifierChecks += modifiers.length;
    const residueInfluence = this.getResidueInfluence(worldX, worldY);
    const baseSample = this.worldField.sample(worldX, worldY, this.time, {
      residueInfluence,
      modifiers,
      delta: (a, b) => this.delta(a, b),
    });
    const environmental = this.sampleEnvironmentalFields(worldX, worldY);
    const sample = {
      ...baseSample,
      nutrient: clamp(baseSample.nutrient * 0.42 + environmental.nutrient * 0.72 + residueInfluence * 0.16, 0, 1),
      temperature: clamp(baseSample.temperature * 0.42 + environmental.temperature * 0.72, 0, 1),
      stability: clamp(baseSample.stability + environmental.nutrient * 0.06 - Math.abs(environmental.temperature - 0.5) * 0.04, 0, 1),
      resonance: clamp(baseSample.resonance + environmental.nutrient * 0.04, 0, 1),
    } satisfies FieldSample;
    this.fieldSampleCache.set(cacheKey, sample);
    return sample;
  }

  private getResidueInfluence(x: number, y: number): number {
    this.diagnostics.queryCounts.residueInfluenceSamples += 1;
    let value = 0;
    this.forEachNearbyBucket(this.residueBuckets, { x, y }, 160, RESIDUE_BUCKET_SIZE, RESIDUE_BUCKET_COLS, RESIDUE_BUCKET_ROWS, (residue) => {
      const offset = this.delta({ x, y }, residue.position);
      const dist = Math.hypot(offset.x, offset.y);
      if (dist > residue.radius) return;
      value += smoothstep(residue.radius, 0, dist) * residue.nutrient;
    });
    return clamp(value, 0, 1.2);
  }

  private computePairResonance(a: Entity, b: Entity, proximity: number) {
    const offset = this.delta(a.position, b.position);
    const midpoint = this.wrapPosition({
      x: a.position.x + offset.x * 0.5,
      y: a.position.y + offset.y * 0.5,
    });
    const sample = this.sampleField(midpoint.x, midpoint.y);
    const tone = 1 - Math.abs(a.tone - b.tone);
    const harmony = clamp(tone * 0.34 + sample.resonance * 0.34 + proximity * 0.32, 0, 1);
    const dissonance = clamp((1 - tone) * 0.2 + (sample.terrain === 'solid' ? 0.18 : 0) + (a.type === 'predator' || b.type === 'predator' ? 0.08 : 0), 0, 1);
    return { harmony, dissonance };
  }


  private updateTrail(entity: Entity): void {
    if (ROOTED_BLOOM_TYPES.includes(entity.type)) {
      entity.trail = [];
      return;
    }
    entity.trail.unshift({ ...entity.position });
    const maxTrail = entity.type === 'cluster' ? 8 : entity.type === 'grazer' ? 7 : 6;
    if (entity.trail.length > maxTrail) entity.trail.length = maxTrail;
  }

  private findBloomTarget(position: Vec2): Entity | undefined {
    this.diagnostics.queryCounts.bloomSearches += 1;
    let best: Entity | undefined;
    let bestScore = -Infinity;
    this.forEachNearbyBucket(this.entityBuckets, position, 340, ENTITY_BUCKET_SIZE, ENTITY_BUCKET_COLS, ENTITY_BUCKET_ROWS, (candidate) => {
      if (!ROOTED_BLOOM_TYPES.includes(candidate.type)) return;
      const offset = this.delta(position, candidate.position);
      const dist = Math.hypot(offset.x, offset.y);
      if (dist > 340) return;
      const sample = this.sampleField(candidate.position.x, candidate.position.y);
      const score = (1 - dist / 340) * 0.54 + candidate.pollination * -0.24 + candidate.energy * 0.16 + candidate.growth * 0.2 + habitatMatch(sample, 'basin') * 0.16 + habitatMatch(sample, 'wetland') * 0.06 - habitatPenalty(sample, 'highland') * 0.14 + (candidate.stage === 'mature' ? 0.14 : 0) + (candidate.type === 'ephemeral' ? 0.08 : candidate.type === 'canopy' ? 0.12 : 0);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    });
    return best;
  }

  private findResidueTarget(position: Vec2, radius = 260): Residue | undefined {
    this.diagnostics.queryCounts.residueSearches += 1;
    let best: Residue | undefined;
    let bestScore = -Infinity;
    this.forEachNearbyBucket(this.residueBuckets, position, radius, RESIDUE_BUCKET_SIZE, RESIDUE_BUCKET_COLS, RESIDUE_BUCKET_ROWS, (residue) => {
      const offset = this.delta(position, residue.position);
      const dist = Math.hypot(offset.x, offset.y);
      if (dist > radius) return;
      const sample = this.sampleField(residue.position.x, residue.position.y);
      const score = (1 - dist / radius) * 0.52 + residue.richness * 0.42 + residue.nutrient * 0.24 + habitatMatch(sample, 'wetland') * 0.18 + habitatMatch(sample, 'basin') * 0.12 - habitatPenalty(sample, 'highland') * 0.18;
      if (score > bestScore) {
        best = residue;
        bestScore = score;
      }
    });
    return best;
  }

  private findFoodTarget(position: Vec2, radius: number, predicate: (particle: FeedParticle) => boolean): FeedParticle | undefined {
    this.diagnostics.queryCounts.foodSearches += 1;
    let best: FeedParticle | undefined;
    let bestScore = -Infinity;
    this.forEachNearbyBucket(this.particleBuckets, position, radius, PARTICLE_BUCKET_SIZE, PARTICLE_BUCKET_COLS, PARTICLE_BUCKET_ROWS, (particle) => {
      if (!predicate(particle)) return;
      const offset = this.delta(position, particle.position);
      const dist = Math.hypot(offset.x, offset.y);
      if (dist > radius) return;
      const freshness = 1 - particle.age / particle.duration;
      const score = (1 - dist / radius) * 0.66 + particle.energy * 0.26 + freshness * 0.18;
      if (score > bestScore) {
        bestScore = score;
        best = particle;
      }
    });
    return best;
  }

  private findGrazerBloomTarget(position: Vec2): Entity | undefined {
    this.diagnostics.queryCounts.grazerBloomSearches += 1;
    let best: Entity | undefined;
    let bestScore = -Infinity;
    this.forEachNearbyBucket(this.entityBuckets, position, 260, ENTITY_BUCKET_SIZE, ENTITY_BUCKET_COLS, ENTITY_BUCKET_ROWS, (candidate) => {
      if (!ROOTED_BLOOM_TYPES.includes(candidate.type)) return;
      const offset = this.delta(position, candidate.position);
      const dist = Math.hypot(offset.x, offset.y);
      if (dist > 260) return;
      const edible = candidate.stage === 'mature' ? 0.18 : 0;
      const sample = this.sampleField(candidate.position.x, candidate.position.y);
      const score = (1 - dist / 260) * 0.44 + candidate.pollination * 0.22 + candidate.energy * 0.14 + candidate.growth * 0.1 + habitatMatch(sample, 'basin') * 0.18 - habitatPenalty(sample, 'wetland') * 0.12 - habitatPenalty(sample, 'highland') * 0.14 + edible + (candidate.type === 'canopy' ? 0.08 : candidate.type === 'ephemeral' ? 0.02 : 0);
      if (score > bestScore && score > 0.34) {
        bestScore = score;
        best = candidate;
      }
    });
    return best;
  }

  private consumeParticle(
    entity: Entity,
    particle: FeedParticle,
    dt: number,
    seekRadius: number,
    pullRadius: number,
    fruitPull: number,
    feedPull: number,
    gain: number,
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number; temperature: number },
  ): void {
    const offset = this.delta(entity.position, particle.position);
    const dist = Math.hypot(offset.x, offset.y) || 1;
    const pull = smoothstep(pullRadius, 0, dist) * (particle.kind === 'fruit' ? fruitPull : feedPull);
    entity.velocity.x += (offset.x / dist) * pull * dt * (0.5 + entity.activity);
    entity.velocity.y += (offset.y / dist) * pull * dt * (0.5 + entity.activity);
    entity.targetId = particle.id;
    entity.targetKind = particle.kind;

    if (dist < entity.size + particle.radius + (entity.type === 'grazer' ? 8 : 6)) {
      entity.energy = clamp(entity.energy + particle.energy * gain, 0, 1.55);
      entity.growth = clamp(entity.growth + particle.energy * (gain * 0.54), 0, 1.8);
      entity.food = clamp(entity.food + particle.energy * (entity.type === 'grazer' ? 0.96 : 0.72), 0, 1.6);
      entity.memory = clamp(entity.memory + dt * 0.12, 0, 1.2);
      entity.visualState = 'feeding';
      entity.visualPulse = entity.type === 'grazer' ? 0.5 : 0.62;
      entity.pulse = 0.24;
      entity.acousticPressure = clamp(entity.acousticPressure + particle.energy * 0.9, 0, 1.4);
      if (this.shouldEmitSound(entity, dt, 2.2, gain * 2.4 + 0.6)) {
        this.emitBurst('feed', entity.position, (entity.type === 'grazer' ? 12 : 10) + entity.size, 0.18 + entity.hueShift * 0.03);
        this.emitWorldEvent({ type: 'entityFed', time: this.time, position: { ...entity.position }, entityType: entity.type, entityId: entity.id, foodKind: particle.kind });
      }
      particle.age = particle.duration;
      entity.targetId = undefined;
      entity.targetKind = undefined;
      localStats.fruit += particle.kind === 'fruit' ? 1.2 : 0.6;
    } else if (dist > seekRadius) {
      entity.targetId = undefined;
      entity.targetKind = undefined;
    }
  }

  private emitWorldEvent(event: WorldEventInput): void {
    this.eventQueue.create(event);
  }

  private emitToolFeedback(tool: ToolType, position: Vec2, intensity: number): void {
    this.tool.feedback = {
      id: this.nextFeedbackId++,
      tool,
      position: { ...position },
      intensity,
    } satisfies ToolFeedback;
  }

  private emitBurst(type: EventBurst['type'], position: Vec2, radius: number, hue: number): void {
    this.bursts.push({
      id: this.nextBurstId++,
      type,
      position: { ...position },
      radius,
      age: 0,
      duration: type === 'death' ? 1.9 : type === 'disrupt' ? 2.2 : 1.4,
      hue,
    });
  }

  private spawnParticle(origin: Vec2, spread: number, kind: FeedParticle['kind'], initial: boolean, sourceEntityId?: number): void {
    const angle = this.rng.range(0, TWO_PI);
    const distance = this.rng.range(spread * 0.15, spread);
    const speed = kind === 'feed' ? this.rng.range(initial ? 18 : 6, initial ? 34 : 16) : this.rng.range(4, 16);
    this.particles.push({
      id: this.nextParticleId++,
      kind,
      position: {
        x: wrap(origin.x + Math.cos(angle) * distance, WORLD_WIDTH),
        y: wrap(origin.y + Math.sin(angle) * distance, WORLD_HEIGHT),
      },
      velocity: {
        x: Math.cos(angle) * speed + this.rng.range(-3, 3),
        y: Math.sin(angle) * speed + this.rng.range(-3, 3),
      },
      energy: this.rng.range(kind === 'feed' ? 0.3 : 0.18, kind === 'feed' ? 0.46 : 0.3),
      age: 0,
      duration: this.rng.range(kind === 'feed' ? 3.4 : 11, kind === 'feed' ? 5.6 : 16),
      radius: kind === 'feed' ? this.rng.range(2.4, 4.2) : this.rng.range(3.2, 5.2),
      sourceEntityId,
    });
  }

  private spawnResidue(position: Vec2, nutrient: number, sourceType?: EntityType): void {
    this.residues.push({
      id: this.nextResidueId++,
      position: { ...position },
      nutrient,
      age: 0,
      duration: this.rng.range(30, 46),
      radius: this.rng.range(88, 132),
      sourceType,
      richness: nutrient,
    });
    this.emitWorldEvent({ type: 'residueCreated', time: this.time, position: { ...position }, nutrient });
  }

  private seedTerrain(position: Vec2, radius: number, fertility: number, moisture: number, solidity: number, duration: number): void {
    const nearby = this.getNearbyTerrainModifiers(position, Math.max(radius, 120));
    const mergeTarget = nearby.find((modifier) => {
      const offset = this.delta(position, modifier.position);
      return Math.hypot(offset.x, offset.y) <= Math.max(radius, modifier.radius) * 0.45;
    });

    if (mergeTarget) {
      mergeTarget.position = this.wrapPosition({
        x: mergeTarget.position.x + this.delta(mergeTarget.position, position).x * 0.18,
        y: mergeTarget.position.y + this.delta(mergeTarget.position, position).y * 0.18,
      });
      mergeTarget.radius = clamp(Math.max(mergeTarget.radius, radius), 24, 260);
      mergeTarget.fertility = clamp(mergeTarget.fertility + fertility * 0.6, -0.4, 0.4);
      mergeTarget.moisture = clamp(mergeTarget.moisture + moisture * 0.6, -0.4, 0.4);
      mergeTarget.solidity = clamp(mergeTarget.solidity + solidity * 0.6, -0.4, 0.4);
      mergeTarget.duration = Math.max(mergeTarget.duration, duration);
      mergeTarget.age = Math.min(mergeTarget.age, mergeTarget.duration * 0.35);
      return;
    }

    const modifier = {
      id: this.nextModifierId++,
      position: { ...position },
      radius,
      fertility,
      moisture,
      solidity,
      age: 0,
      duration,
    };
    this.terrainModifiers.push(modifier);
    this.insertTerrainModifierBucket(modifier);
  }

  private triggerDisrupt(field: ToolField): void {
    this.emitBurst('disrupt', field.position, field.radius * 0.7, 0.72);
    this.seedTerrain(field.position, field.radius * 1.05, -0.1, 0.06, 0.08, 16);

    const survivors: Entity[] = [];
    for (const entity of this.entities) {
      const offset = this.delta(field.position, entity.position);
      const dist = Math.hypot(offset.x, offset.y) || 1;
      if (dist > field.radius * 0.9) {
        survivors.push(entity);
        continue;
      }
      const falloff = smoothstep(field.radius * 0.9, 0, dist);
      entity.velocity.x += (offset.x / dist) * 48 * falloff;
      entity.velocity.y += (offset.y / dist) * 48 * falloff;
      entity.stability = clamp(entity.stability - 0.18 * falloff, 0, 1.2);
      entity.visualPulse = 0.9;
      entity.visualState = 'dying';
      if (falloff > 0.74 && this.rng.next() < 0.16 && !ROOTED_BLOOM_TYPES.includes(entity.type)) {
        handleDeathTransition(entity, this.createLifecycleRuntimeContext());
        continue;
      }
      survivors.push(entity);
    }
    this.entities = survivors;
  }

  private countNearbyFood(position: Vec2, radius: number): number {
    this.diagnostics.queryCounts.foodSearches += 1;
    let total = 0;
    this.forEachNearbyBucket(this.particleBuckets, position, radius, PARTICLE_BUCKET_SIZE, PARTICLE_BUCKET_COLS, PARTICLE_BUCKET_ROWS, (particle) => {
      const offset = this.delta(position, particle.position);
      const dx = offset.x;
      const dy = offset.y;
      if (dx * dx + dy * dy <= radius * radius) total += particle.kind === 'feed' ? 1.4 : 1;
    });
    return clamp(total / 6, 0, 1);
  }

  private getNeighbors(index: number, radius: number): Entity[] {
    this.diagnostics.queryCounts.neighbors += 1;
    const neighbors: Entity[] = [];
    const entity = this.entities[index] as Entity;
    const radiusSq = radius * radius;
    this.forEachNearbyBucket(this.entityBuckets, entity.position, radius, ENTITY_BUCKET_SIZE, ENTITY_BUCKET_COLS, ENTITY_BUCKET_ROWS, (other) => {
      if (other.id === entity.id) return;
      const offset = this.delta(entity.position, other.position);
      const dx = offset.x;
      const dy = offset.y;
      if (dx * dx + dy * dy <= radiusSq) neighbors.push(other);
    });
    return neighbors;
  }

  private getNeighborsByEntity(entity: Entity, radius: number): Entity[] {
    this.diagnostics.queryCounts.neighbors += 1;
    const neighbors: Entity[] = [];
    const radiusSq = radius * radius;
    this.forEachNearbyBucket(this.entityBuckets, entity.position, radius, ENTITY_BUCKET_SIZE, ENTITY_BUCKET_COLS, ENTITY_BUCKET_ROWS, (other) => {
      if (other.id === entity.id) return;
      const offset = this.delta(entity.position, other.position);
      if (offset.x ** 2 + offset.y ** 2 <= radiusSq) neighbors.push(other);
    });
    return neighbors;
  }

  private countEntities(): Record<EntityType, number> {
    return this.entities.reduce(
      (acc, entity) => {
        acc[entity.type] += 1;
        return acc;
      },
      { flocker: 0, cluster: 0, plant: 0, ephemeral: 0, canopy: 0, grazer: 0, parasite: 0, predator: 0 } as Record<EntityType, number>,
    );
  }

  private getHabitatSuitability(sample: FieldSample, preferred: HabitatType): number {
    const primaryMatch = habitatMatch(sample, preferred);
    const dominantMatch = sample.habitat === preferred ? 0.16 : 0;
    const mixedness = 1 - maxHabitatWeight(sample);
    return clamp(primaryMatch * 0.78 + dominantMatch + mixedness * 0.06, 0, 1);
  }

  private getEntitySpawnSuitability(type: EntityType, sample: FieldSample): number {
    if (type === 'plant') {
      return clamp(sample.fertility * 0.34 + sample.nutrient * 0.2 + this.getHabitatSuitability(sample, 'basin') * 0.34 + sample.moisture * 0.08 - habitatPenalty(sample, 'highland') * 0.26, 0, 1);
    }
    if (type === 'ephemeral') {
      return clamp(sample.fertility * 0.22 + sample.nutrient * 0.26 + sample.temperature * 0.24 + this.getHabitatSuitability(sample, 'wetland') * 0.14 + this.getHabitatSuitability(sample, 'basin') * 0.18 - habitatPenalty(sample, 'highland') * 0.18, 0, 1);
    }
    if (type === 'canopy') {
      return clamp(sample.fertility * 0.24 + sample.nutrient * 0.28 + (1 - Math.abs(sample.temperature - 0.42)) * 0.18 + this.getHabitatSuitability(sample, 'basin') * 0.22 - habitatPenalty(sample, 'highland') * 0.14, 0, 1);
    }
    if (type === 'flocker') {
      return clamp(sample.resonance * 0.16 + sample.moisture * 0.18 + this.getHabitatSuitability(sample, 'wetland') * 0.22 + this.getHabitatSuitability(sample, 'basin') * 0.14 + sample.traversability * 0.18 - habitatPenalty(sample, 'highland') * 0.08, 0, 1);
    }
    if (type === 'cluster') {
      return clamp(sample.nutrient * 0.3 + sample.moisture * 0.14 + this.getHabitatSuitability(sample, 'wetland') * 0.24 + this.getHabitatSuitability(sample, 'basin') * 0.18 - habitatPenalty(sample, 'highland') * 0.18, 0, 1);
    }
    if (type === 'grazer') {
      return clamp(sample.fertility * 0.22 + sample.traversability * 0.18 + this.getHabitatSuitability(sample, 'basin') * 0.28 - habitatPenalty(sample, 'wetland') * 0.16 - habitatPenalty(sample, 'highland') * 0.18, 0, 1);
    }
    if (type === 'parasite') {
      return clamp(sample.fertility * 0.16 + sample.nutrient * 0.18 + sample.temperature * 0.22 + (sample.terrain === 'dense' ? 0.14 : 0) + this.getHabitatSuitability(sample, 'basin') * 0.12 - habitatPenalty(sample, 'highland') * 0.18, 0, 1);
    }
    return clamp(sample.moisture * 0.28 + sample.traversability * 0.16 + this.getHabitatSuitability(sample, 'wetland') * 0.22 + sample.elevation * 0.1, 0, 1);
  }

  private randomSpawnPointForEntity(type: EntityType): Vec2 {
    let bestPoint = this.randomPoint();
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 52; attempt += 1) {
      const point = this.randomPoint();
      const score = this.getEntitySpawnSuitability(type, this.sampleField(point.x, point.y));
      if (score > bestScore) {
        bestScore = score;
        bestPoint = point;
      }
      if (score > 0.84) return point;
    }
    return bestPoint;
  }

  private randomTerrainPoint(preferred: TerrainType): Vec2 {
    let bestPoint = this.randomPoint();
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 48; attempt += 1) {
      const point = this.randomPoint();
      const score = this.getSpawnSuitability(preferred, this.sampleField(point.x, point.y));
      if (score > bestScore) {
        bestScore = score;
        bestPoint = point;
      }
      if (score > 0.82) return point;
    }
    return bestPoint;
  }

  private getSpawnSuitability(preferred: TerrainType, sample: FieldSample): number {
    if (preferred === 'water') return clamp(sample.moisture * 0.42 + this.getHabitatSuitability(sample, 'wetland') * 0.4 + (1 - sample.elevation) * 0.12 + (1 - sample.slope) * 0.06, 0, 1);
    if (preferred === 'dense') return clamp(sample.density * 0.34 + habitatPenalty(sample, 'highland') * 0.2 + this.getHabitatSuitability(sample, 'wetland') * 0.16 + (1 - sample.traversability) * 0.18, 0, 1);
    if (preferred === 'solid') return clamp(sample.elevation * 0.38 + sample.slope * 0.18 + this.getHabitatSuitability(sample, 'highland') * 0.36 + (1 - sample.traversability) * 0.08, 0, 1);
    return clamp(sample.fertility * 0.34 + sample.nutrient * 0.22 + this.getHabitatSuitability(sample, 'basin') * 0.28 + sample.moisture * 0.08 + (1 - sample.slope) * 0.08, 0, 1);
  }

  private randomPoint(): Vec2 {
    return { x: this.rng.range(0, WORLD_WIDTH), y: this.rng.range(0, WORLD_HEIGHT) };
  }

  private randomVelocity(scale: number): Vec2 {
    const angle = this.rng.range(0, TWO_PI);
    return { x: Math.cos(angle) * this.rng.range(scale * 0.3, scale), y: Math.sin(angle) * this.rng.range(scale * 0.3, scale) };
  }

  private scatterAround(center: Vec2, radius: number): Vec2 {
    const angle = this.rng.range(0, TWO_PI);
    const distance = this.rng.range(radius * 0.2, radius);
    return {
      x: wrap(center.x + Math.cos(angle) * distance, WORLD_WIDTH),
      y: wrap(center.y + Math.sin(angle) * distance, WORLD_HEIGHT),
    };
  }

  private spawnPropagule(position: Vec2, kind: Propagule['kind'], species: EntityType, sourceEntityId?: number, nutrient = 0.36): void {
    if (this.propagules.length >= MAX_PROPAGULES) return;
    const angle = this.rng.range(0, TWO_PI);
    const speed = kind === 'spore' ? this.rng.range(2, 10) : this.rng.range(0, 3.4);
    const propagule: Propagule = {
      id: this.nextPropaguleId++,
      kind,
      species,
      position: { ...position },
      velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      age: 0,
      dormancy: this.rng.range(kind === 'seed' ? 8 : 4, kind === 'seed' ? 22 : 12),
      viability: this.rng.range(0.42, 0.86),
      nutrient,
      sourceEntityId,
    };
    this.propagules.push(propagule);
    this.propagulesById.set(propagule.id, propagule);
  }

  private getNeighborsAtPosition(position: Vec2, radius: number): Entity[] {
    this.diagnostics.queryCounts.neighbors += 1;
    const neighbors: Entity[] = [];
    const radiusSq = radius * radius;
    this.forEachNearbyBucket(this.entityBuckets, position, radius, ENTITY_BUCKET_SIZE, ENTITY_BUCKET_COLS, ENTITY_BUCKET_ROWS, (other) => {
      const offset = this.delta(position, other.position);
      if (offset.x * offset.x + offset.y * offset.y <= radiusSq) neighbors.push(other);
    });
    return neighbors;
  }

  private findNearbySpawnPoint(center: Vec2, radius: number, predicate: (sample: FieldSample) => boolean): Vec2 {
    let fallback = this.scatterAround(center, radius);
    let fallbackScore = -Infinity;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const point = this.scatterAround(center, radius);
      const sample = this.sampleField(point.x, point.y);
      const score = sample.fertility + sample.moisture + sample.traversability + (1 - sample.slope);
      if (score > fallbackScore) {
        fallback = point;
        fallbackScore = score;
      }
      if (predicate(sample)) return point;
    }
    return fallback;
  }

  private sampleNoise(x: number, y: number, seed: number): number {
    return clamp(
      0.5
        + Math.sin(x * 1.1 + seed * 4.2) * 0.21
        + Math.cos(y * 1.07 - seed * 2.1) * 0.17
        + Math.sin((x + y) * 0.62 + seed * 1.6) * 0.12
        + fract(Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453) * 0.1,
      0,
      1,
    );
  }
}
