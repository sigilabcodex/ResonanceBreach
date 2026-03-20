import {
  ATTRACTOR_COUNT,
  BASE_TOOL_RADIUS,
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
  SOFT_BOUNDARY_MARGIN,
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
} from '../config';
import { Rng } from './random';
import type {
  Attractor,
  CameraState,
  Entity,
  EventBurst,
  FeedParticle,
  GardenStats,
  SimulationSnapshot,
  TerrainCell,
  ToolFeedback,
  ToolField,
  ToolState,
  Vec2,
} from './types';

const TWO_PI = Math.PI * 2;
const TERRAIN_SAMPLE_SPACING_X = WORLD_WIDTH / TERRAIN_SAMPLE_COLS;
const TERRAIN_SAMPLE_SPACING_Y = WORLD_HEIGHT / TERRAIN_SAMPLE_ROWS;
const TOOL_UNLOCK_SCHEDULE: Array<{ tool: ToolType; time: number; energy: number }> = [
  { tool: 'observe', time: 0, energy: 0 },
  { tool: 'grow', time: 0, energy: 0 },
  { tool: 'feed', time: 16, energy: 26 },
  { tool: 'repel', time: 34, energy: 34 },
  { tool: 'disrupt', time: 54, energy: 42 },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};
const fract = (value: number) => value - Math.floor(value);

interface FieldSample {
  terrain: TerrainType;
  fertility: number;
  stability: number;
  density: number;
  resonance: number;
  roughness: number;
  flow: Vec2;
  hue: number;
}

export class Simulation {
  private rng = new Rng(0xdecafbad);
  private entities: Entity[] = [];
  private terrain: TerrainCell[] = [];
  private attractors: Attractor[] = [];
  private fields: ToolField[] = [];
  private particles: FeedParticle[] = [];
  private bursts: EventBurst[] = [];
  private nextId = 1;
  private nextClusterId = 1;
  private nextFeedbackId = 1;
  private nextFieldId = 1;
  private nextParticleId = 1;
  private nextBurstId = 1;
  private time = 0;
  private timeScale = 1;
  private unlockedProgress = 0;
  private energy = ENERGY_START;
  private camera: CameraState = {
    center: { x: WORLD_WIDTH * 0.5, y: WORLD_HEIGHT * 0.5 },
    zoom: 1,
  };
  private tool: ToolState = {
    active: 'observe',
    unlocked: ['observe', 'grow'],
    pulse: 0,
    worldPosition: { x: WORLD_WIDTH * 0.5, y: WORLD_HEIGHT * 0.5 },
    radius: BASE_TOOL_RADIUS,
    strength: 0,
    visible: false,
    blocked: false,
  };
  private stats: GardenStats = {
    harmony: 0.5,
    activity: 0.3,
    threat: 0.12,
    growth: 0.32,
    energy: ENERGY_START / ENERGY_MAX,
    stability: 0.54,
    biodiversity: 0.5,
    focus: 0,
  };

  constructor() {
    this.reset();
  }

  reset(): void {
    this.rng = new Rng(0xdecafbad);
    this.entities = [];
    this.fields = [];
    this.particles = [];
    this.bursts = [];
    this.nextId = 1;
    this.nextClusterId = 1;
    this.nextFeedbackId = 1;
    this.nextFieldId = 1;
    this.nextParticleId = 1;
    this.nextBurstId = 1;
    this.time = 0;
    this.timeScale = 1;
    this.unlockedProgress = 0;
    this.energy = ENERGY_START;
    this.camera = {
      center: { x: WORLD_WIDTH * 0.5, y: WORLD_HEIGHT * 0.5 },
      zoom: 1,
    };
    this.tool = {
      active: 'observe',
      unlocked: ['observe', 'grow'],
      pulse: 0,
      worldPosition: { x: WORLD_WIDTH * 0.5, y: WORLD_HEIGHT * 0.5 },
      radius: TOOL_RADIUS.observe,
      strength: 0,
      visible: false,
      blocked: false,
    };
    this.attractors = this.createAttractors();
    this.terrain = this.createTerrainSamples();

    for (let i = 0; i < INITIAL_FLOCKER_COUNT; i += 1) this.entities.push(this.createEntity('flocker', this.randomTerrainPoint('fluid')));
    for (let i = 0; i < INITIAL_CLUSTER_COUNT; i += 1) this.entities.push(this.createEntity('cluster', this.randomTerrainPoint('dense')));
    for (let i = 0; i < INITIAL_PLANT_COUNT; i += 1) this.entities.push(this.createEntity('plant', this.randomTerrainPoint('dense')));
    for (let i = 0; i < INITIAL_PREDATOR_COUNT; i += 1) this.entities.push(this.createEntity('predator', this.randomTerrainPoint('fluid')));

    this.stats = this.computeStats();
  }

  setTool(type: ToolType): void {
    if (this.tool.unlocked.includes(type)) {
      this.tool.active = type;
      this.tool.radius = TOOL_RADIUS[type];
      this.tool.pulse = 1;
      this.tool.blocked = false;
      this.emitToolFeedback(type, this.tool.worldPosition, 0.45);
    }
  }

