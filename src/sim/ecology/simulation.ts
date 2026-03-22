import {
  ATTRACTOR_COUNT,
  CAMERA_MAX_ZOOM,
  CAMERA_MIN_ZOOM,
  ENERGY_MAX,
  ENERGY_START,
  INITIAL_CLUSTER_COUNT,
  INITIAL_FLOCKER_COUNT,
  INITIAL_GRAZER_COUNT,
  INITIAL_PLANT_COUNT,
  INITIAL_PREDATOR_COUNT,
  MAX_CLUSTERS,
  MAX_FLOCKERS,
  MAX_GRAZERS,
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
import { createDefaultAttentionState, createDefaultCamera, createDefaultStats, createDefaultToolState, createWorldState } from '../world';
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
  Residue,
  SimulationSnapshot,
  TerrainCell,
  ToolFeedback,
  ToolField,
  ToolState,
  Vec2,
  WorldState,
} from '../../types/world';

const TWO_PI = Math.PI * 2;
const TERRAIN_SAMPLE_COUNT = TERRAIN_SAMPLE_COLS * TERRAIN_SAMPLE_ROWS;
const TERRAIN_SAMPLE_RADIUS = Math.min(WORLD_WIDTH / TERRAIN_SAMPLE_COLS, WORLD_HEIGHT / TERRAIN_SAMPLE_ROWS);
const GOLDEN_RATIO = 0.6180339887498948;
const TERRAIN_SAMPLE_REFRESH_INTERVAL = 1 / 15;
const ENTITY_BUCKET_SIZE = 220;
const PARTICLE_BUCKET_SIZE = 220;
const RESIDUE_BUCKET_SIZE = 220;
const ENTITY_BUCKET_COLS = Math.ceil(WORLD_WIDTH / ENTITY_BUCKET_SIZE);
const ENTITY_BUCKET_ROWS = Math.ceil(WORLD_HEIGHT / ENTITY_BUCKET_SIZE);
const PARTICLE_BUCKET_COLS = Math.ceil(WORLD_WIDTH / PARTICLE_BUCKET_SIZE);
const PARTICLE_BUCKET_ROWS = Math.ceil(WORLD_HEIGHT / PARTICLE_BUCKET_SIZE);
const RESIDUE_BUCKET_COLS = Math.ceil(WORLD_WIDTH / RESIDUE_BUCKET_SIZE);
const RESIDUE_BUCKET_ROWS = Math.ceil(WORLD_HEIGHT / RESIDUE_BUCKET_SIZE);
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
  private nextModifierId = 1;
  private attentionDragging = false;
  private terrainSampleTimer = 0;
  private readonly entityBuckets = new Map<string, Entity[]>();
  private readonly particleBuckets = new Map<string, FeedParticle[]>();
  private readonly residueBuckets = new Map<string, Residue[]>();
  private readonly entityBucketById = new Map<number, string>();

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
    this.bursts = [];
    this.terrainModifiers = [];
    this.nextId = 1;
    this.nextClusterId = 1;
    this.nextFeedbackId = 1;
    this.nextFieldId = 1;
    this.nextParticleId = 1;
    this.nextBurstId = 1;
    this.nextResidueId = 1;
    this.nextModifierId = 1;
    this.terrainSampleTimer = 0;
    this.entityBuckets.clear();
    this.entityBucketById.clear();
    this.particleBuckets.clear();
    this.residueBuckets.clear();
    this.time = 0;
    this.timeScale = 1;
    this.unlockedProgress = 0;
    this.energy = ENERGY_START;
    this.attentionDragging = false;
    this.camera = createDefaultCamera();
    this.tool = createDefaultToolState();
    this.attention = createDefaultAttentionState();
    this.stats = createDefaultStats();
    this.world.events = [];
    this.world.notifications = { recent: [] };
    this.attractors = this.createAttractors();

    for (let i = 0; i < INITIAL_PLANT_COUNT; i += 1) this.entities.push(this.createEntity('plant', this.randomSpawnPointForEntity('plant')));
    for (let i = 0; i < INITIAL_FLOCKER_COUNT; i += 1) this.entities.push(this.createEntity('flocker', this.randomSpawnPointForEntity('flocker')));
    for (let i = 0; i < INITIAL_CLUSTER_COUNT; i += 1) this.entities.push(this.createEntity('cluster', this.randomSpawnPointForEntity('cluster')));
    for (let i = 0; i < INITIAL_GRAZER_COUNT; i += 1) this.entities.push(this.createEntity('grazer', this.randomSpawnPointForEntity('grazer')));
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
    this.updateAttractors(dt);
    this.updateTerrainModifiers(dt);
    this.updateFields(dt);
    this.updateParticles(dt);
    this.updateResidues(dt);
    this.updateBursts(dt);
    this.refreshTerrainSamples(dt);
    this.rebuildParticleBuckets();
    this.rebuildResidueBuckets();
    this.rebuildEntityBuckets();

    const survivors: Entity[] = [];
    const localStats = { harmony: 0, activity: 0, threat: 0, stability: 0, interactions: 0, focus: 0, nutrients: 0, fruit: 0 };

    for (let i = 0; i < this.entities.length; i += 1) {
      const entity = this.entities[i] as Entity;
      entity.age += dt;
      entity.pulse = Math.max(0, entity.pulse - dt * 0.28);
      entity.visualPulse = Math.max(0, entity.visualPulse - dt * 0.44);
      entity.reproductionCooldown = Math.max(0, entity.reproductionCooldown - dt);
      entity.fruitCooldown = Math.max(0, entity.fruitCooldown - dt);
      entity.stageProgress = this.getLifecycleProgress(entity);
      entity.stage = this.getStage(entity.stageProgress);
      if (entity.visualPulse <= 0.03 && entity.visualState !== 'dying') entity.visualState = 'idle';

      const sample = this.sampleField(entity.position.x, entity.position.y);
      const neighbors = this.getNeighbors(i, NEIGHBOR_RADIUS);
      this.applyEntityBehavior(entity, sample, neighbors, dt, 0, localStats);

      const persists = this.shouldPersist(entity);
      if (persists) survivors.push(entity);
      else this.handleDeath(entity);
      this.syncEntityBucket(entity, persists);
    }

    this.entities = survivors;
    this.syncAttentionState();
    this.spawnEntities(dt);
    this.updateEnergy(dt, localStats);
    this.stats = this.computeStats(localStats);
    this.unlockedProgress = this.tool.unlocked.length / TOOL_UNLOCK_SCHEDULE.length;
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
      const entity = this.findEntityAt(position);
      if (entity) this.setEntityAttention(entity);
      else this.clearAttention();
    }

    this.attention.dragStart = null;
    this.attention.dragCurrent = null;
  }

  private cancelAttentionDrag(): void {
    this.attentionDragging = false;
    this.attention.dragging = false;
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

  private getRelatedEntityIds(entity: Entity): number[] {
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

  private findEntityAt(position: Vec2): Entity | undefined {
    let best: Entity | undefined;
    let bestScore = Infinity;
    const pickRadius = clamp(28 / Math.max(this.camera.zoom, 0.3), 20, 78);

    for (const entity of this.entities) {
      const offset = this.delta(position, entity.position);
      const distance = Math.hypot(offset.x, offset.y);
      const threshold = pickRadius + entity.size * (entity.type === 'plant' ? 1.9 : 1.4);
      if (distance > threshold) continue;
      const score = distance - entity.activity * 3 - entity.visualPulse * 3;
      if (score < bestScore) {
        best = entity;
        bestScore = score;
      }
    }

    return best;
  }

  private syncAttentionState(): void {
    if (this.attention.mode !== 'entity' || this.attention.entityId === null) return;

    const entity = this.entities.find((candidate) => candidate.id === this.attention.entityId);
    if (!entity) {
      this.clearAttention();
      return;
    }

    this.attention.position = { ...entity.position };
    this.attention.radius = clamp(160 + entity.size * 8, 150, 240);
    this.attention.strength = 1;
    this.attention.relatedEntityIds = this.getRelatedEntityIds(entity);
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

  private rebuildParticleBuckets(): void {
    this.particleBuckets.clear();
    for (const particle of this.particles) {
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
    for (const residue of this.residues) {
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

  private createEntity(type: EntityType, position: Vec2): Entity {
    const baseSize = { flocker: 6.2, cluster: 8.4, plant: 8.2, grazer: 10.4, predator: 11 }[type];
    const lifeSpan = { flocker: 124, cluster: 148, plant: 224, grazer: 162, predator: 150 }[type];
    const tone = { flocker: 0.72, cluster: 0.22, plant: 0.3, grazer: 0.48, predator: 0.74 }[type];
    const clusterId = type === 'cluster' ? this.nextClusterId++ : 0;
    const vitality = type === 'plant'
      ? this.rng.range(0.52, 0.82)
      : type === 'cluster'
        ? this.rng.range(0.46, 0.74)
        : type === 'grazer'
          ? this.rng.range(0.44, 0.68)
          : this.rng.range(0.56, 0.86);
    const growth = type === 'plant' ? this.rng.range(0.22, 0.48) : type === 'cluster' ? this.rng.range(0.18, 0.42) : type === 'grazer' ? this.rng.range(0.14, 0.28) : this.rng.range(0.16, 0.34);
    return {
      id: this.nextId++,
      type,
      stage: 'birth',
      position: { ...position },
      velocity: type === 'plant' ? { x: 0, y: 0 } : this.randomVelocity(type === 'cluster' ? 1.6 : type === 'grazer' ? 1.3 : 2.8),
      heading: this.rng.range(0, TWO_PI),
      size: baseSize,
      baseSize,
      energy: clamp(vitality + this.rng.range(0.04, 0.16), 0, 1.2),
      growth,
      resonance: this.rng.range(type === 'cluster' ? 0.18 : type === 'grazer' ? 0.22 : 0.24, type === 'flocker' ? 0.82 : type === 'grazer' ? 0.64 : 0.72),
      harmony: this.rng.range(type === 'cluster' ? 0.18 : type === 'grazer' ? 0.28 : 0.4, type === 'flocker' ? 0.88 : type === 'grazer' ? 0.68 : 0.76),
      stability: this.rng.range(type === 'flocker' ? 0.42 : type === 'grazer' ? 0.52 : 0.56, type === 'cluster' ? 0.86 : type === 'grazer' ? 0.88 : 0.94),
      age: 0,
      lifeSpan: lifeSpan + this.rng.range(-14, 18),
      stageProgress: 0,
      reproductionCooldown: this.rng.range(type === 'plant' ? 14 : type === 'grazer' ? 14 : 10, type === 'cluster' ? 18 : type === 'grazer' ? 26 : 24),
      pulse: 0,
      tone: clamp(tone + this.rng.range(-0.06, 0.06), 0, 1),
      shape: this.rng.range(0, 1),
      hueShift: this.rng.range(-0.18, 0.18),
      terrainBias: this.rng.range(-0.16, 0.16),
      clusterId,
      appetite: this.rng.range(type === 'cluster' ? 0.52 : type === 'grazer' ? 0.62 : 0.24, type === 'cluster' ? 1.08 : type === 'grazer' ? 0.98 : 0.92),
      anchor: type === 'plant' ? { ...position } : undefined,
      visualState: 'idle',
      visualPulse: 0,
      boundaryFade: 1,
      activity: this.rng.range(type === 'plant' ? 0.08 : type === 'grazer' ? 0.18 : 0.14, type === 'cluster' ? 0.32 : type === 'grazer' ? 0.34 : 0.44),
      activityBias: this.rng.range(0, 1),
      food: this.rng.range(type === 'plant' ? 0.54 : type === 'grazer' ? 0.44 : 0.42, type === 'cluster' ? 0.88 : type === 'grazer' ? 0.74 : 0.76),
      fruitCooldown: this.rng.range(type === 'plant' ? 8 : type === 'grazer' ? 10 : 5, type === 'plant' ? 16 : type === 'grazer' ? 18 : 10),
      vitality,
      pollination: type === 'plant' ? this.rng.range(0.12, 0.34) : 0,
      memory: this.rng.range(type === 'grazer' ? 0.24 : 0.18, type === 'grazer' ? 0.52 : 0.44),
      targetId: undefined,
      targetKind: undefined,
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
    this.terrainModifiers = this.terrainModifiers.filter((modifier) => {
      modifier.age += dt;
      return modifier.age < modifier.duration;
    });
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
      residue.nutrient = clamp(residue.nutrient - dt * 0.006, 0, 1.2);
      residue.richness = clamp(residue.nutrient * (1 - residue.age / residue.duration), 0, 1.4);
      if (residue.age < residue.duration && residue.nutrient > 0.02) active.push(residue);
    }
    this.residues = active;
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
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number },
  ): void {
    const activityPulse = Math.sin(this.time * (0.018 + entity.activityBias * 0.015) + entity.id * 0.7) * 0.5 + 0.5;
    const nearbyFood = this.countNearbyFood(entity.position, entity.type === 'flocker' ? 210 : 160);
    const nearbyResidue = this.getResidueInfluence(entity.position.x, entity.position.y);
    const targetActivity = entity.type === 'plant'
      ? 0.08 + sample.fertility * 0.1 + sample.nutrient * 0.16 + focusWeight * 0.08 + entity.pollination * 0.05
      : entity.type === 'cluster'
        ? 0.12 + activityPulse * 0.12 + nearbyResidue * 0.28 + focusWeight * 0.08
        : entity.type === 'grazer'
          ? 0.1 + activityPulse * 0.08 + nearbyFood * 0.3 + focusWeight * 0.16 + Math.max(0, 0.4 - entity.energy) * 0.18
        : 0.18 + activityPulse * 0.22 + nearbyFood * 0.24 + focusWeight * 0.18;
    entity.activity = lerp(entity.activity, clamp(targetActivity, 0.04, 1), dt * 0.7);
    entity.resonance = clamp(lerp(entity.resonance, 0.28 + sample.resonance * (entity.type === 'cluster' ? 0.46 : 0.72), dt * 0.12), 0, 1.3);
    entity.stability = clamp(lerp(entity.stability, 0.34 + sample.stability * 0.86 + (entity.type === 'plant' ? sample.fertility * 0.08 : 0), dt * 0.08), 0, 1.2);
    entity.food = clamp(entity.food - dt * (entity.type === 'plant' ? 0.0022 : entity.type === 'cluster' ? 0.0052 : entity.type === 'grazer' ? 0.011 + entity.activity * 0.012 : 0.008 + entity.activity * 0.01), 0, 1.6);
    entity.energy = clamp(entity.energy - dt * (entity.type === 'plant' ? 0.0014 : entity.type === 'cluster' ? 0.0038 : entity.type === 'grazer' ? 0.009 + entity.activity * 0.01 : 0.005 + entity.activity * 0.008), 0, 1.6);
    entity.memory = clamp(entity.memory - dt * 0.012, 0, 1.2);
    entity.pollination = clamp(entity.pollination - dt * (entity.type === 'plant' ? 0.012 : 0), 0, 1.6);

    this.applyToolFields(entity, dt);
    entity.boundaryFade = lerp(entity.boundaryFade, clamp(0.58 + sample.traversability * 0.42, 0.52, 1), dt * 0.24);

    if (entity.type === 'plant') this.updatePlant(entity, sample, dt, localStats);
    else this.updateCreature(entity, sample, neighbors, dt, localStats);

    entity.vitality = clamp(entity.energy * 0.55 + entity.food * 0.25 + entity.stability * 0.2, 0, 1.6);
    entity.stageProgress = this.getLifecycleProgress(entity);
    entity.stage = this.getStage(entity.stageProgress);
    entity.size = clamp(entity.baseSize * (0.68 + entity.growth * 0.42 + entity.stageProgress * 0.24 + (entity.type === 'plant' ? entity.pollination * 0.04 : entity.type === 'grazer' ? entity.food * 0.05 : 0)), entity.baseSize * 0.54, entity.baseSize * 2.1);
    entity.heading = Math.atan2(entity.velocity.y || 0.001, entity.velocity.x || 0.001);
    this.updateTrail(entity);
    localStats.activity += entity.activity;
    localStats.harmony += entity.harmony;
    localStats.stability += entity.stability;
    localStats.interactions += 1;
    localStats.focus += focusWeight;
    localStats.nutrients += sample.nutrient;
  }

  private updatePlant(
    entity: Entity,
    sample: FieldSample,
    dt: number,
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number },
  ): void {
    const anchor = entity.anchor ?? entity.position;
    const anchorDelta = this.delta(entity.position, anchor);
    entity.velocity.x = lerp(entity.velocity.x, -anchorDelta.x * 0.02 + sample.flow.x * 0.012 + sample.moistureGradient.x * 2.8 - sample.gradient.x * 2.4, dt * 0.5);
    entity.velocity.y = lerp(entity.velocity.y, -anchorDelta.y * 0.02 + sample.flow.y * 0.012 + sample.moistureGradient.y * 2.8 - sample.gradient.y * 2.4, dt * 0.5);
    entity.position = this.wrapPosition({
      x: entity.position.x + entity.velocity.x * dt,
      y: entity.position.y + entity.velocity.y * dt,
    });

    const basinBoost = habitatMatch(sample, 'basin');
    const wetBoost = habitatMatch(sample, 'wetland');
    const ridgeStress = habitatPenalty(sample, 'highland');
    const fertilityScore = sample.fertility * 0.42 + sample.nutrient * 0.38 + sample.moisture * 0.12 + entity.pollination * 0.16 + basinBoost * 0.22 + wetBoost * 0.08;
    const stress = (1 - sample.traversability) * 0.04 + sample.slope * 0.028 + ridgeStress * 0.08 + (sample.terrain === 'solid' ? 0.06 : sample.terrain === 'water' ? 0.016 : 0) + Math.max(0, 0.36 - fertilityScore) * 0.05;
    entity.growth = clamp(entity.growth + dt * (fertilityScore * 0.05 - stress), 0, 1.8);
    entity.energy = clamp(entity.energy + dt * (fertilityScore * 0.08 - stress * 1.25), 0, 1.4);
    entity.food = clamp(entity.food + dt * (sample.nutrient * 0.065 + sample.fertility * 0.04 - stress * 0.8), 0, 1.5);
    entity.harmony = clamp(lerp(entity.harmony, 0.38 + sample.resonance * 0.34 + sample.moisture * 0.08 + entity.pollination * 0.12, dt * 0.08), 0, 1.2);

    if (fertilityScore > 0.6 && entity.stage !== 'birth') {
      this.seedTerrain(entity.position, 52 + entity.size * 2.4, 0.01 * dt, 0.004 * dt, -0.001 * dt, 2.6);
    }

    const fruitingHealth = fertilityScore * 0.38 + entity.energy * 0.24 + entity.food * 0.18 + entity.growth * 0.12 + entity.pollination * 0.08;
    if (
      entity.stage === 'mature'
      && entity.fruitCooldown <= 0
      && fruitingHealth > 0.72
      && entity.pollination > 0.42
      && entity.energy > 0.74
      && entity.food > 0.7
      && sample.terrain !== 'solid'
    ) {
      const fruitCount = sample.nutrient > 0.42 ? 2 : 1;
      for (let i = 0; i < fruitCount; i += 1) {
        this.spawnParticle(entity.position, entity.size * 2.6, 'fruit', false, entity.id);
        localStats.fruit += 1;
      }
      entity.fruitCooldown = this.rng.range(12, 20);
      entity.energy *= 0.9;
      entity.food *= 0.92;
      entity.visualState = 'reproducing';
      entity.visualPulse = 0.42;
      this.emitBurst('birth', entity.position, 8 + entity.size * 0.7, 0.12 + entity.hueShift * 0.04);
      this.emitWorldEvent({ type: 'fruitCreated', time: this.time, position: { ...entity.position }, sourceEntityId: entity.id, count: fruitCount });
    }

    if (entity.stage === 'decay' && (fertilityScore < 0.34 || entity.energy < 0.28)) {
      entity.visualState = 'dying';
      entity.visualPulse = Math.max(entity.visualPulse, 0.18);
      entity.energy = clamp(entity.energy - dt * 0.015, 0, 1.4);
    }
  }

  private updateCreature(
    entity: Entity,
    sample: FieldSample,
    neighbors: Entity[],
    dt: number,
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number },
  ): void {
    if (entity.type === 'cluster') {
      this.updateDecomposer(entity, sample, neighbors, dt, localStats);
      return;
    }
    if (entity.type === 'predator') {
      entity.activity = lerp(entity.activity, 0, dt * 2);
      entity.energy = clamp(entity.energy - dt * 0.1, 0, 1.2);
      return;
    }
    if (entity.type === 'grazer') {
      this.updateGrazer(entity, sample, neighbors, dt, localStats);
      return;
    }

    this.updatePollinator(entity, sample, neighbors, dt, localStats);
  }

  private updatePollinator(
    entity: Entity,
    sample: FieldSample,
    neighbors: Entity[],
    dt: number,
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number },
  ): void {
    const nearestFood = this.findFoodTarget(entity.position, 240, (particle) => particle.kind === 'fruit' || particle.kind === 'feed');
    const bloomTarget = this.findBloomTarget(entity.position);
    const nearestOffset = bloomTarget ? this.delta(entity.position, bloomTarget.position) : undefined;
    const nearestDistance = bloomTarget ? Math.hypot(nearestOffset!.x, nearestOffset!.y) : Infinity;

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

    if (bloomTarget && nearestOffset && nearestDistance < 320) {
      const dist = nearestDistance || 1;
      const nx = nearestOffset.x / dist;
      const ny = nearestOffset.y / dist;
      const tangentX = -ny;
      const tangentY = nx;
      const curve = 0.55 + Math.sin(this.time * 0.12 + entity.id) * 0.24;
      const pull = smoothstep(320, 0, dist) * 18;
      entity.velocity.x += (nx * pull + tangentX * curve * 8) * dt;
      entity.velocity.y += (ny * pull + tangentY * curve * 8) * dt;
      entity.targetId = bloomTarget.id;
      entity.targetKind = 'bloom';
      entity.memory = clamp(entity.memory + dt * 0.08, 0, 1.2);

      if (dist < entity.size + bloomTarget.size + 14) {
        bloomTarget.pollination = clamp(bloomTarget.pollination + dt * 0.48, 0, 1.8);
        bloomTarget.energy = clamp(bloomTarget.energy + dt * 0.12, 0, 1.5);
        bloomTarget.growth = clamp(bloomTarget.growth + dt * 0.08, 0, 1.8);
        bloomTarget.visualState = 'feeding';
        bloomTarget.visualPulse = Math.max(bloomTarget.visualPulse, 0.22);
        entity.visualState = 'feeding';
        entity.visualPulse = Math.max(entity.visualPulse, 0.3);
        entity.energy = clamp(entity.energy + dt * 0.06, 0, 1.5);
        entity.food = clamp(entity.food + dt * 0.04, 0, 1.5);
        localStats.fruit += dt * 0.8;
      }
    } else if (nearestFood) {
      this.consumeParticle(entity, nearestFood, dt, 240, 190, 16, 12, 0.2, localStats);
    } else {
      entity.targetId = undefined;
      entity.targetKind = undefined;
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
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number },
  ): void {
    const nearestFruit = this.findFoodTarget(entity.position, 300, (particle) => particle.kind === 'fruit');
    const bloomTarget = nearestFruit ? undefined : this.findGrazerBloomTarget(entity.position);

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

    if (nearestFruit) {
      this.consumeParticle(entity, nearestFruit, dt, 300, 300, 22, 22, 0.34, localStats);
      entity.memory = clamp(entity.memory + dt * 0.08, 0, 1.2);
    } else if (bloomTarget) {
      const offset = this.delta(entity.position, bloomTarget.position);
      const dist = Math.hypot(offset.x, offset.y) || 1;
      const pull = smoothstep(260, 0, dist) * 14;
      entity.velocity.x += (offset.x / dist) * pull * dt;
      entity.velocity.y += (offset.y / dist) * pull * dt;
      entity.targetId = bloomTarget.id;
      entity.targetKind = 'bloom';

      if (dist < entity.size + bloomTarget.size + 10) {
        const browseAmount = Math.min(dt * 0.12, bloomTarget.pollination * 0.1 + bloomTarget.energy * 0.04);
        bloomTarget.pollination = clamp(bloomTarget.pollination - browseAmount * 0.3, 0, 1.8);
        bloomTarget.energy = clamp(bloomTarget.energy - browseAmount * 0.08, 0, 1.5);
        bloomTarget.visualState = 'feeding';
        bloomTarget.visualPulse = Math.max(bloomTarget.visualPulse, 0.18);
        entity.energy = clamp(entity.energy + browseAmount * 0.72, 0, 1.5);
        entity.food = clamp(entity.food + browseAmount * 0.84, 0, 1.6);
        entity.growth = clamp(entity.growth + browseAmount * 0.2, 0, 1.8);
        entity.visualState = 'feeding';
        entity.visualPulse = Math.max(entity.visualPulse, 0.38);
        entity.pulse = Math.max(entity.pulse, 0.22);
        if (this.rng.next() < dt * 1.8) {
          this.emitBurst('feed', entity.position, 9 + entity.size * 0.8, 0.12 + entity.hueShift * 0.03);
          this.emitWorldEvent({ type: 'entityFed', time: this.time, position: { ...entity.position }, entityType: entity.type, entityId: entity.id, foodKind: 'fruit' });
        }
      }
    } else {
      entity.targetId = undefined;
      entity.targetKind = undefined;
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
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number },
  ): void {
    const residue = this.findResidueTarget(entity.position);
    let targetOffset = residue ? this.delta(entity.position, residue.position) : undefined;
    let targetDistance = residue ? Math.hypot(targetOffset!.x, targetOffset!.y) : Infinity;

    const wetBias = habitatMatch(sample, 'wetland');
    const basinBias = habitatMatch(sample, 'basin');
    const ridgePenalty = habitatPenalty(sample, 'highland');
    entity.velocity.x += sample.flow.x * dt * (0.026 + wetBias * 0.02) + sample.nutrient * sample.fertilityGradient.x * dt * (3.8 + basinBias * 2.2) - sample.gradient.x * dt * (2 + ridgePenalty * 3.2);
    entity.velocity.y += sample.flow.y * dt * (0.026 + wetBias * 0.02) + sample.nutrient * sample.fertilityGradient.y * dt * (3.8 + basinBias * 2.2) - sample.gradient.y * dt * (2 + ridgePenalty * 3.2);

    if (residue && targetOffset && targetDistance < 260) {
      const dist = targetDistance || 1;
      const nx = targetOffset.x / dist;
      const ny = targetOffset.y / dist;
      const tangentX = -ny;
      const tangentY = nx;
      const creep = smoothstep(260, 0, dist) * 8;
      entity.velocity.x += (nx * creep + tangentX * 1.2) * dt;
      entity.velocity.y += (ny * creep + tangentY * 1.2) * dt;
      entity.targetId = residue.id;
      entity.targetKind = 'residue';

      if (dist < residue.radius * 0.46 + entity.size + 10) {
        const consumed = Math.min(residue.nutrient, dt * (0.045 + entity.appetite * 0.018));
        residue.nutrient = clamp(residue.nutrient - consumed, 0, 1.2);
        residue.richness = clamp(residue.richness - consumed * 0.65, 0, 1.4);
        entity.energy = clamp(entity.energy + consumed * 0.84, 0, 1.4);
        entity.food = clamp(entity.food + consumed * 0.66, 0, 1.5);
        entity.growth = clamp(entity.growth + consumed * 0.46, 0, 1.8);
        entity.memory = clamp(entity.memory + consumed * 0.7, 0, 1.2);
        entity.visualState = 'feeding';
        entity.visualPulse = Math.max(entity.visualPulse, 0.24);
        this.seedTerrain(residue.position, residue.radius * 0.54, consumed * 0.42, consumed * 0.08, -consumed * 0.02, 5.2);
        localStats.nutrients += consumed * 8;
      }
    } else {
      entity.targetId = undefined;
      entity.targetKind = undefined;
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
        if (entity.type === 'plant') {
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
        if (entity.type !== 'plant') entity.activity = clamp(entity.activity + dt * 0.14 * falloff, 0, 1);
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
    if (entity.type !== 'plant' && entity.stability <= 0.04) return false;
    return true;
  }

  private handleDeath(entity: Entity): void {
    this.spawnResidue(entity.position, clamp(0.26 + entity.growth * 0.3 + entity.vitality * 0.24 + entity.pollination * 0.1, 0.18, 1), entity.type);
    this.emitBurst('death', entity.position, 18 + entity.size * 1.4, 0.88 + entity.hueShift * 0.03);
    this.emitWorldEvent({ type: 'entityDied', time: this.time, position: { ...entity.position }, entityType: entity.type, entityId: entity.id });
  }

  private spawnEntities(dt: number): void {
    const counts = this.countEntities();
    const additions: Entity[] = [];

    for (const entity of this.entities) {
      if (entity.reproductionCooldown > 0) continue;
      const localDensity = this.getNeighborsByEntity(entity, entity.type === 'plant' ? 150 : entity.type === 'cluster' ? 100 : entity.type === 'grazer' ? 120 : 130).length;

      const localSample = this.sampleField(entity.position.x, entity.position.y);

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
        && localSample.slope < 0.62
        && counts.plant + additions.filter((candidate) => candidate.type === 'plant').length < MAX_PLANTS
      ) {
        const birthRate = dt * clamp(0.008 + entity.pollination * 0.018 + localSample.fertility * 0.012 - localDensity * 0.005, 0.002, 0.04);
        if (this.rng.next() <= birthRate) {
          const position = this.findNearbySpawnPoint(entity.position, 84, (sample) => sample.fertility > 0.44 && sample.moisture > 0.26 && habitatMatch(sample, 'basin') > 0.34 && habitatPenalty(sample, 'highland') < 0.46 && sample.slope < 0.58);
          additions.push(this.createEntity('plant', position));
          entity.reproductionCooldown = this.rng.range(24, 34);
          entity.pollination *= 0.58;
          entity.food *= 0.82;
          entity.energy *= 0.88;
        }
      } else if (
        entity.type === 'flocker'
        && entity.stage !== 'birth'
        && entity.food > 0.74
        && entity.energy > 0.72
        && entity.memory > 0.3
        && localSample.traversability > 0.24
        && habitatPenalty(localSample, 'highland') < 0.72
        && counts.flocker + additions.filter((candidate) => candidate.type === 'flocker').length < MAX_FLOCKERS
      ) {
        const birthRate = dt * clamp(0.008 + entity.memory * 0.014 + localSample.moisture * 0.008 + habitatMatch(localSample, 'wetland') * 0.008 + habitatMatch(localSample, 'basin') * 0.006 - localDensity * 0.006, 0.001, 0.03);
        if (this.rng.next() <= birthRate) {
          const position = this.findNearbySpawnPoint(entity.position, 62, (sample) => sample.moisture > 0.32 && sample.slope < 0.56 && sample.traversability > 0.24 && habitatPenalty(sample, 'highland') < 0.58);
          additions.push(this.createEntity('flocker', position));
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
        && counts.grazer + additions.filter((candidate) => candidate.type === 'grazer').length < MAX_GRAZERS
      ) {
        const nearbyFruit = this.findFoodTarget(entity.position, 180, (particle) => particle.kind === 'fruit');
        const birthRate = dt * clamp(0.006 + entity.food * 0.012 + entity.energy * 0.012 + habitatMatch(localSample, 'basin') * 0.01 - habitatPenalty(localSample, 'wetland') * 0.006 + (nearbyFruit ? 0.008 : 0) - localDensity * 0.007, 0.001, 0.024);
        if (this.rng.next() <= birthRate) {
          const origin = nearbyFruit?.position ?? entity.position;
          const position = this.findNearbySpawnPoint(origin, 54, (terrain) => terrain.traversability > 0.24 && terrain.fertility > 0.34 && habitatMatch(terrain, 'basin') > 0.26 && habitatPenalty(terrain, 'wetland') < 0.5 && habitatPenalty(terrain, 'highland') < 0.54 && terrain.slope < 0.58);
          additions.push(this.createEntity('grazer', position));
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
        && counts.cluster + additions.filter((candidate) => candidate.type === 'cluster').length < MAX_CLUSTERS
      ) {
        const nearbyResidue = this.findResidueTarget(entity.position, 140);
        const birthRate = dt * clamp(0.006 + entity.memory * 0.012 + (nearbyResidue ? nearbyResidue.richness * 0.01 : 0) + habitatMatch(localSample, 'wetland') * 0.008 + habitatMatch(localSample, 'basin') * 0.005 - habitatPenalty(localSample, 'highland') * 0.01 - localDensity * 0.006, 0.001, 0.024);
        if (this.rng.next() <= birthRate) {
          const origin = nearbyResidue?.position ?? entity.position;
          const position = this.findNearbySpawnPoint(origin, 48, (sample) => sample.nutrient > 0.2 && sample.traversability > 0.1 && habitatPenalty(sample, 'highland') < 0.68 && sample.slope < 0.7);
          additions.push(this.createEntity('cluster', position));
          entity.reproductionCooldown = this.rng.range(22, 34);
          entity.food *= 0.72;
          entity.energy *= 0.84;
        }
      } else {
        continue;
      }

      entity.visualState = 'reproducing';
      entity.visualPulse = 0.8;
      this.emitBurst('birth', entity.position, 14 + entity.size, 0.34 + entity.hueShift * 0.05);
      const newborn = additions[additions.length - 1];
      if (newborn) {
        this.emitWorldEvent({ type: 'entityBorn', time: this.time, position: { ...newborn.position }, entityType: newborn.type, entityId: newborn.id });
      }
    }

    this.entities.push(...additions);
  }

  private updateEnergy(
    dt: number,
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number },
  ): void {
    const interactions = Math.max(1, localStats.interactions);
    const harmony = localStats.harmony / interactions;
    const stability = localStats.stability / interactions;
    const nutrientLift = localStats.nutrients / interactions;
    const gain = clamp(harmony * 0.24 + stability * 0.24 + nutrientLift * 0.22, 0, 1) * dt * 5.6;
    const loss = clamp(this.fields.filter((field) => field.tool !== 'observe').length * 0.03 + localStats.threat / interactions, 0, 1.2) * dt * 3.8;
    this.energy = clamp(this.energy + gain - loss, 0, ENERGY_MAX);
  }

  private computeStats(localStats?: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number }): GardenStats {
    const counts = this.countEntities();
    const interactions = Math.max(1, localStats?.interactions ?? this.entities.length);
    const harmony = clamp((localStats?.harmony ?? this.entities.reduce((sum, entity) => sum + entity.harmony, 0)) / interactions, 0, 1);
    const activity = clamp((localStats?.activity ?? this.entities.reduce((sum, entity) => sum + entity.activity, 0)) / interactions, 0, 1);
    const threat = clamp((localStats?.threat ?? counts.predator * 0.06) / interactions, 0, 1);
    const stability = clamp((localStats?.stability ?? this.entities.reduce((sum, entity) => sum + entity.stability, 0)) / interactions, 0, 1);
    const growth = clamp(this.entities.reduce((sum, entity) => sum + entity.growth, 0) / Math.max(1, this.entities.length), 0, 1);
    const richness = [counts.flocker > 0, counts.cluster > 0, counts.plant > 0, counts.grazer > 0].filter(Boolean).length / 4;
    const focus = clamp((localStats?.focus ?? 0) / Math.max(1, this.entities.length * 0.7), 0, 1);
    const nutrients = clamp((localStats?.nutrients ?? this.terrain.reduce((sum, cell) => sum + cell.nutrient, 0)) / Math.max(1, this.terrain.length), 0, 1);
    const fruit = clamp(((localStats?.fruit ?? this.particles.filter((particle) => particle.kind === 'fruit').length) / 18), 0, 1);
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
    };
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
    return this.worldField.sample(worldX, worldY, this.time, {
      residueInfluence: this.getResidueInfluence(worldX, worldY),
      modifiers: this.terrainModifiers,
      delta: (a, b) => this.delta(a, b),
    });
  }

  private getResidueInfluence(x: number, y: number): number {
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
    if (entity.type === 'plant') {
      const bloomHealth = clamp(entity.growth * 0.46 + entity.pollination * 0.28 + entity.energy * 0.16 + entity.food * 0.1, 0, 1);
      const ageWeight = clamp(entity.age / entity.lifeSpan, 0, 1);
      return clamp(ageWeight * 0.36 + bloomHealth * 0.64, 0, 1);
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
    if (entity.type === 'plant') {
      entity.trail = [];
      return;
    }
    entity.trail.unshift({ ...entity.position });
    const maxTrail = entity.type === 'cluster' ? 8 : entity.type === 'grazer' ? 7 : 6;
    if (entity.trail.length > maxTrail) entity.trail.length = maxTrail;
  }

  private findBloomTarget(position: Vec2): Entity | undefined {
    let best: Entity | undefined;
    let bestScore = -Infinity;
    this.forEachNearbyBucket(this.entityBuckets, position, 340, ENTITY_BUCKET_SIZE, ENTITY_BUCKET_COLS, ENTITY_BUCKET_ROWS, (candidate) => {
      if (candidate.type !== 'plant') return;
      const offset = this.delta(position, candidate.position);
      const dist = Math.hypot(offset.x, offset.y);
      if (dist > 340) return;
      const sample = this.sampleField(candidate.position.x, candidate.position.y);
      const score = (1 - dist / 340) * 0.54 + candidate.pollination * -0.24 + candidate.energy * 0.16 + candidate.growth * 0.2 + habitatMatch(sample, 'basin') * 0.16 + habitatMatch(sample, 'wetland') * 0.06 - habitatPenalty(sample, 'highland') * 0.14 + (candidate.stage === 'mature' ? 0.14 : 0);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    });
    return best;
  }

  private findResidueTarget(position: Vec2, radius = 260): Residue | undefined {
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
    let best: Entity | undefined;
    let bestScore = -Infinity;
    this.forEachNearbyBucket(this.entityBuckets, position, 260, ENTITY_BUCKET_SIZE, ENTITY_BUCKET_COLS, ENTITY_BUCKET_ROWS, (candidate) => {
      if (candidate.type !== 'plant') return;
      const offset = this.delta(position, candidate.position);
      const dist = Math.hypot(offset.x, offset.y);
      if (dist > 260) return;
      const edible = candidate.stage === 'mature' ? 0.18 : 0;
      const sample = this.sampleField(candidate.position.x, candidate.position.y);
      const score = (1 - dist / 260) * 0.44 + candidate.pollination * 0.22 + candidate.energy * 0.14 + candidate.growth * 0.1 + habitatMatch(sample, 'basin') * 0.18 - habitatPenalty(sample, 'wetland') * 0.12 - habitatPenalty(sample, 'highland') * 0.14 + edible;
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
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number },
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
      this.emitBurst('feed', entity.position, (entity.type === 'grazer' ? 12 : 10) + entity.size, 0.18 + entity.hueShift * 0.03);
      this.emitWorldEvent({ type: 'entityFed', time: this.time, position: { ...entity.position }, entityType: entity.type, entityId: entity.id, foodKind: particle.kind });
      particle.age = particle.duration;
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
    this.terrainModifiers.push({
      id: this.nextModifierId++,
      position: { ...position },
      radius,
      fertility,
      moisture,
      solidity,
      age: 0,
      duration,
    });
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
      if (falloff > 0.74 && this.rng.next() < 0.16 && entity.type !== 'plant') {
        this.handleDeath(entity);
        continue;
      }
      survivors.push(entity);
    }
    this.entities = survivors;
  }

  private countNearbyFood(position: Vec2, radius: number): number {
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
      { flocker: 0, cluster: 0, plant: 0, grazer: 0, predator: 0 } as Record<EntityType, number>,
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
      return clamp(sample.fertility * 0.34 + sample.nutrient * 0.18 + this.getHabitatSuitability(sample, 'basin') * 0.34 + sample.moisture * 0.08 - habitatPenalty(sample, 'highland') * 0.26, 0, 1);
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
