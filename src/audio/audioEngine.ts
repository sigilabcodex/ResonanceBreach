import type { WorldEvent } from '../sim/events';
import { createDefaultDiagnostics } from '../sim/world';
import type { GameSettings } from '../settings';
import type { SimulationSnapshot, ToolState, Vec2 } from '../types/world';
import { createEcologicalMusicState, type EcologicalMusicState, type EcologicalVoiceRole } from './ecologicalMusic';
import { createAudioFocusContext, scoreEntities, selectForegroundVoices, type AudioFocusContext, type ScoredEntity } from './salience';
import {
  createHarmonyState,
  getHarmonyFrequency,
  quantizeToRoleZone,
  type HarmonicPitchRole,
  type HarmonyState,
} from './harmony';
import { createAudioBusLayout, type AudioBusLayout } from './audioBuses';
import { createMusicalInterpreter, type MusicalInterpretationMode } from './musicalInterpreter';
import {
  alignToSoftPulse,
  createEnvelopeByDensity,
  scheduleAdsrGain,
  shouldTriggerNote,
  type NoteEvent,
  type NoteInstrumentFamilyHint,
  type NoteSourceKind,
  type NoteTimingGate,
} from './noteEvents';
import {
  createInstrumentRegistry,
  DEFAULT_INSTRUMENT_DESCRIPTORS,
  type InstrumentDescriptor,
  type InstrumentRegistry,
} from './instruments';
import { createEnvironmentalPulseEvent, mapWorldEventToEcologicalAudioEvents, type EcologicalAudioEvent } from './musicalEvents';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};

type PooledVoice = {
  gain: GainNode;
  filter: BiquadFilterNode;
  panner: StereoPannerNode;
  oscillator: OscillatorNode;
};

type PhraseAgent = {
  id: number;
  entityId: number | null;
  motif: number[];
  rhythm: number[];
  variation: number;
  noteIndex: number;
  notesRemaining: number;
  phase: 'idle' | 'playing' | 'listening';
  nextActionTime: number;
};

type SelectionVoiceMemory = {
  lastContour: number;
  lastDuration: number;
  lastBrightness: number;
  lastAt: number;
};

export interface AudioDebugState {
  masterGain: number;
  foregroundVoiceCount: number;
  focusedVoiceCount: number;
  groupedVoiceCount: number;
  mode: string;
  tonalCenterHz: number;
  roleLevels: Record<EcologicalVoiceRole, number>;
  foregroundBalance: number;
}

const FOREGROUND_VOICE_COUNT = 3;
const ECOLOGICAL_VOICE_COUNT = 4;
const LEAD_VOICE_COUNT = 3;
const PHRASE_AGENT_COUNT = 3;
const MAX_ACTIVE_VOICES = 8;
const ECOLOGICAL_ROLE_ORDER: EcologicalVoiceRole[] = ['bloom', 'grazer', 'pollinator', 'decay'];

const ENTITY_OCTAVE: Record<ScoredEntity['entity']['type'], number> = {
  plant: -1,
  ephemeral: 0,
  canopy: -1,
  cluster: -1,
  flocker: 1,
  grazer: 0,
  parasite: 0,
  predator: 0,
};

const ENTITY_WAVEFORM: Record<ScoredEntity['entity']['type'], OscillatorType> = {
  plant: 'triangle',
  ephemeral: 'triangle',
  canopy: 'triangle',
  cluster: 'sine',
  flocker: 'sine',
  grazer: 'triangle',
  parasite: 'square',
  predator: 'sawtooth',
};

const ECOLOGICAL_WAVEFORM: Record<EcologicalVoiceRole, OscillatorType> = {
  bloom: 'triangle',
  grazer: 'triangle',
  pollinator: 'sine',
  decay: 'triangle',
};

type OrchestrationRole = 'bloom' | 'pollinator' | 'grazer' | 'predator' | 'decomposer' | 'atmosphere' | 'mixed';

type EventInstrumentGesture = {
  instrument: InstrumentDescriptor;
  role: OrchestrationRole;
  voiceRole: EcologicalVoiceRole;
  layer: 'plant' | 'mobile' | 'cluster' | 'event';
  waveform: OscillatorType;
  filterType: BiquadFilterType;
  contour: number;
  octave: number;
  duration: number;
  amount: number;
  filterScale: number;
  q: number;
  destination: GainNode;
};

type InstrumentVoiceProfile = {
  waveform: OscillatorType;
  filterType: BiquadFilterType;
  filterScale: number;
  q: number;
  detuneCents: number;
  durationScale: number;
  amountScale: number;
  envelopeShape: 'soft' | 'percussive' | 'rounded';
};

export interface InterpretationStatus {
  mode: MusicalInterpretationMode;
  musicification: number;
  musicBus: number;
  rawBus: number;
  atmosphereBus: number;
}

const modeToMusicification = (mode: MusicalInterpretationMode): number => {
  if (mode === 'raw') return 0;
  if (mode === 'hybrid') return 0.5;
  return 1;
};

