import {
  CAMERA_MAX_ZOOM,
  CAMERA_MIN_ZOOM,
  INITIAL_CLUSTER_COUNT,
  INITIAL_FILAMENT_COUNT,
  INITIAL_SEED_COUNT,
  MAX_ALIENS,
  MAX_CLUSTERS,
  MAX_FILAMENTS,
  MAX_SEEDS,
  NEIGHBOR_RADIUS,
  TOOL_RADIUS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  ZONE_GRID_COLS,
  ZONE_GRID_ROWS,
  type EntityType,
  type ToolType,
  type ZoneType,
} from '../config';
import { Rng } from './random';
import type { CameraState, Entity, GardenStats, ResonanceState, SimulationSnapshot, ToolState, Vec2, ZoneCell } from './types';

const TWO_PI = Math.PI * 2;
const CELL_WIDTH = WORLD_WIDTH / ZONE_GRID_COLS;
const CELL_HEIGHT = WORLD_HEIGHT / ZONE_GRID_ROWS;
const TOOL_UNLOCK_SCHEDULE: ToolType[] = ['observe', 'grow', 'feed', 'repel', 'disrupt'];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fract = (value: number) => value - Math.floor(value);

export class Simulation {
  private rng = new Rng(0xdecafbad);
  private entities: Entity[] = [];
  private zones: ZoneCell[] = [];
  private nextId = 1;
  private time = 0;
  private timeScale = 1;
  private anomalyPulse = 0;
  private narrativeHint = 0;
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
  };
  private stats: GardenStats = {
    harmony: 0,
    activity: 0,
    mystery: 0,
    growth: 0,
  };

  constructor() {
    this.reset();
  }

  reset(): void {
    this.rng = new Rng(0xdecafbad);
    this.entities = [];
    this.zones = this.createZones();
    this.nextId = 1;
    this.time = 0;
    this.timeScale = 1;
    this.anomalyPulse = 0;
    this.narrativeHint = 0;
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
    };

    for (let i = 0; i < INITIAL_SEED_COUNT; i += 1) {
      this.entities.push(this.createEntity('seed', this.randomPoint()));
    }
    for (let i = 0; i < INITIAL_CLUSTER_COUNT; i += 1) {
      this.entities.push(this.createEntity('cluster', this.randomPoint()));
    }
    for (let i = 0; i < INITIAL_FILAMENT_COUNT; i += 1) {
      this.entities.push(this.createEntity('filament', this.randomPoint()));
    }
    this.stats = this.computeStats();
  }

  setTool(type: ToolType): void {
    if (this.tool.unlocked.includes(type)) {
      this.tool.active = type;
      this.tool.pulse = 1;
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
    this.tool.strength = this.tool.visible ? 1 : Math.max(0, this.tool.strength - dt * 2.6);
    this.tool.pulse = Math.max(0, this.tool.pulse - dt * 0.85);
    this.anomalyPulse = Math.max(0, this.anomalyPulse - dt * 0.22);
    this.narrativeHint = lerp(this.narrativeHint, this.computeNarrativeHint(), 1 - Math.exp(-dt * 0.7));

    this.unlockTools();

    const nextEntities: Entity[] = [];
    const pairStates = new Map<number, ResonanceState>();
    let harmonyAccumulator = 0;
    let dissonanceAccumulator = 0;
    let activityAccumulator = 0;

    for (let i = 0; i < this.entities.length; i += 1) {
      const a = this.entities[i];
      a.age += dt;
      a.phase = (a.phase + dt * (0.22 + a.energy * 0.16 + a.growth * 0.08)) % TWO_PI;
      a.pulse = Math.max(0, a.pulse - dt * 0.75);
      a.resonance = lerp(a.resonance, 0.5, 1 - Math.exp(-dt * 0.22));
      a.cooldown = Math.max(0, (a.cooldown ?? 0) - dt);

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
        const resonance = this.getResonance(a, b, proximity);
        const key = i * 1000 + j;
        pairStates.set(key, resonance);

        const polarity = resonance.harmony - resonance.dissonance;
        const pull = polarity * proximity * (a.type === 'alien' || b.type === 'alien' ? 10 : 22);
        a.velocity.x += nx * pull * dt * -1;
        a.velocity.y += ny * pull * dt * -1;
        b.velocity.x += nx * pull * dt;
        b.velocity.y += ny * pull * dt;

        if (resonance.harmony > 0.52) {
          a.growth = clamp(a.growth + proximity * dt * 0.08, 0, 1.2);
          b.growth = clamp(b.growth + proximity * dt * 0.08, 0, 1.2);
          a.pulse = Math.max(a.pulse, resonance.harmony * 0.8);
          b.pulse = Math.max(b.pulse, resonance.harmony * 0.8);
        }

        if (a.type === 'alien' || b.type === 'alien') {
          const swirl = Math.sin(this.time * 1.8 + a.id - b.id) * (10 + proximity * 30);
          a.velocity.x += -ny * swirl * dt * 0.4;
          a.velocity.y += nx * swirl * dt * 0.4;
          b.velocity.x -= -ny * swirl * dt * 0.4;
          b.velocity.y -= nx * swirl * dt * 0.4;
          this.anomalyPulse = Math.max(this.anomalyPulse, proximity * 0.9);
        }

        harmonyAccumulator += resonance.harmony;
        dissonanceAccumulator += resonance.dissonance;
        activityAccumulator += proximity;
      }
    }

    for (const entity of this.entities) {
      this.applyZoneBehavior(entity, dt);
      this.applyToolInfluence(entity, dt);
      this.updateEntity(entity, dt);

      if (entity.type !== 'alien' && entity.age < entity.life) {
        nextEntities.push(entity);
      } else if (entity.type === 'alien') {
        nextEntities.push(entity);
      }
    }

    this.entities = nextEntities;
    this.spawnEntities(dt);

    const interactionCount = Math.max(1, pairStates.size);
    this.stats = {
      harmony: clamp(harmonyAccumulator / interactionCount, 0, 1),
      activity: clamp(activityAccumulator / interactionCount + this.tool.strength * 0.12, 0, 1),
      mystery: clamp(dissonanceAccumulator / interactionCount + this.anomalyPulse * 0.45, 0, 1),
      growth: this.computeGrowth(),
    };
  }

  getSnapshot(): SimulationSnapshot {
    return {
      entities: this.entities,
      zones: this.zones,
      stats: this.stats,
      tool: this.tool,
      camera: this.camera,
      time: this.time,
      timeScale: this.timeScale,
      anomalyPulse: this.anomalyPulse,
      narrativeHint: this.narrativeHint,
    };
  }

  private createZones(): ZoneCell[] {
    const cells: ZoneCell[] = [];
    for (let row = 0; row < ZONE_GRID_ROWS; row += 1) {
      for (let col = 0; col < ZONE_GRID_COLS; col += 1) {
        const center = {
          x: (col + 0.5) * CELL_WIDTH,
          y: (row + 0.5) * CELL_HEIGHT,
        };
        const weights = this.sampleZoneWeights(center.x, center.y);
        const angle = this.zoneNoise(center.x * 0.005, center.y * 0.005, 1.1) * TWO_PI * 2;
        const flowStrength = 0.4 + weights.drift * 0.8 + weights.resonant * 0.5;
        cells.push({
          index: row * ZONE_GRID_COLS + col,
          col,
          row,
          center,
          bounds: {
            x: col * CELL_WIDTH,
            y: row * CELL_HEIGHT,
            width: CELL_WIDTH,
            height: CELL_HEIGHT,
          },
          weights,
          flow: {
            x: Math.cos(angle) * flowStrength,
            y: Math.sin(angle) * flowStrength,
          },
          shimmer: this.zoneNoise(center.x * 0.011, center.y * 0.011, 3.4),
        });
      }
    }
    return cells;
  }

  private sampleZoneWeights(x: number, y: number): Record<ZoneType, number> {
    const drift = this.zoneNoise(x * 0.004, y * 0.004, 0.12);
    const resonant = this.zoneNoise(x * 0.0045 + 10.4, y * 0.0043 - 2.7, 0.43);
    const fertile = this.zoneNoise(x * 0.0033 - 6.9, y * 0.0031 + 4.7, 0.92);
    const unstable = Math.pow(this.zoneNoise(x * 0.006 + 8.8, y * 0.006 - 5.5, 1.6), 2.2);
    const total = drift + resonant + fertile + unstable || 1;
    return {
      drift: drift / total,
      resonant: resonant / total,
      fertile: fertile / total,
      unstable: unstable / total,
    };
  }

  private zoneNoise(x: number, y: number, seed: number): number {
    return clamp(
      0.5
        + Math.sin(x * 1.31 + seed * 2.7) * 0.22
        + Math.cos(y * 1.17 - seed * 1.3) * 0.18
        + Math.sin((x + y) * 0.73 + seed * 7.1) * 0.12
        + fract(Math.sin((x * 12.9898 + y * 78.233 + seed * 37.719)) * 43758.5453) * 0.16,
      0,
      1,
    );
  }

  private createEntity(type: EntityType, position: Vec2): Entity {
    const toneBase = {
      seed: 0.28,
      cluster: 0.52,
      filament: 0.42,
      alien: 0.74,
    }[type];
    const sizeBase = {
      seed: 3.8,
      cluster: 13,
      filament: 8,
      alien: 10.5,
    }[type];
    const energyBase = {
      seed: 0.36,
      cluster: 0.68,
      filament: 0.5,
      alien: 0.84,
    }[type];

    return {
      id: this.nextId++,
      type,
      position: { ...position },
      velocity: this.randomVelocity(type === 'alien' ? 8 : 4),
      heading: this.rng.range(0, TWO_PI),
      size: sizeBase + this.rng.range(-1, 1) * (type === 'cluster' ? 2.6 : 0.8),
      energy: clamp(energyBase + this.rng.range(-0.15, 0.15), 0.18, 1),
      growth: this.rng.range(0.18, 0.68),
      resonance: this.rng.range(0.3, 0.7),
      phase: this.rng.range(0, TWO_PI),
      pulse: this.rng.range(0, 0.4),
      tone: clamp(toneBase + this.rng.range(-0.1, 0.1), 0, 1),
      age: 0,
      life: type === 'seed' ? this.rng.range(45, 110) : this.rng.range(120, 220),
      zoneAffinity: this.rng.range(0.2, 1),
      wander: this.rng.range(0.2, 1),
      anchor: type === 'filament' ? { ...position } : undefined,
      cooldown: 0,
    };
  }

  private getZoneWeightsAt(x: number, y: number): Record<ZoneType, number> {
    return this.sampleZoneWeights(clamp(x, 0, WORLD_WIDTH), clamp(y, 0, WORLD_HEIGHT));
  }

  private getCellAt(x: number, y: number): ZoneCell {
    const col = clamp(Math.floor(x / CELL_WIDTH), 0, ZONE_GRID_COLS - 1);
    const row = clamp(Math.floor(y / CELL_HEIGHT), 0, ZONE_GRID_ROWS - 1);
    return this.zones[row * ZONE_GRID_COLS + col] as ZoneCell;
  }

  private getResonance(a: Entity, b: Entity, proximity: number): ResonanceState {
    const phaseAlignment = (Math.cos(a.phase - b.phase) + 1) * 0.5;
    const toneAlignment = 1 - Math.abs(a.tone - b.tone);
    const zone = this.getZoneWeightsAt((a.position.x + b.position.x) * 0.5, (a.position.y + b.position.y) * 0.5);
    const harmony = clamp((phaseAlignment * 0.55 + toneAlignment * 0.3 + zone.resonant * 0.4 + proximity * 0.2) / 1.3, 0, 1);
    const dissonance = clamp((1 - phaseAlignment) * 0.45 + (1 - toneAlignment) * 0.2 + zone.unstable * 0.45, 0, 1);
    return {
      alignment: phaseAlignment,
      harmony,
      dissonance,
    };
  }

  private applyZoneBehavior(entity: Entity, dt: number): void {
    const cell = this.getCellAt(entity.position.x, entity.position.y);
    const zone = this.getZoneWeightsAt(entity.position.x, entity.position.y);
    const flowScale = entity.type === 'cluster' ? 0.22 : entity.type === 'filament' ? 0.68 : 0.42;
    entity.velocity.x += cell.flow.x * flowScale * dt * (0.6 + zone.drift * 0.8);
    entity.velocity.y += cell.flow.y * flowScale * dt * (0.6 + zone.drift * 0.8);

    entity.resonance = clamp(entity.resonance + (zone.resonant - 0.26) * dt * 0.22, 0, 1.2);
    entity.growth = clamp(entity.growth + (zone.fertile - 0.22) * dt * 0.16, 0, 1.4);

    if (entity.type === 'cluster') {
      entity.velocity.x += (cell.center.x - entity.position.x) * zone.resonant * dt * 0.035;
      entity.velocity.y += (cell.center.y - entity.position.y) * zone.resonant * dt * 0.035;
    }

    if (entity.type === 'filament' && entity.anchor) {
      entity.velocity.x += (entity.anchor.x - entity.position.x) * dt * 0.012;
      entity.velocity.y += (entity.anchor.y - entity.position.y) * dt * 0.012;
      entity.heading = Math.atan2(cell.flow.y, cell.flow.x);
    }

    if (zone.unstable > 0.54 && entity.type === 'alien' && (entity.cooldown ?? 0) <= 0 && this.rng.next() < dt * 0.28) {
      entity.position.x = clamp(entity.position.x + this.rng.range(-110, 110), 0, WORLD_WIDTH);
      entity.position.y = clamp(entity.position.y + this.rng.range(-90, 90), 0, WORLD_HEIGHT);
      entity.cooldown = this.rng.range(1.8, 4.2);
      entity.pulse = 1;
      this.anomalyPulse = Math.max(this.anomalyPulse, 1);
    } else if (zone.unstable > 0.58 && entity.type !== 'cluster' && this.rng.next() < dt * 0.02) {
      entity.position.x = clamp(entity.position.x + this.rng.range(-24, 24), 0, WORLD_WIDTH);
      entity.position.y = clamp(entity.position.y + this.rng.range(-24, 24), 0, WORLD_HEIGHT);
    }
  }

  private applyToolInfluence(entity: Entity, dt: number): void {
    if (this.tool.active === 'observe' || this.tool.strength <= 0.01) return;

    const dx = entity.position.x - this.tool.worldPosition.x;
    const dy = entity.position.y - this.tool.worldPosition.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > this.tool.radius) return;

    const falloff = 1 - distance / this.tool.radius;
    const nx = dx / (distance || 1);
    const ny = dy / (distance || 1);
    entity.pulse = Math.max(entity.pulse, falloff);

    if (this.tool.active === 'grow') {
      entity.velocity.x += -nx * dt * 32 * falloff;
      entity.velocity.y += -ny * dt * 32 * falloff;
      entity.growth = clamp(entity.growth + dt * falloff * 0.38, 0, 1.5);
      entity.resonance = clamp(entity.resonance + dt * falloff * 0.28, 0, 1.3);
      return;
    }

    if (this.tool.active === 'feed') {
      entity.velocity.x += this.rng.range(-1, 1) * dt * 22 * falloff;
      entity.velocity.y += this.rng.range(-1, 1) * dt * 22 * falloff;
      entity.energy = clamp(entity.energy + dt * falloff * 0.48, 0, 1.2);
      entity.phase += dt * falloff * 1.2;
      return;
    }

    if (this.tool.active === 'repel') {
      entity.velocity.x += nx * dt * 60 * falloff;
      entity.velocity.y += ny * dt * 60 * falloff;
      entity.resonance = clamp(entity.resonance - dt * falloff * 0.22, 0, 1.2);
      return;
    }

    entity.velocity.x += this.rng.range(-1, 1) * dt * 36 * falloff;
    entity.velocity.y += this.rng.range(-1, 1) * dt * 36 * falloff;
    entity.phase += Math.sin(this.time * 3 + entity.id) * dt * 1.8 * falloff;
    entity.resonance = lerp(entity.resonance, 0.45, falloff * dt * 0.8);
  }

  private updateEntity(entity: Entity, dt: number): void {
    const zone = this.getZoneWeightsAt(entity.position.x, entity.position.y);
    const driftTheta = this.time * (0.12 + entity.wander * 0.18) + entity.id * 0.37;
    entity.velocity.x += Math.cos(driftTheta) * dt * (entity.type === 'cluster' ? 2 : 6) * entity.wander;
    entity.velocity.y += Math.sin(driftTheta * 1.2) * dt * (entity.type === 'cluster' ? 2 : 6) * entity.wander;

    if (entity.type === 'cluster') {
      for (const other of this.entities) {
        if (other.id === entity.id || other.type === 'alien') continue;
        const dx = entity.position.x - other.position.x;
        const dy = entity.position.y - other.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1 || dist > 150) continue;
        const pull = (1 - dist / 150) * (0.4 + entity.growth * 0.6);
        other.velocity.x += (dx / dist) * dt * pull * 18;
        other.velocity.y += (dy / dist) * dt * pull * 18;
        other.pulse = Math.max(other.pulse, pull * 0.7);
      }
    }

    if (entity.type === 'filament') {
      entity.velocity.x += Math.cos(entity.heading) * dt * (16 + zone.drift * 12);
      entity.velocity.y += Math.sin(entity.heading) * dt * (16 + zone.drift * 12);
    }

    if (entity.type === 'alien') {
      entity.velocity.x += Math.sin(this.time * 1.9 + entity.id * 0.6) * dt * 18;
      entity.velocity.y += Math.cos(this.time * 1.4 + entity.id * 0.4) * dt * 18;
      if (this.rng.next() < dt * 0.03) {
        entity.tone = clamp(entity.tone + this.rng.range(-0.08, 0.08), 0.56, 0.95);
      }
    }

    const damping = entity.type === 'cluster' ? 0.965 : entity.type === 'alien' ? 0.982 : 0.972;
    entity.velocity.x *= damping;
    entity.velocity.y *= damping;
    entity.position.x = clamp(entity.position.x + entity.velocity.x * dt * 18, 0, WORLD_WIDTH);
    entity.position.y = clamp(entity.position.y + entity.velocity.y * dt * 18, 0, WORLD_HEIGHT);

    if (entity.position.x <= 1 || entity.position.x >= WORLD_WIDTH - 1) entity.velocity.x *= -0.42;
    if (entity.position.y <= 1 || entity.position.y >= WORLD_HEIGHT - 1) entity.velocity.y *= -0.42;

    entity.heading = Math.atan2(entity.velocity.y, entity.velocity.x || 0.0001);
    entity.energy = clamp(entity.energy + (zone.fertile * 0.05 - 0.015) * dt, 0.12, 1.2);
    entity.size = clamp(entity.size + (entity.growth * 0.03 + zone.fertile * 0.04 - 0.018) * dt, entity.type === 'cluster' ? 10 : 2.4, entity.type === 'cluster' ? 22 : 12);
  }

  private spawnEntities(dt: number): void {
    const counts = this.countEntities();
    const fertileBias = this.averageZoneWeight('fertile');
    const resonantBias = this.averageZoneWeight('resonant');
    const unstableBias = this.averageZoneWeight('unstable');

    if (counts.seed < MAX_SEEDS && this.rng.next() < dt * (0.58 + fertileBias * 0.9)) {
      const source = this.pickEntity(['cluster', 'filament']);
      const point = source ? this.scatterAround(source.position, 26) : this.randomPoint();
      this.entities.push(this.createEntity('seed', point));
    }

    if (counts.cluster < MAX_CLUSTERS && this.rng.next() < dt * (0.06 + resonantBias * 0.08)) {
      const source = this.pickEntity(['seed']);
      if (source) {
        this.entities.push(this.createEntity('cluster', this.scatterAround(source.position, 34)));
      }
    }

    if (counts.filament < MAX_FILAMENTS && this.rng.next() < dt * (0.04 + fertileBias * 0.04 + resonantBias * 0.03)) {
      const point = this.randomPoint();
      this.entities.push(this.createEntity('filament', point));
    }

    if (counts.alien < MAX_ALIENS && this.time > 24 && this.rng.next() < dt * (0.004 + unstableBias * 0.012)) {
      this.entities.push(this.createEntity('alien', this.randomPoint()));
      this.anomalyPulse = Math.max(this.anomalyPulse, 0.8);
    }
  }

  private countEntities(): Record<EntityType, number> {
    return this.entities.reduce(
      (acc, entity) => {
        acc[entity.type] += 1;
        return acc;
      },
      { seed: 0, cluster: 0, filament: 0, alien: 0 } as Record<EntityType, number>,
    );
  }

  private computeStats(): GardenStats {
    return {
      harmony: 0.5,
      activity: 0.3,
      mystery: 0.1,
      growth: this.computeGrowth(),
    };
  }

  private computeGrowth(): number {
    const total = this.entities.reduce((sum, entity) => sum + entity.growth, 0);
    return clamp(total / Math.max(1, this.entities.length), 0, 1);
  }

  private computeNarrativeHint(): number {
    const alienCount = this.entities.filter((entity) => entity.type === 'alien').length;
    return clamp(alienCount * 0.18 + this.averageZoneWeight('unstable') * 0.52 + Math.sin(this.time * 0.13) * 0.05 + 0.08, 0, 1);
  }

  private unlockTools(): void {
    const thresholds = [0, 0, 14, 30, 48];
    for (let i = 0; i < TOOL_UNLOCK_SCHEDULE.length; i += 1) {
      const tool = TOOL_UNLOCK_SCHEDULE[i] as ToolType;
      if (this.time >= thresholds[i] && !this.tool.unlocked.includes(tool)) {
        this.tool.unlocked = [...this.tool.unlocked, tool];
        this.tool.pulse = 1;
      }
    }
  }

  private averageZoneWeight(type: ZoneType): number {
    return this.zones.reduce((sum, cell) => sum + cell.weights[type], 0) / Math.max(1, this.zones.length);
  }

  private pickEntity(types: EntityType[]): Entity | undefined {
    const matches = this.entities.filter((entity) => types.includes(entity.type));
    if (matches.length === 0) return undefined;
    return matches[Math.floor(this.rng.next() * matches.length)];
  }

  private randomPoint(): Vec2 {
    return {
      x: this.rng.range(48, WORLD_WIDTH - 48),
      y: this.rng.range(48, WORLD_HEIGHT - 48),
    };
  }

  private randomVelocity(scale: number): Vec2 {
    const angle = this.rng.range(0, TWO_PI);
    const speed = this.rng.range(scale * 0.35, scale);
    return {
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed,
    };
  }

  private scatterAround(center: Vec2, radius: number): Vec2 {
    const angle = this.rng.range(0, TWO_PI);
    const distance = this.rng.range(radius * 0.25, radius);
    return {
      x: clamp(center.x + Math.cos(angle) * distance, 0, WORLD_WIDTH),
      y: clamp(center.y + Math.sin(angle) * distance, 0, WORLD_HEIGHT),
    };
  }
}
