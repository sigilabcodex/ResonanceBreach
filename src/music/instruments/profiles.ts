import type { InstrumentProfile } from '../types/music';

export const DEFAULT_INSTRUMENT_PROFILES: InstrumentProfile[] = [
  { id: 'pad-garden', family: 'pad', register: 'mid', gain: 0.52, attack: 0.45, release: 1.8, velocityResponse: 0.3 },
  { id: 'pluck-wood', family: 'pluck', register: 'mid', gain: 0.4, attack: 0.01, release: 0.8, velocityResponse: 0.72 },
  { id: 'bell-glass', family: 'bell', register: 'high', gain: 0.32, attack: 0.02, release: 2.2, velocityResponse: 0.84 },
  { id: 'low-soft', family: 'low', register: 'low', gain: 0.44, attack: 0.03, release: 1.4, velocityResponse: 0.58 },
  { id: 'texture-air', family: 'texture', register: 'high', gain: 0.22, attack: 0.6, release: 2.6, velocityResponse: 0.18 },
];
