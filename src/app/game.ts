import { CAMERA_MAX_ZOOM, CAMERA_MIN_ZOOM, CAMERA_SMOOTHING, CAMERA_ZOOM_SPEED, FIXED_TIMESTEP, MAX_FRAME_DELTA, WORLD_HEIGHT, WORLD_WIDTH, type ToolType } from '../config';
import { AudioEngine } from '../audio/audioEngine';
import { PlayerInput } from '../interaction/input';
import { Renderer } from '../render/renderer';
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, storeSettings, type GameSettings } from '../settings';
import { Simulation } from '../sim/simulation';
import type { CameraState, PerformanceStats, SimulationSnapshot, TerrainCell, Vec2 } from '../types/world';
import { Hud } from '../ui/hud';
import type { MusicalInterpretationMode } from '../audio/musicalInterpreter';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const wrap = (value: number, size: number) => ((value % size) + size) % size;
const MAX_SIM_STEPS_PER_FRAME = 3;
const MAX_ACCUMULATED_SIM_TIME = FIXED_TIMESTEP * MAX_SIM_STEPS_PER_FRAME;
const MAX_RETAINED_SIM_LAG = FIXED_TIMESTEP;

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
  private readonly followAnchor = {
    center: { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 },
  };
  private settings: GameSettings = DEFAULT_SETTINGS;
  private accumulator = 0;
  private lastTime = 0;
  private animationFrame = 0;
  private readonly perfStats: PerformanceStats = {
    fps: 0,
    frameTimeMs: 0,
    updateTimeMs: 0,
    renderTimeMs: 0,
    drawCallEstimate: 0,
    simSteps: 0,
    audioUpdateTimeMs: 0,
    simStepCapped: false,
    droppedSimTimeMs: 0,
    simAccumulatorMs: 0,
  };
  private fpsAccumulator = 0;
  private fpsFrameCount = 0;
  private followingSelection = false;
  private interpretationMode: MusicalInterpretationMode = 'raw';
  private latestSnapshot: SimulationSnapshot | null = null;
  private activeGesture: {
    button: 'primary' | 'alternate';
    startedAt: Vec2;
    mode: 'pending' | 'hold-observe' | 'drag-influence';
    lastStamp: Vec2;
  } | null = null;

  constructor(mount: HTMLElement) {
    this.settings = normalizeSettings(loadSettings());
    this.interpretationMode = this.settings.audio.interpretationMode;
    this.hud = new Hud((settings) => this.applySettings(settings), this.settings);
    this.audio.setInterpretationMode(this.interpretationMode);
    this.audio.setMusicification(this.settings.audio.musicificationAmount);
    this.audio.applyLiveSettings(this.settings);

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
      onGestureStart: (button, x, y) => this.handleGestureStart(button, x, y),
      onGestureMove: (button, x, y, dragDistance, holdSeconds) => this.handleGestureMove(button, x, y, dragDistance, holdSeconds),
      onGestureEnd: (button, x, y, gesture, dragDistance, holdSeconds) => this.handleGestureEnd(button, x, y, gesture, dragDistance, holdSeconds),
      onToolHover: (x, y) => this.simulation.hoverTool(x, y),
      onInteract: () => {
        void this.audio.ensureStarted();
      },
      onRestart: () => this.restart(),
      onToggleDebugOverlay: () => this.toggleDebugOverlay(),
      onPan: (deltaX, deltaY) => this.panCamera(deltaX, deltaY),
      onZoom: (deltaY, clientX, clientY) => this.zoomCamera(deltaY, clientX, clientY, canvas),
      onToggleMinimalHud: () => this.hud.toggleMinimalHud(),
      onToggleSettings: () => this.hud.toggleSettings(),
      onCycleInterpretationMode: () => this.cycleInterpretationMode(),
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
    this.interpretationMode = this.settings.audio.interpretationMode;
    this.audio.setInterpretationMode(this.interpretationMode);
    this.audio.setMusicification(this.settings.audio.musicificationAmount);
    this.audio.applyLiveSettings(this.settings);
    this.hud.syncSettings(this.settings);
    storeSettings(this.settings);
  }

  private restart(): void {
    this.simulation.reset();
    this.audio.reset();
    this.camera.center.x = WORLD_WIDTH / 2;
    this.camera.center.y = WORLD_HEIGHT / 2;
    this.camera.zoom = 1;
    this.cameraTarget.center.x = WORLD_WIDTH / 2;
    this.cameraTarget.center.y = WORLD_HEIGHT / 2;
    this.cameraTarget.zoom = 1;
    this.followAnchor.center.x = WORLD_WIDTH / 2;
    this.followAnchor.center.y = WORLD_HEIGHT / 2;
    this.followingSelection = false;
    this.audio.setInterpretationMode(this.interpretationMode);
    this.simulation.setCamera(this.camera.center.x, this.camera.center.y, this.camera.zoom);
  }

  private toggleDebugOverlay(): void {
    this.applySettings({
      ...this.settings,
      visuals: {
        ...this.settings.visuals,
        debugOverlays: !this.settings.visuals.debugOverlays,
      },
    });
  }

  private selectTool(tool: ToolType): void {
    this.simulation.setTool(tool);
    void this.audio.ensureStarted();
  }

  private handleGestureStart(button: 'primary' | 'alternate', x: number, y: number): void {
    this.activeGesture = {
      button,
      startedAt: { x, y },
      mode: 'pending',
      lastStamp: { x, y },
    };
    this.simulation.hoverTool(x, y);
  }

  private handleGestureMove(button: 'primary' | 'alternate', x: number, y: number, dragDistance: number, holdSeconds: number): void {
    if (!this.activeGesture || this.activeGesture.button !== button) return;

    if (button === 'primary' && this.activeGesture.mode === 'pending' && holdSeconds >= 0.24 && dragDistance < 28) {
      this.activeGesture.mode = 'hold-observe';
      this.selectTool('observe');
      this.simulation.setToolEngaged(true, this.activeGesture.startedAt.x, this.activeGesture.startedAt.y);
    }

    if (dragDistance >= 28 && this.activeGesture.mode !== 'drag-influence') {
      if (this.activeGesture.mode === 'hold-observe') {
        this.simulation.setToolEngaged(false, x, y);
      }
      this.activeGesture.mode = 'drag-influence';
      this.activeGesture.lastStamp = { x, y };
      const dragTool = button === 'alternate' ? this.pickAvailableTool(['repel', 'disrupt']) : this.pickAvailableTool(['repel', 'grow']);
      this.selectTool(dragTool);
      this.simulation.setToolEngaged(true, x, y);
      return;
    }

    if (this.activeGesture.mode === 'hold-observe') {
      this.simulation.setToolEngaged(true, x, y);
      return;
    }

    if (this.activeGesture.mode !== 'drag-influence') return;
    const distFromStamp = Math.hypot(x - this.activeGesture.lastStamp.x, y - this.activeGesture.lastStamp.y);
    if (distFromStamp >= 64) {
      const dragTool = button === 'alternate' ? this.pickAvailableTool(['repel', 'disrupt']) : this.pickAvailableTool(['repel', 'grow']);
      this.selectTool(dragTool);
      this.simulation.setToolEngaged(true, x, y);
      this.activeGesture.lastStamp = { x, y };
    }
  }

  private handleGestureEnd(
    button: 'primary' | 'alternate',
    x: number,
    y: number,
    gesture: 'tap' | 'hold' | 'drag',
    _dragDistance: number,
    _holdSeconds: number,
  ): void {
    if (!this.activeGesture || this.activeGesture.button !== button) return;

    if (this.activeGesture.mode === 'hold-observe' || gesture === 'hold') {
      this.selectTool('observe');
      this.simulation.setToolEngaged(false, x, y);
      this.activeGesture = null;
      return;
    }

    if (gesture === 'drag' || this.activeGesture.mode === 'drag-influence') {
      this.activeGesture = null;
      return;
    }

    const tool = button === 'alternate'
      ? this.pickAlternateTapTool({ x, y })
      : this.pickPrimaryTapTool({ x, y });
    this.selectTool(tool);
    this.simulation.setToolEngaged(true, x, y);
    this.simulation.setToolEngaged(false, x, y);
    this.activeGesture = null;
  }

  private pickPrimaryTapTool(position: Vec2): ToolType {
    const context = this.getInteractionContext(position);
    if (context.entityDensity > 0.3 || context.fruitDensity < 0.14) {
      return this.pickAvailableTool(['feed', 'grow', 'repel']);
    }
    if (context.fertility < 0.38) return this.pickAvailableTool(['grow', 'feed', 'repel']);
    return this.pickAvailableTool(['grow', 'feed', 'repel']);
  }

  private pickAlternateTapTool(position: Vec2): ToolType {
    const context = this.getInteractionContext(position);
    if (context.entityDensity > 0.34 || context.threat > 0.36) {
      return this.pickAvailableTool(['disrupt', 'repel', 'feed']);
    }
    return this.pickAvailableTool(['repel', 'disrupt', 'feed']);
  }

  private pickAvailableTool(preferences: ToolType[]): ToolType {
    const unlocked = this.latestSnapshot?.tool.unlocked ?? ['observe', 'grow'];
    const found = preferences.find((tool) => unlocked.includes(tool));
    return found ?? (unlocked[0] ?? 'observe');
  }

  private getInteractionContext(position: Vec2): {
    entityDensity: number;
    fruitDensity: number;
    fertility: number;
    threat: number;
  } {
    const snapshot = this.latestSnapshot;
    if (!snapshot) {
      return { entityDensity: 0, fruitDensity: 0, fertility: 0.5, threat: 0 };
    }

    const radius = 230;
    const nearbyEntities = snapshot.entities.filter((entity) => {
      const deltaX = this.wrappedDelta(position.x, entity.position.x, WORLD_WIDTH);
      const deltaY = this.wrappedDelta(position.y, entity.position.y, WORLD_HEIGHT);
      return Math.hypot(deltaX, deltaY) <= radius;
    }).length;
    const nearbyFood = snapshot.particles.filter((particle) => {
      const deltaX = this.wrappedDelta(position.x, particle.position.x, WORLD_WIDTH);
      const deltaY = this.wrappedDelta(position.y, particle.position.y, WORLD_HEIGHT);
      return Math.hypot(deltaX, deltaY) <= radius;
    }).length;
    const nearestTerrain = this.findNearestTerrainCell(snapshot.terrain, position);

    return {
      entityDensity: clamp(nearbyEntities / 18, 0, 1),
      fruitDensity: clamp(nearbyFood / 14, 0, 1),
      fertility: nearestTerrain?.fertility ?? snapshot.stats.growth,
      threat: snapshot.stats.threat,
    };
  }

  private findNearestTerrainCell(cells: TerrainCell[], position: Vec2): TerrainCell | null {
    let bestCell: TerrainCell | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const cell of cells) {
      const deltaX = this.wrappedDelta(position.x, cell.center.x, WORLD_WIDTH);
      const deltaY = this.wrappedDelta(position.y, cell.center.y, WORLD_HEIGHT);
      const dist = Math.hypot(deltaX, deltaY);
      if (dist < bestDist) {
        bestDist = dist;
        bestCell = cell;
      }
    }
    return bestCell;
  }

  private cycleInterpretationMode(): void {
    const order: MusicalInterpretationMode[] = ['raw', 'hybrid', 'musical'];
    const currentIndex = order.indexOf(this.interpretationMode);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % order.length : 0;
    this.interpretationMode = order[nextIndex];
    this.applySettings({
      ...this.settings,
      audio: {
        ...this.settings.audio,
        interpretationMode: this.interpretationMode,
      },
    });
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
    const zoomFactor = Math.exp(-deltaY * CAMERA_ZOOM_SPEED);
    const newZoom = clamp(this.cameraTarget.zoom * zoomFactor, CAMERA_MIN_ZOOM, CAMERA_MAX_ZOOM);
    const afterScale = baseScale * newZoom;

    this.cameraTarget.zoom = newZoom;
    this.cameraTarget.center.x = wrap(worldX - (clientX - rect.left - rect.width * 0.5) / afterScale, WORLD_WIDTH);
    this.cameraTarget.center.y = wrap(worldY - (clientY - rect.top - rect.height * 0.5) / afterScale, WORLD_HEIGHT);
  }

  private wrappedDelta(from: number, to: number, size: number): number {
    return ((((to - from) % size) + size * 1.5) % size) - size * 0.5;
  }

  private updateAttentionCameraTarget(dt: number): void {
    const followTarget = this.simulation.getCameraFollowTarget();
    if (!followTarget) {
      this.followingSelection = false;
      this.followAnchor.center.x = this.cameraTarget.center.x;
      this.followAnchor.center.y = this.cameraTarget.center.y;
      return;
    }

    if (!this.followingSelection) {
      this.followAnchor.center.x = this.cameraTarget.center.x;
      this.followAnchor.center.y = this.cameraTarget.center.y;
      this.followingSelection = true;
    }

    const anchorDeltaX = this.wrappedDelta(this.followAnchor.center.x, followTarget.x, WORLD_WIDTH);
    const anchorDeltaY = this.wrappedDelta(this.followAnchor.center.y, followTarget.y, WORLD_HEIGHT);
    const anchorDistance = Math.hypot(anchorDeltaX, anchorDeltaY);
    const deadZone = clamp(34 / Math.max(this.cameraTarget.zoom, 0.45), 18, 54);
    const anchorCatchup = clamp(dt * (anchorDistance > deadZone ? 4.6 : 2.2), 0.06, 0.18);
    const deadZoneFactor = anchorDistance > deadZone ? 1 : clamp(anchorDistance / Math.max(deadZone, 1), 0.18, 0.8);

    this.followAnchor.center.x = wrap(this.followAnchor.center.x + anchorDeltaX * anchorCatchup * deadZoneFactor, WORLD_WIDTH);
    this.followAnchor.center.y = wrap(this.followAnchor.center.y + anchorDeltaY * anchorCatchup * deadZoneFactor, WORLD_HEIGHT);

    const targetDeltaX = this.wrappedDelta(this.cameraTarget.center.x, this.followAnchor.center.x, WORLD_WIDTH);
    const targetDeltaY = this.wrappedDelta(this.cameraTarget.center.y, this.followAnchor.center.y, WORLD_HEIGHT);
    const targetDistance = Math.hypot(targetDeltaX, targetDeltaY);
    const targetCatchup = clamp(dt * (3 + targetDistance * 0.012), 0.05, 0.16);

    this.cameraTarget.center.x = wrap(this.cameraTarget.center.x + targetDeltaX * targetCatchup, WORLD_WIDTH);
    this.cameraTarget.center.y = wrap(this.cameraTarget.center.y + targetDeltaY * targetCatchup, WORLD_HEIGHT);
  }

  private syncCamera(): void {
    const deltaX = this.wrappedDelta(this.camera.center.x, this.cameraTarget.center.x, WORLD_WIDTH);
    const deltaY = this.wrappedDelta(this.camera.center.y, this.cameraTarget.center.y, WORLD_HEIGHT);
    this.camera.center.x = wrap(this.camera.center.x + deltaX * CAMERA_SMOOTHING, WORLD_WIDTH);
    this.camera.center.y = wrap(this.camera.center.y + deltaY * CAMERA_SMOOTHING, WORLD_HEIGHT);
    this.camera.zoom = lerp(this.camera.zoom, this.cameraTarget.zoom, CAMERA_SMOOTHING);
    this.simulation.setCamera(this.camera.center.x, this.camera.center.y, this.camera.zoom);
  }

  private frame = (timestamp: number): void => {
    const frameStart = performance.now();
    const rawDelta = Math.min(MAX_FRAME_DELTA, (timestamp - this.lastTime) / 1000 || FIXED_TIMESTEP);
    this.lastTime = timestamp;
    this.updateFrameStats(rawDelta);

    this.input.update(rawDelta);

    const timeScale = this.input.getTimeScale();
    this.simulation.setTimeScale(timeScale);
    this.accumulator += rawDelta * timeScale;
    if (this.accumulator > MAX_ACCUMULATED_SIM_TIME) {
      const dropped = this.accumulator - MAX_ACCUMULATED_SIM_TIME;
      this.perfStats.droppedSimTimeMs += dropped * 1000;
      this.accumulator = MAX_ACCUMULATED_SIM_TIME;
    }

    const updateStart = performance.now();
    let simSteps = 0;
    while (this.accumulator >= FIXED_TIMESTEP && simSteps < MAX_SIM_STEPS_PER_FRAME) {
      this.simulation.update(FIXED_TIMESTEP);
      this.accumulator -= FIXED_TIMESTEP;
      simSteps += 1;
    }
    const simStepCapped = this.accumulator >= FIXED_TIMESTEP;
    if (simStepCapped) {
      const dropped = Math.max(0, this.accumulator - MAX_RETAINED_SIM_LAG);
      if (dropped > 0) {
        this.perfStats.droppedSimTimeMs += dropped * 1000;
      }
      this.accumulator = Math.min(this.accumulator, MAX_RETAINED_SIM_LAG);
    }
    this.perfStats.updateTimeMs = performance.now() - updateStart;
    this.perfStats.simSteps = simSteps;
    this.perfStats.simStepCapped = simStepCapped;
    this.perfStats.simAccumulatorMs = this.accumulator * 1000;

    this.updateAttentionCameraTarget(rawDelta);
    this.syncCamera();

    const snapshot = this.simulation.getSnapshot();
    this.latestSnapshot = snapshot;
    const audioStart = performance.now();
    this.audio.update(snapshot, this.settings);
    this.perfStats.audioUpdateTimeMs = performance.now() - audioStart;
    this.hud.update(snapshot, this.audio.getDebugState(), this.perfStats, this.audio.getInterpretationStatus());
    const renderStart = performance.now();
    this.renderer.render(snapshot, this.settings, this.audio.getDebugState(), this.perfStats);
    this.perfStats.renderTimeMs = performance.now() - renderStart;
    this.perfStats.frameTimeMs = performance.now() - frameStart;

    this.animationFrame = window.requestAnimationFrame(this.frame);
  };

  private updateFrameStats(rawDelta: number): void {
    this.fpsAccumulator += rawDelta;
    this.fpsFrameCount += 1;
    this.perfStats.droppedSimTimeMs = Math.max(0, this.perfStats.droppedSimTimeMs - rawDelta * 1000 * 0.35);
    if (this.fpsAccumulator < 0.25) return;
    this.perfStats.fps = this.fpsFrameCount / this.fpsAccumulator;
    this.fpsAccumulator = 0;
    this.fpsFrameCount = 0;
  }
}
