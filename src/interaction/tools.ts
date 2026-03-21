import type { ToolType } from '../config';

export interface ToolDefinition {
  id: ToolType;
  label: string;
  description: string;
}

export const TOOL_DEFINITIONS: Record<ToolType, ToolDefinition> = {
  observe: {
    id: 'observe',
    label: 'ATTENTION',
    description: 'Click an entity to follow it or drag to define a listening region',
  },
  grow: {
    id: 'grow',
    label: 'Grow',
    description: 'Persistent fertility field that supports Rooted Bloom growth and local nutrient recovery',
  },
  feed: {
    id: 'feed',
    label: 'Feed',
    description: 'Release visible food particles that creatures can consume',
  },
  repel: {
    id: 'repel',
    label: 'Repel',
    description: 'A gentle wave that opens breathing room without chaos',
  },
  disrupt: {
    id: 'disrupt',
    label: 'Disrupt',
    description: 'Delayed charge that bursts outward, removes some life, and scars terrain',
  },
};
