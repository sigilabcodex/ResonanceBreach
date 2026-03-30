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
      attack: clamp(0.003 + (1 - rhythm) * 0.003, 0.003, 0.01),
      decay: clamp(safeDuration * (0.18 + rhythm * 0.1), 0.016, safeDuration * 0.34),
      sustain: clamp(0.13 - rhythm * 0.07, 0.04, 0.16),
      release: clamp(safeDuration * (0.24 - rhythm * 0.06), 0.02, safeDuration * 0.3),
    };
  }
  if (shape === 'soft') {
    return {
      attack: clamp(0.014 + (1 - rhythm) * 0.016, 0.01, 0.038),
      decay: clamp(safeDuration * 0.22, 0.024, safeDuration * 0.3),
      sustain: clamp(0.46 - rhythm * 0.08, 0.34, 0.5),
      release: clamp(safeDuration * 0.32 + 0.03, 0.06, safeDuration * 0.44),
    };
  }
  return {
    attack: clamp(0.006 + (1 - rhythm) * 0.01, 0.006, 0.02),
    decay: clamp(safeDuration * 0.2, 0.024, safeDuration * 0.3),
    sustain: clamp(0.26 + (1 - rhythm) * 0.08, 0.2, 0.36),
    release: clamp(safeDuration * 0.24, 0.03, safeDuration * 0.34),
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
