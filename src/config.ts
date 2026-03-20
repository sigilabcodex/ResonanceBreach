export const GAME_TITLE = 'Resonance Garden';
export const WORLD_WIDTH = 1280;
export const WORLD_HEIGHT = 720;

export const FIXED_TIMESTEP = 1 / 60;
export const MAX_FRAME_DELTA = 0.1;

export const INITIAL_SEED_COUNT = 44;
export const INITIAL_CLUSTER_COUNT = 5;
export const INITIAL_FILAMENT_COUNT = 7;
export const MAX_SEEDS = 96;
export const MAX_CLUSTERS = 12;
export const MAX_FILAMENTS = 14;
export const MAX_ALIENS = 5;

export const NEIGHBOR_RADIUS = 132;
export const CAMERA_MIN_ZOOM = 0.42;
export const CAMERA_MAX_ZOOM = 2.85;
export const CAMERA_ZOOM_SPEED = 0.00115;
export const CAMERA_PAN_SPEED = 420;
export const CAMERA_SMOOTHING = 0.12;

export const HUD_REFRESH_RATE = 6;
export const ZONE_GRID_COLS = 10;
export const ZONE_GRID_ROWS = 6;
export const TOOL_RADIUS = 118;

export const TIME_SCALE_SLOW = 0.5;
export const TIME_SCALE_FAST = 2;

export const TOOLS = ['observe', 'grow', 'feed', 'repel', 'disrupt'] as const;
export type ToolType = (typeof TOOLS)[number];

export const ENTITY_TYPES = ['seed', 'cluster', 'filament', 'alien'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ZONE_TYPES = ['drift', 'resonant', 'fertile', 'unstable'] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];
