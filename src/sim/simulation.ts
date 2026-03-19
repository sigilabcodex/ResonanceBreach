import {
  BASE_STABILITY_DRAIN,
  INITIAL_ENTITY_COUNT,
  MAX_ENTITIES,
  MAX_POCKET_INDICATORS,
  RESONANCE_ALIGNMENT_THRESHOLD,
  RESONANCE_RANGE,
  SPAWN_PRESSURE_THRESHOLD,
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
  type EntityType,
} from '../config';
import { Rng } from './random';
import type { BarrierSegment, Entity, FieldCell, Hotspot, SimulationSnapshot, StabilizerZone } from './types';

const TWO_PI = Math.PI * 2;
const CELL_WIDTH = WORLD_WIDTH / TOPOLOGY_COLS;
const CELL_HEIGHT = WORLD_HEIGHT / TOPOLOGY_ROWS;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const entityTypeEnergy: Record<EntityType, number> = {
  seed: 0.42,
  wave: 0.62,
  fracture: 0.9,
};

export class Simulation {
  private rng = new Rng(0xdecafbad);
  private entities: Entity[] = [];
  private field: FieldCell[] = [];
  private barriers: BarrierSegment[] = [];
  private hotspots: Hotspot[] = [];
  private nextId = 1;
  private time = 0;
  private stability = 0.88;
  private pressure = 0;
  private avgResonance = 0;
  private outbreakRisk = 0;
  private lost = false;
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
    this.stability = 0.88;
    this.pressure = 0;
    this.avgResonance = 0;
    this.outbreakRisk = 0;
    this.lost = false;
    this.zone.active = false;
    this.zone.charge = 0;
    this.zone.pulse = 0;
    this.zone.recovery = 0;

