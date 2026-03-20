import type { WorldEvent } from '../sim/events';
import type { SimulationSnapshot, ToolState, Vec2 } from '../types/world';
import { buildZoneSummaries, createAudioFocusContext, scoreEntities, selectForegroundVoices, type AudioFocusContext, type ScoredEntity, type ZoneSummary } from './salience';
import { createHarmonyState, getHarmonyFrequency, type HarmonyState } from './harmony';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type PooledVoice = {
  gain: GainNode;
  filter: BiquadFilterNode;
  panner: StereoPannerNode;
  oscillator: OscillatorNode;
};

const FOREGROUND_VOICE_COUNT = 3;
const ZONE_VOICE_COUNT = 3;

const ENTITY_OCTAVE: Record<ScoredEntity['entity']['type'], number> = {
  plant: -1,
  cluster: 0,
  flocker: 1,
  predator: 0,
};

const ENTITY_WAVEFORM: Record<ScoredEntity['entity']['type'], OscillatorType> = {
  plant: 'triangle',
  cluster: 'sine',
  flocker: 'triangle',
  predator: 'sawtooth',
};

const ZONE_WAVEFORM: Record<ZoneSummary['kind'], OscillatorType> = {
  rooted: 'triangle',
  mobile: 'sine',
  cluster: 'triangle',
  predator: 'sawtooth',
  water: 'sine',
};

