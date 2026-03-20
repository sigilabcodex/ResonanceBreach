import {
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
  TOOL_ENERGY_COST,
  TOOL_RADIUS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  ZONE_GRID_COLS,
  ZONE_GRID_ROWS,
  type EntityType,
  type LifecycleStage,
  type TerrainType,
  type ToolType,
} from '../config';
import { Rng } from './random';
import type { CameraState, Entity, GardenStats, SimulationSnapshot, TerrainCell, ToolFeedback, ToolState, Vec2 } from './types';

const TWO_PI = Math.PI * 2;
const CELL_WIDTH = WORLD_WIDTH / ZONE_GRID_COLS;
const CELL_HEIGHT = WORLD_HEIGHT / ZONE_GRID_ROWS;
const TOOL_UNLOCK_SCHEDULE: Array<{ tool: ToolType; time: number; energy: number }> = [
  { tool: 'observe', time: 0, energy: 0 },
  { tool: 'grow', time: 0, energy: 0 },
  { tool: 'feed', time: 20, energy: 14 },
  { tool: 'repel', time: 38, energy: 26 },
  { tool: 'disrupt', time: 58, energy: 42 },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};
const fract = (value: number) => value - Math.floor(value);

export class Simulation {
  private rng = new Rng(0xdecafbad);
  private entities: Entity[] = [];
  private terrain: TerrainCell[] = [];
  private nextId = 1;
  private nextClusterId = 1;
  private nextFeedbackId = 1;
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
    radius: TOOL_RADIUS,
    strength: 0,
    visible: false,
    blocked: false,
  };
  private stats: GardenStats = {
    harmony: 0.5,
    activity: 0.25,
    threat: 0.1,
    growth: 0.3,
    energy: ENERGY_START / ENERGY_MAX,
    stability: 0.5,
    biodiversity: 0.5,
  };

  constructor() {
    this.reset();
  }

  reset(): void {
    this.rng = new Rng(0xdecafbad);
    this.entities = [];
    this.terrain = this.createTerrain();
    this.nextId = 1;
    this.nextClusterId = 1;
    this.nextFeedbackId = 1;
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
      radius: TOOL_RADIUS,
      strength: 0,
      visible: false,
      blocked: false,
    };

    for (let i = 0; i < INITIAL_FLOCKER_COUNT; i += 1) this.entities.push(this.createEntity('flocker', this.randomTerrainPoint('fluid')));
    for (let i = 0; i < INITIAL_CLUSTER_COUNT; i += 1) this.entities.push(this.createEntity('cluster', this.randomTerrainPoint('dense')));
    for (let i = 0; i < INITIAL_PLANT_COUNT; i += 1) this.entities.push(this.createEntity('plant', this.randomTerrainPoint('dense')));
    for (let i = 0; i < INITIAL_PREDATOR_COUNT; i += 1) this.entities.push(this.createEntity('predator', this.randomTerrainPoint('fluid')));

    this.stats = this.computeStats();
  }

  setTool(type: ToolType): void {
    if (this.tool.unlocked.includes(type)) {
      this.tool.active = type;
      this.tool.pulse = 1;
      this.tool.blocked = false;
      this.emitToolFeedback(type, this.tool.worldPosition, 0.45);
    }
  }

  setToolEngaged(active: boolean, x: number, y: number): void {
    this.tool.visible = active;
    this.tool.worldPosition.x = clamp(x, 0, WORLD_WIDTH);
    this.tool.worldPosition.y = clamp(y, 0, WORLD_HEIGHT);
    if (active) {
      this.tool.strength = 1;
      this.tool.pulse = 1;
    }
  }

  hoverTool(x: number, y: number): void {
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
    this.tool.strength = this.tool.visible ? 1 : Math.max(0, this.tool.strength - dt * 2.5);
    this.tool.pulse = Math.max(0, this.tool.pulse - dt * 0.9);
    this.tool.blocked = false;

    this.unlockTools();

    const localStats = {
      harmony: 0,
      activity: 0,
      threat: 0,
      stability: 0,
      interactions: 0,
      stablePairs: 0,
    };

    for (const entity of this.entities) {
      entity.age += dt;
      entity.pulse = Math.max(0, entity.pulse - dt * 0.8);
      entity.reproductionCooldown = Math.max(0, entity.reproductionCooldown - dt);
      entity.stageProgress = clamp(entity.age / entity.lifeSpan, 0, 1);
      entity.stage = this.getStage(entity.stageProgress);
    }

    for (let i = 0; i < this.entities.length; i += 1) {
      const a = this.entities[i];
      for (let j = i + 1; j < this.entities.length; j += 1) {
        const b = this.entities[j];
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > NEIGHBOR_RADIUS * NEIGHBOR_RADIUS) continue;
        const dist = Math.sqrt(distSq) || 1;
        const nx = dx / dist;
        const ny = dy / dist;
        const proximity = 1 - dist / NEIGHBOR_RADIUS;
        const resonance = this.computePairResonance(a, b, proximity);
        const force = (resonance.harmony - resonance.dissonance) * proximity;

        if (a.type === 'flocker' && b.type === 'flocker') {
          const flockPull = force * 36;
          a.velocity.x -= nx * flockPull * dt;
          a.velocity.y -= ny * flockPull * dt;
          b.velocity.x += nx * flockPull * dt;
          b.velocity.y += ny * flockPull * dt;
          const alignment = 0.035 * proximity;
          a.velocity.x = lerp(a.velocity.x, b.velocity.x, alignment);
          a.velocity.y = lerp(a.velocity.y, b.velocity.y, alignment);
          b.velocity.x = lerp(b.velocity.x, a.velocity.x, alignment);
          b.velocity.y = lerp(b.velocity.y, a.velocity.y, alignment);
        }

        if (a.type === 'cluster' || b.type === 'cluster') {
          const clusterForce = force > 0 ? force * 28 : force * 14;
          a.velocity.x -= nx * clusterForce * dt;
          a.velocity.y -= ny * clusterForce * dt;
          b.velocity.x += nx * clusterForce * dt;
          b.velocity.y += ny * clusterForce * dt;
          if (resonance.harmony > 0.58) {
            const clusterId = a.type === 'cluster' ? a.clusterId : b.clusterId;
            a.clusterId = clusterId || a.clusterId;
            b.clusterId = clusterId || b.clusterId;
          }
        }

        if ((a.type === 'predator' && b.type === 'flocker') || (a.type === 'flocker' && b.type === 'predator')) {
          const predator = a.type === 'predator' ? a : b;
          const prey = predator === a ? b : a;
          predator.velocity.x += nx * (predator === a ? 1 : -1) * proximity * dt * 74;
          predator.velocity.y += ny * (predator === a ? 1 : -1) * proximity * dt * 74;
          prey.velocity.x -= nx * (predator === a ? 1 : -1) * proximity * dt * 92;
          prey.velocity.y -= ny * (predator === a ? 1 : -1) * proximity * dt * 92;
          localStats.threat += proximity * 0.8;
          if (dist < predator.size + prey.size + 6) {
            prey.energy -= dt * (0.24 + predator.appetite * 0.1);
            predator.energy = clamp(predator.energy + dt * 0.3, 0, 1.35);
            predator.pulse = Math.max(predator.pulse, 0.9);
          }
        }

        if ((a.type === 'plant' && b.type === 'cluster') || (a.type === 'cluster' && b.type === 'plant')) {
          const host = a.type === 'cluster' ? a : b;
          const plant = a.type === 'plant' ? a : b;
          if (resonance.harmony > 0.52) {
            host.energy = clamp(host.energy + dt * 0.08 * proximity, 0, 1.4);
            plant.stability = clamp(plant.stability + dt * 0.12 * proximity, 0, 1.2);
            plant.anchor = { ...host.position };
            plant.pulse = Math.max(plant.pulse, 0.6 * proximity);
          }
        }

        a.harmony = clamp(a.harmony + (resonance.harmony - resonance.dissonance * 0.4) * dt * 0.45, 0, 1.2);
        b.harmony = clamp(b.harmony + (resonance.harmony - resonance.dissonance * 0.4) * dt * 0.45, 0, 1.2);
        a.stability = clamp(a.stability + (resonance.harmony - resonance.dissonance) * dt * 0.25, 0, 1.2);
        b.stability = clamp(b.stability + (resonance.harmony - resonance.dissonance) * dt * 0.25, 0, 1.2);
        if (resonance.harmony > 0.56) {
          a.pulse = Math.max(a.pulse, resonance.harmony * 0.8);
          b.pulse = Math.max(b.pulse, resonance.harmony * 0.8);
          localStats.stablePairs += 1;
        }
        localStats.harmony += resonance.harmony;
        localStats.stability += clamp(a.stability + b.stability, 0, 2) * 0.25;
        localStats.activity += proximity;
        localStats.interactions += 1;
      }
    }

    let toolEnergyUsed = 0;
    let plantSpawnBudget = 0;
    const survivors: Entity[] = [];

    for (const entity of this.entities) {
      const cell = this.getCellAt(entity.position.x, entity.position.y);
      this.applyTerrain(entity, cell, dt);
      toolEnergyUsed += this.applyTool(entity, dt);
      plantSpawnBudget += entity.type === 'plant' && cell.terrain === 'dense' ? cell.fertility * dt : 0;
      this.updateEntity(entity, cell, dt);
      if (this.shouldPersist(entity, cell)) survivors.push(entity);
    }

    this.entities = survivors;
    this.spawnEntities(dt, localStats.stablePairs, plantSpawnBudget);
    this.updateEnergy(dt, localStats, toolEnergyUsed);
    this.stats = this.computeStats(localStats);
    this.unlockedProgress = this.tool.unlocked.length / TOOL_UNLOCK_SCHEDULE.length;
  }

  getSnapshot(): SimulationSnapshot {
    return {
      entities: this.entities,
      terrain: this.terrain,
      stats: this.stats,
      tool: this.tool,
      camera: this.camera,
      time: this.time,
      timeScale: this.timeScale,
      unlockedProgress: this.unlockedProgress,
    };
  }

  private createTerrain(): TerrainCell[] {
    const cells: TerrainCell[] = [];
    for (let row = 0; row < ZONE_GRID_ROWS; row += 1) {
      for (let col = 0; col < ZONE_GRID_COLS; col += 1) {
        const center = { x: (col + 0.5) * CELL_WIDTH, y: (row + 0.5) * CELL_HEIGHT };
        const height = this.sampleNoise(center.x * 0.0028, center.y * 0.0032, 0.17);
        const moisture = this.sampleNoise(center.x * 0.0035, center.y * 0.0031, 1.7);
        const fertility = this.sampleNoise(center.x * 0.0042, center.y * 0.0038, 3.6);
        const obstacle = this.sampleNoise(center.x * 0.0051, center.y * 0.0049, 7.4);
        let terrain: TerrainType = 'fluid';
        if (height > 0.7 && obstacle > 0.58) terrain = 'hard';
        else if (fertility + moisture * 0.4 > 0.82) terrain = 'dense';
        const angle = this.sampleNoise(center.x * 0.0022, center.y * 0.0021, 6.1) * TWO_PI * 2;
        const flowStrength = terrain === 'fluid' ? 1.2 + moisture * 1.4 : terrain === 'dense' ? 0.35 + moisture * 0.4 : 0.04;
        cells.push({
          index: row * ZONE_GRID_COLS + col,
          col,
          row,
          center,
          bounds: { x: col * CELL_WIDTH, y: row * CELL_HEIGHT, width: CELL_WIDTH, height: CELL_HEIGHT },
          terrain,
          density: terrain === 'dense' ? 0.6 + fertility * 0.4 : terrain === 'hard' ? 1 : 0.18 + fertility * 0.18,
          fertility: terrain === 'hard' ? 0.05 : fertility,
          stability: clamp(0.75 - Math.abs(0.52 - fertility) * 0.65 + (terrain === 'hard' ? -0.18 : terrain === 'dense' ? 0.08 : 0.04), 0, 1),
          flow: { x: Math.cos(angle) * flowStrength, y: Math.sin(angle) * flowStrength },
          resonance: clamp(0.24 + moisture * 0.28 + fertility * 0.34 - obstacle * 0.16, 0, 1),
          height,
          roughness: obstacle,
        });
      }
    }
    return cells;
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
      velocity: this.randomVelocity(type === 'predator' ? 10 : type === 'flocker' ? 14 : 6),
      heading: this.rng.range(0, TWO_PI),
      size: baseSize,
      baseSize,
      energy: clamp(this.rng.range(0.35, 0.85), 0, 1.1),
      growth: this.rng.range(0.15, 0.5),
      resonance: this.rng.range(0.25, 0.8),
      harmony: this.rng.range(0.3, 0.75),
      stability: this.rng.range(0.35, 0.85),
      age: 0,
      lifeSpan: lifeSpan + this.rng.range(-18, 24),
      stageProgress: 0,
      reproductionCooldown: this.rng.range(3, 10),
      pulse: this.rng.range(0, 0.4),
      tone: clamp(tone + this.rng.range(-0.12, 0.12), 0, 1),
      shape: this.rng.range(0, 1),
      hueShift: this.rng.range(-0.2, 0.2),
      terrainBias: this.rng.range(-0.25, 0.25),
      clusterId,
      appetite: this.rng.range(0.2, 1),
      anchor: type === 'plant' ? { ...position } : undefined,
    };
  }

  private computePairResonance(a: Entity, b: Entity, proximity: number) {
    const cell = this.getCellAt((a.position.x + b.position.x) * 0.5, (a.position.y + b.position.y) * 0.5);
    const phase = (Math.cos((a.heading - b.heading) * 0.7) + 1) * 0.5;
    const tone = 1 - Math.abs(a.tone - b.tone);
    const terrainBonus = cell.terrain === 'fluid' ? 0.06 : cell.terrain === 'dense' ? 0.11 : -0.08;
    const harmony = clamp((phase * 0.34 + tone * 0.28 + cell.resonance * 0.3 + proximity * 0.3 + terrainBonus), 0, 1);
    const dissonance = clamp((1 - tone) * 0.3 + (1 - cell.stability) * 0.44 + (cell.terrain === 'hard' ? 0.16 : 0) + (a.type === 'predator' || b.type === 'predator' ? 0.12 : 0), 0, 1);
    return { harmony, dissonance };
  }

  private applyTerrain(entity: Entity, cell: TerrainCell, dt: number): void {
    entity.resonance = clamp(entity.resonance + (cell.resonance - 0.4) * dt * 0.22, 0, 1.4);
    entity.stability = clamp(entity.stability + (cell.stability - 0.5) * dt * 0.28, 0, 1.3);

    if (cell.terrain === 'fluid') {
      const flowScale = entity.type === 'flocker' ? 1.6 : entity.type === 'predator' ? 1.1 : 0.65;
      entity.velocity.x += cell.flow.x * dt * flowScale;
      entity.velocity.y += cell.flow.y * dt * flowScale;
      if (entity.type === 'flocker') entity.energy = clamp(entity.energy + dt * 0.05, 0, 1.35);
    } else if (cell.terrain === 'dense') {
      entity.velocity.x *= 1 - dt * (0.55 + cell.density * 0.08);
      entity.velocity.y *= 1 - dt * (0.55 + cell.density * 0.08);
      entity.growth = clamp(entity.growth + dt * (0.08 + cell.fertility * 0.14), 0, 1.5);
      if (entity.type === 'plant' && entity.anchor) {
        entity.velocity.x += (entity.anchor.x - entity.position.x) * dt * 0.028;
        entity.velocity.y += (entity.anchor.y - entity.position.y) * dt * 0.028;
      }
    } else {
      entity.stability = clamp(entity.stability - dt * 0.28, 0, 1.3);
      entity.energy = clamp(entity.energy - dt * 0.08, 0, 1.35);
      const pushX = entity.position.x - cell.center.x;
      const pushY = entity.position.y - cell.center.y;
      const length = Math.hypot(pushX, pushY) || 1;
      entity.velocity.x += (pushX / length) * dt * 90;
      entity.velocity.y += (pushY / length) * dt * 90;
    }
  }

  private applyTool(entity: Entity, dt: number): number {
    if (this.tool.active === 'observe' || this.tool.strength <= 0.01 || !this.tool.visible) return 0;
    const dx = entity.position.x - this.tool.worldPosition.x;
    const dy = entity.position.y - this.tool.worldPosition.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > this.tool.radius) return 0;

    const cost = TOOL_ENERGY_COST[this.tool.active] * dt * (0.65 + this.tool.strength * 0.35);
    if (this.energy < cost) {
      this.tool.blocked = true;
      this.tool.strength = Math.max(0.18, this.tool.strength - dt * 5);
      this.tool.pulse = 1;
      return 0;
    }

    this.energy = Math.max(0, this.energy - cost);
    const falloff = 1 - distance / this.tool.radius;
    const nx = dx / (distance || 1);
    const ny = dy / (distance || 1);
    entity.pulse = Math.max(entity.pulse, 0.35 + falloff * 0.65);

    if (this.tool.active === 'grow') {
      entity.velocity.x -= nx * dt * 52 * falloff;
      entity.velocity.y -= ny * dt * 52 * falloff;
      entity.growth = clamp(entity.growth + dt * 0.4 * falloff, 0, 1.6);
      entity.stability = clamp(entity.stability + dt * 0.24 * falloff, 0, 1.4);
      if (entity.type === 'cluster') entity.clusterId ||= this.nextClusterId++;
      this.emitToolFeedback('grow', this.tool.worldPosition, 0.7);
      return cost;
    }

    if (this.tool.active === 'feed') {
      entity.energy = clamp(entity.energy + dt * 0.5 * falloff, 0, 1.45);
      entity.growth = clamp(entity.growth + dt * 0.22 * falloff, 0, 1.6);
      entity.resonance = clamp(entity.resonance + dt * 0.2 * falloff, 0, 1.5);
      entity.velocity.x += this.rng.range(-1, 1) * dt * 18 * falloff;
      entity.velocity.y += this.rng.range(-1, 1) * dt * 18 * falloff;
      this.emitToolFeedback('feed', this.tool.worldPosition, 0.78);
      return cost;
    }

    if (this.tool.active === 'repel') {
      entity.velocity.x += nx * dt * 120 * falloff;
      entity.velocity.y += ny * dt * 120 * falloff;
      entity.stability = clamp(entity.stability - dt * 0.08 * falloff, 0, 1.3);
      this.emitToolFeedback('repel', this.tool.worldPosition, 0.88);
      return cost;
    }

    entity.velocity.x += this.rng.range(-1, 1) * dt * 62 * falloff;
    entity.velocity.y += this.rng.range(-1, 1) * dt * 62 * falloff;
    entity.resonance = lerp(entity.resonance, 0.15, dt * 0.85 * falloff);
    entity.stability = clamp(entity.stability - dt * 0.42 * falloff, 0, 1.2);
    if (entity.type === 'cluster') entity.clusterId = 0;
    this.emitToolFeedback('disrupt', this.tool.worldPosition, 0.95);
    return cost;
  }

  private updateEntity(entity: Entity, cell: TerrainCell, dt: number): void {
    const wanderTheta = this.time * (0.18 + entity.appetite * 0.11) + entity.id * 0.41;
    entity.velocity.x += Math.cos(wanderTheta) * dt * (entity.type === 'flocker' ? 11 : entity.type === 'predator' ? 8 : 4);
    entity.velocity.y += Math.sin(wanderTheta * 1.17) * dt * (entity.type === 'flocker' ? 11 : entity.type === 'predator' ? 8 : 4);

    if (entity.type === 'cluster') {
      const sameCluster = this.entities.filter((other) => other.id !== entity.id && other.clusterId === entity.clusterId && other.clusterId !== 0);
      for (const other of sameCluster.slice(0, 4)) {
        const dx = other.position.x - entity.position.x;
        const dy = other.position.y - entity.position.y;
        const dist = Math.hypot(dx, dy) || 1;
        if (dist > 170) continue;
        const pull = smoothstep(170, 0, dist) * 34;
        entity.velocity.x += (dx / dist) * pull * dt;
        entity.velocity.y += (dy / dist) * pull * dt;
      }
    }

    const stageScale = entity.stage === 'birth' ? 0.68 : entity.stage === 'growth' ? 0.92 : entity.stage === 'mature' ? 1.06 : 0.72;
    const damping = entity.type === 'cluster' ? 0.91 : entity.type === 'plant' ? 0.88 : entity.type === 'predator' ? 0.95 : 0.93;
    entity.velocity.x *= Math.pow(damping, dt * 60);
    entity.velocity.y *= Math.pow(damping, dt * 60);

    let nextX = entity.position.x + entity.velocity.x * dt * stageScale;
    let nextY = entity.position.y + entity.velocity.y * dt * stageScale;
    const nextCell = this.getCellAt(nextX, nextY);
    if (nextCell.terrain === 'hard') {
      entity.velocity.x *= -0.38;
      entity.velocity.y *= -0.38;
      nextX = entity.position.x + entity.velocity.x * dt;
      nextY = entity.position.y + entity.velocity.y * dt;
    }

    entity.position.x = clamp(nextX, 0, WORLD_WIDTH);
    entity.position.y = clamp(nextY, 0, WORLD_HEIGHT);
    if (entity.position.x <= 1 || entity.position.x >= WORLD_WIDTH - 1) entity.velocity.x *= -0.4;
    if (entity.position.y <= 1 || entity.position.y >= WORLD_HEIGHT - 1) entity.velocity.y *= -0.4;
    entity.heading = Math.atan2(entity.velocity.y || 0.001, entity.velocity.x || 0.001);

    const stageGrowth = entity.stage === 'birth' ? 0.11 : entity.stage === 'growth' ? 0.16 : entity.stage === 'mature' ? 0.05 : -0.1;
    entity.growth = clamp(entity.growth + dt * (stageGrowth + cell.fertility * 0.06 - (1 - cell.stability) * 0.08), 0, 1.6);
    entity.energy = clamp(entity.energy + dt * (cell.stability * 0.06 - 0.035 - (entity.type === 'predator' ? 0.025 : 0)), 0, 1.45);
    entity.size = clamp(entity.baseSize * (0.65 + entity.growth * 0.55 + entity.stageProgress * 0.35), entity.baseSize * 0.5, entity.baseSize * 2.2);
  }

  private shouldPersist(entity: Entity, cell: TerrainCell): boolean {
    if (entity.energy <= 0.05) return false;
    if (entity.stability <= 0.06 && entity.stage === 'decay') return false;
    if (entity.stageProgress >= 1 && entity.stage === 'decay' && entity.energy < 0.22) return false;
    if (entity.type === 'plant' && cell.terrain === 'hard') return false;
    return true;
  }

  private spawnEntities(dt: number, stablePairs: number, plantSpawnBudget: number): void {
    const counts = this.countEntities();
    const stableRegions = this.terrain.filter((cell) => cell.stability > 0.64 && cell.resonance > 0.52 && cell.terrain !== 'hard');
    const denseRegions = this.terrain.filter((cell) => cell.terrain === 'dense');

    for (const entity of this.entities) {
      if (entity.stage !== 'mature' || entity.reproductionCooldown > 0 || entity.stability < 0.64 || entity.energy < 0.62) continue;
      const cell = this.getCellAt(entity.position.x, entity.position.y);
      if (cell.terrain === 'hard') continue;
      const chance = dt * (0.015 + stablePairs * 0.00016 + cell.stability * 0.02);
      if (this.rng.next() > chance) continue;
      if (entity.type === 'flocker' && counts.flocker < MAX_FLOCKERS) {
        this.entities.push(this.createEntity('flocker', this.scatterAround(entity.position, 24)));
        counts.flocker += 1;
      } else if (entity.type === 'cluster' && counts.cluster < MAX_CLUSTERS) {
        const child = this.createEntity('cluster', this.scatterAround(entity.position, 32));
        child.clusterId = entity.clusterId || child.clusterId;
        this.entities.push(child);
        counts.cluster += 1;
      } else if (entity.type === 'plant' && counts.plant < MAX_PLANTS) {
        this.entities.push(this.createEntity('plant', this.scatterAround(entity.position, 20)));
        counts.plant += 1;
      } else if (entity.type === 'predator' && counts.predator < MAX_PREDATORS && stablePairs > 10) {
        this.entities.push(this.createEntity('predator', this.scatterAround(entity.position, 40)));
        counts.predator += 1;
      }
      entity.reproductionCooldown = this.rng.range(12, 26);
      entity.energy *= 0.86;
      entity.pulse = 1;
    }

    if (counts.plant < MAX_PLANTS && plantSpawnBudget > 0.12 && denseRegions.length > 0 && this.rng.next() < dt * 1.8) {
      const region = denseRegions[Math.floor(this.rng.next() * denseRegions.length)] as TerrainCell;
      this.entities.push(this.createEntity('plant', this.scatterAround(region.center, 60)));
    }

    if (counts.cluster < MAX_CLUSTERS && stableRegions.length > 0 && this.rng.next() < dt * 0.08) {
      const region = stableRegions[Math.floor(this.rng.next() * stableRegions.length)] as TerrainCell;
      this.entities.push(this.createEntity('cluster', this.scatterAround(region.center, 76)));
    }
  }

  private updateEnergy(dt: number, localStats: { harmony: number; activity: number; threat: number; stability: number; interactions: number; stablePairs: number }, toolEnergyUsed: number): void {
    const stableTerrain = this.terrain.filter((cell) => cell.stability > 0.62 && cell.resonance > 0.54).length / Math.max(1, this.terrain.length);
    const interactionCount = Math.max(1, localStats.interactions);
    const harmony = localStats.harmony / interactionCount;
    const stability = localStats.stability / interactionCount;
    const gain = clamp(stableTerrain * 0.42 + harmony * 0.22 + stability * 0.16, 0, 1) * dt * 4.8;
    const loss = clamp(localStats.threat / interactionCount + (1 - stability) * 0.28, 0, 1.6) * dt * 3.6;
    this.energy = clamp(this.energy + gain - loss - toolEnergyUsed * 0.18, 0, ENERGY_MAX);
  }

  private computeStats(localStats?: { harmony: number; activity: number; threat: number; stability: number; interactions: number }): GardenStats {
    const counts = this.countEntities();
    const interactions = Math.max(1, localStats?.interactions ?? 1);
    const harmony = clamp((localStats?.harmony ?? 0.5) / interactions, 0, 1);
    const activity = clamp((localStats?.activity ?? this.entities.length * 0.05) / interactions + this.tool.strength * 0.08, 0, 1);
    const threat = clamp((localStats?.threat ?? counts.predator * 0.08) / interactions, 0, 1);
    const stability = clamp((localStats?.stability ?? this.entities.length * 0.06) / interactions, 0, 1);
    const growth = clamp(this.entities.reduce((sum, entity) => sum + entity.growth, 0) / Math.max(1, this.entities.length), 0, 1);
    const richness = [counts.flocker > 0, counts.cluster > 0, counts.plant > 0, counts.predator > 0].filter(Boolean).length / 4;
    return {
      harmony,
      activity,
      threat,
      growth,
      stability,
      biodiversity: clamp(richness * 0.65 + this.entities.length / 180, 0, 1),
      energy: this.energy / ENERGY_MAX,
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

  private getCellAt(x: number, y: number): TerrainCell {
    const col = clamp(Math.floor(clamp(x, 0, WORLD_WIDTH - 1) / CELL_WIDTH), 0, ZONE_GRID_COLS - 1);
    const row = clamp(Math.floor(clamp(y, 0, WORLD_HEIGHT - 1) / CELL_HEIGHT), 0, ZONE_GRID_ROWS - 1);
    return this.terrain[row * ZONE_GRID_COLS + col] as TerrainCell;
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
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const cell = this.terrain[Math.floor(this.rng.next() * this.terrain.length)];
      if (cell && cell.terrain === preferred) return this.scatterAround(cell.center, Math.min(CELL_WIDTH, CELL_HEIGHT) * 0.4);
    }
    return this.randomPoint();
  }

  private randomPoint(): Vec2 {
    return { x: this.rng.range(56, WORLD_WIDTH - 56), y: this.rng.range(56, WORLD_HEIGHT - 56) };
  }

  private randomVelocity(scale: number): Vec2 {
    const angle = this.rng.range(0, TWO_PI);
    return { x: Math.cos(angle) * this.rng.range(scale * 0.3, scale), y: Math.sin(angle) * this.rng.range(scale * 0.3, scale) };
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
