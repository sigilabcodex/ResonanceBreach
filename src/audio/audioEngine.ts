import type { Entity, SimulationSnapshot } from '../sim/types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const createNoiseBuffer = (context: AudioContext, seconds: number): AudioBuffer => {
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.45;
  return buffer;
};

export class AudioEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private bedGain?: GainNode;
  private clusterGain?: GainNode;
  private individualGain?: GainNode;
  private terrainGain?: GainNode;
  private threatGain?: GainNode;
  private bedOscA?: OscillatorNode;
  private bedOscB?: OscillatorNode;
  private clusterOsc?: OscillatorNode;
  private individualOsc?: OscillatorNode;
  private terrainNoiseFilter?: BiquadFilterNode;
  private toolBus?: GainNode;
  private lastFeedbackId = 0;
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

    const bedGain = context.createGain();
    bedGain.gain.value = 0.0001;
    bedGain.connect(master);
    const bedFilter = context.createBiquadFilter();
    bedFilter.type = 'lowpass';
    bedFilter.frequency.value = 1400;
    bedFilter.connect(bedGain);

    const bedOscA = context.createOscillator();
    bedOscA.type = 'sine';
    bedOscA.frequency.value = 164.81;
    bedOscA.connect(bedFilter);
    bedOscA.start();

    const bedOscB = context.createOscillator();
    bedOscB.type = 'triangle';
    bedOscB.frequency.value = 247.5;
    bedOscB.connect(bedFilter);
    bedOscB.start();

    const clusterGain = context.createGain();
    clusterGain.gain.value = 0.0001;
    clusterGain.connect(master);
    const clusterOsc = context.createOscillator();
    clusterOsc.type = 'sine';
    clusterOsc.frequency.value = 220;
    clusterOsc.connect(clusterGain);
    clusterOsc.start();

    const individualGain = context.createGain();
    individualGain.gain.value = 0.0001;
    individualGain.connect(master);
    const individualOsc = context.createOscillator();
    individualOsc.type = 'triangle';
    individualOsc.frequency.value = 330;
    const individualFilter = context.createBiquadFilter();
    individualFilter.type = 'bandpass';
    individualFilter.frequency.value = 1200;
    individualFilter.Q.value = 1.3;
    individualOsc.connect(individualFilter);
    individualFilter.connect(individualGain);
    individualOsc.start();

    const terrainGain = context.createGain();
    terrainGain.gain.value = 0.0001;
    terrainGain.connect(master);
    const terrainNoise = context.createBufferSource();
    terrainNoise.buffer = createNoiseBuffer(context, 2.2);
    terrainNoise.loop = true;
    const terrainNoiseFilter = context.createBiquadFilter();
    terrainNoiseFilter.type = 'bandpass';
    terrainNoiseFilter.frequency.value = 900;
    terrainNoiseFilter.Q.value = 1.1;
    terrainNoise.connect(terrainNoiseFilter);
    terrainNoiseFilter.connect(terrainGain);
    terrainNoise.start();

    const threatGain = context.createGain();
    threatGain.gain.value = 0.0001;
    threatGain.connect(master);
    const threatOsc = context.createOscillator();
    threatOsc.type = 'sawtooth';
    threatOsc.frequency.value = 72;
    const threatFilter = context.createBiquadFilter();
    threatFilter.type = 'lowpass';
    threatFilter.frequency.value = 320;
    threatOsc.connect(threatFilter);
    threatFilter.connect(threatGain);
    threatOsc.start();

    const toolBus = context.createGain();
    toolBus.gain.value = 0.22;
    toolBus.connect(master);

    this.context = context;
    this.master = master;
    this.bedGain = bedGain;
    this.clusterGain = clusterGain;
    this.individualGain = individualGain;
    this.terrainGain = terrainGain;
    this.threatGain = threatGain;
    this.bedOscA = bedOscA;
    this.bedOscB = bedOscB;
    this.clusterOsc = clusterOsc;
    this.individualOsc = individualOsc;
    this.terrainNoiseFilter = terrainNoiseFilter;
    this.toolBus = toolBus;
    this.started = true;
  }

  update(snapshot: SimulationSnapshot): void {
    if (
      !this.context ||
      !this.master ||
      !this.bedGain ||
      !this.clusterGain ||
      !this.individualGain ||
      !this.terrainGain ||
      !this.threatGain ||
      !this.bedOscA ||
      !this.bedOscB ||
      !this.clusterOsc ||
      !this.individualOsc ||
      !this.terrainNoiseFilter
    ) {
      return;
    }

    const now = this.context.currentTime;
    const zoomNorm = clamp((snapshot.camera.zoom - 0.32) / (2.8 - 0.32), 0, 1);
    const counts = this.countEntities(snapshot.entities);
    const focus = this.computeFocus(snapshot);
    const root = 154 + snapshot.stats.harmony * 36 + snapshot.stats.energy * 18;
    const harmonic = root * (1.25 + snapshot.stats.growth * 0.1);
    const clusterFreq = root * (0.5 + focus.cluster * 0.4) + counts.cluster * 1.7;
    const individualFreq = 310 + focus.flocker * 90 + focus.plant * 40 + zoomNorm * 55;

    this.bedOscA.frequency.setTargetAtTime(root, now, 0.6);
    this.bedOscB.frequency.setTargetAtTime(harmonic, now, 0.7);
    this.clusterOsc.frequency.setTargetAtTime(clusterFreq, now, 0.45);
    this.individualOsc.frequency.setTargetAtTime(individualFreq, now, 0.28);
    this.terrainNoiseFilter.frequency.setTargetAtTime(620 + focus.fluid * 340 + focus.dense * 170 - focus.hard * 160, now, 0.35);
    this.terrainNoiseFilter.Q.setTargetAtTime(1 + focus.hard * 1.4 + snapshot.stats.threat * 1.2, now, 0.4);

    this.bedGain.gain.setTargetAtTime(0.018 + snapshot.stats.energy * 0.024 + (1 - zoomNorm) * 0.02, now, 0.5);
    this.clusterGain.gain.setTargetAtTime(0.003 + counts.cluster * 0.0005 + snapshot.stats.harmony * 0.015 + zoomNorm * 0.009, now, 0.3);
    this.individualGain.gain.setTargetAtTime(0.004 + counts.flocker * 0.00014 + focus.total * 0.016 + zoomNorm * 0.02, now, 0.22);
    this.terrainGain.gain.setTargetAtTime(0.001 + focus.fluid * 0.01 + focus.dense * 0.005 + (1 - zoomNorm) * 0.007, now, 0.4);
    this.threatGain.gain.setTargetAtTime(0.0001 + snapshot.stats.threat * 0.012 + counts.predator * 0.0009, now, 0.18);
    this.master.gain.setTargetAtTime(0.08 + snapshot.stats.energy * 0.04, now, 0.7);

    if (snapshot.tool.feedback && snapshot.tool.feedback.id !== this.lastFeedbackId) {
      this.lastFeedbackId = snapshot.tool.feedback.id;
      this.triggerToolTone(snapshot.tool.feedback.tool, snapshot.tool.feedback.intensity);
    }
  }

  private triggerToolTone(tool: SimulationSnapshot['tool']['active'], intensity: number): void {
    if (!this.context || !this.toolBus) return;
    const now = this.context.currentTime;
    const gain = this.context.createGain();
    const osc = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const settings = {
      observe: { type: 'sine' as OscillatorType, freq: 260, q: 1.2 },
      grow: { type: 'triangle' as OscillatorType, freq: 330, q: 1.7 },
      feed: { type: 'sine' as OscillatorType, freq: 420, q: 2.2 },
      repel: { type: 'square' as OscillatorType, freq: 180, q: 0.8 },
      disrupt: { type: 'sawtooth' as OscillatorType, freq: 144, q: 3.2 },
    }[tool];

    osc.type = settings.type;
    osc.frequency.value = settings.freq + intensity * 70;
    filter.type = 'bandpass';
    filter.frequency.value = settings.freq * (1.2 + intensity * 0.4);
    filter.Q.value = settings.q;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.03 + intensity * 0.05, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.toolBus);
    osc.start(now);
    osc.stop(now + 0.36);
  }

  private countEntities(entities: Entity[]): Record<Entity['type'], number> {
    return entities.reduce(
      (acc, entity) => {
        acc[entity.type] += 1;
        return acc;
      },
      { flocker: 0, cluster: 0, plant: 0, predator: 0 } as Record<Entity['type'], number>,
    );
  }

  private computeFocus(snapshot: SimulationSnapshot) {
    const radius = 260 / snapshot.camera.zoom;
    const center = snapshot.camera.center;
    let total = 0;
    let flocker = 0;
    let cluster = 0;
    let plant = 0;
    let fluid = 0;
    let dense = 0;
    let hard = 0;

    for (const entity of snapshot.entities) {
      const dx = entity.position.x - center.x;
      const dy = entity.position.y - center.y;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) continue;
      const weight = 1 - dist / radius;
      total += weight;
      if (entity.type === 'flocker') flocker += weight;
      if (entity.type === 'cluster') cluster += weight;
      if (entity.type === 'plant') plant += weight;
    }

    for (const cell of snapshot.terrain) {
      const dx = cell.center.x - center.x;
      const dy = cell.center.y - center.y;
      const dist = Math.hypot(dx, dy);
      if (dist > radius * 1.2) continue;
      const weight = clamp(1 - dist / (radius * 1.2), 0, 1);
      if (cell.terrain === 'fluid') fluid += weight;
      if (cell.terrain === 'dense') dense += weight;
      if (cell.terrain === 'hard') hard += weight;
    }

    const normalizer = Math.max(total, 1);
    return {
      total: clamp(total / 12, 0, 1),
      flocker: flocker / normalizer,
      cluster: cluster / normalizer,
      plant: plant / normalizer,
      fluid: clamp(fluid / 10, 0, 1),
      dense: clamp(dense / 10, 0, 1),
      hard: clamp(hard / 10, 0, 1),
    };
  }
}
