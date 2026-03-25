import type { EcologicalAudioEvent } from './musicalEvents';

export type MusicalInterpretationMode = 'raw' | 'hybrid' | 'musical';

export interface MusicalGesture {
  sourceEvent: EcologicalAudioEvent;
  outputEventType: EcologicalAudioEvent['type'];
  intensity: number;
  quantize: 0 | 0.5 | 1;
  rhythmicBias: number;
  timbralBias: 'natural' | 'blended' | 'instrumental';
}

export interface MusicalInterpreter {
  readonly mode: MusicalInterpretationMode;
  interpret(event: EcologicalAudioEvent): MusicalGesture;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

class DefaultMusicalInterpreter implements MusicalInterpreter {
  constructor(readonly mode: MusicalInterpretationMode) {}

  interpret(event: EcologicalAudioEvent): MusicalGesture {
    if (this.mode === 'raw') {
      return {
        sourceEvent: event,
        outputEventType: event.type,
        intensity: event.intensity,
        quantize: 0,
        rhythmicBias: 0.35,
        timbralBias: 'natural',
      };
    }

    if (this.mode === 'hybrid') {
      return {
        sourceEvent: event,
        outputEventType: event.type,
        intensity: clamp(event.intensity * 0.95 + 0.05, 0, 1),
        quantize: event.type === 'environmentalPulse' ? 1 : 0.5,
        rhythmicBias: 0.55,
        timbralBias: 'blended',
      };
    }

    return {
      sourceEvent: event,
      outputEventType: event.type,
      intensity: clamp(event.intensity * 0.82 + 0.14, 0, 1),
      quantize: 1,
      rhythmicBias: 0.72,
      timbralBias: 'instrumental',
    };
  }
}

export const createMusicalInterpreter = (mode: MusicalInterpretationMode): MusicalInterpreter => new DefaultMusicalInterpreter(mode);