export class AudioEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private masterControl?: GainNode;
  private limiter?: DynamicsCompressorNode;
  private bedGain?: GainNode;
  private bedLowFilter?: BiquadFilterNode;
  private bedMidFilter?: BiquadFilterNode;
  private bedLowOsc?: OscillatorNode;
  private bedPulseOsc?: OscillatorNode;
  private bedNoiseGain?: GainNode;
  private bedNoiseFilter?: BiquadFilterNode;
  private ecologicalVoices: PooledVoice[] = [];
  private foregroundVoices: PooledVoice[] = [];
  private leadVoices: PooledVoice[] = [];
  private eventBus?: GainNode;
  private phraseBus?: GainNode;
  private busLayout?: AudioBusLayout;
  private phraseAgents: PhraseAgent[] = [];
  private activeTransientVoices = 0;
  private lastSelectedEntityId: number | null = null;
  private lastFeedbackId = 0;
  private lastEventId = 0;
  private started = false;
  private lastSnapshotTime = 0;
  private entityPriority = new Map<number, number>();
  private selectionVoiceMemory = new Map<number, SelectionVoiceMemory>();
  private phraseMotifMemory = new Map<number, number[]>();
  private phraseRecentTime = -100;
  private phraseRecentType: ScoredEntity['entity']['type'] | null = null;
  private musicState?: EcologicalMusicState;
  private lastHarmony?: HarmonyState;
  private interpretationMode: MusicalInterpretationMode = 'raw';
  private interpretationBlend = modeToMusicification(this.interpretationMode);
  private interpretationTarget = this.interpretationBlend;
  private interpretationBias = this.interpretationBlend;
  private interpreter = createMusicalInterpreter(this.interpretationMode);
  private statusBusLevels = {
    music: 0.8,
    raw: 0.8,
    atmosphere: 0.7,
  };
  private liveSettings: GameSettings | null = null;
  private readonly instrumentRegistry: InstrumentRegistry = createInstrumentRegistry(DEFAULT_INSTRUMENT_DESCRIPTORS);
  private environmentalPulseId = 1_000_000;
  private lastEnvironmentalPulseTime = -100;
  private noteGateState = new Map<string, number>();
  private recentNoteOnsets: number[] = [];
  private lastAnyOnsetTime = -100;
  private phraseCooldownUntil = -100;
  private eventCooldownUntil = -100;
  private noteTiming: NoteTimingGate = { pulseSeconds: 0.28, looseness: 0.45, jitter: 0.01 };
  private readonly debugState: AudioDebugState = {
    masterGain: 0,
    foregroundVoiceCount: 0,
    focusedVoiceCount: 0,
    groupedVoiceCount: 0,
    mode: 'calm',
    tonalCenterHz: 0,
    roleLevels: {
      bloom: 0,
      grazer: 0,
      pollinator: 0,
      decay: 0,
    },
    foregroundBalance: 0,
  };

  async ensureStarted(): Promise<void> {
    if (this.started) {
      if (this.context?.state === 'suspended') await this.context.resume();
      return;
    }

    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = 0.0001;
    const masterControl = context.createGain();
    masterControl.gain.value = 1;

    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -16;
    limiter.knee.value = 18;
    limiter.ratio.value = 10;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.22;
    master.connect(masterControl);
    masterControl.connect(limiter);
    limiter.connect(context.destination);

    const busLayout = createAudioBusLayout(context, master);

    const bedGain = context.createGain();
    bedGain.gain.value = 0.0001;
    bedGain.connect(busLayout.atmosphere);

    const bedLowFilter = context.createBiquadFilter();
    bedLowFilter.type = 'lowpass';
    bedLowFilter.frequency.value = 220;
    bedLowFilter.Q.value = 0.4;
    bedLowFilter.connect(bedGain);

    const bedMidFilter = context.createBiquadFilter();
    bedMidFilter.type = 'lowpass';
    bedMidFilter.frequency.value = 260;
    bedMidFilter.Q.value = 0.7;
    bedMidFilter.connect(bedGain);

    const bedLowOsc = context.createOscillator();
    bedLowOsc.type = 'sine';
    bedLowOsc.frequency.value = 82;
    bedLowOsc.connect(bedLowFilter);
    bedLowOsc.start();

    const bedPulseOsc = context.createOscillator();
    bedPulseOsc.type = 'triangle';
    bedPulseOsc.frequency.value = 0.12;
    bedPulseOsc.connect(bedMidFilter);
    bedPulseOsc.start();

    const bedNoiseGain = context.createGain();
    bedNoiseGain.gain.value = 0.0001;
    bedNoiseGain.connect(bedGain);

    const bedNoiseFilter = context.createBiquadFilter();
    bedNoiseFilter.type = 'bandpass';
    bedNoiseFilter.frequency.value = 210;
    bedNoiseFilter.Q.value = 0.52;
    bedNoiseFilter.connect(bedNoiseGain);

    const bedNoiseSource = this.createLoopingNoise(context);
    bedNoiseSource.connect(bedNoiseFilter);
    bedNoiseSource.start();

    const ecologicalVoices = Array.from(
      { length: ECOLOGICAL_VOICE_COUNT },
      (_, index) => this.createVoice(context, ECOLOGICAL_WAVEFORM[ECOLOGICAL_ROLE_ORDER[index]], busLayout.rawEcology),
    );
    const foregroundVoices = Array.from(
      { length: FOREGROUND_VOICE_COUNT },
      (_, index) => this.createVoice(context, index === 2 ? 'sawtooth' : 'triangle', busLayout.music),
    );
    const leadVoices = Array.from(
      { length: LEAD_VOICE_COUNT },
      (_, index) => this.createVoice(context, index === 1 ? 'triangle' : 'sine', busLayout.music),
    );

    const eventBus = context.createGain();
    eventBus.gain.value = 0.22;
    eventBus.connect(busLayout.selectionUi);
    const phraseBus = context.createGain();
    phraseBus.gain.value = 0.42;
    phraseBus.connect(busLayout.music);

    this.context = context;
    this.master = master;
    this.masterControl = masterControl;
    this.limiter = limiter;
    this.bedGain = bedGain;
    this.bedLowFilter = bedLowFilter;
    this.bedMidFilter = bedMidFilter;
    this.bedLowOsc = bedLowOsc;
    this.bedPulseOsc = bedPulseOsc;
    this.bedNoiseGain = bedNoiseGain;
    this.bedNoiseFilter = bedNoiseFilter;
    this.ecologicalVoices = ecologicalVoices;
    this.foregroundVoices = foregroundVoices;
    this.leadVoices = leadVoices;
    this.eventBus = eventBus;
    this.phraseBus = phraseBus;
    this.busLayout = busLayout;
    this.phraseAgents = Array.from({ length: PHRASE_AGENT_COUNT }, (_, id) => ({
      id,
      entityId: null,
      motif: [0, 2, -1],
      rhythm: [0.18, 0.24, 0.16],
      variation: 0.1 + id * 0.05,
      noteIndex: 0,
      notesRemaining: 0,
      phase: 'idle',
      nextActionTime: context.currentTime + id * 0.4,
    }));
    this.started = true;
    if (this.liveSettings) this.applyLiveControls(this.liveSettings, true);
  }

  update(snapshot: SimulationSnapshot, settings: GameSettings): void {
    if (
      !this.context
      || !this.master
      || !this.bedGain
      || !this.bedLowFilter
      || !this.bedMidFilter
      || !this.bedLowOsc
      || !this.bedPulseOsc
      || !this.bedNoiseGain
      || !this.bedNoiseFilter
      || !this.eventBus
      || !this.phraseBus
      || !this.limiter
      || !this.busLayout
      || !this.masterControl
    ) {
      return;
    }

    const now = this.context.currentTime;
    const dt = this.lastSnapshotTime > 0 ? Math.max(0.016, snapshot.time - this.lastSnapshotTime) : 0.016;
    this.lastSnapshotTime = snapshot.time;
    const transitionT = 1 - Math.exp(-dt * 3.8);
    this.interpretationBlend = lerp(this.interpretationBlend, this.interpretationTarget, transitionT);
    this.decayEntityPriority(dt);
    this.processEvents(snapshot.events);
    this.processEnvironmentalPulse(snapshot, now);

    this.musicState = createEcologicalMusicState(snapshot, this.musicState);
    const music = this.musicState;
    this.noteTiming = {
      pulseSeconds: clamp(0.22 + (1 - music.composition.rhythmDensity) * 0.24, 0.18, 0.46),
      looseness: clamp(0.58 - this.interpretationBlend * 0.24 + music.composition.pulseJitter * 0.2, 0.2, 0.7),
      jitter: clamp(0.004 + music.composition.pulseJitter * 0.016, 0.002, 0.024),
    };
    const harmony = createHarmonyState(snapshot, music);
    this.lastHarmony = harmony;
    const focus = createAudioFocusContext(snapshot);
    const scored = scoreEntities(snapshot, focus, this.entityPriority);
    const foreground = selectForegroundVoices(scored, FOREGROUND_VOICE_COUNT);
    const zoomNorm = clamp((snapshot.camera.zoom - 0.24) / (2.4 - 0.24), 0, 1);
    this.activeTransientVoices = foreground.length + ECOLOGICAL_VOICE_COUNT + 2;
    this.triggerSelectionResponse(snapshot, harmony, now);

    this.updateGlobalBed(snapshot, harmony, music, focus, zoomNorm, now, settings);
    this.updateEcologicalVoices(snapshot, harmony, music, focus, zoomNorm, now, settings);
    this.updateForegroundVoices(snapshot, harmony, focus, foreground, zoomNorm, now, settings);
    this.updateLeadVoices(snapshot, harmony, music, focus, zoomNorm, now, settings);
    this.updatePhraseAgents(snapshot, harmony, foreground, zoomNorm, now, settings);

    const entityPresence = 0.2 + settings.audio.entityVolume * 0.28 + music.interpretation.rhythmicActivity * 0.1 + music.composition.foregroundLift * 0.04;
    this.eventBus.gain.setTargetAtTime(entityPresence, now, 0.12);
    const rawPresence = 1 - this.interpretationBlend;
    const musicalPresence = this.interpretationBlend;
    const hybridPresence = 1 - Math.abs(this.interpretationBlend - 0.5) * 2;
    const musicTarget = clamp(0.7 + musicalPresence * 0.74 + hybridPresence * 0.12 + music.composition.foregroundLift * 0.34, 0.0001, 2);
    const rawTarget = clamp(0.36 + rawPresence * 0.78 + music.interpretation.intensity * 0.18 - musicalPresence * 0.18, 0.0001, 1.4);
    const atmosphereTarget = clamp(0.48 + hybridPresence * 0.16 + (1 - music.interpretation.tension) * 0.1 - musicalPresence * 0.08, 0.0001, 1.2);
    this.statusBusLevels = { music: musicTarget, raw: rawTarget, atmosphere: atmosphereTarget };
    this.busLayout.music.gain.setTargetAtTime(musicTarget, now, 0.22);
    this.busLayout.atmosphere.gain.setTargetAtTime(atmosphereTarget, now, 0.24);
    this.busLayout.rawEcology.gain.setTargetAtTime(rawTarget, now, 0.2);
    this.busLayout.selectionUi.gain.setTargetAtTime(0.86 + focus.intensity * 0.18, now, 0.14);
    const focusMasterDip = focus.active ? 1 - focus.intensity * 0.01 : 1;
    const masterTarget = (0.48 + snapshot.stats.energy * 0.2 + music.interpretation.intensity * 0.1) * focusMasterDip;
    this.master.gain.setTargetAtTime(masterTarget, now, 0.12);
    this.applyLiveControls(settings);
    this.updateDebugState(snapshot, foreground, harmony, music, focus, masterTarget * this.mapVolume(settings.audio.masterVolume));

    if (snapshot.tool.feedback && snapshot.tool.feedback.id !== this.lastFeedbackId) {
      this.lastFeedbackId = snapshot.tool.feedback.id;
      if (snapshot.tool.feedback.tool === 'observe') {
        this.triggerToolTone(snapshot.tool, harmony, snapshot.tool.feedback.intensity);
      }
    }
  }

  reset(): void {
    this.lastFeedbackId = 0;
    this.lastEventId = 0;
    this.lastSnapshotTime = 0;
    this.entityPriority.clear();
    this.selectionVoiceMemory.clear();
    this.phraseMotifMemory.clear();
    this.noteGateState.clear();
    this.recentNoteOnsets = [];
    this.lastAnyOnsetTime = -100;
    this.phraseCooldownUntil = -100;
    this.eventCooldownUntil = -100;
    this.phraseRecentTime = -100;
    this.phraseRecentType = null;
    this.musicState = undefined;
    this.lastHarmony = undefined;
    this.lastSelectedEntityId = null;
  }

  setInterpretationMode(mode: MusicalInterpretationMode): void {
    this.interpretationMode = mode;
    const targetByMode = modeToMusicification(mode);
    this.interpretationTarget = clamp(targetByMode * 0.8 + this.interpretationBias * 0.2, 0, 1);
    this.interpreter = createMusicalInterpreter(mode);
  }

  setMusicification(amount: number): void {
    this.interpretationBias = clamp(amount, 0, 1);
    const targetByMode = modeToMusicification(this.interpretationMode);
    this.interpretationTarget = clamp(targetByMode * 0.8 + this.interpretationBias * 0.2, 0, 1);
  }

  applyLiveSettings(settings: GameSettings): void {
    this.liveSettings = settings;
    if (!this.context) return;
    this.applyLiveControls(settings, true);
  }

  getInterpretationStatus(): InterpretationStatus {
    return {
      mode: this.interpretationMode,
      musicification: this.interpretationBlend,
      musicBus: this.statusBusLevels.music,
      rawBus: this.statusBusLevels.raw,
      atmosphereBus: this.statusBusLevels.atmosphere,
    };
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

  private summarizeHabitatsAround(position: Vec2, snapshot: SimulationSnapshot, radius: number) {
    let wetland = 0;
    let highland = 0;
    let basin = 0;
    let total = 0;
    for (const cell of snapshot.terrain) {
      const distance = this.distance(cell.center, position, snapshot);
      const weight = 1.2 - clamp(distance / Math.max(radius, 1), 0, 1);
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
    music: EcologicalMusicState,
    focus: AudioFocusContext,
    zoomNorm: number,
    now: number,
    settings: GameSettings,
  ): void {
    if (!this.bedGain || !this.bedLowFilter || !this.bedMidFilter || !this.bedLowOsc || !this.bedPulseOsc || !this.bedNoiseGain || !this.bedNoiseFilter) return;

    const habitat = this.summarizeHabitats(snapshot);
    const drift = Math.sin(snapshot.time * (0.018 + music.composition.evolutionSpeed * 0.02)) * music.composition.harmonicDrift;
    const lowFreq = getHarmonyFrequency(
      harmony,
      'bed',
      clamp(music.interpretation.stability * 0.64 + habitat.basin * 0.22 + drift * 0.14 + 0.12, 0, 1),
      -1,
      this.getPitchTightness('atmosphere'),
    );
    const pulsePhase = snapshot.time * (0.04 + music.composition.evolutionSpeed * 0.05);
    const breathe = 0.5 + Math.sin(pulsePhase * Math.PI * 2) * 0.5;
    const inhaleWindow = smoothstep(0.2, 0.86, breathe);
    const silenceGate = clamp(inhaleWindow * 1.34 - 0.34, 0, 1);
    const ambienceLevel = this.mapVolume(settings.audio.ambienceVolume);
    const modeLift = music.composition.mode === 'fertile'
      ? 0.014
      : music.composition.mode === 'degraded'
        ? -0.006
        : music.composition.mode === 'active'
          ? 0.008
          : 0;
    const bedLevel = (
      0.044
      + music.interpretation.stability * 0.022
      + music.interpretation.abundance * 0.013
      + habitat.basin * 0.01
      + habitat.wetland * 0.008
      + (1 - zoomNorm) * 0.014
      + modeLift
    ) * ambienceLevel * silenceGate;
    const focusDuck = focus.mode === 'entity' ? 1 - focus.intensity * 0.09 : focus.active ? 1 - focus.intensity * 0.11 : 1;

    this.bedLowOsc.frequency.setTargetAtTime(lowFreq * (1 - habitat.highland * 0.08), now, 1.8);
    this.bedPulseOsc.frequency.setTargetAtTime(0.08 + music.composition.rhythmDensity * 0.14 + habitat.basin * 0.04, now, 1.4);
    this.bedLowFilter.frequency.setTargetAtTime(
      220
        + music.interpretation.stability * 150
        + habitat.basin * 90
        + habitat.wetland * 70
        - habitat.highland * 40
        + (1 - music.interpretation.tension) * 50,
      now,
      1.1,
    );
    this.bedMidFilter.frequency.setTargetAtTime(
      120
        + music.interpretation.harmonicRichness * 100
        + habitat.basin * 80
        + (1 - zoomNorm) * 120,
      now,
      1.1,
    );
    this.bedNoiseFilter.frequency.setTargetAtTime(
      180 + habitat.wetland * 220 + (1 - zoomNorm) * 160 + music.interpretation.tension * 120,
      now,
      0.8,
    );
    this.bedNoiseFilter.Q.setTargetAtTime(0.34 + habitat.highland * 0.4 + music.interpretation.rhythmicActivity * 0.52, now, 0.7);
    this.bedNoiseGain.gain.setTargetAtTime((0.009 + music.interpretation.abundance * 0.012 + habitat.wetland * 0.014) * ambienceLevel * silenceGate, now, 0.5);
    this.bedGain.gain.setTargetAtTime(bedLevel * focusDuck, now, 0.45);
  }

  private updateEcologicalVoices(
    snapshot: SimulationSnapshot,
    harmony: HarmonyState,
    music: EcologicalMusicState,
    focus: AudioFocusContext,
    zoomNorm: number,
    now: number,
    settings: GameSettings,
  ): void {
    this.ecologicalVoices.forEach((voice, index) => {
      const role = ECOLOGICAL_ROLE_ORDER[index];
      const layer = music.composition.voices[role];
      const pan = this.panFromPosition(layer.center.x, snapshot);
      const perception = this.computePerceptualAttenuation(layer.center, snapshot, zoomNorm);
      const roleShape = role === 'bloom'
        ? 0.64
        : role === 'grazer'
          ? 0.98
          : role === 'pollinator'
            ? 1.52
            : 0.76;
      const pulseRate = role === 'bloom'
        ? 0.018 + music.composition.evolutionSpeed * 0.06 + layer.motion * 0.05
        : role === 'grazer'
          ? 0.09 + music.composition.rhythmDensity * 0.32 + layer.motion * 0.18
          : role === 'pollinator'
            ? 0.16 + music.composition.rhythmDensity * 0.38 + layer.motion * 0.22
            : 0.04 + music.composition.evolutionSpeed * 0.08 + layer.motion * 0.06;
      const shimmerRate = role === 'bloom'
        ? 0.02 + music.composition.evolutionSpeed * 0.08
        : role === 'pollinator'
          ? 0.1 + music.composition.evolutionSpeed * 0.22 + layer.brightness * 0.08
          : 0.04 + music.composition.evolutionSpeed * 0.14 + layer.brightness * 0.05;
      const slowSwell = 0.5 + Math.sin(snapshot.time * (0.012 + music.composition.evolutionSpeed * 0.05) * Math.PI * 2 + index * 0.8) * 0.5;
      const pulse = role === 'bloom'
        ? 0.76 + slowSwell * 0.16 + Math.sin(snapshot.time * pulseRate * Math.PI * 2 + index * 1.3) * 0.05
        : role === 'grazer'
          ? 0.5 + Math.max(0, Math.sin(snapshot.time * pulseRate * Math.PI * 2 + index * 1.6)) * 0.34 + Math.sin(snapshot.time * pulseRate * Math.PI * 1.5 + index) * 0.08
          : role === 'pollinator'
            ? 0.38 + Math.max(0, Math.sin(snapshot.time * pulseRate * Math.PI * 2 + index * 2.2)) * 0.26 + Math.sin(snapshot.time * pulseRate * Math.PI * (2.8 + music.composition.pulseJitter) + index * 0.5) * 0.14
            : 0.34 + slowSwell * 0.14 + Math.sin(snapshot.time * pulseRate * Math.PI * (1.4 + music.composition.pulseJitter * 0.6) + index * 1.9) * 0.1;
      const shimmer = role === 'decay'
        ? 0.42 + Math.sin(snapshot.time * shimmerRate * Math.PI * 2 + index * 2.4) * 0.1
        : 0.5 + Math.sin(snapshot.time * shimmerRate * Math.PI * 2 + index * 2.1) * 0.24;
      const focusBoost = focus.active
        ? 0.82 + layer.focus * 0.5 + music.composition.foregroundLift * 0.18
        : 0.98;
      const modeRoleLift = music.composition.mode === 'fertile'
        ? role === 'bloom'
          ? 0.018
          : role === 'pollinator'
            ? 0.012
            : role === 'decay'
              ? -0.004
              : 0.006
        : music.composition.mode === 'active'
          ? role === 'grazer'
            ? 0.014
            : role === 'pollinator'
              ? 0.016
              : role === 'bloom'
                ? 0.004
                : 0.008
          : music.composition.mode === 'degraded'
            ? role === 'decay'
              ? 0.012
              : role === 'bloom'
                ? -0.006
                : 0
            : 0;
      const gain = clamp(
        (
          0.02
          + layer.presence * (role === 'bloom' ? 0.046 : role === 'grazer' ? 0.04 : role === 'pollinator' ? 0.032 : 0.024)
          + layer.density * (role === 'bloom' ? 0.016 : role === 'grazer' ? 0.014 : 0.01)
          + Math.max(0, pulse) * (role === 'bloom' ? 0.008 : role === 'grazer' ? 0.014 : role === 'pollinator' ? 0.012 : 0.01)
          + modeRoleLift
        ) * focusBoost * (0.84 + (1 - zoomNorm) * 0.16) * this.mapVolume(settings.audio.ambienceVolume) * perception.gain,
        0.0001,
        role === 'bloom' ? 0.16 : role === 'grazer' ? 0.14 : role === 'pollinator' ? 0.11 : 0.09,
      );
      const contour = clamp(layer.contour * 0.76 + shimmer * 0.16 + music.composition.harmonicDrift * 0.08, 0, 1);
      const harmonyLayer = role === 'bloom' ? 'plant' : role === 'grazer' || role === 'pollinator' ? 'mobile' : 'cluster';
      const filterBase = role === 'bloom'
        ? 280
        : role === 'grazer'
          ? 620
          : role === 'pollinator'
            ? 1800
            : 420;
      const filterFrequency = filterBase
        + layer.brightness * (role === 'pollinator' ? 1520 : role === 'bloom' ? 540 : 980)
        + layer.focus * (role === 'bloom' ? 320 : 720)
        + music.interpretation.harmonicRichness * (role === 'bloom' ? 120 : 180);

      voice.oscillator.type = ECOLOGICAL_WAVEFORM[role];
      const roleTightness = role === 'pollinator'
        ? this.getPitchTightness('music')
        : this.getPitchTightness('raw');
      voice.oscillator.frequency.setTargetAtTime(
        getHarmonyFrequency(harmony, harmonyLayer, contour, layer.register, roleTightness) * roleShape,
        now,
        role === 'bloom' ? 0.9 : role === 'decay' ? 0.42 : 0.26 + (1 - music.composition.evolutionSpeed) * 0.28,
      );
      voice.filter.type = role === 'bloom' ? 'lowpass' : role === 'grazer' ? 'bandpass' : role === 'pollinator' ? 'highpass' : 'bandpass';
      voice.filter.frequency.setTargetAtTime(filterFrequency * perception.highFreq, now, 0.28);
      voice.filter.Q.setTargetAtTime(
        role === 'bloom'
          ? 0.55 + layer.brightness * 0.42
          : role === 'decay'
            ? 2.2 + layer.motion * 1.8
            : role === 'grazer'
              ? 1.1 + layer.motion * 1.1
              : 1.4 + layer.brightness * 1.4,
        now,
        0.24,
      );
      voice.panner.pan.setTargetAtTime(pan, now, 0.24);
      voice.gain.gain.setTargetAtTime(gain, now, role === 'grazer' ? 0.1 : role === 'pollinator' ? 0.08 : 0.18);
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
      const perception = this.computePerceptualAttenuation(candidate.entity.position, snapshot, zoomNorm);
      const focusLift = focus.mode === 'entity'
        ? candidate.isPrimary
          ? 1.18 + focus.intensity * 0.68
          : candidate.isRelated
            ? 0.42 + focus.intensity * 0.24
            : candidate.insideAttention
              ? 0.18
              : -0.04
        : candidate.insideAttention
          ? 0.54 + focus.intensity * 0.42
          : focus.active ? -0.12 - focus.intensity * 0.14 : 0;
      const entityLevel = this.mapVolume(settings.audio.entityVolume);
      const gain = clamp(0.03 + candidate.score * 0.042 + detailLift * 0.018, 0.022, 0.22) * (0.82 + zoomNorm * 0.32 + focusLift) * entityLevel * perception.gain;
      const contour = clamp(candidate.entity.activity * 0.45 + candidate.entity.tone * 0.35 + candidate.entity.harmony * 0.2, 0, 1);
      const filterFrequency = candidate.isPrimary
        ? 1720 + detailLift * 1680 + focus.intensity * 720
        : candidate.insideAttention
          ? 1260 + detailLift * 1320 + focus.intensity * 560
          : focus.active
            ? 420 + detailLift * 420
            : 820 + detailLift * 980;
      const layer = candidate.entity.type === 'plant' || candidate.entity.type === 'ephemeral' || candidate.entity.type === 'canopy' ? 'plant' : candidate.entity.type === 'cluster' || candidate.entity.type === 'parasite' ? 'cluster' : 'mobile';

      voice.oscillator.type = ENTITY_WAVEFORM[candidate.entity.type];
      voice.oscillator.frequency.setTargetAtTime(
        getHarmonyFrequency(harmony, layer, contour, ENTITY_OCTAVE[candidate.entity.type], this.getPitchTightness('raw')),
        now,
        0.24,
      );
      voice.filter.type = candidate.entity.type === 'plant' ? 'lowpass' : 'bandpass';
      voice.filter.frequency.setTargetAtTime(filterFrequency * perception.highFreq * (candidate.entity.type === 'cluster' || candidate.entity.type === 'parasite' ? 0.42 : candidate.entity.type === 'flocker' ? 1.36 : candidate.entity.type === 'grazer' ? 0.94 : 0.7), now, 0.18);
      voice.filter.Q.setTargetAtTime(candidate.entity.type === 'cluster' || candidate.entity.type === 'parasite' ? 0.72 : candidate.entity.type === 'predator' ? 2.4 : candidate.entity.type === 'grazer' ? 1.1 + detailLift * 0.72 : 1.6 + detailLift * 1.15, now, 0.16);
      voice.panner.pan.setTargetAtTime(this.panFromPosition(candidate.entity.position.x, snapshot), now, 0.12);
      voice.gain.gain.setTargetAtTime(gain, now, 0.12);
    });
  }

  private updateLeadVoices(
    snapshot: SimulationSnapshot,
    harmony: HarmonyState,
    music: EcologicalMusicState,
    focus: AudioFocusContext,
    zoomNorm: number,
    now: number,
    settings: GameSettings,
  ): void {
    const phraseBias = clamp(this.interpretationBlend, 0, 1);
    const active = this.interpretationMode !== 'raw' || phraseBias > 0.36;
    const motif = [0.18, 0.4, 0.66, 0.82];
    const motifIndex = Math.floor(snapshot.time * (0.25 + music.composition.evolutionSpeed * 0.2)) % motif.length;
    this.leadVoices.forEach((voice, index) => {
      if (!active) {
        voice.gain.gain.setTargetAtTime(0.0001, now, 0.2);
        return;
      }
      const contour = motif[(motifIndex + index) % motif.length];
      const sway = 0.5 + Math.sin(snapshot.time * (0.08 + index * 0.02) * Math.PI * 2 + index) * 0.5;
      const register = index === 0 ? -1 : index === 1 ? 0 : 1;
      const layer = index === 0 ? 'cluster' : index === 1 ? 'plant' : 'mobile';
      const focusDuck = focus.active ? 1 - focus.intensity * 0.08 : 1;
      const gain = clamp(
        (0.026 + phraseBias * 0.06 + music.composition.foregroundLift * 0.05 + sway * 0.018) * (0.86 + (1 - zoomNorm) * 0.14) * focusDuck * this.mapVolume(settings.audio.musicBusLevel),
        0.0001,
        0.2,
      );
      const filterBase = index === 0 ? 380 : index === 1 ? 1100 : 2100;
      voice.oscillator.type = index === 2 && phraseBias > 0.74 ? 'triangle' : 'sine';
      voice.oscillator.frequency.setTargetAtTime(
        getHarmonyFrequency(harmony, layer, contour, register, this.getPitchTightness('music')),
        now,
        0.26,
      );
      voice.filter.type = index === 0 ? 'lowpass' : index === 1 ? 'bandpass' : 'highpass';
      voice.filter.frequency.setTargetAtTime(filterBase + music.interpretation.harmonicRichness * 1100 + sway * 360, now, 0.28);
      voice.filter.Q.setTargetAtTime(index === 0 ? 0.7 : index === 1 ? 1.4 : 1.1, now, 0.24);
      voice.panner.pan.setTargetAtTime(index === 0 ? -0.22 : index === 1 ? 0 : 0.22, now, 0.22);
      voice.gain.gain.setTargetAtTime(gain, now, 0.16);
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
      }

      const ecologicalEvents = mapWorldEventToEcologicalAudioEvents(event);
      for (const ecologicalEvent of ecologicalEvents) {
        this.processEcologicalAudioEvent(ecologicalEvent, event);
      }
    }
  }

  private processEnvironmentalPulse(snapshot: SimulationSnapshot, now: number): void {
    const pulseInterval = clamp(1.55 + this.noteTiming.pulseSeconds * 1.4, 1.5, 2.2);
    if (now - this.lastEnvironmentalPulseTime < pulseInterval) return;
    this.lastEnvironmentalPulseTime = now;
    const pulseEvent = createEnvironmentalPulseEvent(snapshot, this.environmentalPulseId++);
    this.processEcologicalAudioEvent(pulseEvent);
  }

  private processEcologicalAudioEvent(
    ecologicalEvent: EcologicalAudioEvent,
    sourceWorldEvent?: WorldEvent,
  ): void {
    const gesture = this.interpreter.interpret(ecologicalEvent);
    if (sourceWorldEvent) {
      if (sourceWorldEvent.type !== 'toolUsed') this.triggerEventTone(sourceWorldEvent, ecologicalEvent, gesture.intensity);
      return;
    }
    if (!this.context || !this.eventBus || !this.busLayout) return;
    if (gesture.outputEventType !== 'environmentalPulse') return;
    if (this.activeTransientVoices >= MAX_ACTIVE_VOICES) return;
    if (!this.canAdmitOnset(this.context.currentTime, { minGap: 0.09, maxInWindow: 4, windowSeconds: 0.7 })) return;

    const role = this.inferRoleFromEcologicalEvent(ecologicalEvent);
    const descriptor = this.chooseInstrumentForRole(role, ecologicalEvent.id);
    const profile = this.getInstrumentVoiceProfile(descriptor, 'environmentPulse');
    const destination = descriptor.foregroundFamily === 'soft-pad' ? this.busLayout.atmosphere : this.busLayout.music;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    osc.type = this.interpretationMode === 'raw' ? 'sine' : profile.waveform;
    const pulseBase = this.lastHarmony
      ? getHarmonyFrequency(
        this.lastHarmony,
        'event',
        clamp(0.18 + gesture.intensity * 0.58, 0, 1),
        -1,
        this.getPitchTightness('music'),
      )
      : 72 + gesture.intensity * 28;
    osc.frequency.value = pulseBase;
    filter.type = profile.filterType;
    filter.frequency.value = clamp((130 + gesture.intensity * 140 + (this.interpretationMode === 'raw' ? 0 : 35)) * profile.filterScale, 90, 4800);
    filter.Q.value = profile.q;
    gain.gain.setValueAtTime(0.0001, now);
    const attack = this.interpretationMode === 'musical' ? 0.06 : 0.08;
    const release = (this.interpretationMode === 'raw' ? 0.34 : 0.44) * profile.durationScale;
    const amount = (0.004 + gesture.intensity * 0.008) * (descriptor.maxDensity * 0.7 + 0.58) * profile.amountScale;
    gain.gain.exponentialRampToValueAtTime(amount, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + release);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    osc.start(now);
    osc.stop(now + release + 0.08);
    this.registerOnset(now);
    this.activeTransientVoices += 1;
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
      propagules: [],
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
        temperature: event.tool === 'grow' ? 0.56 : 0.48,
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

  private triggerEventTone(event: WorldEvent, ecologicalEvent: EcologicalAudioEvent, intensityScale = 1): void {
    if (!this.context || !this.eventBus || !this.busLayout) return;
    if (event.type === 'toolUsed') return;
    if (this.activeTransientVoices >= MAX_ACTIVE_VOICES) return;

    const now = this.context.currentTime;
    if (now < this.eventCooldownUntil) return;
    if (!this.canAdmitOnset(now, { minGap: 0.05, maxInWindow: 5, windowSeconds: 0.6 })) return;
    const eventGateKey = this.createNoteGateKey('worldEvent', ecologicalEvent.sourceEntityId ?? event.id);
    const eventProbability = this.interpretationMode === 'raw' ? 0.34 : this.interpretationMode === 'hybrid' ? 0.5 : 0.68;
    const eventCooldown = this.interpretationMode === 'raw' ? 0.36 : this.interpretationMode === 'hybrid' ? 0.3 : 0.24;
    if (!shouldTriggerNote(now, this.noteGateState, eventGateKey, eventCooldown, eventProbability)) return;

    const harmony = createHarmonyState({
      dimensions: { width: 0, height: 0, wrapped: true },
      entities: [],
      terrain: [],
      attractors: [],
      fields: [],
      particles: [],
      residues: [],
      propagules: [],
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
        temperature: event.type === 'entityDied' ? 0.44 : 0.5,
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

    const settings = this.createEventInstrumentGesture(event, ecologicalEvent);
    const eventProfile = this.getInstrumentVoiceProfile(settings.instrument, 'worldEvent');
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const pan = this.context.createStereoPanner();

    osc.type = settings.waveform;
    osc.detune.value = eventProfile.detuneCents * (Math.random() * 2 - 1);
    const baseEventFreq = getHarmonyFrequency(harmony, settings.layer, settings.contour, settings.octave, this.getPitchTightness('music'));
    const baseEventMidi = 69 + 12 * Math.log2(baseEventFreq / 440);
    const zoneMidi = quantizeToRoleZone(baseEventMidi, harmony, this.toHarmonicPitchRole(settings.role), this.getPitchTightness('music'));
    const rangedMidi = clamp(zoneMidi, settings.instrument.pitchRange.minMidi, settings.instrument.pitchRange.maxMidi);
    const pitchHz = 440 * 2 ** ((rangedMidi - 69) / 12);
    const noteEvent = this.createNoteEvent({
      pitchHz,
      duration: settings.duration,
      velocity: settings.amount * clamp(intensityScale, 0.2, 1.4),
      roleHint: settings.voiceRole,
      sourceKind: 'worldEvent',
      sourceId: ecologicalEvent.sourceEntityId ?? event.id,
      instrumentFamilyHint: this.instrumentHintFromDescriptor(settings.instrument.timbralFamily),
      envelopeShape: eventProfile.envelopeShape,
    });
    const startAt = alignToSoftPulse(now, this.noteTiming);
    osc.frequency.value = noteEvent.pitchHz;
    filter.type = settings.filterType;
    filter.frequency.value = clamp(noteEvent.pitchHz * settings.filterScale, 120, 6200);
    filter.Q.value = settings.q;
    pan.pan.value = clamp((event.position.x - 1200) / 1200, -0.8, 0.8);
    const stopAt = scheduleAdsrGain(
      gain,
      startAt,
      noteEvent.velocity,
      { attack: noteEvent.attack, decay: noteEvent.decay, sustain: noteEvent.sustain, release: noteEvent.release },
      noteEvent.duration,
    );

    osc.connect(filter);
    filter.connect(pan);
    pan.connect(gain);
    gain.connect(settings.destination);
    osc.start(startAt);
    osc.stop(stopAt + 0.02);
    this.eventCooldownUntil = now + (this.interpretationMode === 'musical' ? 0.06 : 0.1);
    this.registerOnset(startAt);
    this.activeTransientVoices += 1;
  }

  private inferRoleFromEcologicalEvent(event: EcologicalAudioEvent): OrchestrationRole {
    const tags = new Set(event.tags);
    if (tags.has('predator')) return 'predator';
    if (tags.has('cluster') || tags.has('parasite') || tags.has('residue') || tags.has('death')) return 'decomposer';
    if (tags.has('flocker')) return 'pollinator';
    if (tags.has('grazer')) return 'grazer';
    if (tags.has('plant') || tags.has('ephemeral') || tags.has('canopy') || tags.has('fruit') || tags.has('propagation')) return 'bloom';
    if (tags.has('environment')) return 'atmosphere';
    return 'mixed';
  }

  private chooseInstrumentForRole(role: OrchestrationRole, eventId: number): InstrumentDescriptor {
    const descriptors = this.instrumentRegistry.list();
    const weighted = descriptors
      .map((descriptor) => {
        const hasRole = descriptor.roleAffinity.includes(role)
          || (role === 'decomposer' && descriptor.roleAffinity.includes('decay'))
          || (role === 'bloom' && (descriptor.roleAffinity.includes('rooted') || descriptor.roleAffinity.includes('growth')))
          || (role === 'grazer' && descriptor.roleAffinity.includes('forager'));
        const modeWeight = this.interpretationMode === 'musical'
          ? descriptor.maxDensity + descriptor.rhythmicTendency * 0.4
          : this.interpretationMode === 'hybrid'
            ? descriptor.maxDensity * 0.7 + descriptor.rhythmicTendency * 0.3
            : 0.4;
        const affinityWeight = hasRole ? 1 : descriptor.roleAffinity.includes('mixed') ? 0.4 : 0;
        return { descriptor, weight: affinityWeight * modeWeight };
      })
      .filter((item) => item.weight > 0);
    const pool = weighted.length > 0 ? weighted : descriptors.map((descriptor) => ({ descriptor, weight: 1 }));
    const total = pool.reduce((sum, item) => sum + item.weight, 0);
    const seed = Math.abs(Math.sin((eventId + 1) * 12.9898)) % 1;
    let threshold = seed * total;
    for (const item of pool) {
      threshold -= item.weight;
      if (threshold <= 0) return item.descriptor;
    }
    return pool[pool.length - 1]?.descriptor ?? descriptors[0];
  }

  private createEventInstrumentGesture(event: WorldEvent, ecologicalEvent: EcologicalAudioEvent): EventInstrumentGesture {
    const role = this.inferRoleFromEcologicalEvent(ecologicalEvent);
    const instrument = this.chooseInstrumentForRole(role, ecologicalEvent.id);
    const destination = role === 'decomposer' || role === 'atmosphere'
      ? this.busLayout?.atmosphere ?? this.eventBus!
      : this.interpretationMode === 'raw'
        ? this.busLayout?.rawEcology ?? this.eventBus!
        : this.busLayout?.music ?? this.eventBus!;
    const profile = this.getInstrumentVoiceProfile(instrument, 'worldEvent');
    const modeDurationScale = (this.interpretationMode === 'raw' ? 0.86 : this.interpretationMode === 'hybrid' ? 1 : 1.08) * profile.durationScale;
    const contourByRole: Record<OrchestrationRole, number> = {
      bloom: 0.62,
      pollinator: 0.84,
      grazer: 0.4,
      predator: 0.24,
      decomposer: 0.2,
      atmosphere: 0.3,
      mixed: 0.52,
    };
    const octaveByRole: Record<OrchestrationRole, number> = {
      bloom: 0,
      pollinator: 1,
      grazer: -1,
      predator: -2,
      decomposer: -1,
      atmosphere: -1,
      mixed: 0,
    };
    const layerByRole: Record<OrchestrationRole, 'plant' | 'mobile' | 'cluster' | 'event'> = {
      bloom: 'plant',
      pollinator: 'mobile',
      grazer: 'cluster',
      predator: 'cluster',
      decomposer: 'cluster',
      atmosphere: 'plant',
      mixed: 'event',
    };
    const voiceRoleByOrchestration: Record<OrchestrationRole, EcologicalVoiceRole> = {
      bloom: 'bloom',
      pollinator: 'pollinator',
      grazer: 'grazer',
      predator: 'decay',
      decomposer: 'decay',
      atmosphere: 'bloom',
      mixed: 'grazer',
    };
    return {
      instrument,
      role,
      voiceRole: voiceRoleByOrchestration[role],
      layer: layerByRole[role],
      waveform: this.interpretationMode === 'raw' ? 'triangle' : profile.waveform,
      filterType: event.type === 'entityDied' ? 'lowpass' : profile.filterType,
      contour: clamp(contourByRole[role] + (instrument.rhythmicTendency - 0.5) * 0.16, 0.1, 0.95),
      octave: octaveByRole[role] + (this.interpretationMode === 'musical' ? 1 : 0),
      duration: clamp((0.12 + (1 - instrument.rhythmicTendency) * 0.3) * modeDurationScale, 0.1, 0.54),
      amount: clamp((0.012 + instrument.maxDensity * 0.022) * profile.amountScale, 0.01, 0.04),
      filterScale: clamp((1.2 + instrument.rhythmicTendency * 1.2 + (role === 'predator' ? -0.35 : 0)) * profile.filterScale, 0.95, 2.9),
      q: clamp((0.8 + instrument.rhythmicTendency * 1.8 + (this.interpretationMode === 'musical' ? 0.28 : 0)) * profile.q, 0.75, 3.2),
      destination,
    };
  }

  private getInstrumentVoiceProfile(
    instrument: InstrumentDescriptor,
    sourceKind: 'worldEvent' | 'phraseAgent' | 'environmentPulse',
  ): InstrumentVoiceProfile {
    const byFamily: Record<InstrumentDescriptor['foregroundFamily'], InstrumentVoiceProfile> = {
      'soft-pad': {
        waveform: 'triangle',
        filterType: 'lowpass',
        filterScale: 1.15,
        q: 0.72,
        detuneCents: 1.5,
        durationScale: 1.14,
        amountScale: 0.82,
        envelopeShape: 'soft',
      },
      'bell-chime': {
        waveform: 'sine',
        filterType: 'highpass',
        filterScale: 1.9,
        q: 1.28,
        detuneCents: 4,
        durationScale: 0.72,
        amountScale: 0.9,
        envelopeShape: 'percussive',
      },
      'soft-pluck': {
        waveform: 'triangle',
        filterType: 'bandpass',
        filterScale: 1.55,
        q: 1.18,
        detuneCents: 2.4,
        durationScale: 0.7,
        amountScale: 1.06,
        envelopeShape: 'percussive',
      },
      'mellow-mallet': {
        waveform: 'triangle',
        filterType: 'bandpass',
        filterScale: 1.34,
        q: 1.04,
        detuneCents: 1.2,
        durationScale: 0.78,
        amountScale: 1.02,
        envelopeShape: 'rounded',
      },
      'reed-lead': {
        waveform: 'sawtooth',
        filterType: 'bandpass',
        filterScale: 1.2,
        q: 1.4,
        detuneCents: 3.2,
        durationScale: 0.88,
        amountScale: 1.08,
        envelopeShape: 'rounded',
      },
      'soft-bass-pulse': {
        waveform: 'sine',
        filterType: 'lowpass',
        filterScale: 0.9,
        q: 0.82,
        detuneCents: 2,
        durationScale: 0.84,
        amountScale: 1.16,
        envelopeShape: 'soft',
      },
    };
    const profile = byFamily[instrument.foregroundFamily];
    if (sourceKind === 'phraseAgent') {
      return {
        ...profile,
        q: profile.q * 1.08,
        amountScale: profile.amountScale * 0.98,
      };
    }
    if (sourceKind === 'environmentPulse') {
      return {
        ...profile,
        durationScale: profile.durationScale * 0.9,
        amountScale: profile.amountScale * 0.84,
      };
    }
    return profile;
  }

  private instrumentHintFromDescriptor(family: InstrumentDescriptor['timbralFamily']): NoteInstrumentFamilyHint {
    if (family === 'bass') return 'bass';
    if (family === 'air') return 'air';
    if (family === 'reed') return 'reed';
    if (family === 'textural') return 'textural';
    if (family === 'hybrid') return 'hybrid';
    if (family === 'plucked') return 'plucked';
    return 'unknown';
  }

  private createNoteGateKey(sourceKind: NoteSourceKind, sourceId: number | string): string {
    return `${sourceKind}:${sourceId}`;
  }


  private toHarmonicPitchRole(role: OrchestrationRole | EcologicalVoiceRole): HarmonicPitchRole {
    if (role === 'bloom') return 'bloom';
    if (role === 'grazer') return 'grazer';
    if (role === 'pollinator') return 'pollinator';
    if (role === 'predator') return 'predator';
    if (role === 'decomposer') return 'decomposer';
    if (role === 'atmosphere') return 'drifter';
    if (role === 'mixed') return 'mixed';
    if (role === 'decay') return 'decay';
    return 'mixed';
  }

  private createNoteEvent(input: {
    pitchHz: number;
    duration: number;
    velocity: number;
    roleHint?: EcologicalVoiceRole;
    sourceKind: NoteSourceKind;
    sourceId: number | string;
    instrumentFamilyHint?: NoteInstrumentFamilyHint;
    envelopeShape?: 'soft' | 'percussive' | 'rounded';
  }): NoteEvent {
    const envelopeShape = createEnvelopeByDensity(
      input.sourceKind === 'phraseAgent' ? clamp(input.duration * 0.84, 0.08, 0.6) : input.duration,
      this.noteTiming.looseness < 0.35 ? 0.84 : 0.62,
      input.envelopeShape ?? (input.sourceKind === 'phraseAgent' ? 'rounded' : 'percussive'),
    );
    return {
      pitchHz: clamp(input.pitchHz, 28, 5400),
      duration: clamp(input.duration, 0.07, 0.8),
      velocity: clamp(input.velocity, 0.003, 0.08),
      attack: envelopeShape.attack,
      decay: envelopeShape.decay,
      sustain: envelopeShape.sustain,
      release: envelopeShape.release,
      roleHint: input.roleHint,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      instrumentFamilyHint: input.instrumentFamilyHint,
    };
  }

  private triggerToolTone(tool: ToolState, harmony: HarmonyState, intensity: number): void {
    if (!this.context || !this.eventBus) return;
    if (this.activeTransientVoices >= MAX_ACTIVE_VOICES) return;

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
    const baseMidi = 69 + 12 * Math.log2(baseFreq / 440);
    const snappedMidi = quantizeToRoleZone(baseMidi, harmony, tool.active === 'disrupt' ? 'predator' : tool.active === 'observe' ? 'drifter' : tool.active === 'grow' ? 'rooted' : 'grazer', this.getPitchTightness('music'));
    const snappedFreq = 440 * 2 ** ((snappedMidi - 69) / 12);
    osc.type = settings.type;
    osc.frequency.value = snappedFreq * (1 + intensity * 0.04);
    filter.type = tool.active === 'observe' ? 'highpass' : 'bandpass';
    filter.frequency.value = snappedFreq * settings.filterScale;
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
    this.activeTransientVoices += 1;
  }

  private createLoopingNoise(context: AudioContext): AudioBufferSourceNode {
    const length = context.sampleRate * 2;
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const channel = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.95 + white * 0.05;
      channel[i] = last;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  }

  private computePerceptualAttenuation(position: Vec2, snapshot: SimulationSnapshot, zoomNorm: number): { gain: number; highFreq: number } {
    const distance = this.distance(position, snapshot.camera.center, snapshot);
    const hearingRadius = 220 + 560 / Math.max(snapshot.camera.zoom, 0.22);
    const normDistance = clamp(distance / hearingRadius, 0, 1.3);
    const localHabitat = this.summarizeHabitatsAround(position, snapshot, 520);
    const mediumDensity = 1 + (1 - zoomNorm) * 1 + localHabitat.wetland * 0.22 + localHabitat.basin * 0.18;
    const lowBand = Math.exp(-normDistance * 1.1 * mediumDensity);
    const highBand = Math.exp(-normDistance * (2.6 + localHabitat.wetland * 0.7 + localHabitat.basin * 0.4) * mediumDensity);
    const highlandLift = 1 + localHabitat.highland * 0.22;
    const gain = clamp((lowBand * 0.76 + highBand * 0.24) * (0.95 + highlandLift * 0.05), 0.06, 1);
    const farMuffle = clamp(1 - smoothstep(0.2, 1.02, normDistance) * (0.52 + (1 - zoomNorm) * 0.34), 0.18, 1);
    return { gain, highFreq: clamp((0.24 + highBand * 0.92 + zoomNorm * 0.32) * farMuffle * highlandLift, 0.16, 1.24) };
  }

  private triggerSelectionResponse(snapshot: SimulationSnapshot, harmony: HarmonyState, now: number): void {
    if (!this.context || !this.eventBus) return;
    const selectedId = snapshot.attention.mode === 'entity' ? snapshot.attention.entityId : null;
    if (!selectedId || selectedId === this.lastSelectedEntityId) {
      this.lastSelectedEntityId = selectedId;
      return;
    }
    this.lastSelectedEntityId = selectedId;
    const entity = snapshot.entities.find((candidate) => candidate.id === selectedId);
    if (!entity || this.activeTransientVoices >= MAX_ACTIVE_VOICES) return;

    const roleLayer = entity.type === 'plant' || entity.type === 'ephemeral' || entity.type === 'canopy'
      ? 'plant'
      : entity.type === 'grazer' || entity.type === 'flocker'
        ? 'mobile'
        : 'cluster';
    const nearby = snapshot.entities.filter((candidate) => candidate.id !== entity.id && this.distance(candidate.position, entity.position, snapshot) < 240);
    const nearbySameType = nearby.filter((candidate) => candidate.type === entity.type).length;
    const nearbyPredators = nearby.filter((candidate) => candidate.type === 'predator').length;
    const localTension = clamp(snapshot.stats.threat * 0.54 + nearbyPredators * 0.12 + (entity.predatorState === 'hunting' ? 0.22 : 0), 0, 1);
    const stageColor = entity.stage === 'birth' ? 0.16 : entity.stage === 'mature' ? 0.08 : entity.stage === 'decay' ? -0.14 : 0;
    const stateContour = clamp(
      entity.energy * 0.28
      + entity.activity * 0.2
      + entity.harmony * 0.2
      + entity.tone * 0.16
      + localTension * 0.08
      + Math.min(nearbySameType, 4) * 0.02
      + stageColor,
      0,
      1,
    );
    const activityLift = entity.visualState === 'feeding' ? 0.1 : entity.visualState === 'reproducing' ? 0.14 : entity.visualState === 'dying' ? -0.08 : 0;
    const memory = this.selectionVoiceMemory.get(entity.id);
    const novelty = memory ? clamp(1 - (now - memory.lastAt) / 4, 0.08, 0.46) : 0;
    const jitter = (Math.random() * 2 - 1) * (0.04 + entity.activity * 0.05) + novelty * 0.08;
    const contour = clamp(stateContour + activityLift + jitter, 0, 1);
    const octave = entity.stage === 'decay' ? -1 : entity.type === 'flocker' ? 1 : 0;
    const frequencyRaw = getHarmonyFrequency(harmony, roleLayer, contour, octave);
    const glideRaw = getHarmonyFrequency(
      harmony,
      roleLayer,
      clamp(contour + (entity.visualState === 'dying' ? -0.1 : 0.08) + (Math.random() * 2 - 1) * 0.05, 0, 1),
      octave,
    );
    const selectionRole: HarmonicPitchRole = entity.type === 'predator'
      ? 'predator'
      : entity.type === 'parasite' || entity.type === 'cluster'
        ? 'decomposer'
        : entity.type === 'plant' || entity.type === 'canopy' || entity.type === 'ephemeral'
          ? 'rooted'
          : entity.type === 'flocker'
            ? 'drifter'
            : 'grazer';
    const frequencyMidi = quantizeToRoleZone(69 + 12 * Math.log2(frequencyRaw / 440), harmony, selectionRole, this.getPitchTightness('music'));
    const glideMidi = quantizeToRoleZone(69 + 12 * Math.log2(glideRaw / 440), harmony, selectionRole, this.getPitchTightness('music'));
    const frequency = 440 * 2 ** ((frequencyMidi - 69) / 12);
    const glideTarget = 440 * 2 ** ((glideMidi - 69) / 12);
    const duration = 0.16 + entity.activity * 0.08 + (entity.stage === 'mature' ? 0.05 : 0) + (entity.visualState === 'dying' ? 0.06 : 0);

    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const pan = this.context.createStereoPanner();
    osc.type = entity.type === 'predator' || entity.type === 'parasite' ? 'sawtooth' : entity.type === 'flocker' ? 'sine' : 'triangle';
    osc.frequency.value = frequency;
    filter.type = entity.stage === 'decay' ? 'lowpass' : 'bandpass';
    filter.frequency.value = frequency * (entity.visualState === 'idle' ? 1.55 : 2.15) * (1 - localTension * 0.12);
    filter.Q.value = 1.3 + entity.activity * 0.9 + localTension * 0.8;
    pan.pan.value = this.panFromPosition(entity.position.x, snapshot);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.016 + entity.energy * 0.022 + localTension * 0.01, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, glideTarget), now + duration * 0.9);
    osc.connect(filter);
    filter.connect(pan);
    pan.connect(gain);
    gain.connect(this.eventBus);
    osc.start(now);
    osc.stop(now + duration + 0.1);

    this.entityPriority.set(entity.id, Math.max(this.entityPriority.get(entity.id) ?? 0, 1.2));
    this.selectionVoiceMemory.set(entity.id, {
      lastContour: contour,
      lastDuration: duration,
      lastBrightness: filter.frequency.value,
      lastAt: now,
    });
    this.activeTransientVoices += 1;
  }

  private updatePhraseAgents(
    snapshot: SimulationSnapshot,
    harmony: HarmonyState,
    foreground: ScoredEntity[],
    zoomNorm: number,
    now: number,
    settings: GameSettings,
  ): void {
    if (!this.context || !this.phraseBus) return;
    const phraseBias = clamp(this.interpretationBlend, 0, 1);
    const supportsPhraseLayer = this.interpretationMode !== 'raw' || phraseBias > 0.3;
    if (!supportsPhraseLayer) return;
    const localDensity = clamp(
      snapshot.entities.filter((entity) => this.distance(entity.position, snapshot.camera.center, snapshot) < 340).length / 16,
      0,
      1.8,
    );
    const candidates = foreground
      .filter((entry) => entry.entity.type !== 'predator' && entry.entity.type !== 'parasite')
      .slice(0, 5);
    for (const agent of this.phraseAgents) {
      if (now < agent.nextActionTime) continue;
      if (agent.phase === 'idle') {
        if (now < this.phraseCooldownUntil) {
          agent.nextActionTime = this.phraseCooldownUntil + Math.random() * 0.2;
          continue;
        }
        const launchChance = 0.1 + phraseBias * 0.44 - localDensity * 0.08;
        if (Math.random() > launchChance) {
          agent.nextActionTime = now + 0.5 + (1 - phraseBias) * 0.95 + Math.random() * 0.6;
          continue;
        }
        const callResponseEligible = this.phraseRecentType !== null && now - this.phraseRecentTime < 1.4;
        const responseCandidate = callResponseEligible
          ? candidates.find((entry) => entry.entity.type === this.phraseRecentType)
          : undefined;
        const candidate = responseCandidate ?? candidates[agent.id % Math.max(1, candidates.length)];
        if (!candidate) continue;
        agent.entityId = candidate.entity.id;
        const remembered = this.phraseMotifMemory.get(candidate.entity.id);
        const motifLength = 2 + Math.round(phraseBias * 2);
        const baseMotif = remembered
          ? remembered.map((interval, idx) => interval + (Math.random() < 0.22 && idx > 0 ? (Math.random() < 0.5 ? -1 : 1) : 0))
          : [0, candidate.entity.type === 'flocker' ? 2 : 1, -1, 3];
        agent.motif = baseMotif.slice(0, clamp(motifLength, 2, 4));
        this.phraseMotifMemory.set(candidate.entity.id, baseMotif.slice(0, 4));
        const spacing = clamp(0.22 - phraseBias * 0.06 + localDensity * 0.11, 0.16, 0.36);
        agent.rhythm = agent.motif.map((_, idx) => spacing + (idx % 2 === 0 ? 0.06 : 0.12) + Math.random() * 0.06);
        agent.variation = 0.06 + Math.random() * 0.12;
        agent.notesRemaining = agent.motif.length;
        agent.noteIndex = 0;
        agent.phase = 'playing';
        this.phraseCooldownUntil = now + clamp(0.34 + localDensity * 0.16 + (1 - phraseBias) * 0.3, 0.32, 0.8);
      }
      if (agent.phase === 'playing' && agent.notesRemaining > 0 && this.activeTransientVoices < MAX_ACTIVE_VOICES) {
        const target = snapshot.entities.find((entity) => entity.id === agent.entityId);
        if (!target) {
          agent.phase = 'idle';
          agent.nextActionTime = now + 0.6;
          continue;
        }
        const interval = agent.motif[agent.noteIndex] ?? 0;
        const contour = clamp(target.tone * 0.5 + target.harmony * 0.34 + 0.16 + interval * 0.06 + (Math.random() * 2 - 1) * agent.variation, 0, 1);
        const phraseAmount = (0.046 + phraseBias * 0.036 + target.activity * 0.034 + (1 - zoomNorm) * 0.012) * (1 - localDensity * 0.2);
        const played = this.playPhraseNote(snapshot, harmony, target, contour, Math.max(0.02, phraseAmount), agent.rhythm[agent.noteIndex] ?? 0.2, settings);
        const nextDuration = agent.rhythm[agent.noteIndex] ?? 0.2;
        agent.noteIndex += 1;
        agent.notesRemaining -= 1;
        if (played) this.activeTransientVoices += 1;
        this.phraseRecentTime = now;
        this.phraseRecentType = target.type;
        if (agent.notesRemaining <= 0) {
          agent.phase = 'listening';
          agent.nextActionTime = now + 1.45 - phraseBias * 0.38 + Math.random() * 1.3 + localDensity * 0.55;
        } else {
          const interNoteRest = clamp(0.035 + localDensity * 0.012 + (1 - phraseBias) * 0.008, 0.026, 0.08);
          agent.nextActionTime = now + nextDuration + interNoteRest;
        }
      } else if (agent.phase === 'listening') {
        agent.phase = 'idle';
        agent.nextActionTime = now + 1.0 - phraseBias * 0.24 + Math.random() * 1.7 + localDensity * 0.44;
      }
    }
  }

  private playPhraseNote(
    snapshot: SimulationSnapshot,
    harmony: HarmonyState,
    entity: ScoredEntity['entity'],
    contour: number,
    amount: number,
    duration: number,
    settings: GameSettings,
  ): boolean {
    if (!this.context || !this.phraseBus) return false;
    const now = this.context.currentTime;
    if (!this.canAdmitOnset(now, { minGap: 0.075, maxInWindow: 4, windowSeconds: 0.58 })) return false;
    const phraseGateKey = this.createNoteGateKey('phraseAgent', entity.id);
    const phraseProbability = this.interpretationMode === 'musical' ? 0.82 : 0.62;
    if (!shouldTriggerNote(now, this.noteGateState, phraseGateKey, 0.14 + duration * 0.5, phraseProbability)) return false;

    const voice = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const pan = this.context.createStereoPanner();
    const layer = entity.type === 'plant' || entity.type === 'canopy' ? 'plant' : 'mobile';
    const perception = this.computePerceptualAttenuation(entity.position, snapshot, clamp((snapshot.camera.zoom - 0.24) / (2.4 - 0.24), 0, 1));

    const phraseBias = clamp(this.interpretationBlend, 0, 1);
    const orchestrationRole: OrchestrationRole = entity.type === 'predator'
      ? 'predator'
      : entity.type === 'parasite' || entity.type === 'cluster'
        ? 'decomposer'
        : entity.type === 'flocker'
          ? 'pollinator'
          : entity.type === 'plant' || entity.type === 'canopy' || entity.type === 'ephemeral'
            ? 'bloom'
            : 'grazer';
    const instrument = this.chooseInstrumentForRole(orchestrationRole, entity.id);
    const profile = this.getInstrumentVoiceProfile(instrument, 'phraseAgent');
    voice.type = phraseBias > 0.72 ? profile.waveform : (profile.waveform === 'sawtooth' ? 'triangle' : profile.waveform);
    voice.detune.value = profile.detuneCents * (Math.random() * 2 - 1);
    const entityRole: EcologicalVoiceRole = entity.type === 'plant' || entity.type === 'canopy' || entity.type === 'ephemeral'
      ? 'bloom'
      : entity.type === 'flocker'
        ? 'pollinator'
        : entity.type === 'predator' || entity.type === 'parasite' || entity.type === 'cluster'
          ? 'decay'
          : 'grazer';
    const phrasePitchRole: HarmonicPitchRole = entity.type === 'predator'
      ? 'predator'
      : entity.type === 'parasite' || entity.type === 'cluster'
        ? 'decomposer'
        : entity.type === 'flocker'
          ? 'drifter'
          : entity.type === 'plant' || entity.type === 'canopy' || entity.type === 'ephemeral'
            ? 'rooted'
            : entityRole;
    const basePhraseFreq = getHarmonyFrequency(harmony, layer, contour, entity.type === 'plant' ? -1 : 1, this.getPitchTightness('music'));
    const basePhraseMidi = 69 + 12 * Math.log2(basePhraseFreq / 440);
    const snappedPhraseMidi = quantizeToRoleZone(basePhraseMidi, harmony, phrasePitchRole, this.getPitchTightness('music'));
    const noteEvent = this.createNoteEvent({
      pitchHz: 440 * 2 ** ((snappedPhraseMidi - 69) / 12),
      duration,
      velocity: (amount * (0.72 + phraseBias * 0.6)) * perception.gain * this.mapVolume(settings.audio.entityVolume),
      roleHint: entityRole,
      sourceKind: 'phraseAgent',
      sourceId: entity.id,
      instrumentFamilyHint: this.instrumentHintFromDescriptor(instrument.timbralFamily),
      envelopeShape: profile.envelopeShape,
    });
    const startAt = alignToSoftPulse(now, this.noteTiming);
    voice.frequency.value = noteEvent.pitchHz;
    filter.type = profile.filterType;
    filter.frequency.value = clamp(noteEvent.pitchHz * (1.3 + entity.tone * 0.8) * profile.filterScale * perception.highFreq, 140, 6800);
    filter.Q.value = clamp((1.2 + entity.activity) * profile.q, 0.7, 3.4);
    pan.pan.value = this.panFromPosition(entity.position.x, snapshot);
    const stopAt = scheduleAdsrGain(
      gain,
      startAt,
      noteEvent.velocity,
      { attack: noteEvent.attack, decay: noteEvent.decay, sustain: noteEvent.sustain, release: noteEvent.release },
      noteEvent.duration,
    );
    voice.connect(filter);
    filter.connect(pan);
    pan.connect(gain);
    gain.connect(this.phraseBus);
    voice.start(startAt);
    voice.stop(stopAt + 0.02);
    this.registerOnset(startAt);
    return true;
  }

  private canAdmitOnset(now: number, limits: { minGap: number; maxInWindow: number; windowSeconds: number }): boolean {
    if (now - this.lastAnyOnsetTime < limits.minGap) return false;
    this.recentNoteOnsets = this.recentNoteOnsets.filter((time) => now - time <= limits.windowSeconds);
    return this.recentNoteOnsets.length < limits.maxInWindow;
  }

  private registerOnset(time: number): void {
    this.lastAnyOnsetTime = time;
    this.recentNoteOnsets.push(time);
    if (this.recentNoteOnsets.length > 20) this.recentNoteOnsets.shift();
  }

  getDebugState(): AudioDebugState {
    return { ...this.debugState };
  }

  private updateDebugState(
    snapshot: SimulationSnapshot,
    foreground: ScoredEntity[],
    harmony: HarmonyState,
    music: EcologicalMusicState,
    focus: AudioFocusContext,
    masterGain: number,
  ): void {
    const focusedVoiceCount = foreground.filter((entry) => entry.insideAttention || entry.isPrimary || entry.isRelated).length
      + ECOLOGICAL_ROLE_ORDER.filter((role) => {
        const center = music.composition.voices[role].center;
        return focus.active && this.distance(center, focus.center, snapshot) <= focus.radius;
      }).length;
    this.debugState.masterGain = masterGain;
    this.debugState.foregroundVoiceCount = foreground.length;
    this.debugState.focusedVoiceCount = focusedVoiceCount;
    this.debugState.groupedVoiceCount = ECOLOGICAL_ROLE_ORDER.filter((role) => music.composition.voices[role].presence > 0.06).length;
    this.debugState.mode = `${music.composition.mode}/${this.interpretationMode}/m${this.interpretationBlend.toFixed(2)}/i${this.instrumentRegistry.list().length}`;
    this.debugState.tonalCenterHz = harmony.rootHz;
    this.debugState.roleLevels = {
      bloom: music.composition.voices.bloom.presence,
      grazer: music.composition.voices.grazer.presence,
      pollinator: music.composition.voices.pollinator.presence,
      decay: music.composition.voices.decay.presence,
    };
    this.debugState.foregroundBalance = clamp(foreground.length / FOREGROUND_VOICE_COUNT * 0.45 + music.composition.foregroundLift * 0.55, 0, 1);
  }

  private mapVolume(value: number): number {
    const normalized = clamp(value, 0, 1);
    if (normalized <= 0) return 0.0001;
    return normalized * normalized;
  }

  private getPitchTightness(layer: 'raw' | 'music' | 'atmosphere'): number {
    if (layer === 'music') return clamp(0.56 + this.interpretationBlend * 0.4, 0.56, 0.96);
    if (layer === 'atmosphere') return clamp(0.62 + this.interpretationBlend * 0.3, 0.5, 0.9);
    return clamp(0.14 + this.interpretationBlend * 0.28, 0.08, 0.52);
  }

  private applyLiveControls(settings: GameSettings, fast = false): void {
    if (!this.context || !this.masterControl || !this.busLayout) return;
    const now = this.context.currentTime;
    const timeConstant = fast ? 0.02 : 0.05;
    const master = this.mapVolume(settings.audio.masterVolume);
    const ambience = this.mapVolume(settings.audio.ambienceVolume);
    const entity = this.mapVolume(settings.audio.entityVolume);
    const musicBus = this.mapVolume(settings.audio.musicBusLevel);
    const rawBus = this.mapVolume(settings.audio.rawEcologyBusLevel);
    const atmosphereBus = this.mapVolume(settings.audio.atmosphereBusLevel);
    const selectionTrim = clamp(entity * 1.15, 0.0001, 1);
    const rawTrim = clamp(rawBus * (entity * 0.6 + ambience * 0.4), 0.0001, 1);
    const musicTrim = clamp(musicBus * (0.7 + entity * 0.3), 0.0001, 1);
    const atmosphereTrim = clamp(atmosphereBus * ambience, 0.0001, 1);

    this.masterControl.gain.cancelScheduledValues(now);
    this.masterControl.gain.setTargetAtTime(master, now, timeConstant);
    this.busLayout.musicControl.gain.cancelScheduledValues(now);
    this.busLayout.musicControl.gain.setTargetAtTime(musicTrim, now, timeConstant);
    this.busLayout.rawEcologyControl.gain.cancelScheduledValues(now);
    this.busLayout.rawEcologyControl.gain.setTargetAtTime(rawTrim, now, timeConstant);
    this.busLayout.atmosphereControl.gain.cancelScheduledValues(now);
    this.busLayout.atmosphereControl.gain.setTargetAtTime(atmosphereTrim, now, timeConstant);
    this.busLayout.selectionUiControl.gain.cancelScheduledValues(now);
    this.busLayout.selectionUiControl.gain.setTargetAtTime(selectionTrim, now, timeConstant);
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
