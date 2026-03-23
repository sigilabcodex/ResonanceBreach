import type { Entity, SimulationSnapshot, Vec2 } from '../types/world';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (previous: number, next: number, amount: number) => lerp(previous, next, clamp(amount, 0, 1));

export type EcologicalMusicMode = 'calm' | 'fertile' | 'tense' | 'degraded' | 'anomalous';
export type EcologicalVoiceRole = 'bloom' | 'grazer' | 'pollinator' | 'decay';

export interface EcologicalInterpretation {
  density: number;
  diversity: number;
  growthRate: number;
  feedingActivity: number;
  reproductionActivity: number;
  decayPresence: number;
  localActivity: number;
  globalActivity: number;
  focusPresence: number;
  intensity: number;
  tension: number;
  stability: number;
  rhythmicActivity: number;
  harmonicRichness: number;
  abundance: number;
}

export interface EcologicalVoiceProfile {
  role: EcologicalVoiceRole;
  presence: number;
  focus: number;
  center: Vec2;
  density: number;
  brightness: number;
  motion: number;
  contour: number;
  register: number;
}

export interface EcologicalComposition {
  mode: EcologicalMusicMode;
  tonalCenter: number;
  harmonicDrift: number;
  rhythmDensity: number;
  evolutionSpeed: number;
  pulseJitter: number;
  foregroundLift: number;
  voices: Record<EcologicalVoiceRole, EcologicalVoiceProfile>;
}

export interface EcologicalMusicState {
  interpretation: EcologicalInterpretation;
  composition: EcologicalComposition;
}

// Simulation metrics are first smoothed into continuous ecological readings
// (density, feeding, decay, focus, etc.), then folded into slower-moving
// composition controls so the score evolves as texture instead of firing
// one sound per entity/event.
const ROLE_ORDER: EcologicalVoiceRole[] = ['bloom', 'grazer', 'pollinator', 'decay'];
const SPECIES_ORDER = ['plant', 'grazer', 'flocker', 'cluster', 'predator'] as const;

const entityRole = (entity: Entity): EcologicalVoiceRole => {
  if (entity.type === 'plant') return 'bloom';
  if (entity.type === 'grazer') return 'grazer';
  if (entity.type === 'flocker') return 'pollinator';
  return 'decay';
};

const createEmptyState = (): EcologicalMusicState => ({
  interpretation: {
    density: 0.22,
    diversity: 0.32,
    growthRate: 0.3,
    feedingActivity: 0.12,
    reproductionActivity: 0.12,
    decayPresence: 0.08,
    localActivity: 0.18,
    globalActivity: 0.2,
    focusPresence: 0,
    intensity: 0.2,
    tension: 0.14,
    stability: 0.62,
    rhythmicActivity: 0.18,
    harmonicRichness: 0.28,
    abundance: 0.24,
  },
  composition: {
    mode: 'calm',
    tonalCenter: 41,
    harmonicDrift: 0.08,
    rhythmDensity: 0.16,
    evolutionSpeed: 0.14,
    pulseJitter: 0.12,
    foregroundLift: 0,
    voices: {
      bloom: { role: 'bloom', presence: 0.32, focus: 0, center: { x: 0, y: 0 }, density: 0.24, brightness: 0.28, motion: 0.18, contour: 0.34, register: -1 },
      grazer: { role: 'grazer', presence: 0.12, focus: 0, center: { x: 0, y: 0 }, density: 0.14, brightness: 0.32, motion: 0.28, contour: 0.42, register: 0 },
      pollinator: { role: 'pollinator', presence: 0.16, focus: 0, center: { x: 0, y: 0 }, density: 0.16, brightness: 0.42, motion: 0.42, contour: 0.58, register: 1 },
      decay: { role: 'decay', presence: 0.08, focus: 0, center: { x: 0, y: 0 }, density: 0.08, brightness: 0.16, motion: 0.12, contour: 0.18, register: -1 },
    },
  },
});

const speciesEntropy = (snapshot: SimulationSnapshot): number => {
  const counts = {
    plant: 0,
    grazer: 0,
    flocker: 0,
    cluster: 0,
    predator: 0,
  };
  for (const entity of snapshot.entities) counts[entity.type] += 1;
  const total = Math.max(1, snapshot.entities.length);
  let entropy = 0;
  for (const species of SPECIES_ORDER) {
    const probability = counts[species] / total;
    if (probability <= 0) continue;
    entropy += -probability * Math.log2(probability);
  }
  return clamp(entropy / Math.log2(SPECIES_ORDER.length), 0, 1);
};

