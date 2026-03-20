export const GAME_TITLE = 'Resonance Garden';
export const WORLD_WIDTH = 2400;
export const WORLD_HEIGHT = 1600;

export const FIXED_TIMESTEP = 1 / 60;
export const MAX_FRAME_DELTA = 0.1;

export const INITIAL_FLOCKER_COUNT = 42;
export const INITIAL_CLUSTER_COUNT = 18;
export const INITIAL_PLANT_COUNT = 34;
export const INITIAL_PREDATOR_COUNT = 5;

export const MAX_FLOCKERS = 120;
export const MAX_CLUSTERS = 72;
export const MAX_PLANTS = 120;
export const MAX_PREDATORS = 10;

export const NEIGHBOR_RADIUS = 156;
export const CAMERA_MIN_ZOOM = 0.32;
export const CAMERA_MAX_ZOOM = 2.8;
export const CAMERA_ZOOM_SPEED = 0.0011;
export const CAMERA_PAN_SPEED = 680;
export const CAMERA_SMOOTHING = 0.12;

export const TERRAIN_SAMPLE_COLS = 18;
export const TERRAIN_SAMPLE_ROWS = 12;
export const ATTRACTOR_COUNT = 5;
export const BASE_TOOL_RADIUS = 136;
export const SOFT_BOUNDARY_MARGIN = 180;

export const TIME_SCALE_SLOW = 0.5;
export const TIME_SCALE_FAST = 2;

export const ENERGY_MAX = 120;
export const ENERGY_START = 42;

export const TOOLS = ['observe', 'grow', 'feed', 'repel', 'disrupt'] as const;
export type ToolType = (typeof TOOLS)[number];

export const TOOL_ENERGY_COST: Record<ToolType, number> = {
  observe: 0,
  grow: 8,
  feed: 12,
  repel: 10,
  disrupt: 14,
};

export const TOOL_DURATION: Record<ToolType, number> = {
  observe: 7.5,
  grow: 5.2,
  feed: 5.8,
  repel: 2.6,
  disrupt: 4.8,
};

export const TOOL_RADIUS: Record<ToolType, number> = {
  observe: 150,
  grow: 170,
  feed: 160,
  repel: 180,
  disrupt: 176,
};

export const ENTITY_TYPES = ['flocker', 'cluster', 'plant', 'predator'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const TERRAIN_TYPES = ['fluid', 'dense', 'hard'] as const;
export type TerrainType = (typeof TERRAIN_TYPES)[number];

export const LIFECYCLE_STAGES = ['birth', 'growth', 'mature', 'decay'] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];