export class AudioEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private bedGain?: GainNode;
  private bedLowFilter?: BiquadFilterNode;
  private bedMidFilter?: BiquadFilterNode;
  private bedLowOsc?: OscillatorNode;
  private bedMidOsc?: OscillatorNode;
  private zoneVoices: PooledVoice[] = [];
  private foregroundVoices: PooledVoice[] = [];
  private eventBus?: GainNode;
  private lastFeedbackId = 0;
  private lastEventId = 0;
  private started = false;
  private lastSnapshotTime = 0;
  private entityPriority = new Map<number, number>();

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

    const bedLowFilter = context.createBiquadFilter();
    bedLowFilter.type = 'lowpass';
    bedLowFilter.frequency.value = 220;
    bedLowFilter.Q.value = 0.4;
    bedLowFilter.connect(bedGain);

    const bedMidFilter = context.createBiquadFilter();
    bedMidFilter.type = 'bandpass';
    bedMidFilter.frequency.value = 320;
    bedMidFilter.Q.value = 0.8;
    bedMidFilter.connect(bedGain);

    const bedLowOsc = context.createOscillator();
    bedLowOsc.type = 'sine';
    bedLowOsc.frequency.value = 82;
    bedLowOsc.connect(bedLowFilter);
    bedLowOsc.start();

    const bedMidOsc = context.createOscillator();
    bedMidOsc.type = 'triangle';
    bedMidOsc.frequency.value = 164;
    bedMidOsc.connect(bedMidFilter);
    bedMidOsc.start();

    const zoneVoices = Array.from({ length: ZONE_VOICE_COUNT }, (_, index) => this.createVoice(context, index === 0 ? 'sine' : 'triangle', master));
    const foregroundVoices = Array.from({ length: FOREGROUND_VOICE_COUNT }, (_, index) => this.createVoice(context, index === 2 ? 'sawtooth' : 'triangle', master));

    const eventBus = context.createGain();
    eventBus.gain.value = 0.18;
    eventBus.connect(master);

    this.context = context;
    this.master = master;
    this.bedGain = bedGain;
    this.bedLowFilter = bedLowFilter;
    this.bedMidFilter = bedMidFilter;
    this.bedLowOsc = bedLowOsc;
    this.bedMidOsc = bedMidOsc;
    this.zoneVoices = zoneVoices;
    this.foregroundVoices = foregroundVoices;
    this.eventBus = eventBus;
    this.started = true;
  }

  update(snapshot: SimulationSnapshot): void {
    if (
      !this.context
      || !this.master
      || !this.bedGain
      || !this.bedLowFilter
      || !this.bedMidFilter
      || !this.bedLowOsc
      || !this.bedMidOsc
      || !this.eventBus
    ) {
      return;
    }

    const now = this.context.currentTime;
    const dt = this.lastSnapshotTime > 0 ? Math.max(0.016, snapshot.time - this.lastSnapshotTime) : 0.016;
    this.lastSnapshotTime = snapshot.time;
    this.decayEntityPriority(dt);
    this.processEvents(snapshot.events);

    const harmony = createHarmonyState(snapshot);
    const focus = createAudioFocusContext(snapshot);
    const scored = scoreEntities(snapshot, focus, this.entityPriority);
    const foreground = selectForegroundVoices(scored, FOREGROUND_VOICE_COUNT);
    const zones = buildZoneSummaries(snapshot, scored, foreground);
    const zoomNorm = clamp((snapshot.camera.zoom - 0.32) / (2.8 - 0.32), 0, 1);

    this.updateGlobalBed(snapshot, harmony, focus, zoomNorm, now);
    this.updateZoneVoices(snapshot, harmony, focus, zones, zoomNorm, now);
    this.updateForegroundVoices(snapshot, harmony, focus, foreground, zoomNorm, now);

    const focusMasterDip = focus.active ? 1 - focus.intensity * 0.1 : 1;
    this.master.gain.setTargetAtTime((0.05 + snapshot.stats.energy * 0.025) * focusMasterDip, now, 1.1);

    if (snapshot.tool.feedback && snapshot.tool.feedback.id !== this.lastFeedbackId) {
      this.lastFeedbackId = snapshot.tool.feedback.id;
      if (snapshot.tool.feedback.tool === 'observe') {
        this.triggerToolTone(snapshot.tool, harmony, snapshot.tool.feedback.intensity);
      }
    }
  }

  private createVoice(context: AudioContext, waveform: OscillatorType, destination: GainNode): PooledVoice {
    const gain = context.createGain();
    gain.gain.value = 0.0001;
    gain.connect(destination);

    const panner = context.createStereoPanner();
    panner.connect(gain);

    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 320;
    filter.Q.value = 1;
    filter.connect(panner);

    const oscillator = context.createOscillator();
    oscillator.type = waveform;
    oscillator.frequency.value = 220;
    oscillator.connect(filter);
    oscillator.start();

    return { gain, filter, panner, oscillator };
  }

  private updateGlobalBed(
    snapshot: SimulationSnapshot,
    harmony: HarmonyState,
    focus: AudioFocusContext,
    zoomNorm: number,
    now: number,
  ): void {
    if (!this.bedGain || !this.bedLowFilter || !this.bedMidFilter || !this.bedLowOsc || !this.bedMidOsc) return;

    const lowFreq = getHarmonyFrequency(harmony, 'bed', snapshot.stats.stability, -1);
    const midFreq = getHarmonyFrequency(harmony, 'bed', snapshot.stats.harmony, 0);
    const bedLevel = 0.012 + snapshot.stats.stability * 0.01 + (1 - zoomNorm) * 0.01;
    const focusDuck = focus.active ? 1 - focus.intensity * 0.28 : 1;

    this.bedLowOsc.frequency.setTargetAtTime(lowFreq, now, 1.8);
    this.bedMidOsc.frequency.setTargetAtTime(midFreq, now, 1.6);
    this.bedLowFilter.frequency.setTargetAtTime(180 + snapshot.stats.stability * 120 + (1 - snapshot.stats.threat) * 40, now, 1.4);
    this.bedMidFilter.frequency.setTargetAtTime(240 + snapshot.stats.harmony * 200 + snapshot.stats.growth * 50, now, 1.2);
    this.bedGain.gain.setTargetAtTime(bedLevel * focusDuck, now, 1.1);
  }

  private updateZoneVoices(
    snapshot: SimulationSnapshot,
    harmony: HarmonyState,
    focus: AudioFocusContext,
    zones: ZoneSummary[],
    zoomNorm: number,
    now: number,
  ): void {
    this.zoneVoices.forEach((voice, index) => {
      const zone = zones[index];
      if (!zone) {
        voice.gain.gain.setTargetAtTime(0.0001, now, 0.3);
        return;
      }

      const inFocus = focus.active && this.distance(zone.position, focus.center) <= focus.radius;
      const focusBoost = inFocus ? 0.24 + focus.intensity * 0.44 : focus.active ? -0.08 - focus.intensity * 0.2 : 0;
      const densitySuppression = clamp((1 - zoomNorm) * 0.45 + (1 - zone.detail) * 0.35, 0.22, 0.88);
      const gain = clamp(0.004 + zone.density * 0.006 + zone.count * 0.0004, 0.003, 0.022) * densitySuppression * (1 + focusBoost);
      const contour = clamp(zone.activity * 0.55 + zone.tone * 0.45, 0, 1);
      const octaveOffset = zone.kind === 'rooted' ? -1 : zone.kind === 'water' ? -1 : zone.kind === 'predator' ? 0 : 0;
      const filterFrequency = inFocus
        ? 600 + zone.detail * 900 + focus.intensity * 500
        : focus.active
          ? 220 + zone.detail * 260
          : 320 + zone.detail * 520;

      voice.oscillator.type = ZONE_WAVEFORM[zone.kind];
      voice.oscillator.frequency.setTargetAtTime(getHarmonyFrequency(harmony, zone.kind === 'water' ? 'water' : zone.kind === 'rooted' ? 'plant' : 'cluster', contour, octaveOffset), now, 0.8);
      voice.filter.type = zone.kind === 'water' ? 'lowpass' : 'bandpass';
      voice.filter.frequency.setTargetAtTime(filterFrequency, now, 0.6);
      voice.filter.Q.setTargetAtTime(zone.kind === 'water' ? 0.5 : 0.9 + zone.detail * 0.9, now, 0.6);
      voice.panner.pan.setTargetAtTime(this.panFromPosition(zone.position.x, snapshot), now, 0.4);
      voice.gain.gain.setTargetAtTime(gain, now, 0.55);
    });
  }

  private updateForegroundVoices(
    snapshot: SimulationSnapshot,
    harmony: HarmonyState,
    focus: AudioFocusContext,
    foreground: ScoredEntity[],
    zoomNorm: number,
    now: number,
  ): void {
    this.foregroundVoices.forEach((voice, index) => {
      const candidate = foreground[index];
      if (!candidate) {
        voice.gain.gain.setTargetAtTime(0.0001, now, 0.18);
        return;
      }

      const detailLift = clamp(candidate.detail, 0, 1.4);
      const focusLift = candidate.insideFocus ? 0.3 + focus.intensity * 0.55 : focus.active ? -0.12 - focus.intensity * 0.22 : 0;
      const gain = clamp(0.006 + candidate.score * 0.01 + detailLift * 0.004, 0.006, 0.028) * (0.82 + zoomNorm * 0.28 + focusLift);
      const contour = clamp(candidate.entity.activity * 0.45 + candidate.entity.tone * 0.35 + candidate.entity.harmony * 0.2, 0, 1);
      const filterFrequency = candidate.insideFocus
        ? 920 + detailLift * 980 + focus.intensity * 420
        : focus.active
          ? 320 + detailLift * 320
          : 540 + detailLift * 620;

      voice.oscillator.type = ENTITY_WAVEFORM[candidate.entity.type];
      voice.oscillator.frequency.setTargetAtTime(getHarmonyFrequency(harmony, candidate.entity.type === 'plant' ? 'plant' : 'mobile', contour, ENTITY_OCTAVE[candidate.entity.type]), now, 0.24);
      voice.filter.type = candidate.entity.type === 'plant' ? 'lowpass' : 'bandpass';
      voice.filter.frequency.setTargetAtTime(filterFrequency, now, 0.18);
      voice.filter.Q.setTargetAtTime(candidate.entity.type === 'predator' ? 2.2 : 1 + detailLift, now, 0.22);
      voice.panner.pan.setTargetAtTime(this.panFromPosition(candidate.entity.position.x, snapshot), now, 0.18);
      voice.gain.gain.setTargetAtTime(gain, now, 0.2);
    });
  }

  private processEvents(events: WorldEvent[]): void {
    for (const event of events) {
      if (event.id <= this.lastEventId) continue;
      this.lastEventId = event.id;

      if ('entityId' in event) {
        const bump = event.type === 'entityDied' ? 1 : event.type === 'entityFed' ? 0.72 : 0.55;
        this.entityPriority.set(event.entityId, bump);
      }

      if (event.type === 'toolUsed') {
        this.triggerToolEventTone(event);
      } else {
        this.triggerEventTone(event);
      }
    }
  }

  private decayEntityPriority(dt: number): void {
    for (const [entityId, value] of this.entityPriority.entries()) {
      const nextValue = Math.max(0, value - dt * 0.42);
      if (nextValue <= 0.01) this.entityPriority.delete(entityId);
      else this.entityPriority.set(entityId, nextValue);
    }
  }

  private triggerToolEventTone(event: Extract<WorldEvent, { type: 'toolUsed' }>): void {
    if (!this.context || !this.eventBus) return;

    const harmony = createHarmonyState({
      dimensions: { width: 0, height: 0, wrapped: true },
      entities: [],
      terrain: [],
      attractors: [],
      fields: [],
      particles: [],
      residues: [],
      bursts: [],
      stats: {
        harmony: event.blocked ? 0.36 : 0.58,
        activity: 0.3,
        threat: event.tool === 'disrupt' ? 0.52 : 0.12,
        growth: event.tool === 'grow' ? 0.54 : 0.3,
        energy: 0.45,
        stability: event.blocked ? 0.28 : 0.62,
        biodiversity: 0.4,
        focus: event.tool === 'observe' ? 0.8 : 0,
        nutrients: event.tool === 'feed' ? 0.52 : 0.24,
        fruit: event.tool === 'feed' ? 0.44 : 0.14,
      },
      tool: { active: event.tool, unlocked: [event.tool], pulse: 0, worldPosition: event.position, radius: 0, strength: 0, visible: false, blocked: event.blocked },
      camera: { center: event.position, zoom: 1 },
      time: 0,
      timeScale: 1,
      unlockedProgress: 0,
      energy: 0,
      events: [],
      notifications: { recent: [] },
    });

    this.triggerToolTone({
      active: event.tool,
      unlocked: [event.tool],
      pulse: 0,
      worldPosition: event.position,
      radius: 0,
      strength: 0,
      visible: false,
      blocked: event.blocked,
    }, harmony, event.blocked ? 0.2 : 0.46);
  }

  private triggerEventTone(event: WorldEvent): void {
    if (!this.context || !this.eventBus) return;
    if (event.type === 'toolUsed') return;

    const now = this.context.currentTime;
    const harmony = createHarmonyState({
      dimensions: { width: 0, height: 0, wrapped: true },
      entities: [],
      terrain: [],
      attractors: [],
      fields: [],
      particles: [],
      residues: [],
      bursts: [],
      stats: {
        harmony: 0.55,
        activity: 0.3,
        threat: event.type === 'entityDied' ? 0.42 : 0.12,
        growth: 0.34,
        energy: 0.45,
        stability: 0.6,
        biodiversity: 0.4,
        focus: 0,
        nutrients: event.type === 'residueCreated' ? 0.52 : 0.26,
        fruit: event.type === 'entityFed' ? 0.46 : 0.18,
      },
      tool: { active: 'observe', unlocked: ['observe'], pulse: 0, worldPosition: event.position, radius: 0, strength: 0, visible: false, blocked: false },
      camera: { center: event.position, zoom: 1 },
      time: 0,
      timeScale: 1,
      unlockedProgress: 0,
      energy: 0,
      events: [],
      notifications: { recent: [] },
    });

    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const pan = this.context.createStereoPanner();

    const settings = {
      entityBorn: { layer: 'event' as const, contour: 0.55, octave: 1, dur: 0.24, type: 'triangle' as OscillatorType, amount: 0.012 },
      entityFed: { layer: 'event' as const, contour: 0.8, octave: 1, dur: 0.18, type: 'sine' as OscillatorType, amount: 0.014 },
      entityDied: { layer: 'plant' as const, contour: 0.2, octave: -1, dur: 0.42, type: 'sine' as OscillatorType, amount: 0.011 },
      residueCreated: { layer: 'water' as const, contour: 0.36, octave: -1, dur: 0.3, type: 'triangle' as OscillatorType, amount: 0.01 },
    }[event.type];

    osc.type = settings.type;
    osc.frequency.value = getHarmonyFrequency(harmony, settings.layer, settings.contour, settings.octave);
    filter.type = event.type === 'entityDied' ? 'lowpass' : 'bandpass';
    filter.frequency.value = event.type === 'entityDied' ? 320 : osc.frequency.value * 1.7;
    filter.Q.value = event.type === 'entityFed' ? 2.4 : 1.2;
    pan.pan.value = clamp((event.position.x - 1200) / 1200, -0.8, 0.8);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(settings.amount, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + settings.dur);

    osc.connect(filter);
    filter.connect(pan);
    pan.connect(gain);
    gain.connect(this.eventBus);
    osc.start(now);
    osc.stop(now + settings.dur + 0.08);
  }

  private triggerToolTone(tool: ToolState, harmony: HarmonyState, intensity: number): void {
    if (!this.context || !this.eventBus) return;

    const now = this.context.currentTime;
    const gain = this.context.createGain();
    const osc = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const pan = this.context.createStereoPanner();
    const settings = {
      observe: { type: 'sine' as OscillatorType, contour: 0.68, octave: 1, q: 2.6, dur: 0.32, filterScale: 2.1 },
      grow: { type: 'triangle' as OscillatorType, contour: 0.3, octave: 0, q: 1.6, dur: 0.42, filterScale: 1.5 },
      feed: { type: 'sine' as OscillatorType, contour: 0.74, octave: 1, q: 2.1, dur: 0.36, filterScale: 1.8 },
      repel: { type: 'triangle' as OscillatorType, contour: 0.22, octave: 0, q: 1.2, dur: 0.44, filterScale: 1.3 },
      disrupt: { type: 'sawtooth' as OscillatorType, contour: 0.12, octave: -1, q: 2.2, dur: 0.65, filterScale: 1.15 },
    }[tool.active];

    const baseFreq = getHarmonyFrequency(harmony, tool.active === 'observe' ? 'event' : tool.active === 'grow' ? 'plant' : tool.active === 'feed' ? 'mobile' : 'cluster', settings.contour, settings.octave);
    osc.type = settings.type;
    osc.frequency.value = baseFreq * (1 + intensity * 0.08);
    filter.type = tool.active === 'observe' ? 'highpass' : 'bandpass';
    filter.frequency.value = baseFreq * settings.filterScale;
    filter.Q.value = settings.q;
    pan.pan.value = clamp((tool.worldPosition.x - 1200) / 1200, -0.75, 0.75);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.012 + intensity * 0.016, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + settings.dur);

    osc.connect(filter);
    filter.connect(pan);
    pan.connect(gain);
    gain.connect(this.eventBus);
    osc.start(now);
    osc.stop(now + settings.dur + 0.08);
  }

  private distance(a: Vec2, b: Vec2): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private panFromPosition(x: number, snapshot: SimulationSnapshot): number {
    const radius = 420 / snapshot.camera.zoom;
    return clamp((x - snapshot.camera.center.x) / radius, -0.9, 0.9);
  }
}
