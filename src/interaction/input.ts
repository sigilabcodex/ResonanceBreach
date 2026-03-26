import { CAMERA_PAN_SPEED, WORLD_HEIGHT, WORLD_WIDTH, type ToolType } from '../config';
import type { CameraState } from '../types/world';

const wrap = (value: number, size: number) => ((value % size) + size) % size;

export interface InputCallbacks {
  onTool(active: boolean, x: number, y: number): void;
  onToolHover(x: number, y: number): void;
  onInteract(): void;
  onRestart(): void;
  onToggleDebugOverlay(): void;
  onPan(deltaX: number, deltaY: number): void;
  onZoom(deltaY: number, clientX: number, clientY: number): void;
  onSelectTool(tool: ToolType): void;
  onToggleMinimalHud(): void;
  onToggleSettings(): void;
  onCycleInterpretationMode(): void;
  getCamera(): CameraState;
}

export class PlayerInput {
  private toolPointerId: number | null = null;
  private panPointerId: number | null = null;
  private lastPan = { x: 0, y: 0 };
  private lastToolStamp = { x: 0, y: 0 };
  private readonly keys = new Set<string>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: InputCallbacks,
  ) {
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerUp);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.handleContextMenu);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerUp);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
  }

  update(dt: number): void {
    let x = 0;
    let y = 0;

    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) y -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y += 1;

    if (x !== 0 || y !== 0) {
      const length = Math.hypot(x, y) || 1;
      this.callbacks.onPan((x / length) * CAMERA_PAN_SPEED * dt, (y / length) * CAMERA_PAN_SPEED * dt);
    }
  }

  getTimeScale(): number {
    const slow = this.keys.has('shift');
    const fast = this.keys.has(' ');
    if (slow && !fast) return 0.5;
    if (fast && !slow) return 2;
    return 1;
  }

  private handlePointerDown = (event: PointerEvent): void => {
    this.callbacks.onInteract();
    if (event.button === 2 || event.button === 1) {
      this.panPointerId = event.pointerId;
      this.lastPan = { x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }

    if (event.button !== 0) return;
    this.toolPointerId = event.pointerId;
    this.canvas.setPointerCapture(event.pointerId);
    const point = this.project(event.clientX, event.clientY);
    this.lastToolStamp = point;
    this.callbacks.onTool(true, point.x, point.y);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    const point = this.project(event.clientX, event.clientY);
    this.callbacks.onToolHover(point.x, point.y);

    if (this.panPointerId === event.pointerId) {
      const camera = this.callbacks.getCamera();
      const rect = this.canvas.getBoundingClientRect();
      const scale = Math.max(rect.width / WORLD_WIDTH, rect.height / WORLD_HEIGHT) * camera.zoom;
      const dx = event.clientX - this.lastPan.x;
      const dy = event.clientY - this.lastPan.y;
      this.lastPan = { x: event.clientX, y: event.clientY };
      this.callbacks.onPan(-dx / scale, -dy / scale);
      return;
    }

    if (this.toolPointerId !== event.pointerId) return;
    const dist = Math.hypot(point.x - this.lastToolStamp.x, point.y - this.lastToolStamp.y);
    if (dist > 72) {
      this.lastToolStamp = point;
      this.callbacks.onTool(true, point.x, point.y);
    }
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (this.panPointerId === event.pointerId) {
      this.panPointerId = null;
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      return;
    }

    if (this.toolPointerId !== event.pointerId) return;
    this.toolPointerId = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    const point = this.project(event.clientX, event.clientY);
    this.callbacks.onTool(false, point.x, point.y);
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (key === 'r') {
      this.callbacks.onRestart();
      return;
    }

    if (key === 'h') {
      event.preventDefault();
      this.callbacks.onToggleMinimalHud();
      return;
    }

    if (key === 'f3' || key === '`') {
      event.preventDefault();
      this.callbacks.onToggleDebugOverlay();
      return;
    }

    if (key === 'o') {
      event.preventDefault();
      this.callbacks.onToggleSettings();
      this.callbacks.onInteract();
      return;
    }

    if (key === 'm') {
      event.preventDefault();
      this.callbacks.onCycleInterpretationMode();
      this.callbacks.onInteract();
      return;
    }

    const toolMap: Record<string, ToolType> = {
      '1': 'observe',
      '2': 'grow',
      '3': 'feed',
      '4': 'repel',
      '5': 'disrupt',
    };

    if (toolMap[key]) {
      this.callbacks.onSelectTool(toolMap[key]);
      this.callbacks.onInteract();
      return;
    }

    this.keys.add(key);
    this.callbacks.onInteract();
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.callbacks.onInteract();
    this.callbacks.onZoom(event.deltaY, event.clientX, event.clientY);
  };

  private handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private handlePointerLeave = (): void => {
    if (this.toolPointerId === null) {
      this.callbacks.onToolHover(-1, -1);
      this.callbacks.onTool(false, -1, -1);
    }
  };

  private project(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const camera = this.callbacks.getCamera();
    const scale = Math.max(rect.width / WORLD_WIDTH, rect.height / WORLD_HEIGHT) * camera.zoom;
    const offsetX = rect.width * 0.5 - camera.center.x * scale;
    const offsetY = rect.height * 0.5 - camera.center.y * scale;

    return {
      x: wrap((clientX - rect.left - offsetX) / scale, WORLD_WIDTH),
      y: wrap((clientY - rect.top - offsetY) / scale, WORLD_HEIGHT),
    };
  }
}