  setToolEngaged(active: boolean, x: number, y: number): void {
    this.tool.visible = active || (x >= 0 && y >= 0);
    this.tool.worldPosition.x = clamp(x, 0, WORLD_WIDTH);
    this.tool.worldPosition.y = clamp(y, 0, WORLD_HEIGHT);

    if (!active) return;
    this.deployToolField(this.tool.active, this.tool.worldPosition);
  }

  hoverTool(x: number, y: number): void {
    if (x < 0 || y < 0) {
      this.tool.visible = false;
      return;
    }
    this.tool.visible = true;
    this.tool.worldPosition.x = clamp(x, 0, WORLD_WIDTH);
    this.tool.worldPosition.y = clamp(y, 0, WORLD_HEIGHT);
  }

  setCamera(centerX: number, centerY: number, zoom: number): void {
    this.camera.center.x = clamp(centerX, 0, WORLD_WIDTH);
    this.camera.center.y = clamp(centerY, 0, WORLD_HEIGHT);
    this.camera.zoom = clamp(zoom, CAMERA_MIN_ZOOM, CAMERA_MAX_ZOOM);
  }

  setTimeScale(timeScale: number): void {
    this.timeScale = timeScale;
  }

  update(dt: number): void {
    this.time += dt;
    this.tool.pulse = Math.max(0, this.tool.pulse - dt * 0.7);
    this.tool.strength = lerp(this.tool.strength, this.fields.some((field) => field.tool === this.tool.active) ? 1 : 0.28, dt * 4.2);
    this.tool.blocked = false;

    this.unlockTools();
    this.updateAttractors(dt);
    this.terrain = this.createTerrainSamples();
    this.updateFields(dt);
    this.updateParticles(dt);
    this.updateBursts(dt);

    for (const entity of this.entities) {
      entity.age += dt;
      entity.pulse = Math.max(0, entity.pulse - dt * 0.7);
      entity.visualPulse = Math.max(0, entity.visualPulse - dt * 0.9);
      entity.reproductionCooldown = Math.max(0, entity.reproductionCooldown - dt);
      entity.stageProgress = clamp(entity.age / entity.lifeSpan, 0, 1);
      entity.stage = this.getStage(entity.stageProgress);
      if (entity.visualState !== 'dying' && entity.visualPulse <= 0.05) entity.visualState = 'idle';
    }

    const survivors: Entity[] = [];
    const localStats = { harmony: 0, activity: 0, threat: 0, stability: 0, interactions: 0, focus: 0 };

    for (let i = 0; i < this.entities.length; i += 1) {
      const entity = this.entities[i] as Entity;
      const sample = this.sampleField(entity.position.x, entity.position.y);
      const neighbors = this.getNeighbors(i, NEIGHBOR_RADIUS);
      this.applyBaseFieldForces(entity, sample, neighbors, dt, localStats);
      this.applyAttractorForces(entity, dt);
      this.applyToolFields(entity, dt, localStats);
      this.applyParticleSeeking(entity, dt);
      this.applyBoundary(entity, dt);
      this.updateEntity(entity, sample, neighbors, dt, localStats);
      if (this.shouldPersist(entity)) survivors.push(entity);
      else this.emitBurst('death', entity.position, 28 + entity.size * 1.2, 1.02 + entity.hueShift * 0.03);
    }

    this.entities = survivors;
    this.spawnEntities(dt);
    this.updateEnergy(dt, localStats);
    this.stats = this.computeStats(localStats);
    this.unlockedProgress = this.tool.unlocked.length / TOOL_UNLOCK_SCHEDULE.length;
  }

  getSnapshot(): SimulationSnapshot {
    return {
      entities: this.entities,
      terrain: this.terrain,
      attractors: this.attractors,
      fields: this.fields,
      particles: this.particles,
      bursts: this.bursts,
      stats: this.stats,
      tool: this.tool,
      camera: this.camera,
      time: this.time,
      timeScale: this.timeScale,
      unlockedProgress: this.unlockedProgress,
    };
  }

  private createAttractors(): Attractor[] {
    const attractors: Attractor[] = [];
    for (let i = 0; i < ATTRACTOR_COUNT; i += 1) {
      const angle = (i / ATTRACTOR_COUNT) * TWO_PI + this.rng.range(-0.35, 0.35);
      const radial = this.rng.range(240, 560);
      attractors.push({
        id: i + 1,
        position: {
          x: clamp(WORLD_WIDTH * 0.5 + Math.cos(angle) * radial + this.rng.range(-120, 120), 180, WORLD_WIDTH - 180),
          y: clamp(WORLD_HEIGHT * 0.5 + Math.sin(angle) * radial * 0.7 + this.rng.range(-120, 120), 180, WORLD_HEIGHT - 180),
        },
        strength: this.rng.range(0.55, 1.1),
        orbit: this.rng.range(-1, 1),
        radius: this.rng.range(180, 320),
        hue: this.rng.range(0.45, 0.75),
      });
    }
    return attractors;
  }

