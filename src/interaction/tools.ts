import type { ToolType } from '../config';

export interface ToolDefinition {
  id: ToolType;
  label: string;
  description: string;
}

export const TOOL_DEFINITIONS: Record<ToolType, ToolDefinition> = {
  observe: {
    id: 'observe',
    label: 'Resonance Focus',
    description: 'Hold to isolate a quiet local pocket of sound and motion',
  },
  grow: {
    id: 'grow',
    label: 'Grow',
    description: 'Persistent fertility field that supports slow plant expansion',
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
