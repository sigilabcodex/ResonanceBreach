import type { WorldEvent } from '../sim/events';
import type { Entity, SimulationSnapshot } from '../types/world';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const MAJOR_PENTATONIC = [0, 2, 4, 7, 9];
const quantizeToScale = (root: number, octave: number, degree: number) => root * 2 ** (octave + MAJOR_PENTATONIC[degree % MAJOR_PENTATONIC.length] / 12);

export class AudioEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private ambientGain?: GainNode;
  private plantGain?: GainNode;
  private creatureGain?: GainNode;
  private focusGain?: GainNode;
  private ambientOsc?: OscillatorNode;
  private plantOsc?: OscillatorNode;
  private creatureOsc?: OscillatorNode;
  private ambientFilter?: BiquadFilterNode;
  private plantFilter?: BiquadFilterNode;
  private creatureFilter?: BiquadFilterNode;
  private plantPanner?: StereoPannerNode;
  private creaturePanner?: StereoPannerNode;
  private focusOsc?: OscillatorNode;
  private toolBus?: GainNode;
  private lastFeedbackId = 0;
  private lastEventId = 0;
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
    ambientFilter.frequency.value = 440;
    ambientFilter.connect(ambientGain);
    const ambientOsc = context.createOscillator();
    ambientOsc.type = 'sine';
    ambientOsc.frequency.value = 82;
    ambientOsc.connect(ambientFilter);
    ambientOsc.start();

    const plantGain = context.createGain();
    plantGain.gain.value = 0.0001;
    plantGain.connect(master);
    const plantPanner = context.createStereoPanner();
    plantPanner.connect(plantGain);
    const plantFilter = context.createBiquadFilter();
    plantFilter.type = 'bandpass';
    plantFilter.frequency.value = 240;
    plantFilter.Q.value = 0.7;
    plantFilter.connect(plantPanner);
    const plantOsc = context.createOscillator();
    plantOsc.type = 'triangle';
    plantOsc.frequency.value = 164.81;
    plantOsc.connect(plantFilter);
    plantOsc.start();

    const creatureGain = context.createGain();
    creatureGain.gain.value = 0.0001;
    creatureGain.connect(master);
    const creaturePanner = context.createStereoPanner();
    creaturePanner.connect(creatureGain);
    const creatureFilter = context.createBiquadFilter();
    creatureFilter.type = 'bandpass';
    creatureFilter.frequency.value = 620;
    creatureFilter.Q.value = 1.2;
    creatureFilter.connect(creaturePanner);
    const creatureOsc = context.createOscillator();
    creatureOsc.type = 'sine';
    creatureOsc.frequency.value = 293.66;
    creatureOsc.connect(creatureFilter);
    creatureOsc.start();

    const focusGain = context.createGain();
    focusGain.gain.value = 0.0001;
    focusGain.connect(master);
    const focusOsc = context.createOscillator();
    focusOsc.type = 'sine';
    focusOsc.frequency.value = 392;
    focusOsc.connect(focusGain);
    focusOsc.start();

    const toolBus = context.createGain();
    toolBus.gain.value = 0.18;
    toolBus.connect(master);

    this.context = context;
    this.master = master;
    this.ambientGain = ambientGain;
    this.plantGain = plantGain;
    this.creatureGain = creatureGain;
    this.focusGain = focusGain;
    this.ambientOsc = ambientOsc;
    this.plantOsc = plantOsc;
    this.creatureOsc = creatureOsc;
    this.ambientFilter = ambientFilter;
    this.plantFilter = plantFilter;
    this.creatureFilter = creatureFilter;
    this.plantPanner = plantPanner;
    this.creaturePanner = creaturePanner;
    this.focusOsc = focusOsc;
    this.toolBus = toolBus;
    this.started = true;
  }

  update(snapshot: SimulationSnapshot): void {
    if (
      !this.context ||
      !this.master ||
      !this.ambientGain ||
      !this.plantGain ||
      !this.creatureGain ||
      !this.focusGain ||
      !this.ambientOsc ||
      !this.plantOsc ||
      !this.creatureOsc ||
      !this.ambientFilter ||
      !this.plantFilter ||
      !this.creatureFilter ||
      !this.plantPanner ||
      !this.creaturePanner ||
      !this.focusOsc
    ) {
      return;
    }

    const now = this.context.currentTime;
    const zoomNorm = clamp((snapshot.camera.zoom - 0.32) / (2.8 - 0.32), 0, 1);
    const focus = this.computeFocus(snapshot);
    const plants = snapshot.entities.filter((entity) => entity.type === 'plant');
    const creatures = snapshot.entities.filter((entity) => entity.type !== 'plant').sort((a, b) => b.activity - a.activity).slice(0, 5);
    const root = 82 + snapshot.stats.growth * 18 + snapshot.stats.nutrients * 12;
    const ambientFreq = quantizeToScale(root, -1, 0);
    const plantFreq = quantizeToScale(root, 0, Math.round(clamp(snapshot.stats.nutrients * 4, 0, 4)));
    const creatureFreq = quantizeToScale(root * (1 + zoomNorm * 0.06), 1, Math.round(clamp(snapshot.stats.fruit * 4 + focus.activity * 2, 0, 4)));
    const focusFreq = quantizeToScale(root * 1.5, 1, 4);

    this.ambientOsc.frequency.setTargetAtTime(ambientFreq, now, 1.4);
    this.plantOsc.frequency.setTargetAtTime(plantFreq, now, 1.2);
    this.creatureOsc.frequency.setTargetAtTime(creatureFreq, now, 0.7);
    this.focusOsc.frequency.setTargetAtTime(focusFreq, now, 0.5);

    this.ambientFilter.frequency.setTargetAtTime(280 + (1 - zoomNorm) * 220 + snapshot.stats.stability * 140, now, 1.2);
    this.plantFilter.frequency.setTargetAtTime(220 + snapshot.stats.nutrients * 160 + zoomNorm * 40, now, 0.8);
    this.creatureFilter.frequency.setTargetAtTime(540 + focus.activity * 220 + zoomNorm * 160, now, 0.4);

    const plantCentroid = this.computeCentroid(plants);
    const creatureCentroid = this.computeCentroid(creatures);
    this.plantPanner.pan.setTargetAtTime(this.panFromPosition(plantCentroid.x, snapshot), now, 0.5);
    this.creaturePanner.pan.setTargetAtTime(this.panFromPosition(creatureCentroid.x, snapshot), now, 0.3);

    const focusIsolation = snapshot.stats.focus;
    const ambientGain = 0.015 + (1 - zoomNorm) * 0.012 + snapshot.stats.stability * 0.01;
    const plantGain = 0.004 + plants.length * 0.00018 + snapshot.stats.nutrients * 0.016;
    const creatureGain = 0.006 + creatures.reduce((sum, entity) => sum + entity.activity, 0) * 0.008 + zoomNorm * 0.012;

    this.ambientGain.gain.setTargetAtTime(ambientGain * (1 - focusIsolation * 0.6), now, 0.9);
    this.plantGain.gain.setTargetAtTime(plantGain * (1 - focusIsolation * 0.35), now, 0.7);
    this.creatureGain.gain.setTargetAtTime(creatureGain * (0.78 + focusIsolation * 0.42), now, 0.35);
    this.focusGain.gain.setTargetAtTime(0.0001 + focusIsolation * 0.02, now, 0.25);
    this.master.gain.setTargetAtTime(0.048 + snapshot.stats.energy * 0.03, now, 1.2);

    if (snapshot.tool.feedback && snapshot.tool.feedback.id !== this.lastFeedbackId) {
      this.lastFeedbackId = snapshot.tool.feedback.id;
      this.triggerToolTone(snapshot.tool.feedback.tool, snapshot.tool.feedback.intensity);
    }

    for (const event of snapshot.events) {
      if (event.id <= this.lastEventId) continue;
      this.lastEventId = event.id;
      this.triggerEventTone(event);
    }
  }

  private computeCentroid(entities: Entity[]): { x: number; y: number } {
    if (entities.length === 0) return { x: 0, y: 0 };
    const total = entities.reduce(
      (acc, entity) => {
        acc.x += entity.position.x;
        acc.y += entity.position.y;
        return acc;
      },
      { x: 0, y: 0 },
    );
    return { x: total.x / entities.length, y: total.y / entities.length };
  }

  private panFromPosition(x: number, snapshot: SimulationSnapshot): number {
    if (!x) return 0;
    const radius = 420 / snapshot.camera.zoom;
    return clamp((x - snapshot.camera.center.x) / radius, -0.9, 0.9);
  }

  private computeFocus(snapshot: SimulationSnapshot) {
    const radius = 320 / snapshot.camera.zoom;
    const center = snapshot.camera.center;
    let activity = 0;

    for (const entity of snapshot.entities) {
      const dx = entity.position.x - center.x;
      const dy = entity.position.y - center.y;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) continue;
      const weight = 1 - dist / radius;
      activity += weight * entity.activity;
    }

    return {
      activity: clamp(activity / 6, 0, 1),
    };
  }

  private triggerEventTone(event: WorldEvent): void {
    if (!this.context || !this.toolBus) return;
    if (event.type === 'toolUsed') {
      this.triggerToolTone(event.tool, event.blocked ? 0.22 : 0.5);
      return;
    }

    const now = this.context.currentTime;
    const gain = this.context.createGain();
    const osc = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const settings = {
      entityBorn: { freq: 294, dur: 0.24, type: 'triangle' as OscillatorType },
      entityFed: { freq: 370, dur: 0.18, type: 'sine' as OscillatorType },
      entityDied: { freq: 196, dur: 0.46, type: 'sine' as OscillatorType },
      residueCreated: { freq: 220, dur: 0.34, type: 'triangle' as OscillatorType },
    }[event.type];

    osc.type = settings.type;
    osc.frequency.value = settings.freq;
    filter.type = event.type === 'entityDied' ? 'lowpass' : 'bandpass';
    filter.frequency.value = event.type === 'entityDied' ? 460 : settings.freq * 1.35;
    filter.Q.value = event.type === 'entityFed' ? 2.3 : 1.2;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(event.type === 'entityDied' ? 0.009 : 0.012, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + settings.dur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.toolBus);
    osc.start(now);
    osc.stop(now + settings.dur + 0.06);
  }

  private triggerToolTone(tool: SimulationSnapshot['tool']['active'], intensity: number): void {
    if (!this.context || !this.toolBus) return;
    const now = this.context.currentTime;
    const gain = this.context.createGain();
    const osc = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const settings = {
      observe: { type: 'sine' as OscillatorType, freq: 392, q: 2.6, dur: 0.32 },
      grow: { type: 'triangle' as OscillatorType, freq: 262, q: 1.6, dur: 0.42 },
      feed: { type: 'sine' as OscillatorType, freq: 330, q: 2.1, dur: 0.36 },
      repel: { type: 'triangle' as OscillatorType, freq: 220, q: 1.2, dur: 0.44 },
      disrupt: { type: 'sine' as OscillatorType, freq: 174, q: 2.2, dur: 0.65 },
    }[tool];

    osc.type = settings.type;
    osc.frequency.value = settings.freq + intensity * 38;
    filter.type = 'bandpass';
    filter.frequency.value = settings.freq * (1.1 + intensity * 0.18);
    filter.Q.value = settings.q;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.014 + intensity * 0.018, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + settings.dur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.toolBus);
    osc.start(now);
    osc.stop(now + settings.dur + 0.08);
  }
}
