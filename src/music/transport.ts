const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface MusicTransportState {
  bpm: number;
  secondsPerBeat: number;
  beatsPerBar: number;
  lookaheadSeconds: number;
  phraseBeats: number;
  nextBeatTime: number;
  beatIndex: number;
}

export const createMusicTransport = (now: number): MusicTransportState => ({
  bpm: 56,
  secondsPerBeat: 60 / 56,
  beatsPerBar: 4,
  lookaheadSeconds: 0.38,
  phraseBeats: 8,
  nextBeatTime: now + 0.08,
  beatIndex: 0,
});

export const updateTransportTempo = (transport: MusicTransportState, calmness: number, activity: number): void => {
  const targetBpm = clamp(50 + activity * 18 + (1 - calmness) * 6, 48, 74);
  transport.bpm = transport.bpm + (targetBpm - transport.bpm) * 0.04;
  transport.secondsPerBeat = 60 / transport.bpm;
};
