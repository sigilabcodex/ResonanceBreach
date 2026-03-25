import type { WorldEvent } from '../sim/events';
import type { SimulationSnapshot } from '../types/world';

export type EcologicalAudioEventType =
  | 'entitySelected'
  | 'movementPulse'
  | 'feedingEvent'
  | 'reproductionEvent'
  | 'predatorAlert'
  | 'decayActivity'
  | 'environmentalPulse'
  | 'toolGesture';

export interface EcologicalAudioEvent {
  id: number;
  time: number;
  type: EcologicalAudioEventType;
  sourceEntityId?: number;
  position: { x: number; y: number };
  intensity: number;
  tags: string[];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const mapWorldEventToEcologicalAudioEvents = (event: WorldEvent): EcologicalAudioEvent[] => {
  switch (event.type) {
    case 'entityFed':
      return [{
        id: event.id,
        time: event.time,
        type: 'feedingEvent',
        sourceEntityId: event.entityId,
        position: event.position,
        intensity: event.foodKind === 'feed' ? 0.88 : 0.72,
        tags: ['entity', event.entityType, event.foodKind],
      }];
    case 'entityBorn':
      return [{
        id: event.id,
        time: event.time,
        type: 'reproductionEvent',
        sourceEntityId: event.entityId,
        position: event.position,
        intensity: 0.64,
        tags: ['entity', event.entityType, 'birth'],
      }];
    case 'fruitCreated':
      return [{
        id: event.id,
        time: event.time,
        type: 'reproductionEvent',
        sourceEntityId: event.sourceEntityId,
        position: event.position,
        intensity: clamp(0.5 + event.count * 0.08, 0.5, 0.95),
        tags: ['fruit', 'propagation'],
      }];
    case 'entityDied':
      return [{
        id: event.id,
        time: event.time,
        type: 'decayActivity',
        sourceEntityId: event.entityId,
        position: event.position,
        intensity: 0.9,
        tags: ['entity', event.entityType, 'death'],
      }];
    case 'residueCreated':
      return [{
        id: event.id,
        time: event.time,
        type: 'decayActivity',
        position: event.position,
        intensity: clamp(event.nutrient, 0.35, 0.82),
        tags: ['residue'],
      }];
    case 'toolUsed':
      return [{
        id: event.id,
        time: event.time,
        type: 'toolGesture',
        position: event.position,
        intensity: event.blocked ? 0.24 : 0.58,
        tags: ['tool', event.tool, event.blocked ? 'blocked' : 'applied'],
      }];
  }
};

export const createEnvironmentalPulseEvent = (snapshot: SimulationSnapshot, id: number): EcologicalAudioEvent => ({
  id,
  time: snapshot.time,
  type: 'environmentalPulse',
  position: snapshot.camera.center,
  intensity: clamp(
    snapshot.stats.activity * 0.42 + snapshot.stats.threat * 0.18 + snapshot.stats.stability * 0.22 + snapshot.stats.growth * 0.18,
    0,
    1,
  ),
  tags: ['environment', 'pulse'],
});