const eventPulse = (snapshot: SimulationSnapshot, type: SimulationSnapshot['events'][number]['type']): number => {
  const total = snapshot.events.reduce((sum, event) => sum + (event.type === type ? 1 : 0), 0);
  return clamp(total / 4, 0, 1);
};

const countFocusedEntities = (snapshot: SimulationSnapshot): { active: number; total: number; focusByRole: Record<EcologicalVoiceRole, number> } => {
  const focusByRole: Record<EcologicalVoiceRole, number> = {
    bloom: 0,
    grazer: 0,
    pollinator: 0,
    decay: 0,
  };

  if (snapshot.attention.mode === 'none') {
    return { active: 0, total: Math.max(1, snapshot.entities.length), focusByRole };
  }

  let active = 0;
  if (snapshot.attention.mode === 'entity' && snapshot.attention.entityId !== null) {
    for (const entity of snapshot.entities) {
      if (entity.id === snapshot.attention.entityId || snapshot.attention.relatedEntityIds.includes(entity.id)) {
        active += 1;
        focusByRole[entityRole(entity)] += entity.id === snapshot.attention.entityId ? 1.35 : 0.72;
      }
    }
    return { active, total: Math.max(1, snapshot.entities.length), focusByRole };
  }

  for (const entity of snapshot.entities) {
    const dx = entity.position.x - snapshot.attention.position.x;
    const dy = entity.position.y - snapshot.attention.position.y;
    if (Math.hypot(dx, dy) <= snapshot.attention.radius) {
      active += 1;
      focusByRole[entityRole(entity)] += 1;
    }
  }
  return { active, total: Math.max(1, snapshot.entities.length), focusByRole };
};

const getMode = (intensity: number, tension: number, stability: number, fertility: number, decay: number): EcologicalMusicMode => {
  if (tension > 0.72 && decay > 0.42) return 'degraded';
  if (tension > 0.66 || stability < 0.34) return 'tense';
  if (fertility > 0.62 && stability > 0.54) return 'fertile';
  if (intensity > 0.82 && tension > 0.82) return 'anomalous';
  return 'calm';
};

