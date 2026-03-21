import { ENERGY_MAX, ENERGY_START, TOOL_RADIUS, WORLD_HEIGHT, WORLD_WIDTH } from '../config';
import type { AttentionState, CameraState, GardenStats, ToolState, WorldState } from '../types/world';

export const createDefaultCamera = (): CameraState => ({
  center: { x: WORLD_WIDTH * 0.5, y: WORLD_HEIGHT * 0.5 },
  zoom: 1,
});

export const createDefaultToolState = (): ToolState => ({
  active: 'observe',
  unlocked: ['observe', 'grow'],
  pulse: 0,
  worldPosition: { x: WORLD_WIDTH * 0.5, y: WORLD_HEIGHT * 0.5 },
  radius: TOOL_RADIUS.observe,
  strength: 0,
  visible: false,
  blocked: false,
});


export const createDefaultAttentionState = (): AttentionState => ({
  mode: 'none',
  entityId: null,
  position: { x: WORLD_WIDTH * 0.5, y: WORLD_HEIGHT * 0.5 },
  radius: TOOL_RADIUS.observe,
  strength: 0,
  relatedEntityIds: [],
  dragging: false,
  dragStart: null,
  dragCurrent: null,
});

export const createDefaultStats = (): GardenStats => ({
  harmony: 0.54,
  activity: 0.22,
  threat: 0.08,
  growth: 0.38,
  energy: ENERGY_START / ENERGY_MAX,
  stability: 0.68,
  biodiversity: 0.42,
  focus: 0,
  nutrients: 0.3,
  fruit: 0.18,
});

export const createWorldState = (): WorldState => ({
  dimensions: {
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    wrapped: true,
  },
  entities: [],
  terrain: [],
  attractors: [],
  fields: [],
  particles: [],
  residues: [],
  bursts: [],
  stats: createDefaultStats(),
  tool: createDefaultToolState(),
  attention: createDefaultAttentionState(),
  camera: createDefaultCamera(),
  time: 0,
  timeScale: 1,
  unlockedProgress: 0,
  energy: ENERGY_START,
  events: [],
  notifications: { recent: [] },
});
