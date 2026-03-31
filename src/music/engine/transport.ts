import type { MusicTransportState } from '../types/music';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export class MusicTransport {
  private state: MusicTransportState = {
    bpm: 56,
    beatsPerBar: 4,
    secondsPerBeat: 60 / 56,
    beat: 0,
    bar: 0,
    phaseInBeat: 0,
    phraseLengthBars: 4,
    phraseProgress: 0,
    phraseIndex: 0,
  };

  reset(): void {
    this.state.beat = 0;
    this.state.bar = 0;
    this.state.phaseInBeat = 0;
    this.state.phraseProgress = 0;
    this.state.phraseIndex = 0;
  }

  update(dt: number, intensity: number): MusicTransportState {
    const bpm = clamp(52 + intensity * 18, 48, 72);
    const secondsPerBeat = 60 / bpm;
    const beatsAdvanced = dt / secondsPerBeat;

    this.state.bpm = bpm;
    this.state.secondsPerBeat = secondsPerBeat;
    this.state.beat += beatsAdvanced;
    this.state.bar = Math.floor(this.state.beat / this.state.beatsPerBar);
    this.state.phaseInBeat = this.state.beat - Math.floor(this.state.beat);

    const phraseBeats = this.state.phraseLengthBars * this.state.beatsPerBar;
    const phrasePosition = this.state.beat / phraseBeats;
    this.state.phraseProgress = phrasePosition - Math.floor(phrasePosition);
    this.state.phraseIndex = Math.floor(phrasePosition);

    return { ...this.state };
  }

  getState(): MusicTransportState {
    return { ...this.state };
  }
}
