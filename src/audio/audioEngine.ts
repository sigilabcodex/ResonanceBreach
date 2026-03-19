import type { SimulationSnapshot } from '../sim/types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export class AudioEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private tonalGain?: GainNode;
  private tonalOscA?: OscillatorNode;
  private tonalOscB?: OscillatorNode;
  private filter?: BiquadFilterNode;
  private noiseGain?: GainNode;
  private noiseFilter?: BiquadFilterNode;
  private started = false;

  async ensureStarted(): Promise<void> {
    if (this.started) {
      if (this.context?.state === 'suspended') {
        await this.context.resume();
      }
      return;
    }

    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = 0.22;
    master.connect(context.destination);

    const tonalGain = context.createGain();
    tonalGain.gain.value = 0.0001;
    tonalGain.connect(master);

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 780;
    filter.Q.value = 1.2;
    filter.connect(tonalGain);

    const oscA = context.createOscillator();
    oscA.type = 'triangle';
    oscA.frequency.value = 174;
    oscA.connect(filter);
    oscA.start();

    const oscB = context.createOscillator();
    oscB.type = 'sine';
    oscB.frequency.value = 261.6;
    oscB.detune.value = 7;
    oscB.connect(filter);
    oscB.start();

    const noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseSource = context.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1600;
    noiseFilter.Q.value = 0.4;

    const noiseGain = context.createGain();
    noiseGain.gain.value = 0.0001;

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noiseSource.start();

    this.context = context;
    this.master = master;
    this.tonalGain = tonalGain;
    this.tonalOscA = oscA;
    this.tonalOscB = oscB;
    this.filter = filter;
    this.noiseGain = noiseGain;
    this.noiseFilter = noiseFilter;
    this.started = true;
  }

  update(snapshot: SimulationSnapshot): void {
    if (!this.context || !this.master || !this.tonalGain || !this.tonalOscA || !this.tonalOscB || !this.filter || !this.noiseGain || !this.noiseFilter) {
      return;
    }

    const now = this.context.currentTime;
    const stability = snapshot.stability;
    const instability = 1 - stability;
    const pressure = clamp(snapshot.pressure, 0, 1.2);

    this.tonalOscA.frequency.setTargetAtTime(146 + stability * 110 + pressure * 22, now, 0.16);
    this.tonalOscB.frequency.setTargetAtTime(220 + stability * 92 + Math.sin(snapshot.time * 0.4) * 12, now, 0.18);
    this.filter.frequency.setTargetAtTime(480 + stability * 2200, now, 0.22);
    this.filter.Q.setTargetAtTime(0.9 + pressure * 4.5, now, 0.22);
    this.tonalGain.gain.setTargetAtTime(0.015 + stability * 0.05, now, 0.25);

    this.noiseFilter.frequency.setTargetAtTime(400 + instability * 3200 + pressure * 400, now, 0.18);
    this.noiseFilter.Q.setTargetAtTime(0.4 + instability * 3.8, now, 0.18);
    this.noiseGain.gain.setTargetAtTime(0.002 + instability * 0.04 + pressure * 0.01, now, 0.14);
    this.master.gain.setTargetAtTime(snapshot.lost ? 0.12 : 0.18 + stability * 0.08, now, 0.3);
  }
}
