import type { Entity } from '../sim/types';
import type { SimulationSnapshot } from '../sim/types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const createNoiseBuffer = (context: AudioContext, seconds: number): AudioBuffer => {
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * 0.7;
  }
  return buffer;
};

export class AudioEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private ambientGain?: GainNode;
  private shimmerGain?: GainNode;
  private clusterGain?: GainNode;
  private pulseGain?: GainNode;
  private anomalyGain?: GainNode;
  private localFocusGain?: GainNode;
  private ambientOscA?: OscillatorNode;
  private ambientOscB?: OscillatorNode;
  private shimmerOsc?: OscillatorNode;
  private clusterOsc?: OscillatorNode;
  private pulseOsc?: OscillatorNode;
  private breathLfo?: OscillatorNode;
  private localOsc?: OscillatorNode;
  private anomalyNoiseFilter?: BiquadFilterNode;
  private started = false;

  async ensureStarted(): Promise<void> {
    if (this.started) {
      if (this.context?.state === 'suspended') await this.context.resume();
      return;
    }

    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = 0.0001;
    master.connect(context.destination);

    const ambientGain = context.createGain();
    ambientGain.gain.value = 0.0001;
    ambientGain.connect(master);

    const ambientFilter = context.createBiquadFilter();
    ambientFilter.type = 'lowpass';
    ambientFilter.frequency.value = 1200;
    ambientFilter.Q.value = 0.6;
    ambientFilter.connect(ambientGain);

    const ambientOscA = context.createOscillator();
    ambientOscA.type = 'sine';
    ambientOscA.frequency.value = 174.61;
    ambientOscA.connect(ambientFilter);
    ambientOscA.start();

    const ambientOscB = context.createOscillator();
    ambientOscB.type = 'triangle';
    ambientOscB.frequency.value = 261.63;
    ambientOscB.detune.value = 3;
    ambientOscB.connect(ambientFilter);
    ambientOscB.start();

    const shimmerGain = context.createGain();
    shimmerGain.gain.value = 0.0001;
    shimmerGain.connect(master);

    const shimmerOsc = context.createOscillator();
    shimmerOsc.type = 'triangle';
    shimmerOsc.frequency.value = 392;
    const shimmerFilter = context.createBiquadFilter();
    shimmerFilter.type = 'bandpass';
    shimmerFilter.frequency.value = 980;
    shimmerFilter.Q.value = 0.8;
    shimmerOsc.connect(shimmerFilter);
    shimmerFilter.connect(shimmerGain);
    shimmerOsc.start();

    const clusterGain = context.createGain();
    clusterGain.gain.value = 0.0001;
    clusterGain.connect(master);

    const clusterOsc = context.createOscillator();
    clusterOsc.type = 'sine';
    clusterOsc.frequency.value = 220;
    const clusterFilter = context.createBiquadFilter();
    clusterFilter.type = 'lowpass';
    clusterFilter.frequency.value = 900;
    clusterOsc.connect(clusterFilter);
    clusterFilter.connect(clusterGain);
    clusterOsc.start();

    const pulseGain = context.createGain();
    pulseGain.gain.value = 0.0001;
    pulseGain.connect(master);

    const pulseOsc = context.createOscillator();
    pulseOsc.type = 'triangle';
    pulseOsc.frequency.value = 52;
    const pulseFilter = context.createBiquadFilter();
    pulseFilter.type = 'bandpass';
    pulseFilter.frequency.value = 180;
    pulseFilter.Q.value = 1.4;
    pulseOsc.connect(pulseFilter);
    pulseFilter.connect(pulseGain);
    pulseOsc.start();

    const breathLfo = context.createOscillator();
    breathLfo.type = 'sine';
    breathLfo.frequency.value = 0.12;
    const breathDepth = context.createGain();
    breathDepth.gain.value = 18;
    breathLfo.connect(breathDepth);
    breathDepth.connect(ambientOscB.frequency);
    breathLfo.start();

    const localFocusGain = context.createGain();
    localFocusGain.gain.value = 0.0001;
    localFocusGain.connect(master);
    const localOsc = context.createOscillator();
    localOsc.type = 'sine';
    localOsc.frequency.value = 330;
    const localFilter = context.createBiquadFilter();
    localFilter.type = 'bandpass';
    localFilter.frequency.value = 1400;
    localFilter.Q.value = 1.8;
    localOsc.connect(localFilter);
    localFilter.connect(localFocusGain);
    localOsc.start();

    const anomalyNoise = context.createBufferSource();
    anomalyNoise.buffer = createNoiseBuffer(context, 2.5);
    anomalyNoise.loop = true;
    const anomalyNoiseFilter = context.createBiquadFilter();
    anomalyNoiseFilter.type = 'bandpass';
    anomalyNoiseFilter.frequency.value = 860;
    anomalyNoiseFilter.Q.value = 1.2;
    const anomalyGain = context.createGain();
    anomalyGain.gain.value = 0.0001;
    anomalyNoise.connect(anomalyNoiseFilter);
    anomalyNoiseFilter.connect(anomalyGain);
    anomalyGain.connect(master);
    anomalyNoise.start();

    this.context = context;
    this.master = master;
    this.ambientGain = ambientGain;
    this.shimmerGain = shimmerGain;
    this.clusterGain = clusterGain;
    this.pulseGain = pulseGain;
    this.anomalyGain = anomalyGain;
    this.localFocusGain = localFocusGain;
    this.ambientOscA = ambientOscA;
    this.ambientOscB = ambientOscB;
    this.shimmerOsc = shimmerOsc;
    this.clusterOsc = clusterOsc;
    this.pulseOsc = pulseOsc;
    this.breathLfo = breathLfo;
    this.localOsc = localOsc;
    this.anomalyNoiseFilter = anomalyNoiseFilter;
    this.started = true;
  }

  update(snapshot: SimulationSnapshot): void {
    if (
      !this.context ||
      !this.master ||
      !this.ambientGain ||
      !this.shimmerGain ||
      !this.clusterGain ||
      !this.pulseGain ||
      !this.anomalyGain ||
      !this.localFocusGain ||
      !this.ambientOscA ||
      !this.ambientOscB ||
      !this.shimmerOsc ||
      !this.clusterOsc ||
      !this.pulseOsc ||
      !this.breathLfo ||
      !this.localOsc ||
      !this.anomalyNoiseFilter
    ) {
      return;
    }

    const now = this.context.currentTime;
    const counts = this.countEntities(snapshot.entities);
    const localMix = this.computeLocalMix(snapshot);
    const zoomNorm = clamp((snapshot.camera.zoom - 0.42) / (2.85 - 0.42), 0, 1);
    const harmony = snapshot.stats.harmony;
    const mystery = snapshot.stats.mystery;
    const growth = snapshot.stats.growth;
    const activity = snapshot.stats.activity;

    const root = 174.61 + harmony * 22 + growth * 8 - mystery * 6;
    const third = root * 1.25;
    const fifth = root * 1.5;
    const localPitch = 261.63 + localMix.seed * 42 + localMix.filament * 26 + localMix.cluster * 18;

    this.ambientOscA.frequency.setTargetAtTime(root, now, 0.8);
    this.ambientOscB.frequency.setTargetAtTime(fifth + harmony * 8, now, 0.7);
    this.shimmerOsc.frequency.setTargetAtTime(third + counts.seed * 0.8 + localMix.seed * 34, now, 0.6);
    this.clusterOsc.frequency.setTargetAtTime(root * 0.75 + counts.cluster * 2.4 + harmony * 18, now, 0.6);
    this.pulseOsc.frequency.setTargetAtTime(46 + activity * 18 + growth * 12, now, 0.25);
    this.localOsc.frequency.setTargetAtTime(localPitch + zoomNorm * 60, now, 0.3);
    this.breathLfo.frequency.setTargetAtTime(0.08 + activity * 0.18 + zoomNorm * 0.05, now, 0.8);
    this.anomalyNoiseFilter.frequency.setTargetAtTime(780 + mystery * 740 + snapshot.anomalyPulse * 180, now, 0.3);
    this.anomalyNoiseFilter.Q.setTargetAtTime(1.1 + mystery * 2.3, now, 0.25);

    const pulseShape = 0.35 + 0.65 * Math.max(0, Math.sin(snapshot.time * (1.8 + activity * 2.4)));

    this.ambientGain.gain.setTargetAtTime(0.018 + (1 - zoomNorm) * 0.024 + harmony * 0.014, now, 0.6);
    this.shimmerGain.gain.setTargetAtTime(0.004 + counts.seed * 0.00022 + harmony * 0.008, now, 0.45);
    this.clusterGain.gain.setTargetAtTime(0.005 + counts.cluster * 0.0012 + growth * 0.014, now, 0.42);
    this.pulseGain.gain.setTargetAtTime(0.001 + activity * 0.01 * pulseShape, now, 0.12);
    this.localFocusGain.gain.setTargetAtTime(0.001 + zoomNorm * 0.028 + localMix.total * 0.016, now, 0.25);
    this.anomalyGain.gain.setTargetAtTime(0.0004 + mystery * 0.004 + snapshot.anomalyPulse * 0.006, now, 0.2);
    this.master.gain.setTargetAtTime(0.1 + harmony * 0.025 + zoomNorm * 0.01, now, 0.8);
  }

  private countEntities(entities: Entity[]): Record<Entity['type'], number> {
    return entities.reduce(
      (acc, entity) => {
        acc[entity.type] += 1;
        return acc;
      },
      { seed: 0, cluster: 0, filament: 0, alien: 0 } as Record<Entity['type'], number>,
    );
  }

  private computeLocalMix(snapshot: SimulationSnapshot) {
    const radius = 210 / snapshot.camera.zoom;
    const center = snapshot.camera.center;
    let total = 0;
    let seed = 0;
    let cluster = 0;
    let filament = 0;

    for (const entity of snapshot.entities) {
      const dx = entity.position.x - center.x;
      const dy = entity.position.y - center.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;
      const weight = 1 - dist / radius;
      total += weight;
      if (entity.type === 'seed') seed += weight;
      if (entity.type === 'cluster') cluster += weight;
      if (entity.type === 'filament') filament += weight;
    }

    const normalizer = Math.max(total, 1);
    return {
      total: clamp(total / 10, 0, 1),
      seed: seed / normalizer,
      cluster: cluster / normalizer,
      filament: filament / normalizer,
    };
  }
}