    for (let i = 0; i < INITIAL_ENTITY_COUNT; i += 1) {
      this.entities.push(this.createEntity(this.pickFieldAnchor()));
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

  update(dt: number): void {
    this.time += dt;
    this.zone.recovery *= 0.92;
    this.zone.pulse = Math.max(0, this.zone.pulse - dt * 0.9);

    if (this.lost) {
      this.zone.charge = Math.max(0, this.zone.charge - dt * 0.45);
      return;
    }

    this.resetFieldMetrics();

    let resonanceTotal = 0;
    let clusterPressure = 0;
    let interactionCount = 0;

    for (const entity of this.entities) {
      entity.age += dt;
      entity.phase = (entity.phase + dt * (0.35 + entity.energy * 0.28 + entity.charge * 0.45)) % TWO_PI;
      entity.resonance *= 0.93;
      entity.cluster *= 0.88;
      entity.charge = Math.max(0, entity.charge - dt * 0.06);

      const cell = this.getCellAt(entity.position.x, entity.position.y);
      cell.density += 1;
      cell.resonance += entity.resonance;
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
        const nx = dx / dist;
        const ny = dy / dist;
        const proximity = 1 - dist / RESONANCE_RANGE;
        const phaseAlignment = (Math.cos(a.phase - b.phase) + 1) * 0.5;
        const antiPhase = 1 - phaseAlignment;
        const localA = this.getCellAt(a.position.x, a.position.y);
        const localB = this.getCellAt(b.position.x, b.position.y);
        const sharedHazard = (localA.hazard + localB.hazard) * 0.5;
        const energyBlend = (a.energy + b.energy) * 0.5;
        const resonance = proximity * (phaseAlignment * 0.9 + sharedHazard * 0.45) * energyBlend;
        const clusterFactor = proximity * (0.55 + sharedHazard + (localA.density + localB.density) * 0.01);

        const attraction = (phaseAlignment * 2 - 1) * (18 + sharedHazard * 26) + clusterFactor * 14;
        const repulsion = antiPhase * (14 + (a.charge + b.charge) * 30);
        const swirl = (0.5 - phaseAlignment) * (22 + sharedHazard * 35);

        a.velocity.x += nx * (attraction - repulsion) * dt;
        a.velocity.y += ny * (attraction - repulsion) * dt;
        b.velocity.x -= nx * (attraction - repulsion) * dt;
        b.velocity.y -= ny * (attraction - repulsion) * dt;

        a.velocity.x += -ny * swirl * dt;
        a.velocity.y += nx * swirl * dt;
        b.velocity.x -= -ny * swirl * dt;
        b.velocity.y -= nx * swirl * dt;

        a.resonance += resonance * 0.03;
        b.resonance += resonance * 0.03;
        a.cluster += clusterFactor * 0.08;
        b.cluster += clusterFactor * 0.08;

        if (phaseAlignment > RESONANCE_ALIGNMENT_THRESHOLD && proximity > 0.42) {
          const chargeGain = resonance * (0.024 + clusterFactor * 0.012);
          a.charge = clamp(a.charge + chargeGain, 0, 1.7);
          b.charge = clamp(b.charge + chargeGain, 0, 1.7);
          localA.instability = clamp(localA.instability + resonance * 0.008, 0, 1.5);
          localB.instability = clamp(localB.instability + resonance * 0.008, 0, 1.5);
          clusterPressure += resonance * (0.8 + clusterFactor);
        }

        resonanceTotal += resonance;
        interactionCount += 1;
      }
    }

    this.finalizeFieldMetrics();

    if (this.zone.charge > 0) {
      const discharge = this.zone.active ? 0.22 : 0.8;
      this.zone.charge = Math.max(0, this.zone.charge - dt * discharge);
    }

    for (const entity of this.entities) {
      const cell = this.getCellAt(entity.position.x, entity.position.y);
      const driftAngle = entity.phase + entity.driftBias + this.time * (0.04 + entity.energy * 0.03);
      const flowMix = 14 + cell.containment * 32;
      const laneBias = Math.sin(entity.position.y * 0.012 + cell.flow.x) * 8;

      entity.velocity.x += cell.flow.x * flowMix * dt + Math.cos(driftAngle) * (8 + entity.energy * 12) * dt;
      entity.velocity.y += cell.flow.y * flowMix * dt + Math.sin(driftAngle * 0.9 + laneBias * 0.04) * (7 + entity.energy * 11) * dt;

      const centerDx = cell.center.x - entity.position.x;
      const centerDy = cell.center.y - entity.position.y;
      entity.velocity.x += centerDx * cell.containment * 0.0025 * dt;
      entity.velocity.y += centerDy * cell.containment * 0.0025 * dt;

      if (cell.hazard > 0.4) {
        const orbital = 18 * cell.hazard;
        entity.velocity.x += -centerDy * orbital * 0.0006 * dt;
        entity.velocity.y += centerDx * orbital * 0.0006 * dt;
      }

      if (this.zone.charge > 0.001) {
        const dx = entity.position.x - this.zone.position.x;
        const dy = entity.position.y - this.zone.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < this.zone.radius) {
          const influence = 1 - dist / this.zone.radius;
          const nx = dx / dist;
          const ny = dy / dist;
          const pulseStrength = this.zone.active ? 1.1 : 0.8;
          entity.velocity.x += nx * STABILIZER_STRENGTH * (0.4 + influence * pulseStrength) * dt;
          entity.velocity.y += ny * STABILIZER_STRENGTH * (0.4 + influence * pulseStrength) * dt;
          entity.velocity.x += cell.flow.x * -20 * influence * dt;
          entity.velocity.y += cell.flow.y * -20 * influence * dt;
          entity.energy *= 1 - (1 - STABILIZER_HEAT_DAMPING) * influence * 0.22;
          entity.resonance *= 1 - influence * 0.36;
          entity.charge *= 1 - influence * 0.46;
          entity.cluster *= 1 - influence * 0.34;
          cell.instability = Math.max(0, cell.instability - influence * dt * 0.9);
          this.stability += STABILIZER_RECOVERY * influence * dt;
          this.zone.recovery += influence * 0.01;
          this.zone.pulse = Math.min(1.4, this.zone.pulse + influence * 0.08);
        }
      }

      this.applyBarrierInfluence(entity, dt);

      const drag = 0.992 - entity.energy * 0.008 - entity.charge * 0.01;
      entity.velocity.x *= drag;
      entity.velocity.y *= drag;
      entity.position.x += entity.velocity.x * dt;
      entity.position.y += entity.velocity.y * dt;

      if (entity.position.x < 0 || entity.position.x > WORLD_WIDTH) {
        entity.position.x = clamp(entity.position.x, 0, WORLD_WIDTH);
        entity.velocity.x *= -0.9;
      }
      if (entity.position.y < 0 || entity.position.y > WORLD_HEIGHT) {
        entity.position.y = clamp(entity.position.y, 0, WORLD_HEIGHT);
        entity.velocity.y *= -0.9;
      }

      const postCell = this.getCellAt(entity.position.x, entity.position.y);
      entity.energy = clamp(
        entity.energy + entity.resonance * 0.007 + postCell.hazard * 0.004 + entity.charge * 0.003 - 0.0012,
        0.22,
        1.35,
      );
    }

