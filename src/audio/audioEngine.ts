import type { SimulationSnapshot } from '../sim/types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const createNoiseBuffer = (context: AudioContext, seconds: number): AudioBuffer => {
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
};

export class AudioEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private bedGain?: GainNode;
  private padGain?: GainNode;
  private airGain?: GainNode;
  private strainGain?: GainNode;
  private bedFilter?: BiquadFilterNode;
  private padFilter?: BiquadFilterNode;
  private airFilter?: BiquadFilterNode;
  private strainFilter?: BiquadFilterNode;
  private bedOscA?: OscillatorNode;
  private bedOscB?: OscillatorNode;
  private padOsc?: OscillatorNode;
  private pulseOsc?: OscillatorNode;
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
    master.gain.value = 0.0001;
    master.connect(context.destination);

    const bedGain = context.createGain();
    bedGain.gain.value = 0.0001;
    const bedFilter = context.createBiquadFilter();
    bedFilter.type = 'lowpass';
    bedFilter.frequency.value = 1400;
    bedFilter.Q.value = 0.7;
    bedFilter.connect(bedGain);
    bedGain.connect(master);

    const bedOscA = context.createOscillator();
    bedOscA.type = 'sine';
    bedOscA.frequency.value = 174;
    bedOscA.connect(bedFilter);
    bedOscA.start();

    const bedOscB = context.createOscillator();
    bedOscB.type = 'triangle';
    bedOscB.frequency.value = 261.6;
    bedOscB.detune.value = 2;
    bedOscB.connect(bedFilter);
    bedOscB.start();

    const padGain = context.createGain();
    padGain.gain.value = 0.0001;
    const padFilter = context.createBiquadFilter();
    padFilter.type = 'bandpass';
    padFilter.frequency.value = 820;
    padFilter.Q.value = 0.8;
    padFilter.connect(padGain);
    padGain.connect(master);

    const padOsc = context.createOscillator();
    padOsc.type = 'sawtooth';
    padOsc.frequency.value = 349.2;
    padOsc.detune.value = -4;
    padOsc.connect(padFilter);
    padOsc.start();

    const pulseOsc = context.createOscillator();
    pulseOsc.type = 'sine';
    pulseOsc.frequency.value = 0.12;
    const pulseDepth = context.createGain();
    pulseDepth.gain.value = 16;
    pulseOsc.connect(pulseDepth);
    pulseDepth.connect(bedOscB.frequency);
    pulseOsc.start();

    const airNoise = context.createBufferSource();
    airNoise.buffer = createNoiseBuffer(context, 2);
    airNoise.loop = true;
    const airFilter = context.createBiquadFilter();
    airFilter.type = 'highpass';
    airFilter.frequency.value = 1800;
    airFilter.Q.value = 0.5;
    const airGain = context.createGain();
    airGain.gain.value = 0.0001;
    airNoise.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(master);
    airNoise.start();

    const strainNoise = context.createBufferSource();
    strainNoise.buffer = createNoiseBuffer(context, 2);
    strainNoise.loop = true;
    const strainFilter = context.createBiquadFilter();
    strainFilter.type = 'bandpass';
    strainFilter.frequency.value = 900;
    strainFilter.Q.value = 1.6;
    const strainShaper = context.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i += 1) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.8);
    }
    strainShaper.curve = curve;
    const strainGain = context.createGain();
    strainGain.gain.value = 0.0001;
    strainNoise.connect(strainFilter);
    strainFilter.connect(strainShaper);
    strainShaper.connect(strainGain);
    strainGain.connect(master);
    strainNoise.start();

    this.context = context;
    this.master = master;
    this.bedGain = bedGain;
    this.padGain = padGain;
    this.airGain = airGain;
    this.strainGain = strainGain;
    this.bedFilter = bedFilter;
    this.padFilter = padFilter;
    this.airFilter = airFilter;
    this.strainFilter = strainFilter;
    this.bedOscA = bedOscA;
    this.bedOscB = bedOscB;
    this.padOsc = padOsc;
    this.pulseOsc = pulseOsc;
    this.started = true;
  }

  update(snapshot: SimulationSnapshot): void {
    if (
      !this.context ||
      !this.master ||
      !this.bedGain ||
      !this.padGain ||
      !this.airGain ||
      !this.strainGain ||
      !this.bedFilter ||
      !this.padFilter ||
      !this.airFilter ||
      !this.strainFilter ||
      !this.bedOscA ||
      !this.bedOscB ||
      !this.padOsc ||
      !this.pulseOsc
    ) {
      return;
    }

    const now = this.context.currentTime;
    const stability = snapshot.stability;
    const instability = 1 - stability;
    const pressure = clamp(snapshot.pressure, 0, 1.4);
    const outbreak = clamp(snapshot.outbreakRisk, 0, 1.4);
    const hotspot = snapshot.hotspots[0]?.intensity ?? 0;

    const root = 164.81 + stability * 28;
    const fifth = root * 1.5;
    const ninth = root * 2.24;

    this.bedOscA.frequency.setTargetAtTime(root + Math.sin(snapshot.time * 0.08) * 3, now, 0.6);
    this.bedOscB.frequency.setTargetAtTime(fifth + Math.sin(snapshot.time * 0.11 + pressure) * 6, now, 0.55);
    this.padOsc.frequency.setTargetAtTime(ninth - instability * 35 + Math.sin(snapshot.time * 0.15) * 4, now, 0.45);
    this.pulseOsc.frequency.setTargetAtTime(0.08 + outbreak * 0.05, now, 0.9);

    this.bedFilter.frequency.setTargetAtTime(900 + stability * 2200 - outbreak * 180, now, 0.5);
    this.bedFilter.Q.setTargetAtTime(0.6 + pressure * 0.8, now, 0.5);
    this.padFilter.frequency.setTargetAtTime(540 + stability * 1500 - instability * 220, now, 0.45);
    this.padFilter.Q.setTargetAtTime(0.8 + hotspot * 0.4, now, 0.45);
    this.airFilter.frequency.setTargetAtTime(1400 + stability * 1800 - outbreak * 220, now, 0.4);
    this.strainFilter.frequency.setTargetAtTime(650 + instability * 1100 + pressure * 240, now, 0.25);
    this.strainFilter.Q.setTargetAtTime(1.1 + outbreak * 2.8, now, 0.25);

    this.bedGain.gain.setTargetAtTime(0.014 + stability * 0.05 - instability * 0.008, now, 0.5);
    this.padGain.gain.setTargetAtTime(0.006 + stability * 0.026, now, 0.6);
    this.airGain.gain.setTargetAtTime(0.003 + stability * 0.018 + Math.max(0, 0.01 - pressure * 0.003), now, 0.5);
    this.strainGain.gain.setTargetAtTime(0.001 + instability * 0.02 + outbreak * 0.014 + pressure * 0.008, now, 0.22);
    this.master.gain.setTargetAtTime(snapshot.lost ? 0.11 : 0.13 + stability * 0.08, now, 0.55);
  }
}
