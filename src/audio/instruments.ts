export type InstrumentTimbralFamily = 'plucked' | 'bowed' | 'air' | 'percussive' | 'textural' | 'hybrid';
export type InstrumentEnvelopeCharacter = 'soft' | 'rounded' | 'percussive' | 'long';

export interface InstrumentDescriptor {
  id: string;
  name: string;
  pitchRange: {
    minMidi: number;
    maxMidi: number;
  };
  roleAffinity: Array<'bloom' | 'grazer' | 'pollinator' | 'decay' | 'mixed'>;
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
    id: 'bloom-pad',
    name: 'Bloom Pad',
    pitchRange: { minMidi: 36, maxMidi: 68 },
    roleAffinity: ['bloom'],
    rhythmicTendency: 0.24,
    envelopeCharacter: 'long',
    timbralFamily: 'textural',
    voiceLimit: 3,
    maxDensity: 0.7,
  },
  {
    id: 'grazer-pulse',
    name: 'Grazer Pulse',
    pitchRange: { minMidi: 42, maxMidi: 78 },
    roleAffinity: ['grazer'],
    rhythmicTendency: 0.76,
    envelopeCharacter: 'percussive',
    timbralFamily: 'percussive',
    voiceLimit: 2,
    maxDensity: 0.8,
  },
  {
    id: 'pollinator-chime',
    name: 'Pollinator Chime',
    pitchRange: { minMidi: 55, maxMidi: 92 },
    roleAffinity: ['pollinator'],
    rhythmicTendency: 0.62,
    envelopeCharacter: 'rounded',
    timbralFamily: 'air',
    voiceLimit: 2,
    maxDensity: 0.6,
  },
  {
    id: 'decay-grain',
    name: 'Decay Grain',
    pitchRange: { minMidi: 30, maxMidi: 62 },
    roleAffinity: ['decay'],
    rhythmicTendency: 0.34,
    envelopeCharacter: 'soft',
    timbralFamily: 'hybrid',
    voiceLimit: 2,
    maxDensity: 0.65,
  },
];
