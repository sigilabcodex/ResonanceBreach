export const GAME_TITLE = 'Resonance Garden';
export const WORLD_WIDTH = 3600;
export const WORLD_HEIGHT = 2400;

export const FIXED_TIMESTEP = 1 / 60;
export const MAX_FRAME_DELTA = 0.1;

export const INITIAL_FLOCKER_COUNT = 12;
export const INITIAL_CLUSTER_COUNT = 8;
export const INITIAL_PLANT_COUNT = 14;
export const INITIAL_EPHEMERAL_COUNT = 10;
export const INITIAL_CANOPY_COUNT = 5;
export const INITIAL_GRAZER_COUNT = 8;
export const INITIAL_PARASITE_COUNT = 4;
export const INITIAL_PREDATOR_COUNT = 0;

export const MAX_FLOCKERS = 28;
export const MAX_CLUSTERS = 20;
export const MAX_PLANTS = 42;
export const MAX_EPHEMERALS = 28;
export const MAX_CANOPIES = 14;
export const MAX_GRAZERS = 18;
export const MAX_PARASITES = 12;
export const MAX_PREDATORS = 0;

export const NEIGHBOR_RADIUS = 164;
export const CAMERA_MIN_ZOOM = 0.24;
export const CAMERA_MAX_ZOOM = 2.4;
export const CAMERA_ZOOM_SPEED = 0.0011;
export const CAMERA_PAN_SPEED = 680;
export const CAMERA_SMOOTHING = 0.12;

export const TERRAIN_SAMPLE_COLS = 22;
export const TERRAIN_SAMPLE_ROWS = 14;
export const ATTRACTOR_COUNT = 4;
export const BASE_TOOL_RADIUS = 136;
export const SOFT_BOUNDARY_MARGIN = 220;

export const TIME_SCALE_SLOW = 0.5;
export const TIME_SCALE_FAST = 2;

export const ENERGY_MAX = 120;
export const ENERGY_START = 48;

export const TOOLS = ['observe', 'grow', 'feed', 'repel', 'disrupt'] as const;
export type ToolType = (typeof TOOLS)[number];

export const TOOL_ENERGY_COST: Record<ToolType, number> = {
  observe: 0,
  grow: 8,
  feed: 10,
  repel: 10,
  disrupt: 15,
};

export const TOOL_DURATION: Record<ToolType, number> = {
  observe: 9999,
  grow: 8,
  feed: 4.8,
  repel: 3.2,
  disrupt: 5.4,
};

export const TOOL_RADIUS: Record<ToolType, number> = {
  observe: 170,
  grow: 200,
  feed: 178,
  repel: 190,
  disrupt: 188,
};

export const ENTITY_TYPES = ['flocker', 'cluster', 'plant', 'ephemeral', 'canopy', 'grazer', 'parasite', 'predator'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const TERRAIN_TYPES = ['water', 'fertile', 'dense', 'solid'] as const;
export type TerrainType = (typeof TERRAIN_TYPES)[number];

export const HABITAT_TYPES = ['wetland', 'highland', 'basin'] as const;
export type HabitatType = (typeof HABITAT_TYPES)[number];

export const LIFECYCLE_STAGES = ['birth', 'growth', 'mature', 'decay'] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];
