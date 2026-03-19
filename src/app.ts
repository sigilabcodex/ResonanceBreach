import { FIXED_TIMESTEP, MAX_FRAME_DELTA } from './config';
import { AudioEngine } from './audio/audioEngine';
import { PlayerInput } from './input/playerInput';
import { Renderer } from './render/renderer';
import { Simulation } from './sim/simulation';
import { Hud } from './ui/hud';

export class App {
  private readonly simulation = new Simulation();
  private readonly renderer: Renderer;
  private readonly audio = new AudioEngine();
  private readonly hud = new Hud();
  private readonly input: PlayerInput;
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

    this.input = new PlayerInput(canvas, {
      onZone: (active, x, y) => this.simulation.setZone(active, x, y),
      onInteract: () => {
        void this.audio.ensureStarted();
      },
      onRestart: () => this.restart(),
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
  }

  private handleResize = (): void => {
    this.renderer.resize();
  };

  private frame = (timestamp: number): void => {
    const delta = Math.min(MAX_FRAME_DELTA, (timestamp - this.lastTime) / 1000 || FIXED_TIMESTEP);
    this.lastTime = timestamp;
    this.accumulator += delta;

    while (this.accumulator >= FIXED_TIMESTEP) {
      this.simulation.update(FIXED_TIMESTEP);
      this.accumulator -= FIXED_TIMESTEP;
    }

    const snapshot = this.simulation.getSnapshot();
    this.audio.update(snapshot);
    this.hud.update(snapshot);
    this.renderer.render(snapshot, this.accumulator / FIXED_TIMESTEP);

    this.animationFrame = window.requestAnimationFrame(this.frame);
  };
}
