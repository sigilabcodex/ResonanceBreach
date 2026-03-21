import {
  ATTRACTOR_COUNT,
  CAMERA_MAX_ZOOM,
  CAMERA_MIN_ZOOM,
  ENERGY_MAX,
  ENERGY_START,
  INITIAL_CLUSTER_COUNT,
  INITIAL_FLOCKER_COUNT,
  INITIAL_PLANT_COUNT,
  INITIAL_PREDATOR_COUNT,
  MAX_CLUSTERS,
  MAX_FLOCKERS,
  MAX_PLANTS,
  MAX_PREDATORS,
  NEIGHBOR_RADIUS,
  TERRAIN_SAMPLE_COLS,
  TERRAIN_SAMPLE_ROWS,
  TOOL_DURATION,
  TOOL_ENERGY_COST,
  TOOL_RADIUS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type EntityType,
  type LifecycleStage,
  type TerrainType,
  type ToolType,
} from '../../config';
import { Rng } from '../random';
import { WorldEventQueue, buildNotifications, type WorldEventInput } from '../events';
import { createDefaultCamera, createDefaultStats, createDefaultToolState, createWorldState } from '../world';
import type { FieldSample, TerrainModifier } from '../fields/types';
import type {
  Attractor,
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
const TERRAIN_SAMPLE_SPACING_X = WORLD_WIDTH / TERRAIN_SAMPLE_COLS;
const TERRAIN_SAMPLE_SPACING_Y = WORLD_HEIGHT / TERRAIN_SAMPLE_ROWS;
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
  private nextId = 1;
  private nextClusterId = 1;
  private nextFeedbackId = 1;
  private nextFieldId = 1;
  private nextParticleId = 1;
  private nextBurstId = 1;
  private nextResidueId = 1;
  private nextModifierId = 1;
  private observeHolding = false;

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
    this.time = 0;
    this.timeScale = 1;
    this.unlockedProgress = 0;
    this.energy = ENERGY_START;
    this.observeHolding = false;
    this.camera = createDefaultCamera();
    this.tool = createDefaultToolState();
    this.stats = createDefaultStats();
    this.world.events = [];
    this.world.notifications = { recent: [] };
    this.attractors = this.createAttractors();

    for (let i = 0; i < INITIAL_PLANT_COUNT; i += 1) this.entities.push(this.createEntity('plant', this.randomTerrainPoint('fertile')));
    for (let i = 0; i < INITIAL_FLOCKER_COUNT; i += 1) this.entities.push(this.createEntity('flocker', this.randomTerrainPoint('water')));
    for (let i = 0; i < INITIAL_CLUSTER_COUNT; i += 1) this.entities.push(this.createEntity('cluster', this.randomTerrainPoint('fertile')));
    for (let i = 0; i < INITIAL_PREDATOR_COUNT; i += 1) this.entities.push(this.createEntity('predator', this.randomTerrainPoint('water')));
    this.seedInitialNutrients();

    this.terrain = this.createTerrainSamples();
    this.stats = this.computeStats();
  }

  setTool(type: ToolType): void {
    if (this.tool.unlocked.includes(type)) {
      this.tool.active = type;
      this.tool.radius = TOOL_RADIUS[type];
      this.tool.pulse = 1;
      this.tool.blocked = false;
      if (type !== 'observe') this.removeObserveField();
      this.emitToolFeedback(type, this.tool.worldPosition, 0.38);
    }
  }

  setToolEngaged(active: boolean, x: number, y: number): void {
    this.tool.visible = active || (x >= 0 && y >= 0);
    this.tool.worldPosition.x = wrap(x, WORLD_WIDTH);
    this.tool.worldPosition.y = wrap(y, WORLD_HEIGHT);

    if (this.tool.active === 'observe') {
      this.observeHolding = active;
      if (active) this.ensureObserveField();
      else this.removeObserveField();
      return;
    }

    if (!active) return;
    this.deployToolField(this.tool.active, this.tool.worldPosition);
  }

  hoverTool(x: number, y: number): void {
    if (x < 0 || y < 0) {
      this.tool.visible = false;
      if (!this.observeHolding) this.removeObserveField();
      return;
    }
    this.tool.visible = true;
    this.tool.worldPosition.x = wrap(x, WORLD_WIDTH);
    this.tool.worldPosition.y = wrap(y, WORLD_HEIGHT);
    if (this.observeHolding && this.tool.active === 'observe') this.ensureObserveField();
  }

  setCamera(centerX: number, centerY: number, zoom: number): void {
    this.camera.center.x = wrap(centerX, WORLD_WIDTH);
    this.camera.center.y = wrap(centerY, WORLD_HEIGHT);
    this.camera.zoom = clamp(zoom, CAMERA_MIN_ZOOM, CAMERA_MAX_ZOOM);
  }

  setTimeScale(timeScale: number): void {
    this.timeScale = timeScale;
  }

  update(dt: number): void {
    this.time += dt;
    this.tool.pulse = Math.max(0, this.tool.pulse - dt * 0.22);
    this.tool.strength = lerp(this.tool.strength, this.fields.some((field) => field.tool === this.tool.active) ? 1 : 0.12, dt * 2.4);
    this.tool.blocked = false;

    this.unlockTools();
    this.updateAttractors(dt);
    this.updateTerrainModifiers(dt);
    this.updateFields(dt);
    this.updateParticles(dt);
    this.updateResidues(dt);
    this.updateBursts(dt);
    this.terrain = this.createTerrainSamples();

    const survivors: Entity[] = [];
    const localStats = { harmony: 0, activity: 0, threat: 0, stability: 0, interactions: 0, focus: 0, nutrients: 0, fruit: 0 };

    for (let i = 0; i < this.entities.length; i += 1) {
      const entity = this.entities[i] as Entity;
      entity.age += dt;
      entity.pulse = Math.max(0, entity.pulse - dt * 0.28);
      entity.visualPulse = Math.max(0, entity.visualPulse - dt * 0.44);
      entity.reproductionCooldown = Math.max(0, entity.reproductionCooldown - dt);
      entity.fruitCooldown = Math.max(0, entity.fruitCooldown - dt);
      entity.stageProgress = clamp(entity.age / entity.lifeSpan, 0, 1);
      entity.stage = this.getStage(entity.stageProgress);
      if (entity.visualPulse <= 0.03 && entity.visualState !== 'dying') entity.visualState = 'idle';

      const sample = this.sampleField(entity.position.x, entity.position.y);
      const neighbors = this.getNeighbors(i, NEIGHBOR_RADIUS);
      const focusWeight = this.getObserveWeight(entity.position);
      this.applyEntityBehavior(entity, sample, neighbors, dt, focusWeight, localStats);

      if (this.shouldPersist(entity)) survivors.push(entity);
      else this.handleDeath(entity);
    }

    this.entities = survivors;
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

  private delta(a: Vec2, b: Vec2): Vec2 {
    return {
      x: wrapDelta(a.x, b.x, WORLD_WIDTH),
      y: wrapDelta(a.y, b.y, WORLD_HEIGHT),
    };
  }

  private createAttractors(): Attractor[] {
    const attractors: Attractor[] = [];
    for (let i = 0; i < ATTRACTOR_COUNT; i += 1) {
      const angle = (i / ATTRACTOR_COUNT) * TWO_PI + this.rng.range(-0.25, 0.25);
      const radial = this.rng.range(420, 880);
      attractors.push({
        id: i + 1,
        position: {
          x: wrap(WORLD_WIDTH * 0.5 + Math.cos(angle) * radial, WORLD_WIDTH),
          y: wrap(WORLD_HEIGHT * 0.5 + Math.sin(angle) * radial * 0.72, WORLD_HEIGHT),
        },
        strength: this.rng.range(0.18, 0.42),
        orbit: this.rng.range(-0.28, 0.28),
        radius: this.rng.range(420, 760),
        hue: this.rng.range(0.35, 0.72),
      });
    }
    return attractors;
  }

  private createTerrainSamples(): TerrainCell[] {
    const samples: TerrainCell[] = [];
    for (let row = 0; row < TERRAIN_SAMPLE_ROWS; row += 1) {
      for (let col = 0; col < TERRAIN_SAMPLE_COLS; col += 1) {
        const baseX = (col + 0.5) * TERRAIN_SAMPLE_SPACING_X;
        const baseY = (row + 0.5) * TERRAIN_SAMPLE_SPACING_Y;
        const jitterX = (this.sampleNoise(baseX * 0.0016, baseY * 0.0013, 13.7) - 0.5) * TERRAIN_SAMPLE_SPACING_X * 0.82;
        const jitterY = (this.sampleNoise(baseX * 0.0014, baseY * 0.0017, 21.4) - 0.5) * TERRAIN_SAMPLE_SPACING_Y * 0.78;
        const center = {
          x: wrap(baseX + jitterX, WORLD_WIDTH),
          y: wrap(baseY + jitterY, WORLD_HEIGHT),
        };
        const sample = this.sampleField(center.x, center.y);
        const radiusNoise = this.sampleNoise(center.x * 0.0007, center.y * 0.0007, 4.2);
        const height = this.sampleNoise(center.x * 0.0011, center.y * 0.0012, 1.4);
        samples.push({
          index: row * TERRAIN_SAMPLE_COLS + col,
          center,
          radius: Math.min(TERRAIN_SAMPLE_SPACING_X, TERRAIN_SAMPLE_SPACING_Y) * (0.94 + radiusNoise * 0.34),
          terrain: sample.terrain,
          density: sample.density,
          fertility: sample.fertility,
          stability: sample.stability,
          flow: sample.flow,
          resonance: sample.resonance,
          roughness: sample.roughness,
          height,
          hue: sample.hue,
          nutrient: sample.nutrient,
        });
      }
    }
    return samples;
  }

  private createEntity(type: EntityType, position: Vec2): Entity {
    const baseSize = { flocker: 7, cluster: 10, plant: 7, predator: 11 }[type];
    const lifeSpan = { flocker: 110, cluster: 144, plant: 190, predator: 150 }[type];
    const tone = { flocker: 0.44, cluster: 0.56, plant: 0.32, predator: 0.74 }[type];
    const clusterId = type === 'cluster' ? this.nextClusterId++ : 0;
    return {
      id: this.nextId++,
      type,
      stage: 'birth',
      position: { ...position },
      velocity: type === 'plant' ? { x: 0, y: 0 } : this.randomVelocity(type === 'predator' ? 4.5 : type === 'cluster' ? 2.5 : 3.8),
      heading: this.rng.range(0, TWO_PI),
      size: baseSize,
      baseSize,
      energy: clamp(this.rng.range(0.62, 0.94), 0, 1.2),
      growth: this.rng.range(0.3, 0.64),
      resonance: this.rng.range(0.28, 0.74),
      harmony: this.rng.range(0.42, 0.78),
      stability: this.rng.range(0.5, 0.92),
      age: 0,
      lifeSpan: lifeSpan + this.rng.range(-16, 18),
      stageProgress: 0,
      reproductionCooldown: this.rng.range(10, 22),
      pulse: 0,
      tone: clamp(tone + this.rng.range(-0.08, 0.08), 0, 1),
      shape: this.rng.range(0, 1),
      hueShift: this.rng.range(-0.18, 0.18),
      terrainBias: this.rng.range(-0.16, 0.16),
      clusterId,
      appetite: this.rng.range(0.24, 0.92),
      anchor: type === 'plant' ? { ...position } : undefined,
      visualState: 'idle',
      visualPulse: 0,
      boundaryFade: 1,
      activity: this.rng.range(0.15, 0.42),
      activityBias: this.rng.range(0, 1),
      food: this.rng.range(0.34, 0.58),
      fruitCooldown: this.rng.range(2.5, 6.5),
    };
  }

  private seedInitialNutrients(): void {
    for (let i = 0; i < 16; i += 1) {
      this.spawnParticle(this.randomTerrainPoint(i % 3 === 0 ? 'fertile' : 'water'), 130 + this.rng.range(0, 80), 'feed', true);
    }

    for (let i = 0; i < 8; i += 1) {
      this.spawnResidue(this.randomTerrainPoint('fertile'), this.rng.range(0.34, 0.58));
    }
  }

  private ensureObserveField(): void {
    let field = this.fields.find((candidate) => candidate.tool === 'observe');
    if (!field) {
      field = {
        id: this.nextFieldId++,
        tool: 'observe',
        position: { ...this.tool.worldPosition },
        radius: TOOL_RADIUS.observe,
        strength: 1,
        duration: TOOL_DURATION.observe,
        age: 0,
        pulse: 0.6,
      };
      this.fields.push(field);
      this.emitToolFeedback('observe', this.tool.worldPosition, 0.26);
    }
    field.position = { ...this.tool.worldPosition };
    field.age = 0;
    field.strength = 1;
    field.pulse = Math.max(field.pulse, 0.18);
  }

  private removeObserveField(): void {
    this.fields = this.fields.filter((field) => field.tool !== 'observe');
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
      if (field.tool === 'observe') {
        field.age += dt;
        field.pulse = lerp(field.pulse, 0.12, dt * 0.8);
        active.push(field);
        continue;
      }

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
      residue.nutrient = clamp(residue.nutrient - dt * 0.02, 0, 1.2);
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
    const nearbyFood = this.countNearbyFood(entity.position, 160);
    const targetActivity = entity.type === 'plant'
      ? 0.14 + sample.fertility * 0.18 + sample.nutrient * 0.22 + focusWeight * 0.12
      : 0.08 + activityPulse * 0.24 + nearbyFood * 0.16 + focusWeight * 0.2;
    entity.activity = lerp(entity.activity, clamp(targetActivity, 0.06, 1), dt * 0.7);
    entity.resonance = clamp(lerp(entity.resonance, 0.34 + sample.resonance * 0.7, dt * 0.12), 0, 1.3);
    entity.stability = clamp(lerp(entity.stability, 0.3 + sample.stability * 0.9, dt * 0.08), 0, 1.2);
    entity.growth = clamp(entity.growth + dt * (sample.fertility * 0.048 + sample.nutrient * 0.07 - 0.008), 0, 1.7);
    entity.food = clamp(entity.food - dt * (entity.type === 'plant' ? 0.0044 : 0.01 + entity.activity * 0.015), 0, 1.6);
    entity.energy = clamp(entity.energy - dt * (entity.type === 'plant' ? 0.0022 : 0.006 + entity.activity * 0.012), 0, 1.6);

    this.applyToolFields(entity, dt, focusWeight, localStats);
    entity.boundaryFade = lerp(entity.boundaryFade, sample.terrain === 'solid' ? 0.74 : sample.terrain === 'dense' ? 0.88 : 1, dt * 0.24);

    if (entity.type === 'plant') this.updatePlant(entity, sample, dt, localStats);
    else this.updateCreature(entity, sample, neighbors, dt, localStats);

    entity.size = clamp(entity.baseSize * (0.76 + entity.growth * 0.36 + entity.stageProgress * 0.18), entity.baseSize * 0.6, entity.baseSize * 1.9);
    entity.heading = Math.atan2(entity.velocity.y || 0.001, entity.velocity.x || 0.001);
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
    entity.velocity.x = lerp(entity.velocity.x, anchorDelta.x * 0.03 + sample.flow.x * 0.05, dt * 0.6);
    entity.velocity.y = lerp(entity.velocity.y, anchorDelta.y * 0.03 + sample.flow.y * 0.05, dt * 0.6);
    entity.position = this.wrapPosition({
      x: entity.position.x + entity.velocity.x * dt,
      y: entity.position.y + entity.velocity.y * dt,
    });

    entity.energy = clamp(entity.energy + dt * (sample.fertility * 0.075 + sample.nutrient * 0.14 - (sample.terrain === 'solid' ? 0.06 : 0)), 0, 1.4);
    entity.food = clamp(entity.food + dt * (sample.nutrient * 0.1 + sample.fertility * 0.05), 0, 1.5);
    entity.harmony = clamp(lerp(entity.harmony, 0.48 + sample.resonance * 0.42, dt * 0.08), 0, 1.2);

    if (entity.stage === 'mature' && entity.fruitCooldown <= 0 && entity.energy > 0.58 && sample.terrain !== 'solid') {
      const fruitCount = sample.nutrient > 0.32 ? 2 : 1;
      for (let i = 0; i < fruitCount; i += 1) {
        this.spawnParticle(entity.position, entity.size * 2.2, 'fruit', false);
        localStats.fruit += 1;
      }
      entity.fruitCooldown = this.rng.range(6, 12);
      entity.energy *= 0.94;
      entity.visualState = 'feeding';
      entity.visualPulse = 0.24;
    }
  }

  private updateCreature(
    entity: Entity,
    sample: FieldSample,
    neighbors: Entity[],
    dt: number,
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number },
  ): void {
    let nearestFood: FeedParticle | undefined;
    let nearestFoodDistance = Infinity;

    for (const particle of this.particles) {
      const offset = this.delta(entity.position, particle.position);
      const dist = Math.hypot(offset.x, offset.y);
      if (dist < nearestFoodDistance && dist < (particle.kind === 'feed' ? 240 : 180)) {
        nearestFood = particle;
        nearestFoodDistance = dist;
      }
    }

    let cohesionX = 0;
    let cohesionY = 0;
    let separationX = 0;
    let separationY = 0;
    let neighborCount = 0;

    for (const other of neighbors) {
      if (other.type === 'plant') continue;
      const offset = this.delta(entity.position, other.position);
      const dist = Math.hypot(offset.x, offset.y) || 1;
      const proximity = clamp(1 - dist / NEIGHBOR_RADIUS, 0, 1);
      if (proximity <= 0) continue;
      neighborCount += 1;
      cohesionX += offset.x * proximity;
      cohesionY += offset.y * proximity;
      separationX -= (offset.x / dist) * proximity * proximity;
      separationY -= (offset.y / dist) * proximity * proximity;
      const pair = this.computePairResonance(entity, other, proximity);
      entity.harmony = clamp(entity.harmony + (pair.harmony - pair.dissonance * 0.25) * dt * 0.08, 0, 1.2);
      entity.stability = clamp(entity.stability + (pair.harmony - pair.dissonance * 0.2) * dt * 0.05, 0, 1.2);
      if (entity.type === 'predator' && other.type !== 'predator') localStats.threat += proximity * 0.2;
    }

    const wanderTheta = this.time * (0.018 + entity.activityBias * 0.012) + entity.id * 0.5;
    const wander = entity.type === 'predator' ? 1.8 : entity.type === 'cluster' ? 0.8 : 1.2;
    entity.velocity.x += Math.cos(wanderTheta) * dt * wander * entity.activity;
    entity.velocity.y += Math.sin(wanderTheta * 0.9) * dt * wander * entity.activity;
    const currentLift = entity.type === 'cluster' ? 0.12 : 0.2;
    entity.velocity.x += sample.flow.x * dt * currentLift * (0.45 + entity.activity);
    entity.velocity.y += sample.flow.y * dt * currentLift * (0.45 + entity.activity);

    if (neighborCount > 0) {
      const inv = 1 / neighborCount;
      entity.velocity.x += cohesionX * inv * dt * (entity.type === 'cluster' ? 0.04 : 0.018);
      entity.velocity.y += cohesionY * inv * dt * (entity.type === 'cluster' ? 0.04 : 0.018);
      entity.velocity.x += separationX * dt * (entity.type === 'predator' ? 8 : 11);
      entity.velocity.y += separationY * dt * (entity.type === 'predator' ? 8 : 11);
    }

    for (const attractor of this.attractors) {
      const offset = this.delta(entity.position, attractor.position);
      const dist = Math.hypot(offset.x, offset.y) || 1;
      if (dist > attractor.radius) continue;
      const falloff = smoothstep(attractor.radius, 0, dist);
      const nx = offset.x / dist;
      const ny = offset.y / dist;
      const tangentX = -ny;
      const tangentY = nx;
      entity.velocity.x += (nx * attractor.strength * 4.6 + tangentX * attractor.orbit * 4.2) * dt * falloff;
      entity.velocity.y += (ny * attractor.strength * 4.6 + tangentY * attractor.orbit * 4.2) * dt * falloff;
    }

    if (nearestFood) {
      const offset = this.delta(entity.position, nearestFood.position);
      const dist = Math.hypot(offset.x, offset.y) || 1;
      const pull = smoothstep(nearestFood.kind === 'feed' ? 240 : 180, 0, dist) * (nearestFood.kind === 'feed' ? 18 : 12);
      entity.velocity.x += (offset.x / dist) * pull * dt * (0.6 + entity.activity);
      entity.velocity.y += (offset.y / dist) * pull * dt * (0.6 + entity.activity);

      if (dist < entity.size + nearestFood.radius + 5) {
        const gain = nearestFood.kind === 'feed' ? 0.32 : 0.22;
        entity.energy = clamp(entity.energy + nearestFood.energy * gain, 0, 1.55);
        entity.growth = clamp(entity.growth + nearestFood.energy * (gain * 0.8), 0, 1.8);
        entity.food = clamp(entity.food + nearestFood.energy * 0.7, 0, 1.6);
        entity.visualState = 'feeding';
        entity.visualPulse = 0.7;
        entity.pulse = 0.28;
        this.emitBurst('feed', entity.position, 10 + entity.size, 0.18 + entity.hueShift * 0.03);
        this.emitWorldEvent({ type: 'entityFed', time: this.time, position: { ...entity.position }, entityType: entity.type, entityId: entity.id, foodKind: nearestFood.kind });
        nearestFood.age = nearestFood.duration;
        localStats.fruit += nearestFood.kind === 'fruit' ? 1 : 1.4;
      }
    }

    if (sample.terrain === 'solid') {
      entity.velocity.x -= sample.flow.x * dt * 0.08;
      entity.velocity.y -= sample.flow.y * dt * 0.08;
      entity.energy -= dt * 0.024;
      entity.stability = clamp(entity.stability - dt * 0.04, 0, 1.2);
    } else if (sample.terrain === 'dense') {
      entity.velocity.x *= Math.pow(0.9, dt * 60);
      entity.velocity.y *= Math.pow(0.9, dt * 60);
      entity.energy = clamp(entity.energy - dt * 0.008, 0, 1.5);
      entity.stability = clamp(entity.stability + dt * 0.014, 0, 1.2);
    } else if (sample.terrain === 'fertile') {
      entity.energy = clamp(entity.energy + dt * 0.016, 0, 1.5);
    }

    const damping = entity.type === 'cluster' ? 0.978 : entity.type === 'predator' ? 0.982 : 0.974;
    entity.velocity.x *= Math.pow(damping, dt * 60);
    entity.velocity.y *= Math.pow(damping, dt * 60);
    const moveScale = 0.3 + entity.activity * 0.7;
    entity.position = this.wrapPosition({
      x: entity.position.x + entity.velocity.x * dt * moveScale,
      y: entity.position.y + entity.velocity.y * dt * moveScale,
    });
  }

  private applyToolFields(
    entity: Entity,
    dt: number,
    focusWeight: number,
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number; nutrients: number; fruit: number },
  ): void {
    for (const field of this.fields) {
      const offset = this.delta(entity.position, field.position);
      const dist = Math.hypot(offset.x, offset.y) || 1;
      if (dist > field.radius) continue;
      const falloff = smoothstep(field.radius, 0, dist) * Math.max(field.strength, 0.15);
      const nx = offset.x / dist;
      const ny = offset.y / dist;

      if (field.tool === 'observe') {
        entity.velocity.x *= 1 - dt * 0.08 * falloff;
        entity.velocity.y *= 1 - dt * 0.08 * falloff;
        entity.activity = clamp(entity.activity + dt * 0.08 * falloff, 0, 1);
        localStats.focus += focusWeight;
        continue;
      }

      entity.pulse = Math.max(entity.pulse, 0.12 + falloff * 0.18);
      field.pulse = Math.max(field.pulse, falloff * 0.14);

      if (field.tool === 'grow') {
        entity.velocity.x += nx * dt * 9 * falloff;
        entity.velocity.y += ny * dt * 9 * falloff;
        if (entity.type === 'plant') {
          entity.energy = clamp(entity.energy + dt * 0.08 * falloff, 0, 1.5);
          entity.growth = clamp(entity.growth + dt * 0.1 * falloff, 0, 1.8);
        } else {
          entity.stability = clamp(entity.stability + dt * 0.05 * falloff, 0, 1.2);
        }
        this.seedTerrain(field.position, field.radius * 0.8, 0.08 * dt, 0.04 * dt, -0.02 * dt, 2.8);
      } else if (field.tool === 'feed') {
        if (entity.type !== 'plant') entity.activity = clamp(entity.activity + dt * 0.14 * falloff, 0, 1);
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
    if (entity.energy <= 0.012 || entity.food <= 0.012) return false;
    if (entity.stageProgress >= 1 && entity.energy < 0.18) return false;
    if (entity.type !== 'plant' && entity.stability <= 0.04) return false;
    return true;
  }

  private handleDeath(entity: Entity): void {
    this.spawnResidue(entity.position, clamp(0.32 + entity.growth * 0.32 + entity.energy * 0.18, 0.2, 1));
    this.emitBurst('death', entity.position, 18 + entity.size * 1.4, 0.88 + entity.hueShift * 0.03);
    this.emitWorldEvent({ type: 'entityDied', time: this.time, position: { ...entity.position }, entityType: entity.type, entityId: entity.id });
  }

  private spawnEntities(dt: number): void {
    const counts = this.countEntities();
    const additions: Entity[] = [];

    for (const entity of this.entities) {
      if (entity.stage !== 'mature' || entity.reproductionCooldown > 0 || entity.food < 0.72 || entity.energy < 0.56) continue;
      const localDensity = this.getNeighborsByEntity(entity, 140).length;
      const birthRate = dt * clamp(0.005 + (0.18 - localDensity * 0.012) + entity.activity * 0.006, 0.001, 0.05);
      if (this.rng.next() > birthRate) continue;

      if (entity.type === 'plant' && counts.plant + additions.filter((candidate) => candidate.type === 'plant').length < MAX_PLANTS) {
        additions.push(this.createEntity('plant', this.scatterAround(entity.position, 42)));
      } else if (entity.type === 'flocker' && counts.flocker + additions.filter((candidate) => candidate.type === 'flocker').length < MAX_FLOCKERS) {
        additions.push(this.createEntity('flocker', this.scatterAround(entity.position, 56)));
      } else if (entity.type === 'cluster' && counts.cluster + additions.filter((candidate) => candidate.type === 'cluster').length < MAX_CLUSTERS) {
        additions.push(this.createEntity('cluster', this.scatterAround(entity.position, 52)));
      } else if (entity.type === 'predator' && counts.predator + additions.filter((candidate) => candidate.type === 'predator').length < MAX_PREDATORS) {
        additions.push(this.createEntity('predator', this.scatterAround(entity.position, 64)));
      } else {
        continue;
      }

      entity.reproductionCooldown = this.rng.range(18, 30);
      entity.food *= 0.6;
      entity.energy *= 0.84;
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
    const richness = [counts.flocker > 0, counts.cluster > 0, counts.plant > 0, counts.predator > 0].filter(Boolean).length / 4;
    const focus = clamp((localStats?.focus ?? 0) / Math.max(1, this.entities.length * 0.7), 0, 1);
    const nutrients = clamp((localStats?.nutrients ?? this.terrain.reduce((sum, cell) => sum + cell.nutrient, 0)) / Math.max(1, this.terrain.length), 0, 1);
    const fruit = clamp(((localStats?.fruit ?? this.particles.filter((particle) => particle.kind === 'fruit').length) / 18), 0, 1);
    return {
      harmony,
      activity,
      threat,
      growth,
      stability,
      biodiversity: clamp(richness * 0.66 + this.entities.length / 120, 0, 1),
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
    const driftX = Math.sin(this.time * 0.0035) * 220;
    const driftY = Math.cos(this.time * 0.003) * 170;
    const nx = (worldX + driftX) * 0.00054;
    const ny = (worldY + driftY) * 0.00058;
    const ridgeWarp = this.sampleNoise(nx * 0.44, ny * 0.4, 12.8) - 0.5;
    const flowWarp = this.sampleNoise(nx * 0.36 + ridgeWarp * 0.8, ny * 0.34 - ridgeWarp * 0.6, 15.1) - 0.5;
    const warpedX = nx + ridgeWarp * 0.32 + flowWarp * 0.14;
    const warpedY = ny - ridgeWarp * 0.24 + flowWarp * 0.18;
    let moisture = this.sampleNoise(warpedX * 0.92, warpedY * 1.06, 1.2);
    let fertility = this.sampleNoise(warpedX * 1.08, warpedY * 0.82, 3.2);
    let height = this.sampleNoise(warpedX * 0.72, warpedY * 0.78, 0.3);
    const roughness = this.sampleNoise(warpedX * 1.18, warpedY * 1.14, 6.8);
    const densityBand = this.sampleNoise(warpedX * 0.86, warpedY * 0.94, 9.4);
    const contourField = this.sampleNoise(warpedX * 0.58 + flowWarp * 0.2, warpedY * 0.6 - ridgeWarp * 0.22, 18.4);

    for (const modifier of this.terrainModifiers) {
      const offset = this.delta({ x: worldX, y: worldY }, modifier.position);
      const dist = Math.hypot(offset.x, offset.y);
      if (dist > modifier.radius) continue;
      const influence = smoothstep(modifier.radius, 0, dist) * (1 - modifier.age / modifier.duration);
      fertility = clamp(fertility + modifier.fertility * influence, 0, 1);
      moisture = clamp(moisture + modifier.moisture * influence, 0, 1);
      height = clamp(height + modifier.solidity * influence, 0, 1);
    }

    const residueInfluence = this.getResidueInfluence(worldX, worldY);
    fertility = clamp(fertility + residueInfluence * 0.18, 0, 1);
    moisture = clamp(moisture + residueInfluence * 0.08, 0, 1);

    const basin = smoothstep(0.58, 0.16, height + moisture * 0.08 - contourField * 0.04);
    const ridge = smoothstep(0.66, 0.92, height + contourField * 0.08) * smoothstep(0.5, 0.88, roughness + contourField * 0.06);
    const denseWeight = smoothstep(0.54, 0.8, densityBand * 0.68 + roughness * 0.4 + height * 0.2 + contourField * 0.12) * (1 - ridge * 0.9);
    const fertileWeight = smoothstep(0.42, 0.88, fertility + moisture * 0.18 + residueInfluence * 0.36 + contourField * 0.08 - denseWeight * 0.14) * (1 - ridge * 0.82);
    const terrain: TerrainType = ridge > 0.6 ? 'solid' : denseWeight > 0.54 ? 'dense' : fertileWeight > 0.46 ? 'fertile' : 'water';
    const angle = this.sampleNoise(warpedX * 0.48 + basin * 0.4 + flowWarp * 0.24, warpedY * 0.52 + ridge * 0.18 - ridgeWarp * 0.16, 5.1 + this.time * 0.0009) * TWO_PI * 2;
    const currentSweep = this.sampleNoise(warpedX * 0.22, warpedY * 0.24, 11.4) - 0.5;
    const globalDrift = {
      x: Math.cos(this.time * 0.005 + currentSweep) * 10,
      y: Math.sin(this.time * 0.0045 - currentSweep) * 8,
    };
    const flowStrength = terrain === 'water'
      ? 14 + basin * 16 + moisture * 8
      : terrain === 'fertile'
        ? 6 + fertility * 4
        : terrain === 'dense'
          ? 2.5 + roughness * 2
          : 0.8 + roughness * 1.2;
    const nutrient = clamp(residueInfluence * 0.85 + fertility * 0.42 + moisture * 0.08 + contourField * 0.08 + (terrain === 'fertile' ? 0.22 : terrain === 'water' ? 0.04 : 0), 0, 1);
    const density = clamp(0.18 + fertility * 0.22 + moisture * 0.18 + nutrient * 0.1 + denseWeight * 0.24 - ridge * 0.06, 0, 1);
    const resonance = clamp(0.26 + moisture * 0.26 + fertility * 0.18 + nutrient * 0.18 - roughness * 0.08 - denseWeight * 0.06, 0, 1);
    const stability = clamp(0.38 + fertility * 0.18 + (1 - roughness) * 0.18 + nutrient * 0.18 + denseWeight * 0.12 - ridge * 0.07, 0, 1);
    const hue = clamp(
      terrain === 'water'
        ? 0.5 + moisture * 0.12
        : terrain === 'fertile'
          ? 0.28 + fertility * 0.1
          : terrain === 'dense'
            ? 0.58 + denseWeight * 0.08
            : 0.72 + roughness * 0.04,
      0,
      1,
    );

    return {
      terrain,
      fertility: terrain === 'solid' ? fertility * 0.16 : terrain === 'dense' ? fertility * 0.46 : terrain === 'water' ? fertility * 0.78 : clamp(fertility + 0.06, 0, 1),
      stability,
      density,
      resonance,
      roughness,
      nutrient,
      flow: { x: Math.cos(angle) * flowStrength + globalDrift.x, y: Math.sin(angle) * flowStrength + globalDrift.y },
      hue,
    };
  }

  private getResidueInfluence(x: number, y: number): number {
    let value = 0;
    for (const residue of this.residues) {
      const offset = this.delta({ x, y }, residue.position);
      const dist = Math.hypot(offset.x, offset.y);
      if (dist > residue.radius) continue;
      value += smoothstep(residue.radius, 0, dist) * residue.nutrient;
    }
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
    if (progress < 0.18) return 'birth';
    if (progress < 0.5) return 'growth';
    if (progress < 0.82) return 'mature';
    return 'decay';
  }

  private getObserveWeight(position: Vec2): number {
    const field = this.fields.find((candidate) => candidate.tool === 'observe');
    if (!field) return 0;
    const offset = this.delta(position, field.position);
    const dist = Math.hypot(offset.x, offset.y);
    if (dist > field.radius) return 0;
    return smoothstep(field.radius, 0, dist);
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

  private spawnParticle(origin: Vec2, spread: number, kind: FeedParticle['kind'], initial: boolean): void {
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
      duration: this.rng.range(kind === 'feed' ? 3.4 : 8, kind === 'feed' ? 5.6 : 12),
      radius: kind === 'feed' ? this.rng.range(2.4, 4.2) : this.rng.range(1.8, 3.2),
    });
  }

  private spawnResidue(position: Vec2, nutrient: number): void {
    this.residues.push({
      id: this.nextResidueId++,
      position: { ...position },
      nutrient,
      age: 0,
      duration: this.rng.range(24, 38),
      radius: this.rng.range(90, 140),
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
    for (const particle of this.particles) {
      const offset = this.delta(position, particle.position);
      const dx = offset.x;
      const dy = offset.y;
      if (dx * dx + dy * dy <= radius * radius) total += particle.kind === 'feed' ? 1.4 : 1;
    }
    return clamp(total / 6, 0, 1);
  }

  private getNeighbors(index: number, radius: number): Entity[] {
    const neighbors: Entity[] = [];
    const entity = this.entities[index] as Entity;
    const radiusSq = radius * radius;
    for (let i = 0; i < this.entities.length; i += 1) {
      if (i === index) continue;
      const other = this.entities[i] as Entity;
      const offset = this.delta(entity.position, other.position);
      const dx = offset.x;
      const dy = offset.y;
      if (dx * dx + dy * dy <= radiusSq) neighbors.push(other);
    }
    return neighbors;
  }

  private getNeighborsByEntity(entity: Entity, radius: number): Entity[] {
    const radiusSq = radius * radius;
    return this.entities.filter((other) => {
      if (other.id === entity.id) return false;
      const offset = this.delta(entity.position, other.position);
      return offset.x ** 2 + offset.y ** 2 <= radiusSq;
    });
  }

  private countEntities(): Record<EntityType, number> {
    return this.entities.reduce(
      (acc, entity) => {
        acc[entity.type] += 1;
        return acc;
      },
      { flocker: 0, cluster: 0, plant: 0, predator: 0 } as Record<EntityType, number>,
    );
  }

  private randomTerrainPoint(preferred: TerrainType): Vec2 {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const point = this.randomPoint();
      if (this.sampleField(point.x, point.y).terrain === preferred) return point;
    }
    return this.randomPoint();
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
