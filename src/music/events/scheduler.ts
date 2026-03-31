import { clampMidiToRegister, degreeToMidi } from '../harmony/pitch';
import type { MusicConductorState, MusicTimelineWindow, MusicTransportState, PlannedPhrase, ScheduledNoteEvent } from '../types/music';

export class MusicScheduler {
  private scheduled = new Map<string, ScheduledNoteEvent>();

  reset(): void {
    this.scheduled.clear();
  }

  schedulePhrase(
    phrase: PlannedPhrase,
    transport: MusicTransportState,
    conductor: MusicConductorState,
    nowTime: number,
    lookaheadSeconds: number,
  ): ScheduledNoteEvent[] {
    const phraseStartBeat = phrase.startBar * transport.beatsPerBar;
    const window: MusicTimelineWindow = {
      fromTime: nowTime,
      toTime: nowTime + lookaheadSeconds,
    };

    const newEvents: ScheduledNoteEvent[] = [];
    for (const note of phrase.notes) {
      const absoluteBeat = phraseStartBeat + note.beatOffset;
      const beatUntil = absoluteBeat - transport.beat;
      const atTime = nowTime + beatUntil * transport.secondsPerBeat;
      const id = `${phrase.id}-${note.instrumentId}-${note.beatOffset}`;
      if (atTime < window.fromTime || atTime > window.toTime || this.scheduled.has(id)) continue;

      const midi = clampMidiToRegister(
        degreeToMidi(conductor.tonalCenter, conductor.mode, note.degree),
        conductor.harmonicField,
        note.instrumentId.includes('low') ? 'low' : note.instrumentId.includes('bell') ? 'high' : 'mid',
      );

      const event: ScheduledNoteEvent = {
        id,
        atTime,
        duration: note.durationBeats * transport.secondsPerBeat,
        midi,
        velocity: note.velocity,
        instrumentId: note.instrumentId,
        phraseId: phrase.id,
        rest: note.isRest,
      };

      this.scheduled.set(id, event);
      newEvents.push(event);
    }

    this.trim(window.fromTime - transport.secondsPerBeat * 2);
    return newEvents;
  }

  getWindow(nowTime: number, lookaheadSeconds: number): MusicTimelineWindow {
    return { fromTime: nowTime, toTime: nowTime + lookaheadSeconds };
  }

  private trim(cutoffTime: number): void {
    for (const [id, event] of this.scheduled.entries()) {
      if (event.atTime + event.duration < cutoffTime) {
        this.scheduled.delete(id);
      }
    }
  }
}
