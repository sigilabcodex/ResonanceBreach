import type { Entity, SimulationSnapshot } from '../sim/types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const MAJOR_PENTATONIC = [0, 2, 4, 7, 9];

const createNoiseBuffer = (context: AudioContext, seconds: number): AudioBuffer => {
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.42;
  return buffer;
};

const quantizeToScale = (root: number, octave: number, degree: number) => root * 2 ** (octave + MAJOR_PENTATONIC[degree % MAJOR_PENTATONIC.length] / 12);

export class AudioEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private droneGain?: GainNode;
  private mobileGain?: GainNode;
  private rhythmGain?: GainNode;
  private zoneGain?: GainNode;
  private focusGain?: GainNode;
  private droneA?: OscillatorNode;
  private droneB?: OscillatorNode;
  private mobileOsc?: OscillatorNode;
  private rhythmOsc?: OscillatorNode;
  private zoneNoiseFilter?: BiquadFilterNode;
  private focusOsc?: OscillatorNode;
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

    const droneGain = context.createGain();
    droneGain.gain.value = 0.0001;
    droneGain.connect(master);
    const droneFilter = context.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 1100;
    droneFilter.connect(droneGain);

    const droneA = context.createOscillator();
    droneA.type = 'sine';
    droneA.frequency.value = 130.81;
    droneA.connect(droneFilter);
    droneA.start();

    const droneB = context.createOscillator();
    droneB.type = 'triangle';
    droneB.frequency.value = 196;
    droneB.connect(droneFilter);
    droneB.start();

    const mobileGain = context.createGain();
    mobileGain.gain.value = 0.0001;
    mobileGain.connect(master);
    const mobileOsc = context.createOscillator();
    mobileOsc.type = 'triangle';
    const mobileFilter = context.createBiquadFilter();
    mobileFilter.type = 'bandpass';
    mobileFilter.frequency.value = 950;
    mobileFilter.Q.value = 1.4;
    mobileOsc.connect(mobileFilter);
    mobileFilter.connect(mobileGain);
    mobileOsc.start();

    const rhythmGain = context.createGain();
    rhythmGain.gain.value = 0.0001;
    rhythmGain.connect(master);
    const rhythmOsc = context.createOscillator();
    rhythmOsc.type = 'sawtooth';
    const rhythmFilter = context.createBiquadFilter();
    rhythmFilter.type = 'lowpass';
    rhythmFilter.frequency.value = 300;
    rhythmOsc.frequency.value = 72;
    rhythmOsc.connect(rhythmFilter);
    rhythmFilter.connect(rhythmGain);
    rhythmOsc.start();

    const zoneGain = context.createGain();
    zoneGain.gain.value = 0.0001;
    zoneGain.connect(master);
    const zoneNoise = context.createBufferSource();
    zoneNoise.buffer = createNoiseBuffer(context, 2.4);
    zoneNoise.loop = true;
    const zoneNoiseFilter = context.createBiquadFilter();
    zoneNoiseFilter.type = 'bandpass';
    zoneNoiseFilter.frequency.value = 780;
    zoneNoiseFilter.Q.value = 1.1;
    zoneNoise.connect(zoneNoiseFilter);
    zoneNoiseFilter.connect(zoneGain);
    zoneNoise.start();

    const focusGain = context.createGain();
    focusGain.gain.value = 0.0001;
    focusGain.connect(master);
    const focusOsc = context.createOscillator();
    focusOsc.type = 'sine';
    focusOsc.frequency.value = 392;
    const focusFilter = context.createBiquadFilter();
    focusFilter.type = 'bandpass';
    focusFilter.frequency.value = 1200;
    focusFilter.Q.value = 2.4;
    focusOsc.connect(focusFilter);
    focusFilter.connect(focusGain);
    focusOsc.start();

    const toolBus = context.createGain();
    toolBus.gain.value = 0.22;
    toolBus.connect(master);

    this.context = context;
    this.master = master;
    this.droneGain = droneGain;
    this.mobileGain = mobileGain;
    this.rhythmGain = rhythmGain;
    this.zoneGain = zoneGain;
    this.focusGain = focusGain;
    this.droneA = droneA;
    this.droneB = droneB;
    this.mobileOsc = mobileOsc;
    this.rhythmOsc = rhythmOsc;
    this.zoneNoiseFilter = zoneNoiseFilter;
    this.focusOsc = focusOsc;
    this.toolBus = toolBus;
    this.started = true;
  }

  update(snapshot: SimulationSnapshot): void {
    if (
      !this.context ||
      !this.master ||
      !this.droneGain ||
      !this.mobileGain ||
      !this.rhythmGain ||
      !this.zoneGain ||
      !this.focusGain ||
      !this.droneA ||
      !this.droneB ||
      !this.mobileOsc ||
      !this.rhythmOsc ||
      !this.zoneNoiseFilter ||
      !this.focusOsc
    ) {
      return;
    }

    const now = this.context.currentTime;
    const zoomNorm = clamp((snapshot.camera.zoom - 0.32) / (2.8 - 0.32), 0, 1);
    const counts = this.countEntities(snapshot.entities);
    const focus = this.computeFocus(snapshot);
    const root = 110 + snapshot.stats.harmony * 28 + snapshot.stats.energy * 16;
    const droneRoot = quantizeToScale(root, 0, 0);
    const droneFifth = quantizeToScale(root, 0, 3);
    const mobileDegree = Math.round(clamp(focus.flocker * 4 + focus.cluster * 2, 0, 4));
    const mobileFreq = quantizeToScale(root * (1 + zoomNorm * 0.14), 1, mobileDegree);
    const rhythmFreq = quantizeToScale(root * 0.5, -1, 0) + snapshot.stats.threat * 12;
    const zoneFreq = 380 + focus.fluid * 240 + focus.dense * 180 - focus.hard * 120;
    const focusFreq = quantizeToScale(root * 1.5, 1, 4);

    this.droneA.frequency.setTargetAtTime(droneRoot, now, 0.7);
    this.droneB.frequency.setTargetAtTime(droneFifth, now, 0.7);
    this.mobileOsc.frequency.setTargetAtTime(mobileFreq, now, 0.28);
    this.rhythmOsc.frequency.setTargetAtTime(rhythmFreq, now, 0.18);
    this.zoneNoiseFilter.frequency.setTargetAtTime(zoneFreq, now, 0.35);
    this.zoneNoiseFilter.Q.setTargetAtTime(1 + focus.hard * 1.3 + snapshot.stats.focus * 0.8, now, 0.3);
    this.focusOsc.frequency.setTargetAtTime(focusFreq, now, 0.24);

    this.droneGain.gain.setTargetAtTime(0.015 + counts.plant * 0.00018 + snapshot.stats.energy * 0.018 + (1 - zoomNorm) * 0.012, now, 0.45);
    this.mobileGain.gain.setTargetAtTime(0.004 + counts.flocker * 0.00016 + counts.cluster * 0.0001 + focus.total * 0.012 + zoomNorm * 0.022, now, 0.22);
    this.rhythmGain.gain.setTargetAtTime(0.0001 + counts.predator * 0.0012 + snapshot.stats.threat * 0.016 + zoomNorm * 0.004, now, 0.16);
    this.zoneGain.gain.setTargetAtTime(0.002 + focus.fluid * 0.01 + focus.dense * 0.008 + (1 - zoomNorm) * 0.01, now, 0.4);
    this.focusGain.gain.setTargetAtTime(0.0001 + snapshot.stats.focus * 0.025, now, 0.2);
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
      observe: { type: 'sine' as OscillatorType, freq: 392, q: 2.2 },
      grow: { type: 'triangle' as OscillatorType, freq: 294, q: 1.8 },
      feed: { type: 'sine' as OscillatorType, freq: 440, q: 2.4 },
      repel: { type: 'square' as OscillatorType, freq: 196, q: 1.1 },
      disrupt: { type: 'sawtooth' as OscillatorType, freq: 174, q: 3 },
    }[tool];

    osc.type = settings.type;
    osc.frequency.value = settings.freq + intensity * 70;
    filter.type = 'bandpass';
    filter.frequency.value = settings.freq * (1.15 + intensity * 0.35);
    filter.Q.value = settings.q;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.025 + intensity * 0.05, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (tool === 'observe' ? 0.42 : 0.36));

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.toolBus);
    osc.start(now);
    osc.stop(now + 0.46);
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

    for (const sample of snapshot.terrain) {
      const dx = sample.center.x - center.x;
      const dy = sample.center.y - center.y;
      const dist = Math.hypot(dx, dy);
      if (dist > radius * 1.3) continue;
      const weight = clamp(1 - dist / (radius * 1.3), 0, 1);
      if (sample.terrain === 'fluid') fluid += weight;
      if (sample.terrain === 'dense') dense += weight;
      if (sample.terrain === 'hard') hard += weight;
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