  private createTerrainSamples(): TerrainCell[] {
    const samples: TerrainCell[] = [];
    for (let row = 0; row < TERRAIN_SAMPLE_ROWS; row += 1) {
      for (let col = 0; col < TERRAIN_SAMPLE_COLS; col += 1) {
        const center = {
          x: (col + 0.5) * TERRAIN_SAMPLE_SPACING_X + Math.sin(this.time * 0.04 + row * 1.2) * 18,
          y: (row + 0.5) * TERRAIN_SAMPLE_SPACING_Y + Math.cos(this.time * 0.05 + col * 1.4) * 16,
        };
        const sample = this.sampleField(center.x, center.y);
        const height = this.sampleNoise(center.x * 0.0019, center.y * 0.0022, 1.2 + this.time * 0.02);
        samples.push({
          index: row * TERRAIN_SAMPLE_COLS + col,
          center,
          radius: Math.min(TERRAIN_SAMPLE_SPACING_X, TERRAIN_SAMPLE_SPACING_Y) * this.rng.range(0.82, 1.18),
          terrain: sample.terrain,
          density: sample.density,
          fertility: sample.fertility,
          stability: sample.stability,
          flow: sample.flow,
          resonance: sample.resonance,
          roughness: sample.roughness,
          height,
          hue: sample.hue,
        });
      }
    }
    return samples;
  }

  private createEntity(type: EntityType, position: Vec2): Entity {
    const baseSize = { flocker: 8, cluster: 12, plant: 7, predator: 13 }[type];
    const lifeSpan = { flocker: 90, cluster: 126, plant: 168, predator: 144 }[type];
    const tone = { flocker: 0.42, cluster: 0.58, plant: 0.32, predator: 0.74 }[type];
    const clusterId = type === 'cluster' ? this.nextClusterId++ : 0;
    return {
      id: this.nextId++,
      type,
      stage: 'birth',
      position: { ...position },
      velocity: this.randomVelocity(type === 'predator' ? 8 : type === 'flocker' ? 12 : 5),
      heading: this.rng.range(0, TWO_PI),
      size: baseSize,
      baseSize,
      energy: clamp(this.rng.range(0.4, 0.92), 0, 1.1),
      growth: this.rng.range(0.18, 0.52),
      resonance: this.rng.range(0.25, 0.8),
      harmony: this.rng.range(0.34, 0.78),
      stability: this.rng.range(0.35, 0.9),
      age: 0,
      lifeSpan: lifeSpan + this.rng.range(-18, 24),
      stageProgress: 0,
      reproductionCooldown: this.rng.range(4, 11),
      pulse: this.rng.range(0, 0.4),
      tone: clamp(tone + this.rng.range(-0.12, 0.12), 0, 1),
      shape: this.rng.range(0, 1),
      hueShift: this.rng.range(-0.22, 0.22),
      terrainBias: this.rng.range(-0.25, 0.25),
      clusterId,
      appetite: this.rng.range(0.2, 1),
      anchor: type === 'plant' ? { ...position } : undefined,
      visualState: 'idle',
      visualPulse: 0,
      boundaryFade: 1,
    };
  }

  private deployToolField(tool: ToolType, position: Vec2): void {
    if (tool !== 'observe') {
      const cost = TOOL_ENERGY_COST[tool];
      if (this.energy < cost) {
        this.tool.blocked = true;
        this.tool.pulse = 1;
        this.emitToolFeedback(tool, position, 0.3);
        return;
      }
      this.energy = Math.max(0, this.energy - cost);
    }

    const field: ToolField = {
      id: this.nextFieldId++,
      tool,
      position: { ...position },
      radius: TOOL_RADIUS[tool],
      strength: 1,
      duration: TOOL_DURATION[tool],
      age: 0,
      pulse: 1,
    };
    this.fields.push(field);
    this.tool.pulse = 1;
    this.tool.strength = 1;
    this.emitToolFeedback(tool, position, tool === 'observe' ? 0.45 : 0.84);

    if (tool === 'feed') {
      for (let i = 0; i < 18; i += 1) this.spawnFeedParticle(field, true);
    }
    if (tool === 'repel') this.emitBurst('feed', position, field.radius * 0.36, 0.96);
  }

  private updateAttractors(dt: number): void {
    for (const attractor of this.attractors) {
      const driftX = Math.sin(this.time * 0.05 + attractor.id * 1.1) * dt * 12;
      const driftY = Math.cos(this.time * 0.04 + attractor.id * 1.3) * dt * 10;
      attractor.position.x = clamp(attractor.position.x + driftX, 180, WORLD_WIDTH - 180);
      attractor.position.y = clamp(attractor.position.y + driftY, 180, WORLD_HEIGHT - 180);
      attractor.orbit = lerp(attractor.orbit, Math.sin(this.time * 0.1 + attractor.id) * 0.8, dt * 0.3);
    }
  }

  private updateFields(dt: number): void {
    const active: ToolField[] = [];
    for (const field of this.fields) {
      field.age += dt;
      field.pulse = Math.max(0, field.pulse - dt * 0.35);
      field.strength = clamp(1 - field.age / field.duration, 0, 1);
      if (field.tool === 'feed' && this.rng.next() < dt * 9) this.spawnFeedParticle(field, false);
      if (field.age < field.duration) active.push(field);
    }
    this.fields = active;
  }

