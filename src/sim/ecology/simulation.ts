import {
  ATTRACTOR_COUNT,
  CAMERA_MAX_ZOOM,
  CAMERA_MIN_ZOOM,
  ENERGY_MAX,
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
  type LifecycleStage,
  type TerrainType,
  type ToolType,
} from '../../config';
import { Rng } from '../random';
import { WorldEventQueue, buildNotifications, type WorldEventInput } from '../events';
import { createDefaultAttentionState, createDefaultCamera, createDefaultDiagnostics, createDefaultStats, createDefaultToolState, createWorldState } from '../world';
import type { FieldSample, TerrainModifier } from '../fields/types';
import { WorldFieldModel } from '../fields/worldField';
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
const MAX_PROPAGULES = 320;
const ROOTED_BLOOM_TYPES: EntityType[] = ['plant', 'ephemeral', 'canopy'];
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
    const localStats = { harmony: 0, activity: 0, threat: 0, stability: 0, interactions: 0, focus: 0, nutrients: 0, fruit: 0, temperature: 0 };

    for (let i = 0; i < this.entities.length; i += 1) {
      const entity = this.entities[i] as Entity;
      entity.age += dt;
      entity.pulse = Math.max(0, entity.pulse - dt * 0.28);
      entity.visualPulse = Math.max(0, entity.visualPulse - dt * 0.44);
      entity.reproductionCooldown = Math.max(0, entity.reproductionCooldown - dt);
      entity.fruitCooldown = Math.max(0, entity.fruitCooldown - dt);
      entity.soundCooldown = Math.max(0, entity.soundCooldown - dt);
      entity.stageProgress = this.getLifecycleProgress(entity);
      entity.stage = this.getStage(entity.stageProgress);
      if (entity.visualPulse <= 0.03 && entity.visualState !== 'dying') entity.visualState = 'idle';

      const sample = this.sampleField(entity.position.x, entity.position.y);
      const neighbors = this.getNeighbors(i, NEIGHBOR_RADIUS);
      const entityUpdateStart = performance.now();
      this.applyEntityBehavior(entity, sample, neighbors, dt, 0, localStats);
      this.diagnostics.speciesUpdateTimeMs[entity.type] += performance.now() - entityUpdateStart;

      const persists = this.shouldPersist(entity);
      if (persists) survivors.push(entity);
      else this.handleDeath(entity);
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

  private fieldIndex(col: number, row: number): number {
    const wrappedCol = (col + FIELD_GRID_COLS) % FIELD_GRID_COLS;
    const wrappedRow = (row + FIELD_GRID_ROWS) % FIELD_GRID_ROWS;
    return wrappedRow * FIELD_GRID_COLS + wrappedCol;
  }

  private initializeEnvironmentalFields(): void {
    for (let row = 0; row < FIELD_GRID_ROWS; row += 1) {
      for (let col = 0; col < FIELD_GRID_COLS; col += 1) {
        const x = (col + 0.5) * FIELD_CELL_WIDTH;
        const y = (row + 0.5) * FIELD_CELL_HEIGHT;
        const base = this.worldField.sample(x, y, this.time, {
          residueInfluence: 0,
          modifiers: [],
          delta: (a, b) => this.delta(a, b),
        });
        const index = this.fieldIndex(col, row);
        const nutrient = clamp(base.fertility * 0.52 + base.moisture * 0.18 + base.nutrient * 0.2, 0.08, 0.92);
        const temperature = clamp(base.temperature * 0.7 + base.elevation * 0.14 + (1 - base.moisture) * 0.08, 0.08, 0.92);
        this.nutrientBaseline[index] = nutrient;
        this.nutrientField[index] = nutrient;
        this.temperatureBaseline[index] = temperature;
        this.temperatureField[index] = temperature;
      }
    }
  }

  private sampleEnvironmentalFields(x: number, y: number): { nutrient: number; temperature: number } {
    const gx = wrap(x, WORLD_WIDTH) / FIELD_CELL_WIDTH;
    const gy = wrap(y, WORLD_HEIGHT) / FIELD_CELL_HEIGHT;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const ty = gy - y0;
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const n00 = this.nutrientField[this.fieldIndex(x0, y0)];
    const n10 = this.nutrientField[this.fieldIndex(x1, y0)];
    const n01 = this.nutrientField[this.fieldIndex(x0, y1)];
    const n11 = this.nutrientField[this.fieldIndex(x1, y1)];
    const t00 = this.temperatureField[this.fieldIndex(x0, y0)];
    const t10 = this.temperatureField[this.fieldIndex(x1, y0)];
    const t01 = this.temperatureField[this.fieldIndex(x0, y1)];
    const t11 = this.temperatureField[this.fieldIndex(x1, y1)];
    return {
      nutrient: lerp(lerp(n00, n10, tx), lerp(n01, n11, tx), ty),
      temperature: lerp(lerp(t00, t10, tx), lerp(t01, t11, tx), ty),
    };
  }

  private affectEnvironment(position: Vec2, radius: number, nutrientDelta: number, temperatureDelta: number): void {
    const minCol = Math.floor((wrap(position.x - radius, WORLD_WIDTH)) / FIELD_CELL_WIDTH) - 1;
    const maxCol = Math.floor((wrap(position.x + radius, WORLD_WIDTH)) / FIELD_CELL_WIDTH) + 1;
    const minRow = Math.floor((wrap(position.y - radius, WORLD_HEIGHT)) / FIELD_CELL_HEIGHT) - 1;
    const maxRow = Math.floor((wrap(position.y + radius, WORLD_HEIGHT)) / FIELD_CELL_HEIGHT) + 1;
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const center = {
          x: ((col + FIELD_GRID_COLS) % FIELD_GRID_COLS + 0.5) * FIELD_CELL_WIDTH,
          y: ((row + FIELD_GRID_ROWS) % FIELD_GRID_ROWS + 0.5) * FIELD_CELL_HEIGHT,
        };
        const offset = this.delta(position, center);
        const dist = Math.hypot(offset.x, offset.y);
        if (dist > radius) continue;
        const falloff = smoothstep(radius, 0, dist);
        const index = this.fieldIndex(col, row);
        this.nutrientField[index] = clamp(this.nutrientField[index] + nutrientDelta * falloff, 0, 1);
        this.temperatureField[index] = clamp(this.temperatureField[index] + temperatureDelta * falloff, 0, 1);
      }
    }
  }

  private updateEnvironmentalFields(dt: number): void {
    const nextNutrient = new Float32Array(FIELD_GRID_SIZE);
    const nextTemperature = new Float32Array(FIELD_GRID_SIZE);
    for (let row = 0; row < FIELD_GRID_ROWS; row += 1) {
      for (let col = 0; col < FIELD_GRID_COLS; col += 1) {
        const index = this.fieldIndex(col, row);
        const left = this.fieldIndex(col - 1, row);
        const right = this.fieldIndex(col + 1, row);
        const up = this.fieldIndex(col, row - 1);
        const down = this.fieldIndex(col, row + 1);
        const nutrientAverage = (this.nutrientField[left] + this.nutrientField[right] + this.nutrientField[up] + this.nutrientField[down]) * 0.25;
        const temperatureAverage = (this.temperatureField[left] + this.temperatureField[right] + this.temperatureField[up] + this.temperatureField[down]) * 0.25;
        nextNutrient[index] = clamp(this.nutrientField[index] + (nutrientAverage - this.nutrientField[index]) * dt * 0.32 + (this.nutrientBaseline[index] - this.nutrientField[index]) * dt * 0.06, 0, 1);
        nextTemperature[index] = clamp(this.temperatureField[index] + (temperatureAverage - this.temperatureField[index]) * dt * 0.18 + (this.temperatureBaseline[index] - this.temperatureField[index]) * dt * 0.04, 0, 1);
      }
    }
    this.nutrientField = nextNutrient;
    this.temperatureField = nextTemperature;
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
    const next: Propagule[] = [];
    for (const propagule of this.propagules) {
      propagule.age += dt;
      const flow = this.sampleField(propagule.position.x, propagule.position.y).flow;
      if (propagule.kind === 'spore') {
        propagule.velocity.x = lerp(propagule.velocity.x, flow.x * 0.14, dt * 0.6);
        propagule.velocity.y = lerp(propagule.velocity.y, flow.y * 0.14, dt * 0.6);
      } else {
        propagule.velocity.x *= Math.pow(0.92, dt * 60);
        propagule.velocity.y *= Math.pow(0.92, dt * 60);
      }
      propagule.position = this.wrapPosition({
        x: propagule.position.x + propagule.velocity.x * dt,
        y: propagule.position.y + propagule.velocity.y * dt,
      });

      const sample = this.sampleField(propagule.position.x, propagule.position.y);
      const ready = propagule.age >= propagule.dormancy;
      const withinCap = (() => {
        const counts = this.countEntities();
        if (propagule.species === 'plant') return counts.plant < MAX_PLANTS;
        if (propagule.species === 'ephemeral') return counts.ephemeral < MAX_EPHEMERALS;
        if (propagule.species === 'canopy') return counts.canopy < MAX_CANOPIES;
        if (propagule.species === 'cluster') return counts.cluster < MAX_CLUSTERS;
        if (propagule.species === 'parasite') return counts.parasite < MAX_PARASITES;
        return true
      })();
      const density = this.getNeighborsAtPosition(propagule.position, propagule.species === 'canopy' ? 120 : 84).filter((candidate) => candidate.type === propagule.species).length;
      const suitability = this.getEntitySpawnSuitability(propagule.species, sample)
        + sample.nutrient * 0.28
        + (propagule.species === 'ephemeral' ? sample.temperature * 0.22 : propagule.species === 'canopy' ? (1 - Math.abs(sample.temperature - 0.42)) * 0.16 : 0);
      const germinationRate = dt * clamp(0.01 + suitability * 0.035 - density * 0.008 + propagule.viability * 0.02, 0.002, 0.08);
      if (ready && withinCap && this.rng.next() < germinationRate) {
        const entity = this.createEntity(propagule.species, propagule.position);
        entity.age = propagule.kind === 'seed' ? this.rng.range(0, entity.lifeSpan * 0.06) : 0;
        entity.energy = clamp(entity.energy + propagule.nutrient * 0.28, 0, 1.3);
        this.entities.push(entity);
        this.propagulesById.delete(propagule.id);
        this.diagnostics.lifecycleTransitions.germinations += 1;
        this.emitWorldEvent({ type: 'entityBorn', time: this.time, position: { ...entity.position }, entityType: entity.type, entityId: entity.id });
        continue;
      }
      if (propagule.age < propagule.dormancy + 90 && propagule.viability > 0.04) {
        propagule.viability = clamp(propagule.viability - dt * 0.0012 + sample.nutrient * dt * 0.0006, 0, 1);
        next.push(propagule);
      } else {
        this.affectEnvironment(propagule.position, 24, propagule.nutrient * 0.08, -0.002);
        this.propagulesById.delete(propagule.id);
      }
    }
    this.propagules = next;
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
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number; temperature: number },
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
    entity.stageProgress = this.getLifecycleProgress(entity);
    entity.stage = this.getStage(entity.stageProgress);
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

  private updatePlant(
    entity: Entity,
    sample: FieldSample,
    dt: number,
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number; temperature: number },
  ): void {
    const anchor = entity.anchor ?? entity.position;
    const anchorDelta = this.delta(entity.position, anchor);
    entity.velocity.x = lerp(entity.velocity.x, -anchorDelta.x * (entity.type === 'canopy' ? 0.028 : 0.02) + sample.flow.x * 0.012 + sample.moistureGradient.x * (entity.type === 'ephemeral' ? 3.2 : 2.8) - sample.gradient.x * (entity.type === 'canopy' ? 2 : 2.4), dt * (entity.type === 'canopy' ? 0.35 : 0.5));
    entity.velocity.y = lerp(entity.velocity.y, -anchorDelta.y * (entity.type === 'canopy' ? 0.028 : 0.02) + sample.flow.y * 0.012 + sample.moistureGradient.y * (entity.type === 'ephemeral' ? 3.2 : 2.8) - sample.gradient.y * (entity.type === 'canopy' ? 2 : 2.4), dt * (entity.type === 'canopy' ? 0.35 : 0.5));
    entity.position = this.wrapPosition({
      x: entity.position.x + entity.velocity.x * dt,
      y: entity.position.y + entity.velocity.y * dt,
    });

    const basinBoost = habitatMatch(sample, 'basin');
    const wetBoost = habitatMatch(sample, 'wetland');
    const ridgeStress = habitatPenalty(sample, 'highland');
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

    this.affectEnvironment(entity.position, 40 + entity.size * 2.6, -nutrientDemand * dt * (0.7 + entity.growth * 0.4), entity.type === 'ephemeral' ? 0.01 * dt : entity.type === 'canopy' ? -0.005 * dt : 0.002 * dt);

    entity.growth = clamp(entity.growth + dt * (fertilityScore * (entity.type === 'ephemeral' ? 0.07 : entity.type === 'canopy' ? 0.038 : 0.05) - stress), 0, 1.8);
    entity.energy = clamp(entity.energy + dt * (fertilityScore * (entity.type === 'canopy' ? 0.068 : 0.08) - stress * 1.22), 0, 1.4);
    entity.food = clamp(entity.food + dt * (sample.nutrient * (entity.type === 'ephemeral' ? 0.08 : entity.type === 'canopy' ? 0.075 : 0.065) + sample.fertility * 0.04 - stress * 0.82), 0, 1.5);
    entity.harmony = clamp(lerp(entity.harmony, 0.34 + sample.resonance * 0.32 + sample.moisture * 0.08 + entity.pollination * 0.12 + temperatureComfort * 0.08, dt * 0.08), 0, 1.2);

    if (fertilityScore > 0.6 && entity.stage !== 'birth') {
      this.seedTerrain(entity.position, 48 + entity.size * (entity.type === 'canopy' ? 3.2 : 2.4), 0.008 * dt, entity.type === 'ephemeral' ? 0.005 * dt : 0.003 * dt, -0.001 * dt, entity.type === 'canopy' ? 3.6 : 2.6);
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
        this.spawnParticle(entity.position, entity.size * (entity.type === 'canopy' ? 3.2 : 2.6), 'fruit', false, entity.id);
        localStats.fruit += 1;
      }
      entity.fruitCooldown = this.rng.range(entity.type === 'ephemeral' ? 7 : entity.type === 'canopy' ? 18 : 12, entity.type === 'ephemeral' ? 12 : entity.type === 'canopy' ? 28 : 20);
      entity.energy *= entity.type === 'ephemeral' ? 0.84 : 0.9;
      entity.food *= entity.type === 'ephemeral' ? 0.86 : 0.92;
      entity.visualState = 'reproducing';
      entity.visualPulse = 0.42;
      this.diagnostics.lifecycleTransitions.fruitingBursts += 1;
      this.emitBurst('birth', entity.position, 8 + entity.size * 0.7, 0.12 + entity.hueShift * 0.04);
      this.emitWorldEvent({ type: 'fruitCreated', time: this.time, position: { ...entity.position }, sourceEntityId: entity.id, count: fruitCount });
    }

    const propaguleChance = entity.type === 'ephemeral' ? 0.24 : entity.type === 'canopy' ? 0.06 : 0.1;
    if (entity.stage !== 'birth' && entity.pollination > 0.4 && entity.energy > 0.56 && this.rng.next() < dt * propaguleChance * clamp(sample.nutrient + temperatureComfort, 0.4, 1.4)) {
      this.spawnPropagule(entity.position, entity.type === 'canopy' ? 'seed' : 'spore', entity.type, entity.id, entity.type === 'canopy' ? 0.56 : 0.38);
      entity.pollination *= entity.type === 'ephemeral' ? 0.88 : 0.92;
    }

    if (entity.stage === 'decay' && (fertilityScore < 0.34 || entity.energy < 0.28 || temperatureComfort < 0.22)) {
      entity.visualState = 'dying';
      entity.visualPulse = Math.max(entity.visualPulse, 0.18);
      entity.energy = clamp(entity.energy - dt * (entity.type === 'ephemeral' ? 0.022 : 0.015), 0, 1.4);
    }
  }

  private updateCreature(
    entity: Entity,
    sample: FieldSample,
    neighbors: Entity[],
    dt: number,
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number; temperature: number },
  ): void {
    if (entity.type === 'cluster') {
      this.updateDecomposer(entity, sample, neighbors, dt, localStats);
      return;
    }
    if (entity.type === 'predator') {
      this.updatePredator(entity, sample, neighbors, dt, localStats);
      return;
    }
    if (entity.type === 'grazer') {
      this.updateGrazer(entity, sample, neighbors, dt, localStats);
      return;
    }
    if (entity.type === 'parasite') {
      this.updateParasite(entity, sample, neighbors, dt, localStats);
      return;
    }

    this.updatePollinator(entity, sample, neighbors, dt, localStats);
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

  private updatePredator(
    entity: Entity,
    sample: FieldSample,
    neighbors: Entity[],
    dt: number,
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number; temperature: number },
  ): void {
    const hunting = entity.energy < 0.42 || entity.food < 0.36;
    entity.predatorState = hunting ? 'hunting' : 'resting';

    let loudestSignal: Entity | undefined;
    let loudestScore = 0;
    for (const other of neighbors) {
      if (other.id === entity.id) continue;
      const offset = this.delta(entity.position, other.position);
      const distance = Math.max(1, Math.hypot(offset.x, offset.y));
      const amplitude = clamp(other.visualPulse * 0.55 + other.activity * 0.32 + other.energy * 0.13, 0, 1.4);
      const repetitiveness = clamp(other.acousticPattern * 0.7 + other.pulse * 0.3, 0, 1.2);
      const score = (amplitude * 0.68 + repetitiveness * 0.52) * clamp(1 - distance / 320, 0, 1);
      if (score > loudestScore) {
        loudestScore = score;
        loudestSignal = other;
      }
    }

    entity.acousticPressure = lerp(entity.acousticPressure, loudestScore, dt * 0.6);
    entity.acousticPattern = lerp(entity.acousticPattern, loudestSignal ? loudestSignal.acousticPattern : 0.2, dt * 0.35);

    const basinBias = habitatMatch(sample, 'basin');
    entity.velocity.x += sample.flow.x * dt * 0.022 + sample.fertilityGradient.x * dt * (1.2 + basinBias * 1.4) - sample.gradient.x * dt * 1.8;
    entity.velocity.y += sample.flow.y * dt * 0.022 + sample.fertilityGradient.y * dt * (1.2 + basinBias * 1.4) - sample.gradient.y * dt * 1.8;

    if (hunting && loudestSignal && loudestScore > 0.24) {
      const offset = this.delta(entity.position, loudestSignal.position);
      const distance = Math.max(1, Math.hypot(offset.x, offset.y));
      const pull = smoothstep(320, 0, distance) * (6 + loudestScore * 8);
      entity.velocity.x += (offset.x / distance) * pull * dt;
      entity.velocity.y += (offset.y / distance) * pull * dt;
      entity.targetId = loudestSignal.id;
      entity.targetKind = 'signal';
      entity.activity = lerp(entity.activity, 0.5 + loudestScore * 0.4, dt * 1.8);
      localStats.threat += dt * (0.05 + loudestScore * 0.22);
    } else {
      entity.targetId = undefined;
      entity.targetKind = undefined;
      const driftTheta = this.time * 0.01 + entity.id * 0.36;
      entity.velocity.x += Math.cos(driftTheta) * dt * 0.34;
      entity.velocity.y += Math.sin(driftTheta * 0.8) * dt * 0.3;
      entity.activity = lerp(entity.activity, hunting ? 0.18 : 0.08, dt * 1.6);
    }

    entity.velocity.x *= Math.pow(0.964, dt * 60);
    entity.velocity.y *= Math.pow(0.964, dt * 60);
    entity.position = this.wrapPosition({
      x: entity.position.x + entity.velocity.x * dt * (0.26 + entity.activity * 0.34),
      y: entity.position.y + entity.velocity.y * dt * (0.26 + entity.activity * 0.34),
    });
    entity.energy = clamp(entity.energy - dt * (hunting ? 0.012 : 0.006), 0, 1.2);
    entity.harmony = clamp(lerp(entity.harmony, 0.14 + sample.resonance * 0.2, dt * 0.04), 0, 1.1);
  }

  private updatePollinator(
    entity: Entity,
    sample: FieldSample,
    neighbors: Entity[],
    dt: number,
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number; temperature: number },
  ): void {
    const nearestFood = this.shouldReuseTarget(entity)
      ? this.getTrackedParticleTarget(entity, 240, (particle) => particle.kind === 'fruit' || particle.kind === 'feed')
      : undefined;
    const bloomTarget = !nearestFood && this.shouldReuseTarget(entity)
      ? this.getTrackedBloomTarget(entity, 340)
      : undefined;
    const activeFood = nearestFood ?? (!bloomTarget
      ? this.findFoodTarget(entity.position, 240, (particle) => particle.kind === 'fruit' || particle.kind === 'feed')
      : undefined);
    const activeBloomTarget = activeFood ? undefined : (bloomTarget ?? this.findBloomTarget(entity.position));
    if (!nearestFood && !bloomTarget) this.diagnostics.queryCounts.targetRetargets += 1;
    const nearestOffset = activeBloomTarget ? this.delta(entity.position, activeBloomTarget.position) : undefined;
    const nearestDistance = activeBloomTarget ? Math.hypot(nearestOffset!.x, nearestOffset!.y) : Infinity;

    let cohesionX = 0;
    let cohesionY = 0;
    let separationX = 0;
    let separationY = 0;
    let neighborCount = 0;

    for (const other of neighbors) {
      if (other.type !== 'flocker') continue;
      const offset = this.delta(entity.position, other.position);
      const dist = Math.hypot(offset.x, offset.y) || 1;
      const proximity = clamp(1 - dist / 150, 0, 1);
      if (proximity <= 0) continue;
      neighborCount += 1;
      cohesionX += offset.x * proximity;
      cohesionY += offset.y * proximity;
      separationX -= (offset.x / dist) * proximity * proximity;
      separationY -= (offset.y / dist) * proximity * proximity;
      const pair = this.computePairResonance(entity, other, proximity);
      entity.harmony = clamp(entity.harmony + (pair.harmony - pair.dissonance * 0.18) * dt * 0.08, 0, 1.2);
      entity.stability = clamp(entity.stability + (pair.harmony - pair.dissonance * 0.12) * dt * 0.04, 0, 1.2);
    }

    const wanderTheta = this.time * (0.03 + entity.activityBias * 0.028) + entity.id * 0.6;
    entity.velocity.x += Math.cos(wanderTheta) * dt * 1.6 * entity.activity;
    entity.velocity.y += Math.sin(wanderTheta * 0.85) * dt * 1.2 * entity.activity;
    const wetPull = habitatMatch(sample, 'wetland');
    const basinPull = habitatMatch(sample, 'basin');
    const ridgePush = habitatPenalty(sample, 'highland');
    entity.velocity.x += sample.flow.x * dt * (0.04 + wetPull * 0.08 + entity.activity * 0.06) + sample.fertilityGradient.x * dt * (5.8 + basinPull * 3.8) - sample.gradient.x * dt * (4.2 + ridgePush * 4.8);
    entity.velocity.y += sample.flow.y * dt * (0.04 + wetPull * 0.08 + entity.activity * 0.06) + sample.fertilityGradient.y * dt * (5.8 + basinPull * 3.8) - sample.gradient.y * dt * (4.2 + ridgePush * 4.8);

    if (activeBloomTarget && nearestOffset && nearestDistance < 320) {
      const dist = nearestDistance || 1;
      const nx = nearestOffset.x / dist;
      const ny = nearestOffset.y / dist;
      const tangentX = -ny;
      const tangentY = nx;
      const curve = 0.55 + Math.sin(this.time * 0.12 + entity.id) * 0.24;
      const pull = smoothstep(320, 0, dist) * 18;
      entity.velocity.x += (nx * pull + tangentX * curve * 8) * dt;
      entity.velocity.y += (ny * pull + tangentY * curve * 8) * dt;
      entity.targetId = activeBloomTarget.id;
      entity.targetKind = 'bloom';
      entity.memory = clamp(entity.memory + dt * 0.08, 0, 1.2);
      this.scheduleRetarget(entity, 1.15);

      if (dist < entity.size + activeBloomTarget.size + 14) {
        activeBloomTarget.pollination = clamp(activeBloomTarget.pollination + dt * 0.48, 0, 1.8);
        activeBloomTarget.energy = clamp(activeBloomTarget.energy + dt * 0.12, 0, 1.5);
        activeBloomTarget.growth = clamp(activeBloomTarget.growth + dt * 0.08, 0, 1.8);
        activeBloomTarget.visualState = 'feeding';
        activeBloomTarget.visualPulse = Math.max(activeBloomTarget.visualPulse, 0.22);
        entity.visualState = 'feeding';
        entity.visualPulse = Math.max(entity.visualPulse, 0.3);
        entity.energy = clamp(entity.energy + dt * 0.06, 0, 1.5);
        entity.food = clamp(entity.food + dt * 0.04, 0, 1.5);
        localStats.fruit += dt * 0.8;
      }
    } else if (activeFood) {
      this.consumeParticle(entity, activeFood, dt, 240, 190, 16, 12, 0.2, localStats);
      this.scheduleRetarget(entity, 1.35);
    } else {
      entity.targetId = undefined;
      entity.targetKind = undefined;
      this.scheduleRetarget(entity, 0.72);
    }

    if (neighborCount > 0) {
      const inv = 1 / neighborCount;
      entity.velocity.x += cohesionX * inv * dt * 0.012;
      entity.velocity.y += cohesionY * inv * dt * 0.012;
      entity.velocity.x += separationX * dt * 7.5;
      entity.velocity.y += separationY * dt * 7.5;
    }

    if (sample.traversability < 0.28 || sample.terrain === 'solid' || ridgePush > 0.72) {
      entity.velocity.x -= sample.gradient.x * dt * (10 + ridgePush * 8) + sample.flow.x * dt * 0.04;
      entity.velocity.y -= sample.gradient.y * dt * (10 + ridgePush * 8) + sample.flow.y * dt * 0.04;
      entity.energy -= dt * (0.016 + ridgePush * 0.018);
      entity.stability = clamp(entity.stability - dt * (0.024 + ridgePush * 0.028), 0, 1.2);
    } else if (sample.terrain === 'dense') {
      entity.velocity.x *= Math.pow(0.93, dt * 60);
      entity.velocity.y *= Math.pow(0.93, dt * 60);
      entity.stability = clamp(entity.stability + dt * 0.008, 0, 1.2);
    } else if (sample.terrain === 'fertile' || basinPull > 0.42) {
      entity.energy = clamp(entity.energy + dt * (0.008 + basinPull * 0.012), 0, 1.5);
    } else if (sample.terrain === 'water' || wetPull > 0.48) {
      entity.velocity.x += sample.moistureGradient.x * dt * (1.8 + wetPull * 1.2);
      entity.velocity.y += sample.moistureGradient.y * dt * (1.8 + wetPull * 1.2);
      entity.stability = clamp(entity.stability + dt * 0.006, 0, 1.2);
    }

    const damping = 0.982 - wetPull * 0.012 - ridgePush * 0.018;
    entity.velocity.x *= Math.pow(damping, dt * 60);
    entity.velocity.y *= Math.pow(damping, dt * 60);
    entity.position = this.wrapPosition({
      x: entity.position.x + entity.velocity.x * dt * (0.46 + entity.activity * 0.72),
      y: entity.position.y + entity.velocity.y * dt * (0.46 + entity.activity * 0.72),
    });
  }

  private updateGrazer(
    entity: Entity,
    sample: FieldSample,
    neighbors: Entity[],
    dt: number,
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number; temperature: number },
  ): void {
    const nearestFruit = this.shouldReuseTarget(entity)
      ? this.getTrackedParticleTarget(entity, 300, (particle) => particle.kind === 'fruit')
      : undefined;
    const bloomTarget = nearestFruit
      ? undefined
      : this.shouldReuseTarget(entity)
        ? this.getTrackedBloomTarget(entity, 260, true)
        : undefined;
    const activeFruit = nearestFruit ?? this.findFoodTarget(entity.position, 300, (particle) => particle.kind === 'fruit');
    const activeBloomTarget = activeFruit ? undefined : (bloomTarget ?? this.findGrazerBloomTarget(entity.position));
    if (!nearestFruit && !bloomTarget) this.diagnostics.queryCounts.targetRetargets += 1;

    const basinPull = habitatMatch(sample, 'basin');
    const wetPenalty = habitatPenalty(sample, 'wetland');
    const ridgePenalty = habitatPenalty(sample, 'highland');
    entity.velocity.x += sample.flow.x * dt * 0.024 + sample.fertilityGradient.x * dt * (3.6 + basinPull * 4.2) - sample.gradient.x * dt * (2.6 + ridgePenalty * 3.8);
    entity.velocity.y += sample.flow.y * dt * 0.024 + sample.fertilityGradient.y * dt * (3.6 + basinPull * 4.2) - sample.gradient.y * dt * (2.6 + ridgePenalty * 3.8);

    let separationX = 0;
    let separationY = 0;
    let grazerCount = 0;
    for (const other of neighbors) {
      if (other.type !== 'grazer') continue;
      const offset = this.delta(entity.position, other.position);
      const dist = Math.hypot(offset.x, offset.y) || 1;
      const proximity = clamp(1 - dist / 120, 0, 1);
      if (proximity <= 0) continue;
      grazerCount += 1;
      separationX -= (offset.x / dist) * proximity * proximity;
      separationY -= (offset.y / dist) * proximity * proximity;
    }

    const strideTheta = this.time * (0.014 + entity.activityBias * 0.008) + entity.id * 0.43;
    entity.velocity.x += Math.cos(strideTheta) * dt * 0.72;
    entity.velocity.y += Math.sin(strideTheta * 0.82) * dt * 0.56;

    if (activeFruit) {
      this.consumeParticle(entity, activeFruit, dt, 300, 300, 22, 22, 0.34, localStats);
      entity.memory = clamp(entity.memory + dt * 0.08, 0, 1.2);
      this.scheduleRetarget(entity, 1.4);
    } else if (activeBloomTarget) {
      const offset = this.delta(entity.position, activeBloomTarget.position);
      const dist = Math.hypot(offset.x, offset.y) || 1;
      const pull = smoothstep(260, 0, dist) * 14;
      entity.velocity.x += (offset.x / dist) * pull * dt;
      entity.velocity.y += (offset.y / dist) * pull * dt;
      entity.targetId = activeBloomTarget.id;
      entity.targetKind = 'bloom';
      this.scheduleRetarget(entity, 1.1);

      if (dist < entity.size + activeBloomTarget.size + 10) {
        const browseAmount = Math.min(dt * 0.12, activeBloomTarget.pollination * 0.1 + activeBloomTarget.energy * 0.04);
        activeBloomTarget.pollination = clamp(activeBloomTarget.pollination - browseAmount * 0.3, 0, 1.8);
        activeBloomTarget.energy = clamp(activeBloomTarget.energy - browseAmount * 0.08, 0, 1.5);
        activeBloomTarget.visualState = 'feeding';
        activeBloomTarget.visualPulse = Math.max(activeBloomTarget.visualPulse, 0.18);
        entity.energy = clamp(entity.energy + browseAmount * 0.72, 0, 1.5);
        entity.food = clamp(entity.food + browseAmount * 0.84, 0, 1.6);
        entity.growth = clamp(entity.growth + browseAmount * 0.2, 0, 1.8);
        entity.visualState = 'feeding';
        entity.visualPulse = Math.max(entity.visualPulse, 0.38);
        entity.pulse = Math.max(entity.pulse, 0.22);
        entity.acousticPressure = clamp(entity.acousticPressure + browseAmount * 0.26, 0, 1.4);
        if (this.shouldEmitSound(entity, dt, 1.6, 1 + browseAmount * 4)) {
          this.emitBurst('feed', entity.position, 9 + entity.size * 0.8, 0.12 + entity.hueShift * 0.03);
          this.emitWorldEvent({ type: 'entityFed', time: this.time, position: { ...entity.position }, entityType: entity.type, entityId: entity.id, foodKind: 'fruit' });
        }
      }
    } else {
      entity.targetId = undefined;
      entity.targetKind = undefined;
      this.scheduleRetarget(entity, 0.68);
      entity.energy = clamp(entity.energy - dt * 0.006, 0, 1.5);
      entity.stability = clamp(entity.stability - dt * 0.008, 0, 1.2);
      if (entity.energy < 0.24 || entity.food < 0.22) {
        entity.visualState = 'dying';
        entity.visualPulse = Math.max(entity.visualPulse, 0.18);
      }
    }

    if (grazerCount > 0) {
      entity.velocity.x += separationX * dt * 6.2;
      entity.velocity.y += separationY * dt * 6.2;
    }

    if (sample.terrain === 'fertile' || basinPull > 0.38) {
      entity.stability = clamp(entity.stability + dt * (0.008 + basinPull * 0.014), 0, 1.2);
      entity.energy = clamp(entity.energy + dt * basinPull * 0.012, 0, 1.5);
    } else if (sample.terrain === 'solid' || sample.traversability < 0.22 || ridgePenalty > 0.7) {
      entity.energy = clamp(entity.energy - dt * (0.016 + ridgePenalty * 0.022), 0, 1.5);
      entity.stability = clamp(entity.stability - dt * (0.016 + ridgePenalty * 0.024), 0, 1.2);
    } else if (sample.terrain === 'water' || wetPenalty > 0.44) {
      entity.velocity.x += sample.moistureGradient.x * dt * 1.1;
      entity.velocity.y += sample.moistureGradient.y * dt * 1.1;
      entity.energy = clamp(entity.energy - dt * (0.01 + wetPenalty * 0.016), 0, 1.5);
    }

    entity.harmony = clamp(lerp(entity.harmony, 0.24 + sample.resonance * 0.22 + entity.food * 0.16, dt * 0.05), 0, 1.1);
    entity.velocity.x *= Math.pow(0.957, dt * 60);
    entity.velocity.y *= Math.pow(0.957, dt * 60);
    entity.position = this.wrapPosition({
      x: entity.position.x + entity.velocity.x * dt * (0.28 + entity.activity * 0.34),
      y: entity.position.y + entity.velocity.y * dt * (0.28 + entity.activity * 0.34),
    });
  }

  private updateDecomposer(
    entity: Entity,
    sample: FieldSample,
    neighbors: Entity[],
    dt: number,
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number; temperature: number },
  ): void {
    const residue = this.shouldReuseTarget(entity)
      ? this.getTrackedResidueTarget(entity, 260)
      : undefined;
    const activeResidue = residue ?? this.findResidueTarget(entity.position);
    if (!residue) this.diagnostics.queryCounts.targetRetargets += 1;
    let targetOffset = activeResidue ? this.delta(entity.position, activeResidue.position) : undefined;
    let targetDistance = activeResidue ? Math.hypot(targetOffset!.x, targetOffset!.y) : Infinity;

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
      this.scheduleRetarget(entity, 1.1);

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
        this.seedTerrain(activeResidue.position, activeResidue.radius * 0.54, consumed * 0.42, consumed * 0.08, -consumed * 0.02, 5.2);
        localStats.nutrients += consumed * 8;
      }
    } else {
      entity.targetId = undefined;
      entity.targetKind = undefined;
      this.scheduleRetarget(entity, 0.72);
      const crawlTheta = this.time * (0.012 + entity.activityBias * 0.01) + entity.id * 0.4;
      entity.velocity.x += Math.cos(crawlTheta) * dt * 0.55;
      entity.velocity.y += Math.sin(crawlTheta * 0.76) * dt * 0.42;
      entity.energy = clamp(entity.energy - dt * 0.004, 0, 1.3);
    }

    for (const other of neighbors) {
      if (other.type !== 'cluster') continue;
      const offset = this.delta(entity.position, other.position);
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
    entity.position = this.wrapPosition({
      x: entity.position.x + entity.velocity.x * dt * (0.3 + entity.activity * 0.4),
      y: entity.position.y + entity.velocity.y * dt * (0.3 + entity.activity * 0.4),
    });
  }
  private updateParasite(
    entity: Entity,
    sample: FieldSample,
    neighbors: Entity[],
    dt: number,
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number; temperature: number },
  ): void {
    const host = this.shouldReuseTarget(entity)
      ? this.getTrackedBloomTarget(entity, 220)
      : undefined;
    const activeHost = host ?? this.findBloomTarget(entity.position);
    const warmth = clamp(1 - Math.abs(sample.temperature - 0.66) * 1.6, 0, 1);
    localStats.threat += dt * 0.04;
    const denseBias = sample.terrain === 'dense' ? 0.12 : 0;
    entity.velocity.x += sample.flow.x * dt * 0.018 + sample.fertilityGradient.x * dt * 2.2 - sample.gradient.x * dt * 1.2;
    entity.velocity.y += sample.flow.y * dt * 0.018 + sample.fertilityGradient.y * dt * 2.2 - sample.gradient.y * dt * 1.2;

    if (activeHost) {
      const offset = this.delta(entity.position, activeHost.position);
      const dist = Math.hypot(offset.x, offset.y) || 1;
      const pull = smoothstep(220, 0, dist) * 10;
      entity.velocity.x += (offset.x / dist) * pull * dt;
      entity.velocity.y += (offset.y / dist) * pull * dt;
      entity.targetId = activeHost.id;
      entity.targetKind = 'bloom';
      this.scheduleRetarget(entity, 1.15);
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
        this.affectEnvironment(entity.position, 36 + entity.size * 2, -siphon * 0.32, siphon * 0.06);
        if (this.rng.next() < dt * 0.8) {
          this.spawnResidue(entity.position, siphon * 0.28 + 0.04, 'parasite');
        }
      }
    } else {
      entity.targetId = undefined;
      entity.targetKind = undefined;
      const sway = this.time * (0.01 + entity.activityBias * 0.008) + entity.id * 0.37;
      entity.velocity.x += Math.cos(sway) * dt * 0.44;
      entity.velocity.y += Math.sin(sway * 0.81) * dt * 0.34;
      entity.energy = clamp(entity.energy - dt * 0.01, 0, 1.4);
      entity.food = clamp(entity.food - dt * 0.006, 0, 1.5);
    }

    for (const other of neighbors) {
      if (other.type !== 'parasite') continue;
      const offset = this.delta(entity.position, other.position);
      const dist = Math.hypot(offset.x, offset.y) || 1;
      const proximity = clamp(1 - dist / 80, 0, 1);
      entity.velocity.x -= (offset.x / dist) * proximity * proximity * dt * 2.2;
      entity.velocity.y -= (offset.y / dist) * proximity * proximity * dt * 2.2;
    }

    entity.harmony = clamp(lerp(entity.harmony, 0.16 + sample.resonance * 0.18 + warmth * 0.08 + denseBias, dt * 0.06), 0, 1.1);
    entity.stability = clamp(entity.stability + dt * (warmth * 0.012 + denseBias * 0.04 - habitatPenalty(sample, 'highland') * 0.018), 0, 1.2);
    entity.velocity.x *= Math.pow(0.968, dt * 60);
    entity.velocity.y *= Math.pow(0.968, dt * 60);
    entity.position = this.wrapPosition({
      x: entity.position.x + entity.velocity.x * dt * (0.24 + entity.activity * 0.28),
      y: entity.position.y + entity.velocity.y * dt * (0.24 + entity.activity * 0.28),
    });

    if (entity.stage !== 'birth' && entity.energy > 0.7 && warmth > 0.4 && this.rng.next() < dt * 0.08) {
      this.spawnPropagule(entity.position, 'spore', 'parasite', entity.id, 0.34);
      entity.energy *= 0.92;
    }
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

  private shouldPersist(entity: Entity): boolean {
    if (entity.energy <= 0.04 || entity.food <= 0.03) return false;
    if (entity.stageProgress >= 1 && entity.energy < 0.2) return false;
    if (!ROOTED_BLOOM_TYPES.includes(entity.type) && entity.stability <= 0.04) return false;
    return true;
  }

  private handleDeath(entity: Entity): void {
    this.spawnResidue(entity.position, clamp(0.26 + entity.growth * 0.3 + entity.vitality * 0.24 + entity.pollination * 0.1, 0.18, 1), entity.type);
    this.diagnostics.lifecycleTransitions.deaths += 1;
    if (ROOTED_BLOOM_TYPES.includes(entity.type) && this.rng.next() < 0.72) this.spawnPropagule(entity.position, entity.type === 'canopy' ? 'seed' : 'spore', entity.type, entity.id, 0.32);
    if (entity.type === 'cluster' || entity.type === 'parasite') this.spawnPropagule(entity.position, 'spore', entity.type, entity.id, 0.24);
    this.emitBurst('death', entity.position, 18 + entity.size * 1.4, 0.88 + entity.hueShift * 0.03);
    this.emitWorldEvent({ type: 'entityDied', time: this.time, position: { ...entity.position }, entityType: entity.type, entityId: entity.id });
  }

  private spawnEntities(dt: number): void {
    const counts = this.countEntities();
    const additions: Entity[] = [];
    const pendingCounts: Record<EntityType, number> = { flocker: 0, cluster: 0, plant: 0, ephemeral: 0, canopy: 0, grazer: 0, parasite: 0, predator: 0 };

    for (const entity of this.entities) {
      if (entity.reproductionCooldown > 0) continue;
      const localDensity = this.getNeighborsByEntity(entity, ROOTED_BLOOM_TYPES.includes(entity.type) ? 150 : entity.type === 'cluster' ? 100 : entity.type === 'grazer' ? 120 : 130).length;
      const localSample = this.sampleField(entity.position.x, entity.position.y);
      let producedEntity: Entity | undefined;
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
        && counts.plant + pendingCounts.plant < MAX_PLANTS
      ) {
        const birthRate = dt * clamp(0.008 + entity.pollination * 0.018 + localSample.fertility * 0.012 - localDensity * 0.005, 0.002, 0.04);
        if (this.rng.next() <= birthRate) {
          this.spawnPropagule(this.findNearbySpawnPoint(entity.position, 84, (sample) => sample.fertility > 0.44 && sample.moisture > 0.26 && habitatMatch(sample, 'basin') > 0.34 && habitatPenalty(sample, 'highland') < 0.46 && sample.slope < 0.58), 'seed', 'plant', entity.id, 0.48);
          pendingCounts.plant += 1;
          producedPropagule = true;
          entity.reproductionCooldown = this.rng.range(24, 34);
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
        && counts.ephemeral + pendingCounts.ephemeral < MAX_EPHEMERALS
      ) {
        const birthRate = dt * clamp(0.016 + localSample.temperature * 0.02 + localSample.nutrient * 0.016 - localDensity * 0.006, 0.004, 0.06);
        if (this.rng.next() <= birthRate) {
          this.spawnPropagule(this.findNearbySpawnPoint(entity.position, 96, (sample) => sample.temperature > 0.54 && sample.nutrient > 0.34 && sample.moisture > 0.24), 'spore', 'ephemeral', entity.id, 0.34);
          pendingCounts.ephemeral += 1;
          producedPropagule = true;
          entity.reproductionCooldown = this.rng.range(10, 18);
          entity.energy *= 0.86;
          entity.food *= 0.84;
        }
      } else if (
        entity.type === 'canopy'
        && entity.stage === 'mature'
        && entity.pollination > 0.62
        && entity.energy > 0.82
        && localSample.nutrient > 0.46
        && counts.canopy + pendingCounts.canopy < MAX_CANOPIES
      ) {
        const birthRate = dt * clamp(0.004 + localSample.nutrient * 0.01 + entity.food * 0.008 - localDensity * 0.004, 0.001, 0.018);
        if (this.rng.next() <= birthRate) {
          this.spawnPropagule(this.findNearbySpawnPoint(entity.position, 130, (sample) => sample.nutrient > 0.46 && Math.abs(sample.temperature - 0.42) < 0.22 && habitatPenalty(sample, 'highland') < 0.62), 'seed', 'canopy', entity.id, 0.6);
          pendingCounts.canopy += 1;
          producedPropagule = true;
          entity.reproductionCooldown = this.rng.range(32, 44);
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
        && counts.flocker + pendingCounts.flocker < MAX_FLOCKERS
      ) {
        const birthRate = dt * clamp(0.008 + entity.memory * 0.014 + localSample.moisture * 0.008 + habitatMatch(localSample, 'wetland') * 0.008 + habitatMatch(localSample, 'basin') * 0.006 - localDensity * 0.006, 0.001, 0.03);
        if (this.rng.next() <= birthRate) {
          const position = this.findNearbySpawnPoint(entity.position, 62, (sample) => sample.moisture > 0.32 && sample.slope < 0.56 && sample.traversability > 0.24 && habitatPenalty(sample, 'highland') < 0.58);
          producedEntity = this.createEntity('flocker', position);
          additions.push(producedEntity);
          pendingCounts.flocker += 1;
          entity.reproductionCooldown = this.rng.range(20, 30);
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
        && counts.grazer + pendingCounts.grazer < MAX_GRAZERS
      ) {
        const nearbyFruit = this.findFoodTarget(entity.position, 180, (particle) => particle.kind === 'fruit');
        const birthRate = dt * clamp(0.006 + entity.food * 0.012 + entity.energy * 0.012 + habitatMatch(localSample, 'basin') * 0.01 - habitatPenalty(localSample, 'wetland') * 0.006 + (nearbyFruit ? 0.008 : 0) - localDensity * 0.007, 0.001, 0.024);
        if (this.rng.next() <= birthRate) {
          const origin = nearbyFruit?.position ?? entity.position;
          const position = this.findNearbySpawnPoint(origin, 54, (terrain) => terrain.traversability > 0.24 && terrain.fertility > 0.34 && habitatMatch(terrain, 'basin') > 0.26 && habitatPenalty(terrain, 'wetland') < 0.5 && habitatPenalty(terrain, 'highland') < 0.54 && terrain.slope < 0.58);
          producedEntity = this.createEntity('grazer', position);
          additions.push(producedEntity);
          pendingCounts.grazer += 1;
          entity.reproductionCooldown = this.rng.range(28, 40);
          entity.food *= 0.62;
          entity.energy *= 0.74;
        }
      } else if (
        entity.type === 'cluster'
        && entity.stage !== 'birth'
        && entity.food > 0.6
        && entity.energy > 0.58
        && entity.memory > 0.34
        && counts.cluster + pendingCounts.cluster < MAX_CLUSTERS
      ) {
        const nearbyResidue = this.findResidueTarget(entity.position, 140);
        const birthRate = dt * clamp(0.006 + entity.memory * 0.012 + (nearbyResidue ? nearbyResidue.richness * 0.01 : 0) + habitatMatch(localSample, 'wetland') * 0.008 + habitatMatch(localSample, 'basin') * 0.005 - habitatPenalty(localSample, 'highland') * 0.01 - localDensity * 0.006, 0.001, 0.024);
        if (this.rng.next() <= birthRate) {
          const origin = nearbyResidue?.position ?? entity.position;
          this.spawnPropagule(this.findNearbySpawnPoint(origin, 48, (sample) => sample.nutrient > 0.2 && sample.traversability > 0.1 && habitatPenalty(sample, 'highland') < 0.68 && sample.slope < 0.7), 'spore', 'cluster', entity.id, 0.4);
          pendingCounts.cluster += 1;
          producedPropagule = true;
          entity.reproductionCooldown = this.rng.range(22, 34);
          entity.food *= 0.72;
          entity.energy *= 0.84;
        }
      } else if (
        entity.type === 'parasite'
        && entity.stage !== 'birth'
        && entity.energy > 0.72
        && entity.memory > 0.22
        && localSample.temperature > 0.48
        && counts.parasite + pendingCounts.parasite < MAX_PARASITES
      ) {
        const birthRate = dt * clamp(0.004 + localSample.temperature * 0.012 + localSample.nutrient * 0.006 - localDensity * 0.006, 0.001, 0.018);
        if (this.rng.next() <= birthRate) {
          this.spawnPropagule(this.findNearbySpawnPoint(entity.position, 60, (sample) => sample.temperature > 0.5 && sample.fertility > 0.24 && habitatPenalty(sample, 'highland') < 0.62), 'spore', 'parasite', entity.id, 0.3);
          pendingCounts.parasite += 1;
          producedPropagule = true;
          entity.reproductionCooldown = this.rng.range(24, 36);
          entity.energy *= 0.9;
          entity.food *= 0.88;
        }
      } else {
        continue;
      }

      entity.visualState = 'reproducing';
      entity.visualPulse = 0.8;
      this.emitBurst('birth', entity.position, 14 + entity.size, 0.34 + entity.hueShift * 0.05);
      if (producedEntity) {
        this.emitWorldEvent({ type: 'entityBorn', time: this.time, position: { ...producedEntity.position }, entityType: producedEntity.type, entityId: producedEntity.id });
      } else if (producedPropagule) {
        this.diagnostics.lifecycleTransitions.propagulesCreated += 1;
      }
    }

    this.entities.push(...additions);
  }

  private updateEnergy(
    dt: number,
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number; temperature: number },
  ): void {
    const interactions = Math.max(1, localStats.interactions);
    const harmony = localStats.harmony / interactions;
    const stability = localStats.stability / interactions;
    const nutrientLift = localStats.nutrients / interactions;
    const gain = clamp(harmony * 0.24 + stability * 0.24 + nutrientLift * 0.22, 0, 1) * dt * 5.6;
    const loss = clamp(this.fields.filter((field) => field.tool !== 'observe').length * 0.03 + localStats.threat / interactions, 0, 1.2) * dt * 3.8;
    this.energy = clamp(this.energy + gain - loss, 0, ENERGY_MAX);
  }

  private computeStats(localStats?: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number; temperature: number }): GardenStats {
    const counts = this.countEntities();
    const interactions = Math.max(1, localStats?.interactions ?? this.entities.length);
    const harmony = clamp((localStats?.harmony ?? this.entities.reduce((sum, entity) => sum + entity.harmony, 0)) / interactions, 0, 1);
    const activity = clamp((localStats?.activity ?? this.entities.reduce((sum, entity) => sum + entity.activity, 0)) / interactions, 0, 1);
    const threat = clamp((localStats?.threat ?? counts.predator * 0.06) / interactions, 0, 1);
    const stability = clamp((localStats?.stability ?? this.entities.reduce((sum, entity) => sum + entity.stability, 0)) / interactions, 0, 1);
    const growth = clamp(this.entities.reduce((sum, entity) => sum + entity.growth, 0) / Math.max(1, this.entities.length), 0, 1);
    const richness = [counts.flocker > 0, counts.cluster > 0, counts.plant > 0, counts.ephemeral > 0, counts.canopy > 0, counts.grazer > 0, counts.parasite > 0].filter(Boolean).length / 7;
    const focus = clamp((localStats?.focus ?? 0) / Math.max(1, this.entities.length * 0.7), 0, 1);
    const nutrients = clamp((localStats?.nutrients ?? this.terrain.reduce((sum, cell) => sum + cell.nutrient, 0)) / Math.max(1, this.terrain.length), 0, 1);
    const fruit = clamp(((localStats?.fruit ?? this.particles.filter((particle) => particle.kind === 'fruit').length) / 24), 0, 1);
    const temperature = clamp((localStats?.temperature ?? this.terrain.reduce((sum, cell) => sum + cell.temperature, 0)) / Math.max(1, this.terrain.length), 0, 1);
    return {
      harmony,
      activity,
      threat,
      growth,
      stability,
      biodiversity: clamp(richness * 0.72 + this.entities.length / 120, 0, 1),
      energy: this.energy / ENERGY_MAX,
      focus,
      nutrients,
      fruit,
      temperature,
    };
  }

  private buildHotspotSummary(): string[] {
    const speciesEntries = Object.entries(this.diagnostics.speciesUpdateTimeMs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([type, timeMs]) => `${type} ${timeMs.toFixed(2)} ms`);
    const querySummary = [
      `field ${this.diagnostics.queryCounts.terrainSamples}`,
      `neighbors ${this.diagnostics.queryCounts.neighbors}`,
      `food ${this.diagnostics.queryCounts.foodSearches}`,
      `residue ${this.diagnostics.queryCounts.residueSearches}`,
    ]
      .sort((a, b) => Number(b.split(' ')[1]) - Number(a.split(' ')[1]))
      .slice(0, 2);
    return [...speciesEntries, ...querySummary];
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

  private getStage(progress: number): LifecycleStage {
    if (progress < 0.2) return 'birth';
    if (progress < 0.48) return 'growth';
    if (progress < 0.82) return 'mature';
    return 'decay';
  }

  private getLifecycleProgress(entity: Entity): number {
    if (ROOTED_BLOOM_TYPES.includes(entity.type)) {
      const bloomHealth = clamp(entity.growth * 0.46 + entity.pollination * 0.28 + entity.energy * 0.16 + entity.food * 0.1, 0, 1);
      const ageWeight = clamp(entity.age / entity.lifeSpan, 0, 1);
      return clamp(ageWeight * (entity.type === 'ephemeral' ? 0.5 : entity.type === 'canopy' ? 0.28 : 0.36) + bloomHealth * (entity.type === 'ephemeral' ? 0.5 : entity.type === 'canopy' ? 0.72 : 0.64), 0, 1);
    }
    if (entity.type === 'cluster') {
      const decayArc = clamp(entity.age / entity.lifeSpan, 0, 1);
      return clamp(decayArc * 0.48 + entity.growth * 0.3 + entity.memory * 0.22, 0, 1);
    }
    if (entity.type === 'grazer') {
      const grazeArc = clamp(entity.age / entity.lifeSpan, 0, 1);
      return clamp(grazeArc * 0.4 + entity.energy * 0.28 + entity.food * 0.26 + entity.growth * 0.06, 0, 1);
    }
    const driftArc = clamp(entity.age / entity.lifeSpan, 0, 1);
    return clamp(driftArc * 0.42 + entity.energy * 0.24 + entity.food * 0.22 + entity.memory * 0.12, 0, 1);
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
        this.handleDeath(entity);
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
