export const GAME_TITLE = 'ResonanceBreach';
export const WORLD_WIDTH = 1280;
export const WORLD_HEIGHT = 720;

export const FIXED_TIMESTEP = 1 / 60;
export const MAX_FRAME_DELTA = 0.1;

export const INITIAL_HARMONIC_COUNT = 18;
export const MAX_ENTITIES = 96;
export const BASE_STABILITY_DRAIN = 0.0028;
export const STABILITY_RECOVERY = 0.022;
export const RESONANCE_RANGE = 122;
export const ENTITY_LINK_DISTANCE = 148;
export const STABILIZER_RADIUS = 118;
export const STABILIZER_STRENGTH = 170;
export const STABILIZER_RECOVERY = 0.18;
export const STABILIZER_HEAT_DAMPING = 0.84;
export const STABILIZER_MAX_CHARGE = 1.8;

export const HUD_REFRESH_RATE = 6;
export const TOPOLOGY_COLS = 6;
export const TOPOLOGY_ROWS = 4;
export const MAX_POCKET_INDICATORS = 3;

export const CAMERA_MIN_ZOOM = 0.45;
export const CAMERA_MAX_ZOOM = 2.35;
export const CAMERA_ZOOM_SPEED = 0.0012;
export const CAMERA_PAN_SPEED = 420;

export const TIME_SCALE_SLOW = 0.5;
export const TIME_SCALE_FAST = 2;

export const PHASE_SEQUENCE = ['calm', 'anomaly', 'emergence', 'pressure', 'breach'] as const;
export type SystemPhase = (typeof PHASE_SEQUENCE)[number];

export const ENTITY_ROLES = ['harmonic', 'anomaly', 'breach'] as const;
export type EntityRole = (typeof ENTITY_ROLES)[number];