export const createEcologicalMusicState = (
  snapshot: SimulationSnapshot,
  previous = createEmptyState(),
): EcologicalMusicState => {
  const entityCount = snapshot.entities.length;
  const density = clamp(entityCount / 60, 0, 1);
  const diversity = speciesEntropy(snapshot);
  const growthRate = clamp(snapshot.stats.growth * 0.68 + snapshot.stats.nutrients * 0.2 + snapshot.stats.fruit * 0.12, 0, 1);
  const feedingFromState = clamp(snapshot.entities.filter((entity) => entity.visualState === 'feeding').length / Math.max(1, entityCount * 0.38), 0, 1);
  const reproductionFromState = clamp(snapshot.entities.filter((entity) => entity.visualState === 'reproducing').length / Math.max(1, entityCount * 0.26), 0, 1);
  const decayFromState = clamp(
    snapshot.entities.filter((entity) => entity.visualState === 'dying').length / Math.max(1, entityCount * 0.18)
      + snapshot.residues.length / 18,
    0,
    1,
  );
  const feedingActivity = clamp(feedingFromState * 0.74 + eventPulse(snapshot, 'entityFed') * 0.26, 0, 1);
  const reproductionActivity = clamp(reproductionFromState * 0.62 + eventPulse(snapshot, 'entityBorn') * 0.24 + eventPulse(snapshot, 'fruitCreated') * 0.14, 0, 1);
  const decayPresence = clamp(decayFromState * 0.76 + eventPulse(snapshot, 'entityDied') * 0.24, 0, 1);
  const focusCounts = countFocusedEntities(snapshot);
  const localActivity = clamp(
    snapshot.attention.mode === 'none'
      ? snapshot.stats.activity * 0.78
      : focusCounts.active / Math.max(1, Math.min(entityCount, 18)),
    0,
    1,
  );
  const globalActivity = clamp(snapshot.stats.activity, 0, 1);
  const focusPresence = clamp(snapshot.attention.mode === 'none' ? 0 : snapshot.attention.strength, 0, 1);
  const stability = clamp(snapshot.stats.stability * 0.78 + snapshot.stats.harmony * 0.22 - decayPresence * 0.08, 0, 1);
  const tension = clamp(snapshot.stats.threat * 0.52 + decayPresence * 0.24 + globalActivity * 0.16 + (1 - stability) * 0.18, 0, 1);
  const harmonicRichness = clamp(diversity * 0.44 + growthRate * 0.18 + snapshot.stats.harmony * 0.22 + snapshot.stats.nutrients * 0.16, 0, 1);
  const rhythmicActivity = clamp(globalActivity * 0.42 + feedingActivity * 0.24 + reproductionActivity * 0.18 + localActivity * 0.16, 0, 1);
  const abundance = clamp(density * 0.54 + snapshot.stats.fruit * 0.18 + snapshot.stats.nutrients * 0.14 + growthRate * 0.14, 0, 1);
  const intensity = clamp(globalActivity * 0.36 + localActivity * 0.16 + harmonicRichness * 0.14 + abundance * 0.14 + focusPresence * 0.12 + tension * 0.08, 0, 1);

  const nextInterpretation: EcologicalInterpretation = {
    density: smooth(previous.interpretation.density, density, 0.1),
    diversity: smooth(previous.interpretation.diversity, diversity, 0.06),
    growthRate: smooth(previous.interpretation.growthRate, growthRate, 0.08),
    feedingActivity: smooth(previous.interpretation.feedingActivity, feedingActivity, 0.18),
    reproductionActivity: smooth(previous.interpretation.reproductionActivity, reproductionActivity, 0.12),
    decayPresence: smooth(previous.interpretation.decayPresence, decayPresence, 0.12),
    localActivity: smooth(previous.interpretation.localActivity, localActivity, 0.14),
    globalActivity: smooth(previous.interpretation.globalActivity, globalActivity, 0.08),
    focusPresence: smooth(previous.interpretation.focusPresence, focusPresence, 0.18),
    intensity: smooth(previous.interpretation.intensity, intensity, 0.08),
    tension: smooth(previous.interpretation.tension, tension, 0.08),
    stability: smooth(previous.interpretation.stability, stability, 0.08),
    rhythmicActivity: smooth(previous.interpretation.rhythmicActivity, rhythmicActivity, 0.1),
    harmonicRichness: smooth(previous.interpretation.harmonicRichness, harmonicRichness, 0.08),
    abundance: smooth(previous.interpretation.abundance, abundance, 0.08),
  };

  const fertility = clamp(snapshot.stats.nutrients * 0.44 + snapshot.stats.growth * 0.32 + snapshot.stats.harmony * 0.14 + snapshot.stats.fruit * 0.1, 0, 1);
  const mode = getMode(nextInterpretation.intensity, nextInterpretation.tension, nextInterpretation.stability, fertility, nextInterpretation.decayPresence);

  const totalRoleWeight: Record<EcologicalVoiceRole, number> = {
    bloom: 0.0001,
    grazer: 0.0001,
    pollinator: 0.0001,
    decay: 0.0001,
  };
  const weightedCenter: Record<EcologicalVoiceRole, Vec2> = {
    bloom: { x: 0, y: 0 },
    grazer: { x: 0, y: 0 },
    pollinator: { x: 0, y: 0 },
    decay: { x: 0, y: 0 },
  };
  const countsByRole: Record<EcologicalVoiceRole, number> = {
    bloom: 0,
    grazer: 0,
    pollinator: 0,
    decay: 0,
  };
  const energyByRole: Record<EcologicalVoiceRole, number> = {
    bloom: 0,
    grazer: 0,
    pollinator: 0,
    decay: 0,
  };
  const motionByRole: Record<EcologicalVoiceRole, number> = {
    bloom: 0,
    grazer: 0,
    pollinator: 0,
    decay: 0,
  };
  const brightnessByRole: Record<EcologicalVoiceRole, number> = {
    bloom: 0,
    grazer: 0,
    pollinator: 0,
    decay: 0,
  };

  for (const entity of snapshot.entities) {
    const role = entityRole(entity);
    const weight = 0.2 + entity.activity * 0.26 + entity.energy * 0.22 + entity.harmony * 0.16 + entity.growth * 0.16;
    countsByRole[role] += 1;
    energyByRole[role] += entity.energy;
    motionByRole[role] += entity.activity;
    brightnessByRole[role] += entity.tone * 0.5 + entity.harmony * 0.5;
    weightedCenter[role].x += entity.position.x * weight;
    weightedCenter[role].y += entity.position.y * weight;
    totalRoleWeight[role] += weight;
  }

  const roleProfiles = ROLE_ORDER.reduce<Record<EcologicalVoiceRole, EcologicalVoiceProfile>>((profiles, role) => {
    const count = countsByRole[role];
    const averageEnergy = energyByRole[role] / Math.max(1, count);
    const averageMotion = motionByRole[role] / Math.max(1, count);
    const averageBrightness = brightnessByRole[role] / Math.max(1, count);
    const roleDensity = clamp(count / Math.max(1, entityCount * (role === 'bloom' ? 0.48 : role === 'decay' ? 0.36 : 0.24)), 0, 1);
    const focus = clamp(focusCounts.focusByRole[role] / 3, 0, 1);
    const center = {
      x: weightedCenter[role].x / totalRoleWeight[role] || snapshot.camera.center.x,
      y: weightedCenter[role].y / totalRoleWeight[role] || snapshot.camera.center.y,
    };
    const presenceBase = role === 'bloom'
      ? abundance * 0.44 + growthRate * 0.34 + roleDensity * 0.22
      : role === 'grazer'
        ? rhythmicActivity * 0.44 + feedingActivity * 0.22 + roleDensity * 0.24 + averageEnergy * 0.1
        : role === 'pollinator'
          ? diversity * 0.26 + harmonicRichness * 0.34 + localActivity * 0.16 + averageMotion * 0.24
          : decayPresence * 0.48 + tension * 0.18 + roleDensity * 0.2 + averageBrightness * 0.14;
    profiles[role] = {
      role,
      presence: smooth(previous.composition.voices[role].presence, clamp(presenceBase, 0, 1), 0.1),
      focus: smooth(previous.composition.voices[role].focus, clamp(focus * 0.84 + focusPresence * 0.16, 0, 1), 0.16),
      center,
      density: smooth(previous.composition.voices[role].density, roleDensity, 0.08),
      brightness: smooth(previous.composition.voices[role].brightness, clamp(averageBrightness * 0.54 + harmonicRichness * 0.28 + (role === 'decay' ? tension * 0.12 : 0.18), 0, 1), 0.12),
      motion: smooth(previous.composition.voices[role].motion, clamp(averageMotion * 0.46 + rhythmicActivity * 0.34 + (role === 'pollinator' ? 0.16 : role === 'decay' ? decayPresence * 0.08 : 0), 0, 1), 0.12),
      contour: smooth(previous.composition.voices[role].contour, clamp(averageBrightness * 0.24 + averageMotion * 0.26 + harmonicRichness * 0.32 + focus * 0.18, 0, 1), 0.08),
      register: role === 'bloom' ? -1 : role === 'pollinator' ? 1 : role === 'decay' ? -1 : 0,
    };
    return profiles;
  }, {
    bloom: previous.composition.voices.bloom,
    grazer: previous.composition.voices.grazer,
    pollinator: previous.composition.voices.pollinator,
    decay: previous.composition.voices.decay,
  });

  return {
    interpretation: nextInterpretation,
    composition: {
      mode,
      tonalCenter: Math.round(
        smooth(
          previous.composition.tonalCenter,
          39 + nextInterpretation.harmonicRichness * 5 + fertility * 4 - nextInterpretation.tension * 3 + nextInterpretation.focusPresence,
          0.08,
        ),
      ),
      harmonicDrift: smooth(previous.composition.harmonicDrift, clamp(nextInterpretation.diversity * 0.28 + nextInterpretation.stability * 0.18 + nextInterpretation.focusPresence * 0.12, 0, 1), 0.08),
      rhythmDensity: smooth(previous.composition.rhythmDensity, clamp(nextInterpretation.rhythmicActivity * 0.72 + nextInterpretation.tension * 0.1 + nextInterpretation.focusPresence * 0.18, 0, 1), 0.14),
      evolutionSpeed: smooth(previous.composition.evolutionSpeed, clamp(nextInterpretation.intensity * 0.44 + nextInterpretation.tension * 0.24 + nextInterpretation.localActivity * 0.16 + 0.08, 0, 1), 0.1),
      pulseJitter: smooth(previous.composition.pulseJitter, clamp(nextInterpretation.diversity * 0.34 + nextInterpretation.rhythmicActivity * 0.24 + nextInterpretation.focusPresence * 0.18, 0, 1), 0.1),
      foregroundLift: smooth(previous.composition.foregroundLift, clamp(nextInterpretation.focusPresence * 0.72 + nextInterpretation.localActivity * 0.18, 0, 1), 0.16),
      voices: roleProfiles,
    },
  };
};
