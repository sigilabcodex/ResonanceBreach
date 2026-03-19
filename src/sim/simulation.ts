import {
  BASE_STABILITY_DRAIN,
  CAMERA_MAX_ZOOM,
  CAMERA_MIN_ZOOM,
  INITIAL_HARMONIC_COUNT,
  MAX_ENTITIES,
  MAX_POCKET_INDICATORS,
  PHASE_SEQUENCE,
  RESONANCE_RANGE,
  STABILITY_RECOVERY,
  STABILIZER_HEAT_DAMPING,
  STABILIZER_MAX_CHARGE,
  STABILIZER_RADIUS,
  STABILIZER_RECOVERY,
  STABILIZER_STRENGTH,
  TOPOLOGY_COLS,
  TOPOLOGY_ROWS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type EntityRole,
  type SystemPhase,
} from '../config';
import { Rng } from './random';
import type {
  BarrierSegment,
  CameraState,
  Entity,
  FieldCell,
  Hotspot,
  PhaseState,
  SimulationSnapshot,
  StabilizerZone,
} from './types';

const TWO_PI = Math.PI * 2;
const CELL_WIDTH = WORLD_WIDTH / TOPOLOGY_COLS;
const CELL_HEIGHT = WORLD_HEIGHT / TOPOLOGY_ROWS;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const roleEnergy: Record<EntityRole, number> = {
  harmonic: 0.32,
  anomaly: 0.44,
  breach: 0.76,
};

export class Simulation {
  private rng = new Rng(0xdecafbad);
  private entities: Entity[] = [];
  private field: FieldCell[] = [];
  private barriers: BarrierSegment[] = [];
  private hotspots: Hotspot[] = [];
  private nextId = 1;
  private time = 0;
  private stability = 0.94;
  private pressure = 0;
  private avgResonance = 0;
  private outbreakRisk = 0;
  private rhythmicPressure = 0;
  private lost = false;
  private phaseSignal = 0;
  private phaseState: PhaseState = {
    current: 'calm',
    progress: 0,
    blend: { calm: 1, anomaly: 0, emergence: 0, pressure: 0, breach: 0 },
  };
  private camera: CameraState = {
    center: { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 },
    zoom: 1,
  };
  private timeScale = 1;
  private zone: StabilizerZone = {
    active: false,
    position: { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 },
    radius: STABILIZER_RADIUS,
    charge: 0,
    pulse: 0,
    recovery: 0,
  };

  constructor() {
    this.reset();
  }

  reset(): void {
    this.rng = new Rng(0xdecafbad);
    this.entities = [];
    this.field = this.createField();
    this.barriers = this.createBarriers();
    this.hotspots = [];
    this.nextId = 1;
    this.time = 0;
    this.stability = 0.94;
    this.pressure = 0;
    this.avgResonance = 0;
    this.outbreakRisk = 0;
    this.rhythmicPressure = 0;
    this.phaseSignal = 0;
    this.phaseState = {
      current: 'calm',
      progress: 0,
      blend: { calm: 1, anomaly: 0, emergence: 0, pressure: 0, breach: 0 },
    };
    this.lost = false;
    this.zone.active = false;
    this.zone.charge = 0;
    this.zone.pulse = 0;
    this.zone.recovery = 0;
    this.zone.position = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
    this.camera = { center: { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 }, zoom: 1 };
    this.timeScale = 1;

    for (let i = 0; i < INITIAL_HARMONIC_COUNT; i += 1) {
      this.entities.push(this.createEntity('harmonic', this.pickFieldAnchor()));
    }
  }

