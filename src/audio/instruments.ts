export type InstrumentTimbralFamily = 'plucked' | 'bowed' | 'air' | 'percussive' | 'textural' | 'hybrid' | 'bass' | 'reed';
export type InstrumentEnvelopeCharacter = 'soft' | 'rounded' | 'percussive' | 'long' | 'breathy';
export type InstrumentRoleAffinity = 'bloom' | 'rooted' | 'growth' | 'grazer' | 'forager' | 'pollinator' | 'drifter' | 'predator' | 'decomposer' | 'decay' | 'atmosphere' | 'mixed';

export interface InstrumentDescriptor {
  id: string;
  name: string;
  pitchRange: {
    minMidi: number;
    maxMidi: number;
  };
  roleAffinity: InstrumentRoleAffinity[];
  rhythmicTendency: number;
  envelopeCharacter: InstrumentEnvelopeCharacter;
  timbralFamily: InstrumentTimbralFamily;
  voiceLimit: number;
  maxDensity: number;
}

export interface InstrumentRegistry {
  list(): InstrumentDescriptor[];
  get(id: string): InstrumentDescriptor | undefined;
  register(descriptor: InstrumentDescriptor): void;
}

export const createInstrumentRegistry = (seed: InstrumentDescriptor[] = []): InstrumentRegistry => {
  const instruments = new Map<string, InstrumentDescriptor>();
  seed.forEach((descriptor) => instruments.set(descriptor.id, descriptor));

  return {
    list: () => [...instruments.values()],
    get: (id) => instruments.get(id),
    register: (descriptor) => {
      instruments.set(descriptor.id, descriptor);
    },
  };
};

export const DEFAULT_INSTRUMENT_DESCRIPTORS: InstrumentDescriptor[] = [
  {
    id: 'soft-pluck',
    name: 'Soft Pluck',
    pitchRange: { minMidi: 57, maxMidi: 88 },
    roleAffinity: ['pollinator', 'drifter', 'growth'],
    rhythmicTendency: 0.74,
    envelopeCharacter: 'percussive',
    timbralFamily: 'plucked',
    voiceLimit: 2,
    maxDensity: 0.62,
  },
  {
    id: 'mellow-mallet',
    name: 'Mellow Mallet',
    pitchRange: { minMidi: 45, maxMidi: 76 },
    roleAffinity: ['bloom', 'rooted', 'grazer'],
    rhythmicTendency: 0.58,
    envelopeCharacter: 'rounded',
    timbralFamily: 'percussive',
    voiceLimit: 2,
    maxDensity: 0.72,
  },
  {
    id: 'warm-bass-pulse',
    name: 'Warm Bass Pulse',
    pitchRange: { minMidi: 30, maxMidi: 58 },
    roleAffinity: ['grazer', 'forager', 'predator'],
    rhythmicTendency: 0.42,
    envelopeCharacter: 'soft',
    timbralFamily: 'bass',
    voiceLimit: 2,
    maxDensity: 0.56,
  },
  {
    id: 'reed-breath',
    name: 'Reed Breath',
    pitchRange: { minMidi: 49, maxMidi: 80 },
    roleAffinity: ['decomposer', 'decay', 'predator'],
    rhythmicTendency: 0.36,
    envelopeCharacter: 'breathy',
    timbralFamily: 'reed',
    voiceLimit: 2,
    maxDensity: 0.48,
  },
  {
    id: 'wood-tick',
    name: 'Wood Tick',
    pitchRange: { minMidi: 60, maxMidi: 96 },
    roleAffinity: ['pollinator', 'forager', 'mixed'],
    rhythmicTendency: 0.82,
    envelopeCharacter: 'percussive',
    timbralFamily: 'percussive',
    voiceLimit: 1,
    maxDensity: 0.45,
  },
  {
    id: 'atmo-hush',
    name: 'Atmos Hush',
    pitchRange: { minMidi: 34, maxMidi: 67 },
    roleAffinity: ['atmosphere', 'decomposer', 'decay', 'bloom'],
    rhythmicTendency: 0.2,
    envelopeCharacter: 'long',
    timbralFamily: 'textural',
    voiceLimit: 2,
    maxDensity: 0.4,
  },
];
