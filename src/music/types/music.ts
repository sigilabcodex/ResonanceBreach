import type { EntityType } from '../../config';
import type { WorldEvent } from '../../sim/events';

export type MusicScaleMode = 'ionian' | 'dorian' | 'aeolian' | 'mixolydian' | 'lydian' | 'pentatonicMajor' | 'pentatonicMinor';

export interface MusicWorldFeatures {
  time: number;
  activity: number;
  stability: number;
  growth: number;
  threat: number;
  biodiversity: number;
  nutrients: number;
  fruit: number;
  energy: number;
  entityDensity: number;
  residueDensity: number;
  speciesDistribution: Partial<Record<EntityType, number>>;
  recentEventEnergy: number;
  eventBias: {
    birth: number;
    death: number;
    feeding: number;
    tool: number;
    residue: number;
    fruiting: number;
  };
}

export interface MusicTransportState {
  bpm: number;
  beatsPerBar: number;
  secondsPerBeat: number;
  beat: number;
  bar: number;
  phaseInBeat: number;
  phraseLengthBars: number;
  phraseProgress: number;
  phraseIndex: number;
}

export interface HarmonicField {
  rootMidi: number;
  mode: MusicScaleMode;
  register: {
    low: number;
    mid: number;
    high: number;
  };
  chordDegrees: number[];
  tension: number;
}

export interface EnsembleActivation {
  pad: number;
  pluck: number;
  bell: number;
  low: number;
  texture: number;
}

export interface MusicConductorState {
  density: number;
  intensity: number;
  tonalCenter: number;
  mode: MusicScaleMode;
  harmonicField: HarmonicField;
  silenceBias: number;
  phraseBias: number;
  ensemble: EnsembleActivation;
}

export interface Motif {
  id: string;
  degreeContour: number[];
  rhythm: number[];
  velocityShape: number[];
}

export interface PhraseNotePlan {
  degree: number;
  beatOffset: number;
  durationBeats: number;
  velocity: number;
  instrumentId: string;
  isRest: boolean;
}

export interface PlannedPhrase {
  id: string;
  phraseIndex: number;
  startBar: number;
  motifId: string;
  notes: PhraseNotePlan[];
}

export interface ScheduledNoteEvent {
  id: string;
  atTime: number;
  duration: number;
  midi: number;
  velocity: number;
  instrumentId: string;
  phraseId: string;
  rest: boolean;
}

export interface MusicTimelineWindow {
  fromTime: number;
  toTime: number;
}

export interface InstrumentProfile {
  id: string;
  family: 'pad' | 'pluck' | 'bell' | 'low' | 'texture';
  register: 'low' | 'mid' | 'high';
  gain: number;
  attack: number;
  release: number;
  velocityResponse: number;
}

export interface MusicEngineUpdateInput {
  dt: number;
  worldTime: number;
  events: WorldEvent[];
  features: MusicWorldFeatures;
}

export interface MusicEngineSnapshot {
  transport: MusicTransportState;
  conductor: MusicConductorState;
  activePhrase: PlannedPhrase | null;
  scheduledWindow: MusicTimelineWindow;
  scheduledEvents: ScheduledNoteEvent[];
}
