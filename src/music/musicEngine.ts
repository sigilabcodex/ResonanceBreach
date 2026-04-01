import type { EcologicalMusicState } from '../audio/ecologicalMusic';
import { quantizeToRoleZone, type HarmonyState } from '../audio/harmony';
import { createEnvelopeByDensity, scheduleAdsrGain } from '../audio/noteEvents';
import type { GameSettings } from '../settings';
import { createMusicTransport, updateTransportTempo, type MusicTransportState } from './transport';
import { derivePhraseInfluence, generatePhrase } from './phraseGenerator';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export class ProceduralMusicEngine {
  private transport: MusicTransportState;
  private enabled = true;

  constructor(private readonly context: AudioContext, private readonly destination: GainNode) {
    this.transport = createMusicTransport(context.currentTime);
  }

  reset(): void {
    this.transport = createMusicTransport(this.context.currentTime);
  }

  update(harmony: HarmonyState, music: EcologicalMusicState, settings: GameSettings, interpretationBlend: number, interpretationMode: 'raw' | 'hybrid' | 'musical'): void {
    this.enabled = interpretationMode !== 'raw' || interpretationBlend > 0.35;
    if (!this.enabled) return;

    const influence = derivePhraseInfluence(music);
    updateTransportTempo(this.transport, influence.calmness, influence.activity);

    const now = this.context.currentTime;
    const scheduleUntil = now + this.transport.lookaheadSeconds;

    while (this.transport.nextBeatTime <= scheduleUntil) {
      const beatInPhrase = this.transport.beatIndex % this.transport.phraseBeats;
      if (beatInPhrase === 0) {
        this.schedulePhrase(this.transport.nextBeatTime, harmony, influence, music, settings, interpretationBlend);
      }
      this.transport.nextBeatTime += this.transport.secondsPerBeat;
      this.transport.beatIndex += 1;
    }
  }

  private schedulePhrase(
    phraseStart: number,
    harmony: HarmonyState,
    influence: ReturnType<typeof derivePhraseInfluence>,
    music: EcologicalMusicState,
    settings: GameSettings,
    interpretationBlend: number,
  ): void {
    const phrase = generatePhrase(harmony, influence, this.transport.phraseBeats);
    if (phrase.length === 0) return;

    for (const note of phrase) {
      const startAt = phraseStart + note.beatOffset * this.transport.secondsPerBeat;
      const duration = note.durationBeats * this.transport.secondsPerBeat;
      const snapped = quantizeToRoleZone(note.midi, harmony, note.voice === 'pad' ? 'rooted' : 'drifter', 0.9);
      const velocity = note.velocity
        * (0.6 + settings.audio.musicBusLevel * 0.4)
        * (0.55 + interpretationBlend * 0.55)
        * (0.8 + music.composition.foregroundLift * 0.35);
      this.triggerVoice(startAt, duration, midiToHz(snapped), clamp(velocity, 0.06, 0.54), note.voice, influence.density);
    }
  }

  private triggerVoice(startAt: number, duration: number, frequency: number, velocity: number, voice: 'pad' | 'chime' | 'pluck', density: number): void {
    const oscA = this.context.createOscillator();
    const oscB = this.context.createOscillator();
    const mix = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const pan = this.context.createStereoPanner();

    oscA.type = voice === 'pad' ? 'triangle' : voice === 'pluck' ? 'sine' : 'triangle';
    oscB.type = voice === 'pad' ? 'sine' : 'sine';
    oscA.frequency.value = frequency;
    oscB.frequency.value = frequency * (voice === 'chime' ? 2 : 1.005);

    filter.type = voice === 'pad' ? 'lowpass' : 'bandpass';
    filter.frequency.value = voice === 'pad' ? clamp(frequency * 2.2, 220, 1800) : clamp(frequency * 2.8, 480, 4200);
    filter.Q.value = voice === 'pad' ? 0.8 : 1.2;

    mix.gain.value = voice === 'pad' ? 0.7 : 0.52;
    pan.pan.value = (Math.random() * 2 - 1) * (voice === 'pad' ? 0.25 : 0.46);

    const envelope = createEnvelopeByDensity(duration, density, voice === 'pad' ? 'soft' : voice === 'pluck' ? 'percussive' : 'rounded');
    const stopAt = scheduleAdsrGain(gain, startAt, velocity, envelope, duration);

    oscA.connect(mix);
    oscB.connect(mix);
    mix.connect(filter);
    filter.connect(pan);
    pan.connect(gain);
    gain.connect(this.destination);

    oscA.start(startAt);
    oscB.start(startAt);
    oscA.stop(stopAt + 0.03);
    oscB.stop(stopAt + 0.03);
  }
}
