import {
  BASE_STABILITY_DRAIN,
  INITIAL_ENTITY_COUNT,
  MAX_ENTITIES,
  RESONANCE_ALIGNMENT_THRESHOLD,
  RESONANCE_RANGE,
  SPAWN_PRESSURE_THRESHOLD,
  STABILITY_RECOVERY,
  STABILIZER_HEAT_DAMPING,
  STABILIZER_MAX_CHARGE,
  STABILIZER_RADIUS,
  STABILIZER_RECOVERY,
  STABILIZER_STRENGTH,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type EntityType,
} from '../config';
import { Rng } from './random';
import type { Entity, SimulationSnapshot, StabilizerZone } from './types';

const TWO_PI = Math.PI * 2;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const entityTypeEnergy: Record<EntityType, number> = {
  seed: 0.45,
  wave: 0.65,
  fracture: 0.92,
};

export class Simulation {
  private rng = new Rng(0xdecafbad);
  private entities: Entity[] = [];
  private nextId = 1;
  private time = 0;
  private stability = 0.86;
  private pressure = 0;
  private avgResonance = 0;
  private lost = false;
  private zone: StabilizerZone = {
    active: false,
    position: { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 },
    radius: STABILIZER_RADIUS,
    charge: 0,
  };

  constructor() {
    this.reset();
  }

  reset(): void {
    this.rng = new Rng(0xdecafbad);
    this.entities = [];
    this.nextId = 1;
    this.time = 0;
    this.stability = 0.86;
    this.pressure = 0;
    this.avgResonance = 0;
    this.lost = false;
    this.zone.active = false;
    this.zone.charge = 0;

    for (let i = 0; i < INITIAL_ENTITY_COUNT; i += 1) {
      this.entities.push(this.createEntity());
    }
  }

  setZone(active: boolean, x: number, y: number): void {
    this.zone.active = active;
    this.zone.position.x = clamp(x, 0, WORLD_WIDTH);
    this.zone.position.y = clamp(y, 0, WORLD_HEIGHT);
    if (active) {
      this.zone.charge = STABILIZER_MAX_CHARGE;
    }
  }

  update(dt: number): void {
    if (this.lost) {
      this.time += dt;
      this.zone.charge = Math.max(0, this.zone.charge - dt * 0.5);
      return;
    }

    this.time += dt;

    let resonanceTotal = 0;
    let spawnBudget = 0;

    for (const entity of this.entities) {
      entity.age += dt;
      entity.phase = (entity.phase + dt * (0.22 + entity.energy * 0.33)) % TWO_PI;
      entity.resonance *= 0.94;
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
        const energyBlend = (a.energy + b.energy) * 0.5;
        const resonance = proximity * phaseAlignment * energyBlend;

        const attraction = (resonance - 0.28) * 24;
        a.velocity.x += nx * attraction * dt;
        a.velocity.y += ny * attraction * dt;
        b.velocity.x -= nx * attraction * dt;
        b.velocity.y -= ny * attraction * dt;

        const swirl = (0.5 - phaseAlignment) * 30;
        a.velocity.x += -ny * swirl * dt;
        a.velocity.y += nx * swirl * dt;
        b.velocity.x -= -ny * swirl * dt;
        b.velocity.y -= nx * swirl * dt;

        a.resonance += resonance * 0.024;
        b.resonance += resonance * 0.024;
        resonanceTotal += resonance;

        if (phaseAlignment > RESONANCE_ALIGNMENT_THRESHOLD && proximity > 0.5) {
          spawnBudget += resonance * 0.75;
        }
      }
    }

    if (this.zone.charge > 0) {
      const damp = this.zone.active ? 0 : 0.88;
      this.zone.charge = Math.max(0, this.zone.charge - dt * damp);
    }

    for (const entity of this.entities) {
      const driftAngle = entity.phase + entity.age * 0.17 + entity.energy * 2;
      entity.velocity.x += Math.cos(driftAngle) * (8 + entity.energy * 16) * dt;
      entity.velocity.y += Math.sin(driftAngle * 0.87) * (8 + entity.energy * 16) * dt;

      if (this.zone.charge > 0.001) {
        const dx = entity.position.x - this.zone.position.x;
        const dy = entity.position.y - this.zone.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < this.zone.radius) {
          const influence = 1 - dist / this.zone.radius;
          const nx = dx / dist;
          const ny = dy / dist;
          entity.velocity.x += nx * STABILIZER_STRENGTH * influence * dt;
          entity.velocity.y += ny * STABILIZER_STRENGTH * influence * dt;
          entity.energy *= 1 - (1 - STABILIZER_HEAT_DAMPING) * influence * 0.14;
          entity.resonance *= 1 - influence * 0.18;
          this.stability += STABILIZER_RECOVERY * influence * dt;
        }
      }

