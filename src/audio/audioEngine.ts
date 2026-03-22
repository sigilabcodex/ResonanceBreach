import type { WorldEvent } from '../sim/events';
import { createDefaultDiagnostics } from '../sim/world';
import type { GameSettings } from '../settings';
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

export interface AudioDebugState {
  masterGain: number;
  foregroundVoiceCount: number;
  focusedVoiceCount: number;
  groupedVoiceCount: number;
}

const FOREGROUND_VOICE_COUNT = 3;
const ZONE_VOICE_COUNT = 3;

const ENTITY_OCTAVE: Record<ScoredEntity['entity']['type'], number> = {
  plant: -1,
  cluster: -1,
  flocker: 1,
  grazer: 0,
  predator: 0,
};

const ENTITY_WAVEFORM: Record<ScoredEntity['entity']['type'], OscillatorType> = {
  plant: 'triangle',
  cluster: 'sine',
  flocker: 'sine',
  grazer: 'triangle',
  predator: 'sawtooth',
};

const ZONE_WAVEFORM: Record<ZoneSummary['kind'], OscillatorType> = {
  rooted: 'triangle',
  mobile: 'sine',
  cluster: 'sine',
  predator: 'sawtooth',
  water: 'sine',
};

export class AudioEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private limiter?: DynamicsCompressorNode;
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
  private readonly debugState: AudioDebugState = {
    masterGain: 0,
    foregroundVoiceCount: 0,
    focusedVoiceCount: 0,
    groupedVoiceCount: 0,
  };

  async ensureStarted(): Promise<void> {
    if (this.started) {
      if (this.context?.state === 'suspended') await this.context.resume();
      return;
    }

    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = 0.0001;

    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -16;
    limiter.knee.value = 18;
    limiter.ratio.value = 10;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.22;
    master.connect(limiter);
    limiter.connect(context.destination);

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
    eventBus.gain.value = 0.22;
    eventBus.connect(master);

    this.context = context;
    this.master = master;
    this.limiter = limiter;
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

  update(snapshot: SimulationSnapshot, settings: GameSettings): void {
    if (
      !this.context
      || !this.master
      || !this.bedGain
      || !this.bedLowFilter
      || !this.bedMidFilter
      || !this.bedLowOsc
      || !this.bedMidOsc
      || !this.eventBus
      || !this.limiter
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
    const zoomNorm = clamp((snapshot.camera.zoom - 0.24) / (2.4 - 0.24), 0, 1);

    this.updateGlobalBed(snapshot, harmony, focus, zoomNorm, now, settings);
    this.updateZoneVoices(snapshot, harmony, focus, zones, zoomNorm, now, settings);
    this.updateForegroundVoices(snapshot, harmony, focus, foreground, zoomNorm, now, settings);

    const entityPresence = 0.18 + settings.audio.entityVolume * 0.36;
    this.eventBus.gain.setTargetAtTime(entityPresence, now, 0.12);
    const focusMasterDip = focus.active ? 1 - focus.intensity * 0.02 : 1;
    const masterTarget = (0.3 + snapshot.stats.energy * 0.2) * focusMasterDip * this.mapVolume(settings.audio.masterVolume);
    this.master.gain.setTargetAtTime(masterTarget, now, 0.22);
    this.updateDebugState(snapshot, foreground, zones, focus, masterTarget);

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

  private summarizeHabitats(snapshot: SimulationSnapshot) {
    let wetland = 0;
    let highland = 0;
    let basin = 0;
    let total = 0;
    for (const cell of snapshot.terrain) {
      const distance = this.distance(cell.center, snapshot.camera.center, snapshot);
      const weight = 1.2 - clamp(distance / 1400, 0, 1);
      if (weight <= 0) continue;
      wetland += cell.habitatWeights.wetland * weight;
      highland += cell.habitatWeights.highland * weight;
      basin += cell.habitatWeights.basin * weight;
      total += weight;
    }
    if (total <= 0) return { wetland: 0, highland: 0, basin: 0 };
    return { wetland: wetland / total, highland: highland / total, basin: basin / total };
  }

  private updateGlobalBed(
    snapshot: SimulationSnapshot,
    harmony: HarmonyState,
    focus: AudioFocusContext,
    zoomNorm: number,
    now: number,
    settings: GameSettings,
  ): void {
    if (!this.bedGain || !this.bedLowFilter || !this.bedMidFilter || !this.bedLowOsc || !this.bedMidOsc) return;

    const habitat = this.summarizeHabitats(snapshot);
    const lowFreq = getHarmonyFrequency(harmony, 'bed', clamp(snapshot.stats.stability * 0.76 + habitat.basin * 0.24, 0, 1), -1);
    const midFreq = getHarmonyFrequency(harmony, habitat.wetland > habitat.highland ? 'water' : 'bed', clamp(snapshot.stats.harmony * 0.74 + habitat.wetland * 0.16 + habitat.basin * 0.1, 0, 1), 0);
    const ambienceLevel = this.mapVolume(settings.audio.ambienceVolume);
    const bedLevel = (0.042 + snapshot.stats.stability * 0.024 + habitat.basin * 0.012 + habitat.wetland * 0.008 + (1 - zoomNorm) * 0.016) * ambienceLevel;
    const focusDuck = focus.mode === 'entity' ? 1 - focus.intensity * 0.12 : focus.active ? 1 - focus.intensity * 0.18 : 1;

    this.bedLowOsc.frequency.setTargetAtTime(lowFreq * (1 - habitat.highland * 0.08), now, 1.8);
    this.bedMidOsc.frequency.setTargetAtTime(midFreq * (1 + habitat.wetland * 0.04 - habitat.highland * 0.03), now, 1.6);
    this.bedLowFilter.frequency.setTargetAtTime(210 + snapshot.stats.stability * 120 + habitat.basin * 90 + habitat.wetland * 70 - habitat.highland * 40 + (1 - snapshot.stats.threat) * 40, now, 1.1);
    this.bedMidFilter.frequency.setTargetAtTime(320 + snapshot.stats.harmony * 220 + snapshot.stats.growth * 80 + habitat.wetland * 90 - habitat.highland * 70, now, 0.9);
    this.bedGain.gain.setTargetAtTime(bedLevel * focusDuck, now, 0.45);
  }

  private updateZoneVoices(
    snapshot: SimulationSnapshot,
    harmony: HarmonyState,
    focus: AudioFocusContext,
    zones: ZoneSummary[],
    zoomNorm: number,
    now: number,
    settings: GameSettings,
  ): void {
    this.zoneVoices.forEach((voice, index) => {
      const zone = zones[index];
      if (!zone) {
        voice.gain.gain.setTargetAtTime(0.0001, now, 0.3);
        return;
      }

      const inFocus = focus.active && this.distance(zone.position, focus.center, snapshot) <= focus.radius;
      const focusBoost = focus.mode === 'entity'
        ? inFocus ? 0.18 + focus.intensity * 0.28 : -0.05
        : inFocus ? 0.34 + focus.intensity * 0.42 : focus.active ? -0.16 - focus.intensity * 0.18 : 0;
      const densitySuppression = clamp((1 - zoomNorm) * 0.42 + (1 - zone.detail) * 0.28, 0.26, 0.86);
      const ambienceLevel = this.mapVolume(settings.audio.ambienceVolume);
      const gain = clamp(0.014 + zone.density * 0.016 + zone.count * 0.0011, 0.009, 0.068) * densitySuppression * (1 + focusBoost) * ambienceLevel;
      const contour = clamp(zone.activity * 0.55 + zone.tone * 0.45, 0, 1);
      const octaveOffset = zone.kind === 'rooted' ? -1 : zone.kind === 'water' ? -1 : zone.kind === 'cluster' ? -1 : 0;
      const filterFrequency = inFocus
        ? 980 + zone.detail * 1380 + focus.intensity * 760
        : focus.active
          ? 220 + zone.detail * 280
          : 420 + zone.detail * 760;

      voice.oscillator.type = ZONE_WAVEFORM[zone.kind];
      voice.oscillator.frequency.setTargetAtTime(getHarmonyFrequency(harmony, zone.kind === 'water' ? 'water' : zone.kind === 'rooted' ? 'plant' : zone.kind === 'mobile' ? 'mobile' : 'cluster', contour, octaveOffset), now, 0.8);
      voice.filter.type = zone.kind === 'water' || zone.kind === 'rooted' ? 'lowpass' : 'bandpass';
      voice.filter.frequency.setTargetAtTime(filterFrequency * (zone.kind === 'cluster' ? 0.48 : zone.kind === 'mobile' ? 1.18 : 1), now, 0.6);
      voice.filter.Q.setTargetAtTime(zone.kind === 'cluster' ? 0.82 : zone.kind === 'water' ? 0.42 : 1 + zone.detail * 1.1, now, 0.36);
      voice.panner.pan.setTargetAtTime(this.panFromPosition(zone.position.x, snapshot), now, 0.28);
      voice.gain.gain.setTargetAtTime(gain, now, 0.32);
    });
  }

  private updateForegroundVoices(
    snapshot: SimulationSnapshot,
    harmony: HarmonyState,
    focus: AudioFocusContext,
    foreground: ScoredEntity[],
    zoomNorm: number,
    now: number,
    settings: GameSettings,
  ): void {
    this.foregroundVoices.forEach((voice, index) => {
      const candidate = foreground[index];
      if (!candidate) {
        voice.gain.gain.setTargetAtTime(0.0001, now, 0.18);
        return;
      }

      const detailLift = clamp(candidate.detail, 0, 1.4);
      const focusLift = focus.mode === 'entity'
        ? candidate.isPrimary
          ? 1.02 + focus.intensity * 0.54
          : candidate.isRelated
            ? 0.26 + focus.intensity * 0.18
            : candidate.insideAttention
              ? 0.1
              : -0.06
        : candidate.insideAttention
          ? 0.36 + focus.intensity * 0.34
          : focus.active ? -0.16 - focus.intensity * 0.18 : 0;
      const entityLevel = this.mapVolume(settings.audio.entityVolume);
      const gain = clamp(0.016 + candidate.score * 0.026 + detailLift * 0.011, 0.014, 0.11) * (0.78 + zoomNorm * 0.34 + focusLift) * entityLevel;
      const contour = clamp(candidate.entity.activity * 0.45 + candidate.entity.tone * 0.35 + candidate.entity.harmony * 0.2, 0, 1);
      const filterFrequency = candidate.isPrimary
        ? 1560 + detailLift * 1520 + focus.intensity * 620
        : candidate.insideAttention
          ? 1120 + detailLift * 1180 + focus.intensity * 520
          : focus.active
            ? 340 + detailLift * 360
            : 760 + detailLift * 920;
      const layer = candidate.entity.type === 'plant' ? 'plant' : candidate.entity.type === 'cluster' ? 'cluster' : 'mobile';

      voice.oscillator.type = ENTITY_WAVEFORM[candidate.entity.type];
      voice.oscillator.frequency.setTargetAtTime(getHarmonyFrequency(harmony, layer, contour, ENTITY_OCTAVE[candidate.entity.type]), now, 0.24);
      voice.filter.type = candidate.entity.type === 'plant' ? 'lowpass' : 'bandpass';
      voice.filter.frequency.setTargetAtTime(filterFrequency * (candidate.entity.type === 'cluster' ? 0.42 : candidate.entity.type === 'flocker' ? 1.36 : candidate.entity.type === 'grazer' ? 0.94 : 0.7), now, 0.18);
      voice.filter.Q.setTargetAtTime(candidate.entity.type === 'cluster' ? 0.72 : candidate.entity.type === 'predator' ? 2.4 : candidate.entity.type === 'grazer' ? 1.2 + detailLift * 0.8 : 1.6 + detailLift * 1.15, now, 0.16);
      voice.panner.pan.setTargetAtTime(this.panFromPosition(candidate.entity.position.x, snapshot), now, 0.12);
      voice.gain.gain.setTargetAtTime(gain, now, 0.12);
    });
  }

  private processEvents(events: WorldEvent[]): void {
    for (const event of events) {
      if (event.id <= this.lastEventId) continue;
      this.lastEventId = event.id;

      if ('entityId' in event) {
        const bump = event.type === 'entityDied' ? 1 : event.type === 'entityFed' ? 0.72 : 0.55;
        this.entityPriority.set(event.entityId, bump);
      } else if (event.type === 'fruitCreated') {
        this.entityPriority.set(event.sourceEntityId, 0.62);
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
      attention: { mode: 'none', entityId: null, position: event.position, radius: 0, strength: 0, relatedEntityIds: [], dragging: false, dragStart: null, dragCurrent: null },
      camera: { center: event.position, zoom: 1 },
      time: 0,
      timeScale: 1,
      unlockedProgress: 0,
      energy: 0,
      events: [],
      notifications: { recent: [] },
      diagnostics: createDefaultDiagnostics(),
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
        fruit: event.type === 'entityFed' || event.type === 'fruitCreated' ? 0.46 : 0.18,
      },
      tool: { active: 'observe', unlocked: ['observe'], pulse: 0, worldPosition: event.position, radius: 0, strength: 0, visible: false, blocked: false },
      attention: { mode: 'none', entityId: null, position: event.position, radius: 0, strength: 0, relatedEntityIds: [], dragging: false, dragStart: null, dragCurrent: null },
      camera: { center: event.position, zoom: 1 },
      time: 0,
      timeScale: 1,
      unlockedProgress: 0,
      energy: 0,
      events: [],
      notifications: { recent: [] },
      diagnostics: createDefaultDiagnostics(),
    });

    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const pan = this.context.createStereoPanner();

    const settings = {
      entityBorn: { layer: 'event' as const, contour: 0.55, octave: 1, dur: 0.24, type: 'triangle' as OscillatorType, amount: 0.026 },
      entityFed: { layer: 'event' as const, contour: 0.82, octave: 1, dur: 0.16, type: 'sine' as OscillatorType, amount: 0.024 },
      entityDied: { layer: 'plant' as const, contour: 0.2, octave: -1, dur: 0.42, type: 'sine' as OscillatorType, amount: 0.018 },
      residueCreated: { layer: 'cluster' as const, contour: 0.22, octave: -2, dur: 0.28, type: 'triangle' as OscillatorType, amount: 0.016 },
      fruitCreated: { layer: 'event' as const, contour: 0.9, octave: 1, dur: 0.26, type: 'triangle' as OscillatorType, amount: 0.018 },
    }[event.type];

    osc.type = settings.type;
    osc.frequency.value = getHarmonyFrequency(harmony, settings.layer, settings.contour, settings.octave);
    filter.type = event.type === 'entityDied' ? 'lowpass' : event.type === 'fruitCreated' ? 'highpass' : 'bandpass';
    filter.frequency.value = event.type === 'entityDied' ? 320 : event.type === 'fruitCreated' ? osc.frequency.value * 2.1 : osc.frequency.value * 1.7;
    filter.Q.value = event.type === 'entityFed' ? 2.4 : event.type === 'fruitCreated' ? 1.6 : 1.2;
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
    gain.gain.exponentialRampToValueAtTime(0.024 + intensity * 0.03, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + settings.dur);

    osc.connect(filter);
    filter.connect(pan);
    pan.connect(gain);
    gain.connect(this.eventBus);
    osc.start(now);
    osc.stop(now + settings.dur + 0.08);
  }

  getDebugState(): AudioDebugState {
    return { ...this.debugState };
  }

  private updateDebugState(
    snapshot: SimulationSnapshot,
    foreground: ScoredEntity[],
    zones: ZoneSummary[],
    focus: AudioFocusContext,
    masterGain: number,
  ): void {
    const focusedVoiceCount = foreground.filter((entry) => entry.insideAttention || entry.isPrimary || entry.isRelated).length
      + zones.filter((zone) => focus.active && this.distance(zone.position, focus.center, snapshot) <= focus.radius).length;
    this.debugState.masterGain = masterGain;
    this.debugState.foregroundVoiceCount = foreground.length;
    this.debugState.focusedVoiceCount = focusedVoiceCount;
    this.debugState.groupedVoiceCount = zones.length;
  }

  private mapVolume(value: number): number {
    return 0.18 + value * value * 0.82;
  }

  private distance(a: Vec2, b: Vec2, snapshot: SimulationSnapshot): number {
    const dxRaw = a.x - b.x;
    const dyRaw = a.y - b.y;
    const dx = Math.abs(dxRaw) > snapshot.dimensions.width * 0.5 ? snapshot.dimensions.width - Math.abs(dxRaw) : Math.abs(dxRaw);
    const dy = Math.abs(dyRaw) > snapshot.dimensions.height * 0.5 ? snapshot.dimensions.height - Math.abs(dyRaw) : Math.abs(dyRaw);
    return Math.hypot(dx, dy);
  }

  private panFromPosition(x: number, snapshot: SimulationSnapshot): number {
    const radius = 420 / snapshot.camera.zoom;
    let delta = x - snapshot.camera.center.x;
    if (delta > snapshot.dimensions.width * 0.5) delta -= snapshot.dimensions.width;
    else if (delta < -snapshot.dimensions.width * 0.5) delta += snapshot.dimensions.width;
    return clamp(delta / radius, -0.9, 0.9);
  }
}
