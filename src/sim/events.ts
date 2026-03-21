import type { EntityType, ToolType } from '../config';
import type { Vec2, WorldNotifications } from '../types/world';

const speciesName = (entityType: EntityType) => ({
  plant: 'Rooted Bloom',
  flocker: 'Pollinator Drifter',
  cluster: 'Decomposer',
  grazer: 'Grazer',
  predator: 'Predator',
}[entityType]);

interface WorldEventBase {
  id: number;
  time: number;
  position: Vec2;
}

export interface EntityBornEvent extends WorldEventBase {
  type: 'entityBorn';
  entityType: EntityType;
  entityId: number;
}

export interface EntityFedEvent extends WorldEventBase {
  type: 'entityFed';
  entityType: EntityType;
  entityId: number;
  foodKind: 'fruit' | 'feed';
}

export interface EntityDiedEvent extends WorldEventBase {
  type: 'entityDied';
  entityType: EntityType;
  entityId: number;
}

export interface ToolUsedEvent extends WorldEventBase {
  type: 'toolUsed';
  tool: ToolType;
  blocked: boolean;
}

export interface ResidueCreatedEvent extends WorldEventBase {
  type: 'residueCreated';
  nutrient: number;
}

export interface FruitCreatedEvent extends WorldEventBase {
  type: 'fruitCreated';
  sourceEntityId: number;
  count: number;
}

export type WorldEvent = EntityBornEvent | EntityFedEvent | EntityDiedEvent | ToolUsedEvent | ResidueCreatedEvent | FruitCreatedEvent;
export type WorldEventInput =
  | Omit<EntityBornEvent, 'id'>
  | Omit<EntityFedEvent, 'id'>
  | Omit<EntityDiedEvent, 'id'>
  | Omit<ToolUsedEvent, 'id'>
  | Omit<ResidueCreatedEvent, 'id'>
  | Omit<FruitCreatedEvent, 'id'>;

export class WorldEventQueue {
  private nextId = 1;
  private pending: WorldEvent[] = [];

  create(event: WorldEventInput): WorldEvent {
    const completeEvent = { ...event, id: this.nextId++ } as WorldEvent;
    this.pending.push(completeEvent);
    return completeEvent;
  }

  drain(): WorldEvent[] {
    const drained = this.pending;
    this.pending = [];
    return drained;
  }
}

export const buildNotifications = (events: WorldEvent[]): WorldNotifications => {
  const recent = events
    .slice(-3)
    .reverse()
    .map((event) => {
      switch (event.type) {
        case 'entityBorn':
          return `${speciesName(event.entityType)} emerged into the field`;
        case 'entityFed':
          return `${speciesName(event.entityType)} fed on ${event.foodKind}`;
        case 'entityDied':
          return `${speciesName(event.entityType)} died and returned to the soil`;
        case 'toolUsed':
          return event.blocked ? `${event.tool} blocked by low resonance energy` : `${event.tool} tool applied`;
        case 'residueCreated':
          return 'residue created and feeding nearby nutrients';
        case 'fruitCreated':
          return `Rooted Bloom fruited into the field (${event.count})`;
      }
    });

  return { recent };
};
