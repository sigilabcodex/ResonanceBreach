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
  private rhythmGain?: GainNode;
  private rhythmFilter?: BiquadFilterNode;
  private bedFilter?: BiquadFilterNode;
  private padFilter?: BiquadFilterNode;
  private airFilter?: BiquadFilterNode;
  private strainFilter?: BiquadFilterNode;
  private bedOscA?: OscillatorNode;
  private bedOscB?: OscillatorNode;
  private padOsc?: OscillatorNode;
  private pulseLfo?: OscillatorNode;
  private rhythmOsc?: OscillatorNode;
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
    bedFilter.frequency.value = 1500;
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
    bedOscB.detune.value = 3;
    bedOscB.connect(bedFilter);
    bedOscB.start();

    const padGain = context.createGain();
    padGain.gain.value = 0.0001;
    const padFilter = context.createBiquadFilter();
    padFilter.type = 'bandpass';
    padFilter.frequency.value = 840;
    padFilter.Q.value = 0.9;
    padFilter.connect(padGain);
    padGain.connect(master);

    const padOsc = context.createOscillator();
    padOsc.type = 'triangle';
    padOsc.frequency.value = 329.6;
    padOsc.detune.value = -5;
    padOsc.connect(padFilter);
    padOsc.start();

    const pulseLfo = context.createOscillator();
    pulseLfo.type = 'sine';
    pulseLfo.frequency.value = 0.1;
    const pulseDepth = context.createGain();
    pulseDepth.gain.value = 12;
    pulseLfo.connect(pulseDepth);
    pulseDepth.connect(bedOscB.frequency);
    pulseLfo.start();

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
    strainFilter.frequency.value = 920;
    strainFilter.Q.value = 1.5;
    const strainGain = context.createGain();
    strainGain.gain.value = 0.0001;
    strainNoise.connect(strainFilter);
    strainFilter.connect(strainGain);
    strainGain.connect(master);
    strainNoise.start();

    const rhythmOsc = context.createOscillator();
    rhythmOsc.type = 'triangle';
    rhythmOsc.frequency.value = 48;
    const rhythmFilter = context.createBiquadFilter();
    rhythmFilter.type = 'bandpass';
    rhythmFilter.frequency.value = 180;
    rhythmFilter.Q.value = 2.1;
    const rhythmGain = context.createGain();
    rhythmGain.gain.value = 0.0001;
    rhythmOsc.connect(rhythmFilter);
    rhythmFilter.connect(rhythmGain);
    rhythmGain.connect(master);
    rhythmOsc.start();

    this.context = context;
    this.master = master;
    this.bedGain = bedGain;
    this.padGain = padGain;
    this.airGain = airGain;
    this.strainGain = strainGain;
    this.rhythmGain = rhythmGain;
    this.rhythmFilter = rhythmFilter;
    this.bedFilter = bedFilter;
    this.padFilter = padFilter;
    this.airFilter = airFilter;
    this.strainFilter = strainFilter;
    this.bedOscA = bedOscA;
    this.bedOscB = bedOscB;
    this.padOsc = padOsc;
    this.pulseLfo = pulseLfo;
    this.rhythmOsc = rhythmOsc;
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
      !this.rhythmGain ||
      !this.rhythmFilter ||
      !this.bedFilter ||
      !this.padFilter ||
      !this.airFilter ||
      !this.strainFilter ||
      !this.bedOscA ||
      !this.bedOscB ||
      !this.padOsc ||
      !this.pulseLfo ||
      !this.rhythmOsc
    ) {
      return;
    }

    const now = this.context.currentTime;
    const stability = snapshot.stability;
    const instability = 1 - stability;
    const pressure = clamp(snapshot.pressure, 0, 1.4);
    const outbreak = clamp(snapshot.outbreakRisk, 0, 1.4);
    const rhythm = clamp(snapshot.rhythmicPressure, 0, 1.4);
    const calmBlend = snapshot.phaseState.blend.calm;
    const breachBlend = snapshot.phaseState.blend.breach;

    const root = 164.81 + calmBlend * 18 - breachBlend * 8;
    const fifth = root * 1.5;
    const upper = root * 2;

    this.bedOscA.frequency.setTargetAtTime(root + Math.sin(snapshot.time * 0.08) * 2.2, now, 0.8);
    this.bedOscB.frequency.setTargetAtTime(fifth + Math.sin(snapshot.time * 0.11 + pressure) * 4, now, 0.7);
    this.padOsc.frequency.setTargetAtTime(upper + snapshot.phaseState.blend.emergence * 14 - instability * 12, now, 0.6);
    this.pulseLfo.frequency.setTargetAtTime(0.06 + rhythm * 0.32, now, 0.7);
    this.rhythmOsc.frequency.setTargetAtTime(42 + rhythm * 26 + pressure * 8, now, 0.18);

    this.bedFilter.frequency.setTargetAtTime(1200 + stability * 1400 - outbreak * 120, now, 0.6);
    this.padFilter.frequency.setTargetAtTime(520 + stability * 900 + snapshot.phaseState.blend.emergence * 180, now, 0.5);
    this.airFilter.frequency.setTargetAtTime(1600 + calmBlend * 1600 - breachBlend * 220, now, 0.5);
    this.strainFilter.frequency.setTargetAtTime(620 + instability * 900 + pressure * 180, now, 0.25);
    this.strainFilter.Q.setTargetAtTime(1.1 + outbreak * 1.6 + rhythm * 0.6, now, 0.25);
    this.rhythmFilter.frequency.setTargetAtTime(150 + rhythm * 160, now, 0.15);
    this.rhythmFilter.Q.setTargetAtTime(1.8 + rhythm * 1.5, now, 0.15);

    this.bedGain.gain.setTargetAtTime(0.018 + stability * 0.036, now, 0.6);
    this.padGain.gain.setTargetAtTime(0.005 + calmBlend * 0.018 + snapshot.phaseState.blend.emergence * 0.01, now, 0.6);
    this.airGain.gain.setTargetAtTime(0.003 + stability * 0.014, now, 0.55);
    this.strainGain.gain.setTargetAtTime(0.001 + instability * 0.01 + outbreak * 0.008 + breachBlend * 0.01, now, 0.25);

    const pulseShape = 0.35 + 0.65 * Math.max(0, Math.sin(snapshot.time * (2.4 + rhythm * 4.2)));
    const rhythmGainTarget = rhythm <= 0.05 ? 0.0001 : 0.002 + rhythm * 0.012 * pulseShape;
    this.rhythmGain.gain.setTargetAtTime(rhythmGainTarget, now, 0.08);
    this.master.gain.setTargetAtTime(snapshot.lost ? 0.1 : 0.12 + stability * 0.06, now, 0.6);
  }
}
