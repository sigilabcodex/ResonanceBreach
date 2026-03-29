import type { EcologicalVoiceRole } from './ecologicalMusic';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export type NoteInstrumentFamilyHint = 'plucked' | 'air' | 'reed' | 'bass' | 'textural' | 'hybrid' | 'unknown';
export type NoteSourceKind = 'worldEvent' | 'phraseAgent' | 'environmentPulse' | 'selection';

export interface NoteEvent {
  pitchHz: number;
  duration: number;
  velocity: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  instrumentFamilyHint?: NoteInstrumentFamilyHint;
  roleHint?: EcologicalVoiceRole;
  sourceKind?: NoteSourceKind;
  sourceId?: number | string;
}

export interface NoteTimingGate {
  pulseSeconds: number;
  looseness: number;
  jitter: number;
}

export interface NoteEnvelopeShape {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export const createEnvelopeByDensity = (
  duration: number,
  density: number,
  shape: 'soft' | 'percussive' | 'rounded' = 'rounded',
): NoteEnvelopeShape => {
  const safeDuration = Math.max(0.06, duration);
  const rhythm = clamp(density, 0, 1);
  if (shape === 'percussive') {
    return {
      attack: clamp(0.004 + (1 - rhythm) * 0.004, 0.004, 0.012),
      decay: clamp(safeDuration * (0.22 + rhythm * 0.12), 0.02, safeDuration * 0.46),
      sustain: clamp(0.22 - rhythm * 0.1, 0.08, 0.26),
      release: clamp(safeDuration * (0.38 - rhythm * 0.08), 0.03, safeDuration * 0.44),
    };
  }
  if (shape === 'soft') {
    return {
      attack: clamp(0.016 + (1 - rhythm) * 0.02, 0.012, 0.048),
      decay: clamp(safeDuration * 0.26, 0.03, safeDuration * 0.34),
      sustain: 0.62,
      release: clamp(safeDuration * 0.44 + 0.04, 0.08, safeDuration * 0.6),
    };
  }
  return {
    attack: clamp(0.008 + (1 - rhythm) * 0.012, 0.008, 0.024),
    decay: clamp(safeDuration * 0.24, 0.03, safeDuration * 0.36),
    sustain: clamp(0.36 + (1 - rhythm) * 0.12, 0.28, 0.52),
    release: clamp(safeDuration * 0.36, 0.04, safeDuration * 0.52),
  };
};

export const alignToSoftPulse = (now: number, timing: NoteTimingGate): number => {
  const pulse = Math.max(0.1, timing.pulseSeconds);
  const quantized = Math.round(now / pulse) * pulse;
  const pull = clamp(1 - timing.looseness, 0, 1);
  const aligned = now + (quantized - now) * pull;
  const jitter = (Math.random() * 2 - 1) * timing.jitter;
  return Math.max(now, aligned + jitter);
};

export const shouldTriggerNote = (
  now: number,
  gateState: Map<string, number>,
  key: string,
  cooldown: number,
  probability: number,
): boolean => {
  const nextReady = gateState.get(key) ?? -Infinity;
  if (now < nextReady) return false;
  if (Math.random() > clamp(probability, 0, 1)) {
    gateState.set(key, now + cooldown * 0.5);
    return false;
  }
  gateState.set(key, now + cooldown);
  return true;
};

export const scheduleAdsrGain = (
  gain: GainNode,
  now: number,
  velocity: number,
  envelope: NoteEnvelopeShape,
  duration: number,
): number => {
  const floor = 0.0001;
  const amount = Math.max(0.0002, velocity);
  const attackEnd = now + envelope.attack;
  const decayEnd = attackEnd + envelope.decay;
  const bodyEnd = now + Math.max(duration * 0.65, envelope.attack + envelope.decay + 0.02);
  const releaseEnd = bodyEnd + envelope.release;
  const sustainAmount = Math.max(floor, amount * envelope.sustain);

  gain.gain.setValueAtTime(floor, now);
  gain.gain.exponentialRampToValueAtTime(amount, attackEnd);
  gain.gain.exponentialRampToValueAtTime(sustainAmount, decayEnd);
  gain.gain.setValueAtTime(sustainAmount, bodyEnd);
  gain.gain.exponentialRampToValueAtTime(floor, releaseEnd);

  return releaseEnd;
};