    const spawnBudget = this.resolveOutbreaks(dt, clusterPressure);
    const normalizedEntityPressure = Math.max(0, this.entities.length - INITIAL_ENTITY_COUNT) / (MAX_ENTITIES - INITIAL_ENTITY_COUNT);
    const interactionResonance = interactionCount > 0 ? resonanceTotal / interactionCount : 0;
    this.avgResonance = resonanceTotal / Math.max(1, this.entities.length);
    this.outbreakRisk = clamp(spawnBudget * 0.22 + this.highestCellHazard() * 0.55, 0, 1.6);
    this.pressure = clamp(interactionResonance * 1.6 + normalizedEntityPressure * 0.9 + this.outbreakRisk * 0.7, 0, 1.8);

    const stabilityDrift = BASE_STABILITY_DRAIN + this.pressure * 0.036 + this.outbreakRisk * 0.028;
    const passiveRecovery = Math.max(0, (1 - this.pressure) * STABILITY_RECOVERY * 0.08);
    this.stability = clamp(this.stability - stabilityDrift * dt + passiveRecovery * dt + this.zone.recovery * 0.018, 0, 1);

    if (this.entities.length >= MAX_ENTITIES) {
      this.stability = clamp(this.stability - dt * 0.11, 0, 1);
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
    };
  }

  private createField(): FieldCell[] {
    const cells: FieldCell[] = [];
    for (let row = 0; row < TOPOLOGY_ROWS; row += 1) {
      for (let col = 0; col < TOPOLOGY_COLS; col += 1) {
        const index = row * TOPOLOGY_COLS + col;
        const flowAngle = this.rng.range(0, TWO_PI);
        const containment = this.rng.range(0.18, 0.72);
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
            x: Math.cos(flowAngle) * this.rng.range(0.2, 0.95),
            y: Math.sin(flowAngle) * this.rng.range(0.2, 0.95),
          },
          containment,
          instability: this.rng.range(0.02, 0.16),
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
          gateCenter: spanStart + CELL_HEIGHT * this.rng.range(0.28, 0.72),
          gateSize: CELL_HEIGHT * this.rng.range(0.18, 0.28),
          strength: this.rng.range(0.65, 1.05),
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
          gateCenter: spanStart + CELL_WIDTH * this.rng.range(0.24, 0.76),
          gateSize: CELL_WIDTH * this.rng.range(0.16, 0.24),
          strength: this.rng.range(0.5, 0.92),
        });
      }
    }

    return barriers;
  }

  private resetFieldMetrics(): void {
    for (const cell of this.field) {
      cell.density = 0;
      cell.resonance *= 0.4;
      cell.instability = clamp(cell.instability * 0.988 + 0.003, 0, 1.4);
      cell.hazard = clamp(cell.instability * 0.72 + cell.containment * 0.18, 0, 1.4);
    }
  }

  private finalizeFieldMetrics(): void {
    const smoothed = this.field.map((cell) => {
      const neighbors = this.getCellNeighbors(cell);
      const neighborInstability = neighbors.reduce((sum, neighbor) => sum + neighbor.instability, 0) / Math.max(1, neighbors.length);
      const densityFactor = cell.density / 7.5;
      const resonanceFactor = cell.resonance / Math.max(1, cell.density || 1);
      return clamp(cell.instability * 0.62 + neighborInstability * 0.28 + densityFactor * 0.08 + resonanceFactor * 0.4, 0, 1.5);
    });

    smoothed.forEach((instability, index) => {
      const cell = this.field[index];
      cell.instability = instability;
      cell.hazard = clamp(instability * 0.78 + cell.density / 10 + cell.containment * 0.12, 0, 1.55);
      cell.resonance = cell.density > 0 ? cell.resonance / cell.density : 0;
    });
  }

  private resolveOutbreaks(dt: number, clusterPressure: number): number {
    let spawnBudget = 0;

    const hazardCells = [...this.field].sort((a, b) => b.hazard - a.hazard).slice(0, 6);
    for (const cell of hazardCells) {
      if (cell.density <= 0) continue;

      const localEntities = this.entities.filter((entity) => this.getCellAt(entity.position.x, entity.position.y).index === cell.index);
      const criticalEntities = localEntities.filter((entity) => entity.charge > 0.42 || entity.resonance > 0.11);
      const localPressure = cell.hazard * 0.9 + criticalEntities.length * 0.12 + clusterPressure * 0.0022;
      spawnBudget += localPressure;

      if (
        localPressure * dt > SPAWN_PRESSURE_THRESHOLD * dt &&
        this.entities.length < MAX_ENTITIES &&
        this.rng.next() < clamp(localPressure * dt * 0.42, 0, 0.7)
      ) {
        const burstCount = criticalEntities.length > 2 && this.rng.next() < 0.45 ? 2 : 1;
        const anchor = criticalEntities[0]?.position ?? cell.center;
        for (let i = 0; i < burstCount && this.entities.length < MAX_ENTITIES; i += 1) {
          this.entities.push(this.createEntity({ x: anchor.x, y: anchor.y }, cell));
        }
        cell.instability = clamp(cell.instability + 0.08, 0, 1.5);
        this.stability = clamp(this.stability - 0.016 * burstCount, 0, 1);
      }

      for (const entity of criticalEntities) {
        entity.charge = clamp(entity.charge + cell.hazard * dt * 0.32, 0, 1.9);
        entity.resonance += cell.hazard * dt * 0.014;
      }
    }

    return spawnBudget;
  }

  private computeHotspots(): Hotspot[] {
    return [...this.field]
      .sort((a, b) => b.hazard - a.hazard)
      .slice(0, MAX_POCKET_INDICATORS)
      .filter((cell) => cell.hazard > 0.42)
      .map((cell) => ({
        x: cell.center.x,
        y: cell.center.y,
        intensity: clamp(cell.hazard, 0, 1.4),
        radius: Math.min(cell.bounds.width, cell.bounds.height) * (0.22 + cell.hazard * 0.16),
      }));
  }

  private applyBarrierInfluence(entity: Entity, dt: number): void {
    for (const barrier of this.barriers) {
      if (barrier.axis === 'vertical') {
        if (entity.position.y < barrier.spanStart || entity.position.y > barrier.spanEnd) continue;
        const offsetToGate = Math.abs(entity.position.y - barrier.gateCenter);
        if (offsetToGate < barrier.gateSize * 0.5) continue;
        const dist = Math.abs(entity.position.x - barrier.position);
        if (dist > 28) continue;
        const push = (1 - dist / 28) * barrier.strength * 90;
        const direction = entity.position.x < barrier.position ? -1 : 1;
        entity.velocity.x += direction * push * dt;
        entity.velocity.y += (entity.position.y < barrier.gateCenter ? -1 : 1) * push * 0.18 * dt;
      } else {
        if (entity.position.x < barrier.spanStart || entity.position.x > barrier.spanEnd) continue;
        const offsetToGate = Math.abs(entity.position.x - barrier.gateCenter);
        if (offsetToGate < barrier.gateSize * 0.5) continue;
        const dist = Math.abs(entity.position.y - barrier.position);
        if (dist > 28) continue;
        const push = (1 - dist / 28) * barrier.strength * 76;
        const direction = entity.position.y < barrier.position ? -1 : 1;
        entity.velocity.y += direction * push * dt;
        entity.velocity.x += (entity.position.x < barrier.gateCenter ? -1 : 1) * push * 0.15 * dt;
      }
    }
  }

  private createEntity(anchor?: { x: number; y: number }, preferredCell?: FieldCell): Entity {
    const type = this.pickType();
    const cell = preferredCell ?? this.getCellAt(anchor?.x ?? WORLD_WIDTH * 0.5, anchor?.y ?? WORLD_HEIGHT * 0.5);
    const scatter = Math.min(cell.bounds.width, cell.bounds.height) * 0.28;
    const x = anchor
      ? clamp(anchor.x + this.rng.range(-scatter, scatter), cell.bounds.x + 12, cell.bounds.x + cell.bounds.width - 12)
      : this.rng.range(cell.bounds.x + 24, cell.bounds.x + cell.bounds.width - 24);
    const y = anchor
      ? clamp(anchor.y + this.rng.range(-scatter, scatter), cell.bounds.y + 12, cell.bounds.y + cell.bounds.height - 12)
      : this.rng.range(cell.bounds.y + 24, cell.bounds.y + cell.bounds.height - 24);
    const angle = this.rng.range(0, TWO_PI);
    const speed = this.rng.range(10, 36);

    return {
      id: this.nextId += 1,
      type,
      position: { x, y },
      velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      energy: clamp(entityTypeEnergy[type] + this.rng.range(-0.1, 0.14), 0.24, 1.2),
      phase: this.rng.range(0, TWO_PI),
      resonance: this.rng.range(0, 0.03),
      charge: this.rng.range(0, 0.12),
      cluster: 0,
      driftBias: this.rng.range(-0.8, 0.8),
      age: this.rng.range(0, 5),
    };
  }

  private pickType(): EntityType {
    const roll = this.rng.next();
    if (roll < 0.48) return 'seed';
    if (roll < 0.84) return 'wave';
    return 'fracture';
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

  private highestCellHazard(): number {
    let highest = 0;
    for (const cell of this.field) {
      if (cell.hazard > highest) highest = cell.hazard;
    }
    return highest;
  }
}
