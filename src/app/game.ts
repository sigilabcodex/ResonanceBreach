import { CAMERA_MAX_ZOOM, CAMERA_MIN_ZOOM, CAMERA_SMOOTHING, CAMERA_ZOOM_SPEED, FIXED_TIMESTEP, MAX_FRAME_DELTA, WORLD_HEIGHT, WORLD_WIDTH, type ToolType } from '../config';
import { AudioEngine } from '../audio/audioEngine';
import { PlayerInput } from '../interaction/input';
import { Renderer } from '../render/renderer';
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, storeSettings, type GameSettings } from '../settings';
import { Simulation } from '../sim/simulation';
import type { CameraState } from '../types/world';
import { Hud } from '../ui/hud';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const wrap = (value: number, size: number) => ((value % size) + size) % size;

export class App {
  private readonly simulation = new Simulation();
  private readonly renderer: Renderer;
  private readonly audio = new AudioEngine();
  private readonly hud: Hud;
  private readonly input: PlayerInput;
  private readonly camera: CameraState = {
    center: { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 },
    zoom: 1,
  };
  private readonly cameraTarget: CameraState = {
    center: { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 },
    zoom: 1,
  };
  private settings: GameSettings = DEFAULT_SETTINGS;
  private accumulator = 0;
  private lastTime = 0;
  private animationFrame = 0;

  constructor(mount: HTMLElement) {
    this.settings = normalizeSettings(loadSettings());
    this.hud = new Hud((tool) => this.selectTool(tool), (settings) => this.applySettings(settings), this.settings);

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
      onToggleHud: () => this.hud.toggleHudHidden(),
      onToggleSettings: () => this.hud.toggleSettings(),
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

  private applySettings(settings: GameSettings): void {
    this.settings = normalizeSettings(settings);
    storeSettings(this.settings);
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
    this.cameraTarget.center.x = wrap(this.cameraTarget.center.x + deltaX, WORLD_WIDTH);
    this.cameraTarget.center.y = wrap(this.cameraTarget.center.y + deltaY, WORLD_HEIGHT);
  }

  private zoomCamera(deltaY: number, clientX: number, clientY: number, canvas: HTMLCanvasElement): void {
    const rect = canvas.getBoundingClientRect();
    const baseScale = Math.max(rect.width / WORLD_WIDTH, rect.height / WORLD_HEIGHT);
    const beforeScale = baseScale * this.cameraTarget.zoom;
    const worldX = this.cameraTarget.center.x + (clientX - rect.left - rect.width * 0.5) / beforeScale;
    const worldY = this.cameraTarget.center.y + (clientY - rect.top - rect.height * 0.5) / beforeScale;
    const newZoom = clamp(this.cameraTarget.zoom * (1 - deltaY * CAMERA_ZOOM_SPEED), CAMERA_MIN_ZOOM, CAMERA_MAX_ZOOM);
    const afterScale = baseScale * newZoom;

    this.cameraTarget.zoom = newZoom;
    this.cameraTarget.center.x = wrap(worldX - (clientX - rect.left - rect.width * 0.5) / afterScale, WORLD_WIDTH);
    this.cameraTarget.center.y = wrap(worldY - (clientY - rect.top - rect.height * 0.5) / afterScale, WORLD_HEIGHT);
  }

  private updateAttentionCameraTarget(): void {
    const followTarget = this.simulation.getCameraFollowTarget();
    if (!followTarget) return;

    const deltaX = ((((followTarget.x - this.cameraTarget.center.x) % WORLD_WIDTH) + WORLD_WIDTH * 1.5) % WORLD_WIDTH) - WORLD_WIDTH * 0.5;
    const deltaY = ((((followTarget.y - this.cameraTarget.center.y) % WORLD_HEIGHT) + WORLD_HEIGHT * 1.5) % WORLD_HEIGHT) - WORLD_HEIGHT * 0.5;
    this.cameraTarget.center.x = wrap(this.cameraTarget.center.x + deltaX * 0.08, WORLD_WIDTH);
    this.cameraTarget.center.y = wrap(this.cameraTarget.center.y + deltaY * 0.08, WORLD_HEIGHT);
  }

  private syncCamera(): void {
    const deltaX = ((((this.cameraTarget.center.x - this.camera.center.x) % WORLD_WIDTH) + WORLD_WIDTH * 1.5) % WORLD_WIDTH) - WORLD_WIDTH * 0.5;
    const deltaY = ((((this.cameraTarget.center.y - this.camera.center.y) % WORLD_HEIGHT) + WORLD_HEIGHT * 1.5) % WORLD_HEIGHT) - WORLD_HEIGHT * 0.5;
    this.camera.center.x = wrap(this.camera.center.x + deltaX * CAMERA_SMOOTHING, WORLD_WIDTH);
    this.camera.center.y = wrap(this.camera.center.y + deltaY * CAMERA_SMOOTHING, WORLD_HEIGHT);
    this.camera.zoom = lerp(this.camera.zoom, this.cameraTarget.zoom, CAMERA_SMOOTHING);
    this.simulation.setCamera(this.camera.center.x, this.camera.center.y, this.camera.zoom);
  }

  private frame = (timestamp: number): void => {
    const rawDelta = Math.min(MAX_FRAME_DELTA, (timestamp - this.lastTime) / 1000 || FIXED_TIMESTEP);
    this.lastTime = timestamp;

    this.input.update(rawDelta);

    const timeScale = this.input.getTimeScale();
    this.simulation.setTimeScale(timeScale);
    this.accumulator += rawDelta * timeScale;

    while (this.accumulator >= FIXED_TIMESTEP) {
      this.simulation.update(FIXED_TIMESTEP);
      this.accumulator -= FIXED_TIMESTEP;
    }

    this.updateAttentionCameraTarget();
    this.syncCamera();

    const snapshot = this.simulation.getSnapshot();
    this.audio.update(snapshot, this.settings);
    this.hud.update(snapshot);
    this.renderer.render(snapshot, this.settings, this.audio.getDebugState());

    this.animationFrame = window.requestAnimationFrame(this.frame);
  };
}