  setZone(active: boolean, x: number, y: number): void {
    this.zone.active = active;
    this.zone.position.x = clamp(x, 0, WORLD_WIDTH);
    this.zone.position.y = clamp(y, 0, WORLD_HEIGHT);
    if (active) {
      this.zone.charge = STABILIZER_MAX_CHARGE;
      this.zone.pulse = 1;
    }
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
    this.zone.recovery *= 0.96;
    this.zone.pulse = Math.max(0, this.zone.pulse - dt * 0.75);

    if (this.lost) {
      this.zone.charge = Math.max(0, this.zone.charge - dt * 0.28);
      return;
    }

    this.resetFieldMetrics(dt);
    this.updatePhaseState(dt);

    let resonanceTotal = 0;
    let interactionCount = 0;

    for (const entity of this.entities) {
      entity.age += dt;
      entity.phase = (entity.phase + dt * (0.22 + entity.energy * 0.2 + entity.charge * 0.18)) % TWO_PI;
      entity.pulse = Math.max(0, entity.pulse - dt * 0.8);
      entity.resonance *= 0.98;
      entity.cluster *= 0.95;
      entity.charge *= 0.99;
      entity.instability *= 0.985;

      const cell = this.getCellAt(entity.position.x, entity.position.y);
      cell.density += 1;
      cell.resonance += entity.resonance + entity.instability * 0.2;
    }

    for (let i = 0; i < this.entities.length; i += 1) {
      const a = this.entities[i];
      for (let j = i + 1; j < this.entities.length; j += 1) {
        const b = this.entities[j];
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > RESONANCE_RANGE * RESONANCE_RANGE) continue;

        const dist = Math.sqrt(distSq) || 1;
        const proximity = 1 - dist / RESONANCE_RANGE;
        const nx = dx / dist;
        const ny = dy / dist;
        const phaseAlignment = (Math.cos(a.phase - b.phase) + 1) * 0.5;
        const localPressure = (this.getCellAt(a.position.x, a.position.y).hazard + this.getCellAt(b.position.x, b.position.y).hazard) * 0.5;

        let influence = 0;
        if (a.role === 'harmonic' && b.role === 'harmonic') {
          influence = (phaseAlignment - 0.35) * 12;
          a.resonance += proximity * 0.004;
          b.resonance += proximity * 0.004;
        } else if (a.role === 'breach' || b.role === 'breach') {
          influence = (0.22 + proximity + localPressure * 0.4) * 24;
          a.charge += proximity * 0.0025;
          b.charge += proximity * 0.0025;
          a.pulse = Math.max(a.pulse, proximity * 0.4);
          b.pulse = Math.max(b.pulse, proximity * 0.4);
        } else {
          influence = Math.sin(this.time * 4 + a.id + b.id) * (4 + proximity * 8);
          a.instability += proximity * 0.004;
          b.instability += proximity * 0.004;
        }

        a.velocity.x -= nx * influence * dt;
        a.velocity.y -= ny * influence * dt;
        b.velocity.x += nx * influence * dt;
        b.velocity.y += ny * influence * dt;

        if (a.role === 'anomaly' || b.role === 'anomaly') {
          const swirl = (0.5 - phaseAlignment) * (12 + localPressure * 10);
          a.velocity.x += -ny * swirl * dt;
          a.velocity.y += nx * swirl * dt;
          b.velocity.x -= -ny * swirl * dt;
          b.velocity.y -= nx * swirl * dt;
        }

        resonanceTotal += proximity * (0.4 + phaseAlignment * 0.6 + localPressure * 0.2);
        interactionCount += 1;
      }
    }

    this.finalizeFieldMetrics();
    this.updateEntities(dt);
    this.spawnByPhase(dt);

    const harmonicCount = this.entities.filter((entity) => entity.role === 'harmonic').length;
    const anomalyCount = this.entities.filter((entity) => entity.role === 'anomaly').length;
    const breachCount = this.entities.filter((entity) => entity.role === 'breach').length;
    const interactionResonance = interactionCount > 0 ? resonanceTotal / interactionCount : 0;

    this.avgResonance = resonanceTotal / Math.max(1, this.entities.length);
    this.outbreakRisk = clamp(
      this.field.reduce((sum, cell) => sum + cell.hazard, 0) / Math.max(1, this.field.length) + breachCount * 0.028 + anomalyCount * 0.01,
      0,
      1.4,
    );
    this.rhythmicPressure = clamp(this.phaseState.blend.pressure * 0.45 + this.phaseState.blend.breach * 0.95 + breachCount * 0.025, 0, 1.5);
    this.pressure = clamp(
      interactionResonance * 0.45 + anomalyCount * 0.012 + breachCount * 0.03 + this.outbreakRisk * 0.5,
      0,
      1.6,
    );

