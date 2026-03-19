import { WORLD_HEIGHT, WORLD_WIDTH } from '../config';

export interface InputCallbacks {
  onZone(active: boolean, x: number, y: number): void;
  onInteract(): void;
  onRestart(): void;
}

export class PlayerInput {
  private pointerActive = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: InputCallbacks,
  ) {
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerUp);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerUp);
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  private handlePointerDown = (event: PointerEvent): void => {
    this.pointerActive = true;
    this.canvas.setPointerCapture(event.pointerId);
    this.callbacks.onInteract();
    const point = this.project(event);
    this.callbacks.onZone(true, point.x, point.y);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.pointerActive) return;
    const point = this.project(event);
    this.callbacks.onZone(true, point.x, point.y);
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (!this.pointerActive) return;
    this.pointerActive = false;
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    const point = this.project(event);
    this.callbacks.onZone(false, point.x, point.y);
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key.toLowerCase() === 'r') {
      this.callbacks.onRestart();
      return;
    }

    this.callbacks.onInteract();
  };

  private project(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / WORLD_WIDTH, rect.height / WORLD_HEIGHT);
    const offsetX = (rect.width - WORLD_WIDTH * scale) * 0.5;
    const offsetY = (rect.height - WORLD_HEIGHT * scale) * 0.5;

    return {
      x: Math.max(0, Math.min(WORLD_WIDTH, (event.clientX - rect.left - offsetX) / scale)),
      y: Math.max(0, Math.min(WORLD_HEIGHT, (event.clientY - rect.top - offsetY) / scale)),
    };
  }
}