      const drag = 0.991 - entity.energy * 0.012;
      entity.velocity.x *= drag;
      entity.velocity.y *= drag;
      entity.position.x += entity.velocity.x * dt;
      entity.position.y += entity.velocity.y * dt;

      if (entity.position.x < 0 || entity.position.x > WORLD_WIDTH) {
        entity.position.x = clamp(entity.position.x, 0, WORLD_WIDTH);
        entity.velocity.x *= -0.92;
      }
      if (entity.position.y < 0 || entity.position.y > WORLD_HEIGHT) {
        entity.position.y = clamp(entity.position.y, 0, WORLD_HEIGHT);
        entity.velocity.y *= -0.92;
      }

      entity.energy = clamp(entity.energy + entity.resonance * 0.006 - 0.0008, 0.25, 1.25);
    }

    const normalizedEntityPressure = Math.max(0, this.entities.length - INITIAL_ENTITY_COUNT) / (MAX_ENTITIES - INITIAL_ENTITY_COUNT);
    this.avgResonance = this.entities.length > 0 ? resonanceTotal / this.entities.length : 0;
    this.pressure = clamp(this.avgResonance * 0.9 + normalizedEntityPressure * 0.85 + spawnBudget * 0.0025, 0, 1.8);

    const stabilityDrift = BASE_STABILITY_DRAIN + this.pressure * 0.03 - (1 - this.pressure) * STABILITY_RECOVERY * 0.012;
    this.stability = clamp(this.stability - stabilityDrift * dt + (1 - this.pressure) * STABILITY_RECOVERY * dt * 0.06, 0, 1);

    const spawnChance = spawnBudget * dt * 0.24;
    if (spawnChance > SPAWN_PRESSURE_THRESHOLD * dt && this.entities.length < MAX_ENTITIES && this.rng.next() < spawnChance) {
      this.entities.push(this.createEntity(this.pickSpawnAnchor()));
      this.stability = clamp(this.stability - 0.02, 0, 1);
    }

    if (this.entities.length >= MAX_ENTITIES) {
      this.stability = clamp(this.stability - dt * 0.09, 0, 1);
    }

    this.lost = this.stability <= 0.001;
  }

  getSnapshot(): SimulationSnapshot {
    return {
      entities: this.entities,
      stability: this.stability,
      pressure: this.pressure,
      avgResonance: this.avgResonance,
      zone: this.zone,
      time: this.time,
      lost: this.lost,
    };
  }

  private createEntity(anchor?: { x: number; y: number }): Entity {
    const type = this.pickType();
    const radius = 120;
    const x = anchor ? clamp(anchor.x + this.rng.range(-radius, radius), 0, WORLD_WIDTH) : this.rng.range(120, WORLD_WIDTH - 120);
    const y = anchor ? clamp(anchor.y + this.rng.range(-radius, radius), 0, WORLD_HEIGHT) : this.rng.range(120, WORLD_HEIGHT - 120);
    const angle = this.rng.range(0, TWO_PI);
    const speed = this.rng.range(12, 42);

    return {
      id: this.nextId += 1,
      type,
      position: { x, y },
      velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      energy: entityTypeEnergy[type] + this.rng.range(-0.12, 0.16),
      phase: this.rng.range(0, TWO_PI),
      resonance: 0,
      age: this.rng.range(0, 5),
    };
  }

  private pickType(): EntityType {
    const roll = this.rng.next();
    if (roll < 0.5) return 'seed';
    if (roll < 0.84) return 'wave';
    return 'fracture';
  }

  private pickSpawnAnchor(): { x: number; y: number } {
    let hottest = this.entities[0];
    for (const entity of this.entities) {
      if (!hottest || entity.resonance + entity.energy > hottest.resonance + hottest.energy) {
        hottest = entity;
      }
    }

    return hottest
      ? { x: hottest.position.x, y: hottest.position.y }
      : { x: WORLD_WIDTH * 0.5, y: WORLD_HEIGHT * 0.5 };
  }
}