    const stabilityDrift = BASE_STABILITY_DRAIN + this.outbreakRisk * 0.009 + this.rhythmicPressure * 0.014;
    const passiveRecovery = STABILITY_RECOVERY * (0.65 + harmonicCount * 0.008) * (1 - this.phaseState.blend.breach * 0.78);
    this.stability = clamp(this.stability - stabilityDrift * dt + passiveRecovery * dt + this.zone.recovery * 0.045, 0, 1);

    if (this.entities.length >= MAX_ENTITIES) {
      this.stability = clamp(this.stability - dt * 0.06, 0, 1);
    }

    this.hotspots = this.computeHotspots();
    this.lost = this.stability <= 0.001;
  }

  getSnapshot(): SimulationSnapshot {
    return {
      entities: this.entities,
      field: this.field,
      barriers: this.barriers,
      hotspots: this.hotspots,
      stability: this.stability,
      pressure: this.pressure,
      avgResonance: this.avgResonance,
      outbreakRisk: this.outbreakRisk,
      zone: this.zone,
      time: this.time,
      lost: this.lost,
      phaseState: this.phaseState,
      rhythmicPressure: this.rhythmicPressure,
      camera: this.camera,
      timeScale: this.timeScale,
    };
  }

  private updatePhaseState(dt: number): void {
    const elapsed = smoothstep(12, 180, this.time);
    const stress = smoothstep(0.08, 0.82, 1 - this.stability + this.outbreakRisk * 0.28);
    const targetSignal = clamp(elapsed * 0.62 + stress * 0.7, 0, 1.12);
    this.phaseSignal = lerp(this.phaseSignal, targetSignal, 1 - Math.exp(-dt * 0.35));

    const centers: SystemPhase[] = [...PHASE_SEQUENCE];
    const spread = 0.16;
    const blend = centers.reduce((acc, phase, index) => {
      const center = index / (centers.length - 1);
      const distance = Math.abs(this.phaseSignal - center);
      const weight = clamp(1 - distance / spread, 0, 1);
      acc[phase] = weight * weight * (3 - 2 * weight);
      return acc;
    }, { calm: 0, anomaly: 0, emergence: 0, pressure: 0, breach: 0 } as Record<SystemPhase, number>);

    const total = Object.values(blend).reduce((sum, value) => sum + value, 0) || 1;
    for (const phase of centers) {
      blend[phase] /= total;
    }

    let dominant: SystemPhase = 'calm';
    for (const phase of centers) {
      if (blend[phase] > blend[dominant]) dominant = phase;
    }

    this.phaseState = {
      current: dominant,
      progress: this.phaseSignal,
      blend,
    };
  }

  private createField(): FieldCell[] {
    const cells: FieldCell[] = [];
    for (let row = 0; row < TOPOLOGY_ROWS; row += 1) {
      for (let col = 0; col < TOPOLOGY_COLS; col += 1) {
        const index = row * TOPOLOGY_COLS + col;
        const flowAngle = this.rng.range(0, TWO_PI);
        cells.push({
          index,
          col,
          row,
          center: {
            x: col * CELL_WIDTH + CELL_WIDTH * 0.5,
            y: row * CELL_HEIGHT + CELL_HEIGHT * 0.5,
          },
          bounds: {
            x: col * CELL_WIDTH,
            y: row * CELL_HEIGHT,
            width: CELL_WIDTH,
            height: CELL_HEIGHT,
          },
          flow: {
            x: Math.cos(flowAngle) * this.rng.range(0.08, 0.42),
            y: Math.sin(flowAngle) * this.rng.range(0.08, 0.42),
          },
          containment: this.rng.range(0.24, 0.76),
          instability: this.rng.range(0.01, 0.06),
          resonance: 0,
          density: 0,
          hazard: 0,
        });
      }
    }
    return cells;
  }

  private createBarriers(): BarrierSegment[] {
    const barriers: BarrierSegment[] = [];

    for (let col = 1; col < TOPOLOGY_COLS; col += 1) {
      const x = col * CELL_WIDTH;
      for (let row = 0; row < TOPOLOGY_ROWS; row += 1) {
        const spanStart = row * CELL_HEIGHT;
        const spanEnd = spanStart + CELL_HEIGHT;
        barriers.push({
          axis: 'vertical',
          position: x,
          spanStart,
          spanEnd,
          gateCenter: spanStart + CELL_HEIGHT * this.rng.range(0.34, 0.66),
          gateSize: CELL_HEIGHT * this.rng.range(0.18, 0.26),
          strength: this.rng.range(0.42, 0.82),
        });
      }
    }

    for (let row = 1; row < TOPOLOGY_ROWS; row += 1) {
      const y = row * CELL_HEIGHT;
      for (let col = 0; col < TOPOLOGY_COLS; col += 1) {
        const spanStart = col * CELL_WIDTH;
        const spanEnd = spanStart + CELL_WIDTH;
        barriers.push({
          axis: 'horizontal',
          position: y,
          spanStart,
          spanEnd,
          gateCenter: spanStart + CELL_WIDTH * this.rng.range(0.34, 0.66),
          gateSize: CELL_WIDTH * this.rng.range(0.16, 0.24),
          strength: this.rng.range(0.36, 0.74),
        });
      }
    }

    return barriers;
  }

  private resetFieldMetrics(dt: number): void {
    for (const cell of this.field) {
      cell.density = 0;
      cell.resonance *= 0.24;
      cell.instability = clamp(cell.instability * 0.996 + this.phaseState.blend.anomaly * 0.0005 + this.phaseState.blend.breach * 0.0018, 0, 1.4);
      cell.hazard = clamp(cell.instability * 0.72 + cell.containment * 0.12, 0, 1.4);
      cell.flow.x = lerp(cell.flow.x, cell.flow.x * 0.96 + Math.sin(this.time * 0.08 + cell.row) * 0.015, 1 - Math.exp(-dt * 0.2));
      cell.flow.y = lerp(cell.flow.y, cell.flow.y * 0.96 + Math.cos(this.time * 0.06 + cell.col) * 0.015, 1 - Math.exp(-dt * 0.2));
    }
  }

  private finalizeFieldMetrics(): void {
    const smoothed = this.field.map((cell) => {
      const neighbors = this.getCellNeighbors(cell);
      const neighborInstability = neighbors.reduce((sum, neighbor) => sum + neighbor.instability, 0) / Math.max(1, neighbors.length);
      const densityFactor = cell.density / 8;
      const resonanceFactor = cell.resonance / Math.max(1, cell.density || 1);
      return clamp(cell.instability * 0.58 + neighborInstability * 0.28 + densityFactor * 0.06 + resonanceFactor * 0.32, 0, 1.45);
    });

    smoothed.forEach((instability, index) => {
      const cell = this.field[index];
      cell.instability = instability;
      cell.hazard = clamp(instability * 0.76 + cell.density / 14 + cell.containment * 0.1, 0, 1.5);
      cell.resonance = cell.density > 0 ? cell.resonance / cell.density : 0;
    });
  }

  private updateEntities(dt: number): void {
    const survivors: Entity[] = [];

    for (const entity of this.entities) {
      const cell = this.getCellAt(entity.position.x, entity.position.y);
      const driftAngle = entity.phase + entity.driftBias + this.time * 0.03;

      if (entity.role === 'harmonic') {
        const centerDx = cell.center.x - entity.position.x;
        const centerDy = cell.center.y - entity.position.y;
        entity.velocity.x += centerDx * 0.004 * dt + Math.cos(driftAngle) * 7 * dt + cell.flow.x * 10 * dt;
        entity.velocity.y += centerDy * 0.004 * dt + Math.sin(driftAngle) * 7 * dt + cell.flow.y * 10 * dt;
        entity.energy = clamp(entity.energy + (0.34 - entity.energy) * dt * 0.18 - cell.hazard * 0.0022, 0.2, 0.54);
      } else if (entity.role === 'anomaly') {
        const jitter = 18 + cell.hazard * 10;
        entity.velocity.x += Math.sin(entity.phase * 4 + this.time * 6 + entity.id) * jitter * dt;
        entity.velocity.y += Math.cos(entity.phase * 3.6 + this.time * 6.5 + entity.id) * jitter * dt;
        entity.velocity.x += cell.flow.x * 14 * dt;
        entity.velocity.y += cell.flow.y * 14 * dt;
        entity.instability = clamp(entity.instability + cell.hazard * dt * 0.05, 0, 1.2);
        entity.energy = clamp(entity.energy + 0.01 * dt + cell.hazard * 0.008 * dt, 0.28, 0.75);
      } else {
        const hotspot = this.hotspots[0];
        const targetX = hotspot?.x ?? cell.center.x;
        const targetY = hotspot?.y ?? cell.center.y;
        const dx = targetX - entity.position.x;
        const dy = targetY - entity.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        entity.velocity.x += (dx / dist) * (18 + cell.hazard * 16) * dt + Math.cos(driftAngle * 1.6) * 4.5 * dt;
        entity.velocity.y += (dy / dist) * (18 + cell.hazard * 16) * dt + Math.sin(driftAngle * 1.6) * 4.5 * dt;
        entity.charge = clamp(entity.charge + dt * (0.035 + this.phaseState.blend.breach * 0.06 + cell.hazard * 0.02), 0, 1.8);
        entity.pulse = Math.max(entity.pulse, this.rhythmicPressure * 0.45 + cell.hazard * 0.2);
        entity.energy = clamp(entity.energy + dt * 0.022 + cell.hazard * 0.012 * dt, 0.58, 1.12);
      }

      if (this.zone.charge > 0.001) {
        const dx = entity.position.x - this.zone.position.x;
        const dy = entity.position.y - this.zone.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < this.zone.radius) {
          const influence = 1 - dist / this.zone.radius;
          entity.velocity.x += (dx / dist) * STABILIZER_STRENGTH * influence * dt;
          entity.velocity.y += (dy / dist) * STABILIZER_STRENGTH * influence * dt;
          entity.energy *= 1 - (1 - STABILIZER_HEAT_DAMPING) * influence * 0.14;
          entity.charge *= 1 - influence * 0.26;
          entity.instability *= 1 - influence * 0.34;
          entity.resonance *= 1 - influence * 0.3;
          cell.instability = Math.max(0, cell.instability - influence * dt * 0.2);
          this.stability += STABILIZER_RECOVERY * influence * dt;
          this.zone.recovery += influence * 0.007;
          this.zone.pulse = Math.min(1.3, this.zone.pulse + influence * 0.05);
        }
      }

      this.applyBarrierInfluence(entity, dt);

      const drag = entity.role === 'breach' ? 0.989 : entity.role === 'anomaly' ? 0.982 : 0.992;
      entity.velocity.x *= drag;
      entity.velocity.y *= drag;
      entity.position.x += entity.velocity.x * dt;
      entity.position.y += entity.velocity.y * dt;

      if (entity.position.x < 0 || entity.position.x > WORLD_WIDTH) {
        entity.position.x = clamp(entity.position.x, 0, WORLD_WIDTH);
        entity.velocity.x *= -0.8;
      }
      if (entity.position.y < 0 || entity.position.y > WORLD_HEIGHT) {
        entity.position.y = clamp(entity.position.y, 0, WORLD_HEIGHT);
        entity.velocity.y *= -0.8;
      }

      entity.lifespan -= dt;
      const shouldDecay = entity.role !== 'harmonic' && entity.lifespan <= 0 && this.rng.next() < 0.2;
      if (!shouldDecay) {
        survivors.push(entity);
      }
    }

    this.entities = survivors;
    if (this.zone.charge > 0) {
      const discharge = this.zone.active ? 0.28 : 0.65;
      this.zone.charge = Math.max(0, this.zone.charge - dt * discharge);
    }
  }

  private spawnByPhase(dt: number): void {
    const anomalyChance = (0.006 + this.phaseState.blend.anomaly * 0.026 + this.phaseState.blend.emergence * 0.018) * dt;
    const breachChance = (this.phaseState.blend.emergence * 0.006 + this.phaseState.blend.pressure * 0.016 + this.phaseState.blend.breach * 0.024) * dt;
    const harmonicChance = Math.max(0, (0.01 - this.entities.length * 0.00005) * dt);

    if (this.entities.length < INITIAL_HARMONIC_COUNT + 6 && this.rng.next() < harmonicChance) {
      this.entities.push(this.createEntity('harmonic', this.pickFieldAnchor()));
    }

    if (this.entities.length < MAX_ENTITIES && this.rng.next() < anomalyChance) {
      const cell = this.pickHazardCell(this.phaseState.blend.anomaly > 0.3 ? 0.18 : 0.12);
      if (cell) {
        this.entities.push(this.createEntity('anomaly', cell.center, cell));
        cell.instability = clamp(cell.instability + 0.04, 0, 1.4);
      }
    }

    if (this.entities.length < MAX_ENTITIES && this.rng.next() < breachChance) {
      const cell = this.pickHazardCell(0.28);
      if (cell) {
        const anchor = this.findRoleInCell('anomaly', cell.index)?.position ?? cell.center;
        this.entities.push(this.createEntity('breach', anchor, cell));
        cell.instability = clamp(cell.instability + 0.08, 0, 1.4);
        this.stability = clamp(this.stability - 0.012, 0, 1);
      }
    }

    const pressureGrowth = this.phaseState.blend.pressure * 0.004 + this.phaseState.blend.breach * 0.01;
    if (this.entities.length < MAX_ENTITIES && pressureGrowth > 0 && this.rng.next() < pressureGrowth * dt * 60) {
      const breeder = this.entities.find((entity) => entity.role === 'breach' && entity.charge > 0.55);
      if (breeder) {
        const cell = this.getCellAt(breeder.position.x, breeder.position.y);
        this.entities.push(this.createEntity('breach', breeder.position, cell));
        breeder.charge *= 0.72;
        breeder.pulse = 1;
      }
    }
  }

  private computeHotspots(): Hotspot[] {
    return [...this.field]
      .sort((a, b) => b.hazard - a.hazard)
      .slice(0, MAX_POCKET_INDICATORS)
      .filter((cell) => cell.hazard > 0.18)
      .map((cell) => ({
        x: cell.center.x,
        y: cell.center.y,
        intensity: clamp(cell.hazard, 0, 1.4),
        radius: Math.min(cell.bounds.width, cell.bounds.height) * (0.14 + cell.hazard * 0.12),
      }));
  }

  private applyBarrierInfluence(entity: Entity, dt: number): void {
    for (const barrier of this.barriers) {
      if (barrier.axis === 'vertical') {
        if (entity.position.y < barrier.spanStart || entity.position.y > barrier.spanEnd) continue;
        const offsetToGate = Math.abs(entity.position.y - barrier.gateCenter);
        if (offsetToGate < barrier.gateSize * 0.5) continue;
        const dist = Math.abs(entity.position.x - barrier.position);
        if (dist > 22) continue;
        const push = (1 - dist / 22) * barrier.strength * 40;
        const direction = entity.position.x < barrier.position ? -1 : 1;
        entity.velocity.x += direction * push * dt;
      } else {
        if (entity.position.x < barrier.spanStart || entity.position.x > barrier.spanEnd) continue;
        const offsetToGate = Math.abs(entity.position.x - barrier.gateCenter);
        if (offsetToGate < barrier.gateSize * 0.5) continue;
        const dist = Math.abs(entity.position.y - barrier.position);
        if (dist > 22) continue;
        const push = (1 - dist / 22) * barrier.strength * 34;
        const direction = entity.position.y < barrier.position ? -1 : 1;
        entity.velocity.y += direction * push * dt;
      }
    }
  }

  private createEntity(role: EntityRole, anchor?: { x: number; y: number }, preferredCell?: FieldCell): Entity {
    const cell = preferredCell ?? this.getCellAt(anchor?.x ?? WORLD_WIDTH * 0.5, anchor?.y ?? WORLD_HEIGHT * 0.5);
    const scatter = Math.min(cell.bounds.width, cell.bounds.height) * (role === 'harmonic' ? 0.32 : 0.18);
    const x = anchor
      ? clamp(anchor.x + this.rng.range(-scatter, scatter), cell.bounds.x + 12, cell.bounds.x + cell.bounds.width - 12)
      : this.rng.range(cell.bounds.x + 24, cell.bounds.x + cell.bounds.width - 24);
    const y = anchor
      ? clamp(anchor.y + this.rng.range(-scatter, scatter), cell.bounds.y + 12, cell.bounds.y + cell.bounds.height - 12)
      : this.rng.range(cell.bounds.y + 24, cell.bounds.y + cell.bounds.height - 24);
    const angle = this.rng.range(0, TWO_PI);
    const speed = role === 'breach' ? this.rng.range(12, 22) : role === 'anomaly' ? this.rng.range(8, 18) : this.rng.range(4, 14);

    return {
      id: this.nextId += 1,
      role,
      position: { x, y },
      velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      energy: clamp(roleEnergy[role] + this.rng.range(-0.08, 0.08), 0.18, 1.15),
      phase: this.rng.range(0, TWO_PI),
      resonance: role === 'harmonic' ? this.rng.range(0.01, 0.06) : this.rng.range(0.02, 0.12),
      charge: role === 'breach' ? this.rng.range(0.16, 0.42) : this.rng.range(0, 0.12),
      cluster: 0,
      driftBias: this.rng.range(-0.7, 0.7),
      age: this.rng.range(0, 8),
      pulse: role === 'breach' ? 0.4 : 0,
      instability: role === 'harmonic' ? 0.02 : role === 'anomaly' ? 0.28 : 0.52,
      lifespan: role === 'harmonic' ? Number.POSITIVE_INFINITY : role === 'anomaly' ? this.rng.range(18, 44) : this.rng.range(34, 72),
    };
  }

  private pickHazardCell(minHazard: number): FieldCell | undefined {
    const ranked = [...this.field].sort((a, b) => b.hazard - a.hazard);
    const candidates = ranked.filter((cell) => cell.hazard >= minHazard);
    if (candidates.length === 0) {
      return ranked[0];
    }
    return candidates[Math.floor(this.rng.range(0, Math.max(0.999, candidates.length - 0.001)))];
  }

  private findRoleInCell(role: EntityRole, cellIndex: number): Entity | undefined {
    return this.entities.find((entity) => entity.role === role && this.getCellAt(entity.position.x, entity.position.y).index === cellIndex);
  }

  private pickFieldAnchor(): { x: number; y: number } {
    const cell = this.field[Math.floor(this.rng.range(0, this.field.length - 0.001))] ?? this.field[0];
    return {
      x: lerp(cell.bounds.x + 24, cell.bounds.x + cell.bounds.width - 24, this.rng.next()),
      y: lerp(cell.bounds.y + 24, cell.bounds.y + cell.bounds.height - 24, this.rng.next()),
    };
  }

  private getCellAt(x: number, y: number): FieldCell {
    const col = clamp(Math.floor(x / CELL_WIDTH), 0, TOPOLOGY_COLS - 1);
    const row = clamp(Math.floor(y / CELL_HEIGHT), 0, TOPOLOGY_ROWS - 1);
    return this.field[row * TOPOLOGY_COLS + col] as FieldCell;
  }

  private getCellNeighbors(cell: FieldCell): FieldCell[] {
    const neighbors: FieldCell[] = [];
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let colOffset = -1; colOffset <= 1; colOffset += 1) {
        if (rowOffset === 0 && colOffset === 0) continue;
        const row = cell.row + rowOffset;
        const col = cell.col + colOffset;
        if (row < 0 || row >= TOPOLOGY_ROWS || col < 0 || col >= TOPOLOGY_COLS) continue;
        neighbors.push(this.field[row * TOPOLOGY_COLS + col] as FieldCell);
      }
    }
    return neighbors;
  }
}
