import { CAMERA_PAN_SPEED, WORLD_HEIGHT, WORLD_WIDTH } from '../config';
import type { CameraState } from '../types/world';

const wrap = (value: number, size: number) => ((value % size) + size) % size;
const DRAG_THRESHOLD = 28;

export type GestureButton = 'primary' | 'alternate';

export interface InputCallbacks {
  onGestureStart(button: GestureButton, x: number, y: number): void;
  onGestureMove(button: GestureButton, x: number, y: number, dragDistance: number, holdSeconds: number): void;
  onGestureEnd(button: GestureButton, x: number, y: number, gesture: 'tap' | 'hold' | 'drag', dragDistance: number, holdSeconds: number): void;
  onToolHover(x: number, y: number): void;
  onInteract(): void;
  onRestart(): void;
  onToggleDebugOverlay(): void;
  onPan(deltaX: number, deltaY: number): void;
  onZoom(deltaY: number, clientX: number, clientY: number): void;
  onToggleMinimalHud(): void;
  onToggleSettings(): void;
  onCycleInterpretationMode(): void;
  getCamera(): CameraState;
}

export class PlayerInput {
  private gesturePointerId: number | null = null;
  private gestureButton: GestureButton = 'primary';
  private panPointerId: number | null = null;
  private lastPan = { x: 0, y: 0 };
  private gestureStart = { x: 0, y: 0 };
  private gestureStartedAt = 0;
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

    if (event.button === 1) {
      this.panPointerId = event.pointerId;
      this.lastPan = { x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }

    const gestureButton: GestureButton = event.button === 2 || (event.button === 0 && event.shiftKey) ? 'alternate' : 'primary';
    if (event.button !== 0 && event.button !== 2) return;

    this.gesturePointerId = event.pointerId;
    this.gestureButton = gestureButton;
    this.canvas.setPointerCapture(event.pointerId);
    const point = this.project(event.clientX, event.clientY);
    this.gestureStart = point;
    this.gestureStartedAt = performance.now();
    this.callbacks.onGestureStart(gestureButton, point.x, point.y);
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

    if (this.gesturePointerId !== event.pointerId) return;
    const dragDistance = Math.hypot(point.x - this.gestureStart.x, point.y - this.gestureStart.y);
    const holdSeconds = (performance.now() - this.gestureStartedAt) / 1000;
    this.callbacks.onGestureMove(this.gestureButton, point.x, point.y, dragDistance, holdSeconds);
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (this.panPointerId === event.pointerId) {
      this.panPointerId = null;
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      return;
    }

    if (this.gesturePointerId !== event.pointerId) return;
    const point = this.project(event.clientX, event.clientY);
    const dragDistance = Math.hypot(point.x - this.gestureStart.x, point.y - this.gestureStart.y);
    const holdSeconds = (performance.now() - this.gestureStartedAt) / 1000;
    const gesture = dragDistance >= DRAG_THRESHOLD ? 'drag' : holdSeconds >= 0.24 ? 'hold' : 'tap';
    this.callbacks.onGestureEnd(this.gestureButton, point.x, point.y, gesture, dragDistance, holdSeconds);
    this.gesturePointerId = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
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
    if (this.gesturePointerId === null) {
      this.callbacks.onToolHover(-1, -1);
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
