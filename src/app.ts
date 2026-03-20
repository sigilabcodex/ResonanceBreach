import { CAMERA_MAX_ZOOM, CAMERA_MIN_ZOOM, CAMERA_SMOOTHING, CAMERA_ZOOM_SPEED, FIXED_TIMESTEP, MAX_FRAME_DELTA, WORLD_HEIGHT, WORLD_WIDTH, type ToolType } from './config';
import { AudioEngine } from './audio/audioEngine';
import { PlayerInput } from './input/playerInput';
import { Renderer } from './render/renderer';
import { Simulation } from './sim/simulation';
import type { CameraState } from './sim/types';
import { Hud } from './ui/hud';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class App {
  private readonly simulation = new Simulation();
  private readonly renderer: Renderer;
  private readonly audio = new AudioEngine();
  private readonly hud = new Hud((tool) => this.selectTool(tool));
  private readonly input: PlayerInput;
  private readonly camera: CameraState = {
    center: { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 },
    zoom: 1,
  };
  private readonly cameraTarget: CameraState = {
    center: { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 },
    zoom: 1,
  };
  private accumulator = 0;
  private lastTime = 0;
  private animationFrame = 0;

  constructor(mount: HTMLElement) {
    mount.innerHTML = `
      <div class="shell">
        <canvas class="sim-canvas"></canvas>
      </div>
    `;

    const canvas = mount.querySelector('canvas');
    if (!canvas) {
      throw new Error('Canvas not created.');
    }

    this.renderer = new Renderer(canvas);
    this.hud.attach(mount);
    this.simulation.setCamera(this.camera.center.x, this.camera.center.y, this.camera.zoom);

    this.input = new PlayerInput(canvas, {
      onTool: (active, x, y) => this.simulation.setToolEngaged(active, x, y),
      onToolHover: (x, y) => this.simulation.hoverTool(x, y),
      onInteract: () => {
        void this.audio.ensureStarted();
      },
      onRestart: () => this.restart(),
      onPan: (deltaX, deltaY) => this.panCamera(deltaX, deltaY),
      onZoom: (deltaY, clientX, clientY) => this.zoomCamera(deltaY, clientX, clientY, canvas),
      onSelectTool: (tool) => this.selectTool(tool),
      getCamera: () => this.camera,
    });

    this.hud.restartButton.addEventListener('click', () => this.restart());
    window.addEventListener('resize', this.handleResize);
  }

  start(): void {
    this.lastTime = performance.now();
    this.animationFrame = window.requestAnimationFrame(this.frame);
  }

  dispose(): void {
    window.cancelAnimationFrame(this.animationFrame);
    window.removeEventListener('resize', this.handleResize);
    this.input.dispose();
  }

  private restart(): void {
    this.simulation.reset();
    this.camera.center.x = WORLD_WIDTH / 2;
    this.camera.center.y = WORLD_HEIGHT / 2;
    this.camera.zoom = 1;
    this.cameraTarget.center.x = WORLD_WIDTH / 2;
    this.cameraTarget.center.y = WORLD_HEIGHT / 2;
    this.cameraTarget.zoom = 1;
    this.simulation.setCamera(this.camera.center.x, this.camera.center.y, this.camera.zoom);
  }

  private selectTool(tool: ToolType): void {
    this.simulation.setTool(tool);
    void this.audio.ensureStarted();
  }

  private handleResize = (): void => {
    this.renderer.resize();
  };

  private panCamera(deltaX: number, deltaY: number): void {
    this.cameraTarget.center.x = clamp(this.cameraTarget.center.x + deltaX, 0, WORLD_WIDTH);
    this.cameraTarget.center.y = clamp(this.cameraTarget.center.y + deltaY, 0, WORLD_HEIGHT);
  }

  private zoomCamera(deltaY: number, clientX: number, clientY: number, canvas: HTMLCanvasElement): void {
    const rect = canvas.getBoundingClientRect();
    const baseScale = Math.min(rect.width / WORLD_WIDTH, rect.height / WORLD_HEIGHT);
    const beforeScale = baseScale * this.cameraTarget.zoom;
    const worldX = this.cameraTarget.center.x + (clientX - rect.left - rect.width * 0.5) / beforeScale;
    const worldY = this.cameraTarget.center.y + (clientY - rect.top - rect.height * 0.5) / beforeScale;
    const newZoom = clamp(this.cameraTarget.zoom * (1 - deltaY * CAMERA_ZOOM_SPEED), CAMERA_MIN_ZOOM, CAMERA_MAX_ZOOM);
    const afterScale = baseScale * newZoom;

    this.cameraTarget.zoom = newZoom;
    this.cameraTarget.center.x = clamp(worldX - (clientX - rect.left - rect.width * 0.5) / afterScale, 0, WORLD_WIDTH);
    this.cameraTarget.center.y = clamp(worldY - (clientY - rect.top - rect.height * 0.5) / afterScale, 0, WORLD_HEIGHT);
  }

  private syncCamera(): void {
    this.camera.center.x = lerp(this.camera.center.x, this.cameraTarget.center.x, CAMERA_SMOOTHING);
    this.camera.center.y = lerp(this.camera.center.y, this.cameraTarget.center.y, CAMERA_SMOOTHING);
    this.camera.zoom = lerp(this.camera.zoom, this.cameraTarget.zoom, CAMERA_SMOOTHING);
    this.simulation.setCamera(this.camera.center.x, this.camera.center.y, this.camera.zoom);
  }

  private frame = (timestamp: number): void => {
    const rawDelta = Math.min(MAX_FRAME_DELTA, (timestamp - this.lastTime) / 1000 || FIXED_TIMESTEP);
    this.lastTime = timestamp;

    this.input.update(rawDelta);
    this.syncCamera();

    const timeScale = this.input.getTimeScale();
    this.simulation.setTimeScale(timeScale);
    this.accumulator += rawDelta * timeScale;

    while (this.accumulator >= FIXED_TIMESTEP) {
      this.simulation.update(FIXED_TIMESTEP);
      this.accumulator -= FIXED_TIMESTEP;
    }

    const snapshot = this.simulation.getSnapshot();
    this.audio.update(snapshot);
    this.hud.update(snapshot);
    this.renderer.render(snapshot);

    this.animationFrame = window.requestAnimationFrame(this.frame);
  };
}
