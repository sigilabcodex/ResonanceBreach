import { degreeToMidi } from '../harmony/pitch';
import type { InstrumentProfile } from '../types/music';
import type { MusicConductorState, MusicTransportState, PlannedPhrase } from '../types/music';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const BASE_MOTIFS = [
  { id: 'arc', degreeContour: [0, 1, 2, 1], rhythm: [0, 1, 2, 3], velocityShape: [0.56, 0.62, 0.68, 0.58] },
  { id: 'drift', degreeContour: [0, -1, 1, 0], rhythm: [0, 1.5, 2.5, 3.5], velocityShape: [0.52, 0.44, 0.6, 0.5] },
  { id: 'bloom', degreeContour: [0, 2, 4, 2], rhythm: [0, 1, 2.25, 3.25], velocityShape: [0.5, 0.58, 0.7, 0.62] },
] as const;

export class PhrasePlanner {
  planPhrase(transport: MusicTransportState, conductor: MusicConductorState, instruments: InstrumentProfile[]): PlannedPhrase {
    const motifIndex = Math.floor((transport.phraseIndex + conductor.tonalCenter) % BASE_MOTIFS.length);
    const motif = BASE_MOTIFS[motifIndex] ?? BASE_MOTIFS[0];
    const instrument = this.pickLeadInstrument(instruments, conductor);

    const notes = motif.rhythm.map((beatOffset, i) => {
      const rawVelocity = motif.velocityShape[i] ?? 0.5;
      const restSeed = Math.sin((transport.phraseIndex + 1) * 17.13 + beatOffset * 9.71 + i * 3.11) * 0.5 + 0.5;
      const isRest = restSeed < conductor.silenceBias * 0.45;
      return {
        degree: motif.degreeContour[i] ?? 0,
        beatOffset,
        durationBeats: clamp(0.45 + conductor.density * 0.35, 0.35, 1.2),
        velocity: clamp(rawVelocity * (0.65 + conductor.intensity * 0.55), 0.2, 0.95),
        instrumentId: instrument.id,
        isRest,
      };
    });

    return {
      id: `phrase-${transport.phraseIndex}`,
      phraseIndex: transport.phraseIndex,
      startBar: transport.bar,
      motifId: motif.id,
      notes,
    };
  }

  previewFirstPitch(phrase: PlannedPhrase, conductor: MusicConductorState): number | null {
    const first = phrase.notes.find((note) => !note.isRest);
    if (!first) return null;
    return degreeToMidi(conductor.harmonicField.rootMidi, conductor.mode, first.degree);
  }

  private pickLeadInstrument(instruments: InstrumentProfile[], conductor: MusicConductorState): InstrumentProfile {
    const ranked = instruments
      .filter((profile) => profile.family === 'pluck' || profile.family === 'bell')
      .sort((a, b) => (b.gain * conductor.intensity) - (a.gain * conductor.intensity));

    return ranked[0] ?? instruments[0];
  }
}
