export type InstrumentTimbralFamily = 'plucked' | 'bowed' | 'air' | 'percussive' | 'textural' | 'hybrid' | 'bass' | 'reed';
export type InstrumentEnvelopeCharacter = 'soft' | 'rounded' | 'percussive' | 'long' | 'breathy';
export type InstrumentRoleAffinity = 'bloom' | 'rooted' | 'growth' | 'grazer' | 'forager' | 'pollinator' | 'drifter' | 'predator' | 'decomposer' | 'decay' | 'atmosphere' | 'mixed';
export type ForegroundInstrumentFamily = 'soft-pad' | 'bell-chime' | 'soft-pluck' | 'mellow-mallet' | 'reed-lead' | 'soft-bass-pulse';
export type InstrumentRegisterPreference = 'low' | 'midLow' | 'mid' | 'midHigh' | 'high' | 'wide';

export interface InstrumentDescriptor {
  id: string;
  name: string;
  foregroundFamily: ForegroundInstrumentFamily;
  pitchRange: {
    minMidi: number;
    maxMidi: number;
  };
  registerPreference: InstrumentRegisterPreference;
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
    id: 'soft-pad',
    name: 'Soft Pad',
    foregroundFamily: 'soft-pad',
    pitchRange: { minMidi: 40, maxMidi: 72 },
    registerPreference: 'midLow',
    roleAffinity: ['atmosphere', 'bloom', 'rooted', 'decomposer'],
    rhythmicTendency: 0.2,
    envelopeCharacter: 'long',
    timbralFamily: 'textural',
    voiceLimit: 2,
    maxDensity: 0.38,
  },
  {
    id: 'bell-chime',
    name: 'Bell Chime',
    foregroundFamily: 'bell-chime',
    pitchRange: { minMidi: 62, maxMidi: 96 },
    registerPreference: 'high',
    roleAffinity: ['pollinator', 'drifter', 'growth', 'mixed'],
    rhythmicTendency: 0.78,
    envelopeCharacter: 'percussive',
    timbralFamily: 'air',
    voiceLimit: 2,
    maxDensity: 0.5,
  },
  {
    id: 'soft-pluck',
    name: 'Soft Pluck',
    foregroundFamily: 'soft-pluck',
    pitchRange: { minMidi: 54, maxMidi: 86 },
    registerPreference: 'midHigh',
    roleAffinity: ['pollinator', 'forager', 'growth'],
    rhythmicTendency: 0.72,
    envelopeCharacter: 'percussive',
    timbralFamily: 'plucked',
    voiceLimit: 2,
    maxDensity: 0.64,
  },
  {
    id: 'mellow-mallet',
    name: 'Mellow Mallet',
    foregroundFamily: 'mellow-mallet',
    pitchRange: { minMidi: 45, maxMidi: 76 },
    registerPreference: 'mid',
    roleAffinity: ['bloom', 'rooted', 'grazer'],
    rhythmicTendency: 0.56,
    envelopeCharacter: 'rounded',
    timbralFamily: 'percussive',
    voiceLimit: 2,
    maxDensity: 0.7,
  },
  {
    id: 'reed-lead',
    name: 'Reed Lead',
    foregroundFamily: 'reed-lead',
    pitchRange: { minMidi: 50, maxMidi: 82 },
    registerPreference: 'mid',
    roleAffinity: ['decomposer', 'decay', 'predator'],
    rhythmicTendency: 0.4,
    envelopeCharacter: 'breathy',
    timbralFamily: 'reed',
    voiceLimit: 2,
    maxDensity: 0.48,
  },
  {
    id: 'soft-bass-pulse',
    name: 'Soft Bass Pulse',
    foregroundFamily: 'soft-bass-pulse',
    pitchRange: { minMidi: 30, maxMidi: 56 },
    registerPreference: 'low',
    roleAffinity: ['grazer', 'forager', 'predator', 'rooted'],
    rhythmicTendency: 0.36,
    envelopeCharacter: 'soft',
    timbralFamily: 'bass',
    voiceLimit: 2,
    maxDensity: 0.54,
  },
];
