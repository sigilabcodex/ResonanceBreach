import type { MusicalInterpretationMode } from './audio/musicalInterpreter';

export interface AudioSettings {
  masterVolume: number;
  ambienceVolume: number;
  entityVolume: number;
  musicBusLevel: number;
  rawEcologyBusLevel: number;
  atmosphereBusLevel: number;
  interpretationMode: MusicalInterpretationMode;
  musicificationAmount: number;
}

export interface VisualSettings {
  terrainLines: boolean;
  motionTrails: boolean;
  debugOverlays: boolean;
  reduceMotion: boolean;
  showLeftPanel: boolean;
  showRightPanel: boolean;
  minimalHud: boolean;
}

export interface GameSettings {
  audio: AudioSettings;
  visuals: VisualSettings;
}

export const SETTINGS_STORAGE_KEY = 'resonance-garden-settings';

export const DEFAULT_SETTINGS: GameSettings = {
  audio: {
    masterVolume: 0.84,
    ambienceVolume: 0.64,
    entityVolume: 0.9,
    musicBusLevel: 0.94,
    rawEcologyBusLevel: 0.74,
    atmosphereBusLevel: 0.62,
    interpretationMode: 'hybrid',
    musicificationAmount: 0.62,
  },
  visuals: {
    terrainLines: true,
    motionTrails: true,
    debugOverlays: false,
    reduceMotion: false,
    showLeftPanel: true,
    showRightPanel: true,
    minimalHud: false,
  },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const sanitizeBoolean = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const sanitizeNumber = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? clamp(value, 0, 1) : fallback);

export const normalizeSettings = (value?: Partial<GameSettings> | null): GameSettings => ({
  audio: {
    masterVolume: sanitizeNumber(value?.audio?.masterVolume, DEFAULT_SETTINGS.audio.masterVolume),
    ambienceVolume: sanitizeNumber(value?.audio?.ambienceVolume, DEFAULT_SETTINGS.audio.ambienceVolume),
    entityVolume: sanitizeNumber(value?.audio?.entityVolume, DEFAULT_SETTINGS.audio.entityVolume),
    musicBusLevel: sanitizeNumber(value?.audio?.musicBusLevel, DEFAULT_SETTINGS.audio.musicBusLevel),
    rawEcologyBusLevel: sanitizeNumber(value?.audio?.rawEcologyBusLevel, DEFAULT_SETTINGS.audio.rawEcologyBusLevel),
    atmosphereBusLevel: sanitizeNumber(value?.audio?.atmosphereBusLevel, DEFAULT_SETTINGS.audio.atmosphereBusLevel),
    interpretationMode: value?.audio?.interpretationMode === 'raw' || value?.audio?.interpretationMode === 'hybrid' || value?.audio?.interpretationMode === 'musical'
      ? value.audio.interpretationMode
      : DEFAULT_SETTINGS.audio.interpretationMode,
    musicificationAmount: sanitizeNumber(value?.audio?.musicificationAmount, DEFAULT_SETTINGS.audio.musicificationAmount),
  },
  visuals: {
    terrainLines: sanitizeBoolean(value?.visuals?.terrainLines, DEFAULT_SETTINGS.visuals.terrainLines),
    motionTrails: sanitizeBoolean(value?.visuals?.motionTrails, DEFAULT_SETTINGS.visuals.motionTrails),
    debugOverlays: sanitizeBoolean(value?.visuals?.debugOverlays, DEFAULT_SETTINGS.visuals.debugOverlays),
    reduceMotion: sanitizeBoolean(value?.visuals?.reduceMotion, DEFAULT_SETTINGS.visuals.reduceMotion),
    showLeftPanel: sanitizeBoolean(value?.visuals?.showLeftPanel, DEFAULT_SETTINGS.visuals.showLeftPanel),
    showRightPanel: sanitizeBoolean(value?.visuals?.showRightPanel, DEFAULT_SETTINGS.visuals.showRightPanel),
    minimalHud: sanitizeBoolean(value?.visuals?.minimalHud, DEFAULT_SETTINGS.visuals.minimalHud),
  },
});

export const loadSettings = (): GameSettings => {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return normalizeSettings(JSON.parse(raw) as Partial<GameSettings>);
  } catch {
    return DEFAULT_SETTINGS;
  }
};

export const storeSettings = (settings: GameSettings): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
};