  private updateParticles(dt: number): void {
    const nextParticles: FeedParticle[] = [];
    for (const particle of this.particles) {
      particle.age += dt;
      particle.position.x += particle.velocity.x * dt;
      particle.position.y += particle.velocity.y * dt;
      particle.velocity.x *= Math.pow(0.982, dt * 60);
      particle.velocity.y *= Math.pow(0.982, dt * 60);
      if (particle.age < particle.duration) nextParticles.push(particle);
    }
    this.particles = nextParticles;
  }

  private updateBursts(dt: number): void {
    this.bursts = this.bursts.filter((burst) => {
      burst.age += dt;
      return burst.age < burst.duration;
    });
  }

  private applyBaseFieldForces(
    entity: Entity,
    sample: FieldSample,
    neighbors: Entity[],
    dt: number,
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number },
  ): void {
    entity.resonance = clamp(entity.resonance + (sample.resonance - 0.45) * dt * 0.28, 0, 1.5);
    entity.stability = clamp(entity.stability + (sample.stability - 0.5) * dt * 0.22, 0, 1.35);
    entity.growth = clamp(entity.growth + (sample.fertility - 0.4) * dt * 0.16, 0, 1.7);
    entity.velocity.x += sample.flow.x * dt * (entity.type === 'flocker' ? 1.6 : entity.type === 'predator' ? 1.2 : 0.6);
    entity.velocity.y += sample.flow.y * dt * (entity.type === 'flocker' ? 1.6 : entity.type === 'predator' ? 1.2 : 0.6);

    if (neighbors.length === 0) return;

    let alignX = 0;
    let alignY = 0;
    let cohesionX = 0;
    let cohesionY = 0;
    let separationX = 0;
    let separationY = 0;
    let clusterPressure = 0;

    for (const other of neighbors) {
      const dx = other.position.x - entity.position.x;
      const dy = other.position.y - entity.position.y;
      const dist = Math.hypot(dx, dy) || 1;
      const proximity = clamp(1 - dist / NEIGHBOR_RADIUS, 0, 1);
      const resonance = this.computePairResonance(entity, other, proximity);
      const toneAffinity = 1 - Math.abs(entity.tone - other.tone);

      alignX += other.velocity.x * proximity;
      alignY += other.velocity.y * proximity;
      cohesionX += dx * proximity;
      cohesionY += dy * proximity;
      separationX -= (dx / dist) * proximity * proximity;
      separationY -= (dy / dist) * proximity * proximity;
      clusterPressure += proximity;

      entity.harmony = clamp(entity.harmony + (resonance.harmony - resonance.dissonance * 0.6) * dt * 0.18, 0, 1.25);
      entity.stability = clamp(entity.stability + (resonance.harmony - resonance.dissonance) * dt * 0.12, 0, 1.25);
      localStats.harmony += resonance.harmony;
      localStats.stability += entity.stability;
      localStats.activity += proximity;
      localStats.interactions += 1;

      if ((entity.type === 'predator' && other.type === 'flocker') || (entity.type === 'flocker' && other.type === 'predator')) {
        localStats.threat += proximity * 0.8;
      }
      if (resonance.harmony > 0.58 && toneAffinity > 0.56) entity.pulse = Math.max(entity.pulse, 0.35 + proximity * 0.5);
    }

    const inv = 1 / neighbors.length;
    const typeScale = entity.type === 'flocker' ? 1 : entity.type === 'cluster' ? 0.74 : entity.type === 'predator' ? 0.88 : 0.55;
    entity.velocity.x += (alignX * inv) * dt * 0.08 * typeScale;
    entity.velocity.y += (alignY * inv) * dt * 0.08 * typeScale;
    entity.velocity.x += (cohesionX * inv) * dt * (entity.type === 'cluster' ? 0.08 : 0.045);
    entity.velocity.y += (cohesionY * inv) * dt * (entity.type === 'cluster' ? 0.08 : 0.045);
    entity.velocity.x += separationX * dt * (entity.type === 'flocker' ? 34 : 24);
    entity.velocity.y += separationY * dt * (entity.type === 'flocker' ? 34 : 24);

    if (clusterPressure > 2.6) {
      entity.clusterId ||= this.nextClusterId++;
      entity.pulse = Math.max(entity.pulse, clamp(clusterPressure / 6, 0, 0.85));
    }
  }

  private applyAttractorForces(entity: Entity, dt: number): void {
    for (const attractor of this.attractors) {
      const dx = attractor.position.x - entity.position.x;
      const dy = attractor.position.y - entity.position.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist > attractor.radius * 2.4) continue;
      const falloff = clamp(1 - dist / (attractor.radius * 2.4), 0, 1);
      const nx = dx / dist;
      const ny = dy / dist;
      const tangentX = -ny;
      const tangentY = nx;
      const gravity = attractor.strength * falloff * (entity.type === 'plant' ? 18 : entity.type === 'cluster' ? 24 : 32);
      const orbit = attractor.orbit * falloff * (entity.type === 'plant' ? 11 : 24);
      entity.velocity.x += (nx * gravity + tangentX * orbit) * dt;
      entity.velocity.y += (ny * gravity + tangentY * orbit) * dt;
      entity.pulse = Math.max(entity.pulse, falloff * 0.25);
    }
  }

  private applyToolFields(
    entity: Entity,
    dt: number,
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number },
  ): void {
    for (const field of this.fields) {
      const dx = field.position.x - entity.position.x;
      const dy = field.position.y - entity.position.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist > field.radius) continue;
      const falloff = smoothstep(field.radius, 0, dist) * field.strength;
      const nx = dx / dist;
      const ny = dy / dist;

      if (field.tool === 'observe') {
        localStats.focus += falloff;
        entity.velocity.x *= 1 - dt * 0.18 * falloff;
        entity.velocity.y *= 1 - dt * 0.18 * falloff;
        entity.pulse = Math.max(entity.pulse, 0.3 * falloff);
        continue;
      }

      entity.pulse = Math.max(entity.pulse, 0.36 + falloff * 0.54);
      field.pulse = Math.max(field.pulse, falloff * 0.4);

      if (field.tool === 'grow') {
        const tangentX = -ny;
        const tangentY = nx;
        entity.velocity.x += (nx * 46 + tangentX * 12) * dt * falloff;
        entity.velocity.y += (ny * 46 + tangentY * 12) * dt * falloff;
        entity.growth = clamp(entity.growth + dt * 0.24 * falloff, 0, 1.8);
        entity.stability = clamp(entity.stability + dt * 0.16 * falloff, 0, 1.4);
        if (entity.type !== 'predator') entity.clusterId ||= this.nextClusterId++;
      } else if (field.tool === 'feed') {
        entity.energy = clamp(entity.energy + dt * 0.08 * falloff, 0, 1.5);
        entity.growth = clamp(entity.growth + dt * 0.06 * falloff, 0, 1.8);
      } else if (field.tool === 'repel') {
        entity.velocity.x -= nx * dt * 125 * (0.3 + falloff);
        entity.velocity.y -= ny * dt * 125 * (0.3 + falloff);
        entity.stability = clamp(entity.stability - dt * 0.08 * falloff, 0, 1.25);
      } else if (field.tool === 'disrupt') {
        const jitter = (1 - field.age / field.duration) * 40 * falloff;
        entity.velocity.x += this.rng.range(-jitter, jitter) * dt;
        entity.velocity.y += this.rng.range(-jitter, jitter) * dt;
        entity.harmony = lerp(entity.harmony, 0.24, dt * 0.3 * falloff);
        entity.stability = clamp(entity.stability - dt * 0.22 * falloff, 0, 1.2);
        if (entity.type === 'cluster' && falloff > 0.35) entity.clusterId = 0;
      }
    }
  }

  private applyParticleSeeking(entity: Entity, dt: number): void {
    if (entity.type === 'plant') return;
    let closest: FeedParticle | undefined;
    let bestDistance = Infinity;
    for (const particle of this.particles) {
      const dx = particle.position.x - entity.position.x;
      const dy = particle.position.y - entity.position.y;
      const dist = Math.hypot(dx, dy);
      if (dist < bestDistance && dist < 160) {
        bestDistance = dist;
        closest = particle;
      }
    }
    if (!closest) return;

    const dx = closest.position.x - entity.position.x;
    const dy = closest.position.y - entity.position.y;
    const dist = Math.hypot(dx, dy) || 1;
    const pull = smoothstep(160, 0, dist) * (entity.type === 'predator' ? 42 : 32);
    entity.velocity.x += (dx / dist) * pull * dt;
    entity.velocity.y += (dy / dist) * pull * dt;

    if (dist < entity.size + 8) {
      entity.energy = clamp(entity.energy + closest.energy * 0.34, 0, 1.55);
      entity.growth = clamp(entity.growth + closest.energy * 0.22, 0, 1.85);
      entity.pulse = Math.max(entity.pulse, 0.95);
      entity.visualState = 'feeding';
      entity.visualPulse = 0.95;
      this.emitBurst('feed', entity.position, 14 + entity.size, 0.14 + entity.hueShift * 0.05);
      closest.age = closest.duration;
    }
  }

  private applyBoundary(entity: Entity, dt: number): void {
    const left = smoothstep(SOFT_BOUNDARY_MARGIN, 0, entity.position.x);
    const right = smoothstep(WORLD_WIDTH - SOFT_BOUNDARY_MARGIN, WORLD_WIDTH, entity.position.x);
    const top = smoothstep(SOFT_BOUNDARY_MARGIN, 0, entity.position.y);
    const bottom = smoothstep(WORLD_HEIGHT - SOFT_BOUNDARY_MARGIN, WORLD_HEIGHT, entity.position.y);
    const inwardX = left - right;
    const inwardY = top - bottom;
    const boundaryForce = Math.max(Math.abs(inwardX), Math.abs(inwardY));
    if (boundaryForce > 0) {
      entity.velocity.x += inwardX * dt * 92;
      entity.velocity.y += inwardY * dt * 92;
      entity.velocity.x *= 1 - dt * 0.35 * boundaryForce;
      entity.velocity.y *= 1 - dt * 0.35 * boundaryForce;
    }
    entity.boundaryFade = clamp(1 - boundaryForce * 0.55, 0.2, 1);
  }

  private updateEntity(
    entity: Entity,
    sample: FieldSample,
    neighbors: Entity[],
    dt: number,
    localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number },
  ): void {
    const wanderTheta = this.time * (0.14 + entity.appetite * 0.09) + entity.id * 0.41;
    entity.velocity.x += Math.cos(wanderTheta) * dt * (entity.type === 'flocker' ? 6 : entity.type === 'predator' ? 8 : 3);
    entity.velocity.y += Math.sin(wanderTheta * 1.2) * dt * (entity.type === 'flocker' ? 6 : entity.type === 'predator' ? 8 : 3);

    if (entity.type === 'predator') {
      const prey = neighbors.find((candidate) => candidate.type === 'flocker');
      if (prey) {
        const dx = prey.position.x - entity.position.x;
        const dy = prey.position.y - entity.position.y;
        const dist = Math.hypot(dx, dy) || 1;
        entity.velocity.x += (dx / dist) * dt * 52;
        entity.velocity.y += (dy / dist) * dt * 52;
        localStats.threat += clamp(1 - dist / NEIGHBOR_RADIUS, 0, 1);
        if (dist < entity.size + prey.size + 4) {
          prey.energy -= dt * (0.3 + entity.appetite * 0.12);
          prey.visualState = 'dying';
          prey.visualPulse = 0.8;
          entity.energy = clamp(entity.energy + dt * 0.34, 0, 1.55);
          entity.pulse = Math.max(entity.pulse, 1);
        }
      }
    }

    if (entity.type === 'plant') {
      const anchor = entity.anchor ?? entity.position;
      entity.velocity.x += (anchor.x - entity.position.x) * dt * 0.02;
      entity.velocity.y += (anchor.y - entity.position.y) * dt * 0.02;
      if (sample.terrain === 'hard') entity.energy -= dt * 0.2;
    }

    const damping = entity.type === 'cluster' ? 0.92 : entity.type === 'plant' ? 0.89 : entity.type === 'predator' ? 0.95 : 0.935;
    entity.velocity.x *= Math.pow(damping, dt * 60);
    entity.velocity.y *= Math.pow(damping, dt * 60);

    const focusField = this.fields.some((field) => field.tool === 'observe' && Math.hypot(entity.position.x - field.position.x, entity.position.y - field.position.y) < field.radius);
    const focusScale = focusField ? 0.76 : 1;
    entity.position.x = clamp(entity.position.x + entity.velocity.x * dt * focusScale, 0, WORLD_WIDTH);
    entity.position.y = clamp(entity.position.y + entity.velocity.y * dt * focusScale, 0, WORLD_HEIGHT);
    entity.heading = Math.atan2(entity.velocity.y || 0.001, entity.velocity.x || 0.001);

    const maturityBonus = entity.stage === 'mature' ? 0.07 : entity.stage === 'growth' ? 0.04 : entity.stage === 'decay' ? -0.1 : -0.02;
    entity.growth = clamp(entity.growth + dt * (maturityBonus + sample.fertility * 0.08 - (1 - sample.stability) * 0.08), 0, 1.8);
    entity.energy = clamp(entity.energy + dt * (sample.stability * 0.04 - 0.03 - (entity.type === 'predator' ? 0.03 : 0)), 0, 1.55);
    entity.size = clamp(entity.baseSize * (0.7 + entity.growth * 0.5 + entity.stageProgress * 0.28), entity.baseSize * 0.5, entity.baseSize * 2.3);

    if (entity.energy < 0.22 || entity.stage === 'decay') {
      entity.visualState = 'dying';
      entity.visualPulse = Math.max(entity.visualPulse, 0.4);
    }
  }

  private shouldPersist(entity: Entity): boolean {
    if (entity.energy <= 0.03) return false;
    if (entity.stageProgress >= 1 && entity.energy < 0.24) return false;
    if (entity.stability <= 0.04 && entity.visualState === 'dying') return false;
    return true;
  }

  private spawnEntities(dt: number): void {
    const counts = this.countEntities();
    for (const entity of this.entities) {
      if (entity.stage !== 'mature' || entity.reproductionCooldown > 0 || entity.energy < 0.7 || entity.stability < 0.5) continue;
      const localDensity = this.getNeighborsByEntity(entity, 120).length;
      const birthRate = dt * (0.009 + clamp(0.2 - localDensity * 0.018, 0.01, 0.18) + entity.growth * 0.006);
      if (this.rng.next() > birthRate) continue;

      if (entity.type === 'flocker' && counts.flocker < MAX_FLOCKERS) {
        this.entities.push(this.createEntity('flocker', this.scatterAround(entity.position, 28)));
        counts.flocker += 1;
      } else if (entity.type === 'cluster' && counts.cluster < MAX_CLUSTERS) {
        const child = this.createEntity('cluster', this.scatterAround(entity.position, 34));
        child.clusterId = entity.clusterId || child.clusterId;
        this.entities.push(child);
        counts.cluster += 1;
      } else if (entity.type === 'plant' && counts.plant < MAX_PLANTS) {
        this.entities.push(this.createEntity('plant', this.scatterAround(entity.position, 26)));
        counts.plant += 1;
      } else if (entity.type === 'predator' && counts.predator < MAX_PREDATORS && counts.flocker > 24) {
        this.entities.push(this.createEntity('predator', this.scatterAround(entity.position, 44)));
        counts.predator += 1;
      } else {
        continue;
      }

      entity.reproductionCooldown = this.rng.range(14, 28);
      entity.energy *= 0.82;
      entity.visualState = 'reproducing';
      entity.visualPulse = 1;
      entity.pulse = 1;
      this.emitBurst('birth', entity.position, 18 + entity.size, 0.34 + entity.hueShift * 0.05);
    }
  }

  private updateEnergy(dt: number, localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number }): void {
    const interactions = Math.max(1, localStats.interactions);
    const harmony = localStats.harmony / interactions;
    const stability = localStats.stability / interactions;
    const activeFields = this.fields.filter((field) => field.tool !== 'observe').length;
    const gain = clamp(harmony * 0.38 + stability * 0.22 + this.entities.filter((entity) => entity.type === 'plant').length / 180, 0, 1) * dt * 5;
    const loss = clamp(localStats.threat / interactions + activeFields * 0.035, 0, 1.8) * dt * 4.2;
    this.energy = clamp(this.energy + gain - loss, 0, ENERGY_MAX);
  }

  private computeStats(localStats?: { harmony: number; activity: number; threat: number; stability: number; interactions: number; focus: number }): GardenStats {
    const counts = this.countEntities();
    const interactions = Math.max(1, localStats?.interactions ?? this.entities.length);
    const harmony = clamp((localStats?.harmony ?? this.entities.reduce((sum, entity) => sum + entity.harmony, 0)) / interactions, 0, 1);
    const activity = clamp(((localStats?.activity ?? this.entities.length * 0.18) / interactions) + this.fields.length * 0.04, 0, 1);
    const threat = clamp((localStats?.threat ?? counts.predator * 0.12) / interactions, 0, 1);
    const stability = clamp((localStats?.stability ?? this.entities.reduce((sum, entity) => sum + entity.stability, 0)) / interactions, 0, 1);
    const growth = clamp(this.entities.reduce((sum, entity) => sum + entity.growth, 0) / Math.max(1, this.entities.length), 0, 1);
    const richness = [counts.flocker > 0, counts.cluster > 0, counts.plant > 0, counts.predator > 0].filter(Boolean).length / 4;
    const focus = clamp((localStats?.focus ?? 0) / Math.max(1, this.entities.length * 0.55), 0, 1);
    return {
      harmony,
      activity,
      threat,
      growth,
      stability,
      biodiversity: clamp(richness * 0.62 + this.entities.length / 180, 0, 1),
      energy: this.energy / ENERGY_MAX,
      focus,
    };
  }

  private unlockTools(): void {
    for (const unlock of TOOL_UNLOCK_SCHEDULE) {
      if (this.time >= unlock.time && this.energy >= unlock.energy && !this.tool.unlocked.includes(unlock.tool)) {
        this.tool.unlocked = [...this.tool.unlocked, unlock.tool];
        this.tool.pulse = 1;
        this.emitToolFeedback(unlock.tool, this.tool.worldPosition, 0.6);
      }
    }
  }

  private sampleField(x: number, y: number): FieldSample {
    const driftX = Math.sin(this.time * 0.04) * 110;
    const driftY = Math.cos(this.time * 0.035) * 90;
    const nx = (x + driftX) * 0.0016;
    const ny = (y + driftY) * 0.0018;
    const moisture = this.sampleNoise(nx * 0.9, ny * 1.12, 1.7);
    const fertility = this.sampleNoise(nx * 1.1, ny * 0.94, 3.6);
    const height = this.sampleNoise(nx * 0.84, ny * 1.24, 0.2);
    const roughness = this.sampleNoise(nx * 1.62, ny * 1.44, 7.2);
    const density = clamp(0.18 + fertility * 0.42 + moisture * 0.2 - roughness * 0.14, 0, 1);
    const resonance = clamp(0.24 + moisture * 0.34 + fertility * 0.24 - roughness * 0.12, 0, 1);
    const stability = clamp(0.24 + fertility * 0.3 + (1 - roughness) * 0.28 + height * 0.08, 0, 1);
    const hardWeight = smoothstep(0.64, 0.92, height) * smoothstep(0.52, 0.88, roughness);
    const denseWeight = smoothstep(0.46, 0.9, fertility + moisture * 0.32) * (1 - hardWeight * 0.6);
    const terrain: TerrainType = hardWeight > 0.58 ? 'hard' : denseWeight > 0.42 ? 'dense' : 'fluid';
    const angle = this.sampleNoise(nx * 0.72, ny * 0.72, 5.4 + this.time * 0.012) * TWO_PI * 2;
    const flowStrength = terrain === 'fluid' ? 24 + moisture * 22 : terrain === 'dense' ? 8 + fertility * 8 : 4 + roughness * 4;
    const hue = clamp(0.45 + moisture * 0.12 - hardWeight * 0.08 + denseWeight * 0.05, 0, 1);
    return {
      terrain,
      fertility: terrain === 'hard' ? fertility * 0.3 : fertility,
      stability: terrain === 'hard' ? stability * 0.56 : terrain === 'dense' ? clamp(stability + 0.12, 0, 1) : stability,
      density: terrain === 'hard' ? 0.8 + roughness * 0.2 : density,
      resonance,
      roughness,
      flow: { x: Math.cos(angle) * flowStrength, y: Math.sin(angle) * flowStrength },
      hue,
    };
  }

  private computePairResonance(a: Entity, b: Entity, proximity: number) {
    const sample = this.sampleField((a.position.x + b.position.x) * 0.5, (a.position.y + b.position.y) * 0.5);
    const phase = (Math.cos((a.heading - b.heading) * 0.7) + 1) * 0.5;
    const tone = 1 - Math.abs(a.tone - b.tone);
    const terrainBonus = sample.terrain === 'fluid' ? 0.05 : sample.terrain === 'dense' ? 0.12 : -0.08;
    const harmony = clamp(phase * 0.28 + tone * 0.3 + sample.resonance * 0.26 + proximity * 0.28 + terrainBonus, 0, 1);
    const dissonance = clamp((1 - tone) * 0.3 + (1 - sample.stability) * 0.42 + (sample.terrain === 'hard' ? 0.16 : 0) + (a.type === 'predator' || b.type === 'predator' ? 0.12 : 0), 0, 1);
    return { harmony, dissonance };
  }

  private getStage(progress: number): LifecycleStage {
    if (progress < 0.18) return 'birth';
    if (progress < 0.46) return 'growth';
    if (progress < 0.82) return 'mature';
    return 'decay';
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
      duration: type === 'death' ? 1.4 : 1.1,
      hue,
    });
  }

  private spawnFeedParticle(field: ToolField, initial: boolean): void {
    const angle = this.rng.range(0, TWO_PI);
    const distance = this.rng.range(field.radius * 0.08, field.radius * (initial ? 0.8 : 0.58));
    const outward = initial ? this.rng.range(32, 72) : this.rng.range(8, 36);
    this.particles.push({
      id: this.nextParticleId++,
      position: {
        x: clamp(field.position.x + Math.cos(angle) * distance, 0, WORLD_WIDTH),
        y: clamp(field.position.y + Math.sin(angle) * distance, 0, WORLD_HEIGHT),
      },
      velocity: {
        x: Math.cos(angle) * outward + this.rng.range(-8, 8),
        y: Math.sin(angle) * outward + this.rng.range(-8, 8),
      },
      energy: this.rng.range(0.26, 0.42),
      age: 0,
      duration: this.rng.range(1.8, 3.1),
    });
  }

  private getNeighbors(index: number, radius: number): Entity[] {
    const neighbors: Entity[] = [];
    const entity = this.entities[index] as Entity;
    const radiusSq = radius * radius;
    for (let i = 0; i < this.entities.length; i += 1) {
      if (i === index) continue;
      const other = this.entities[i] as Entity;
      const dx = other.position.x - entity.position.x;
      const dy = other.position.y - entity.position.y;
      if (dx * dx + dy * dy <= radiusSq) neighbors.push(other);
    }
    return neighbors;
  }

  private getNeighborsByEntity(entity: Entity, radius: number): Entity[] {
    const radiusSq = radius * radius;
    return this.entities.filter((other) => other.id !== entity.id && (other.position.x - entity.position.x) ** 2 + (other.position.y - entity.position.y) ** 2 <= radiusSq);
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
    return { x: this.rng.range(72, WORLD_WIDTH - 72), y: this.rng.range(72, WORLD_HEIGHT - 72) };
  }

  private randomVelocity(scale: number): Vec2 {
    const angle = this.rng.range(0, TWO_PI);
    return { x: Math.cos(angle) * this.rng.range(scale * 0.35, scale), y: Math.sin(angle) * this.rng.range(scale * 0.35, scale) };
  }

  private scatterAround(center: Vec2, radius: number): Vec2 {
    const angle = this.rng.range(0, TWO_PI);
    const distance = this.rng.range(radius * 0.2, radius);
    return {
      x: clamp(center.x + Math.cos(angle) * distance, 0, WORLD_WIDTH),
      y: clamp(center.y + Math.sin(angle) * distance, 0, WORLD_HEIGHT),
    };
  }

  private sampleNoise(x: number, y: number, seed: number): number {
    return clamp(
      0.5
        + Math.sin(x * 1.31 + seed * 4.7) * 0.22
        + Math.cos(y * 1.17 - seed * 2.3) * 0.18
        + Math.sin((x + y) * 0.71 + seed * 1.7) * 0.14
        + fract(Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453) * 0.16,
      0,
      1,
    );
  }
}
