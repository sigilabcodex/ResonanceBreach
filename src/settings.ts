export interface AudioSettings {
  masterVolume: number;
  ambienceVolume: number;
  entityVolume: number;
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
    ambienceVolume: 0.78,
    entityVolume: 0.88,
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
