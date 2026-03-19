import { ENTITY_LINK_DISTANCE, GAME_TITLE, WORLD_HEIGHT, WORLD_WIDTH } from '../config';
import type { SimulationSnapshot } from '../sim/types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const mixColor = (stable: [number, number, number], unstable: [number, number, number], t: number) =>
  `rgb(${Math.round(lerp(stable[0], unstable[0], t))} ${Math.round(lerp(stable[1], unstable[1], t))} ${Math.round(lerp(stable[2], unstable[2], t))})`;

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context unavailable.');
    }

    this.ctx = context;
    this.resize();
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  render(snapshot: SimulationSnapshot, alpha: number): void {
    const { ctx, canvas } = this;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const scale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);
    const offsetX = (width - WORLD_WIDTH * scale) * 0.5;
    const offsetY = (height - WORLD_HEIGHT * scale) * 0.5;
    const instability = 1 - snapshot.stability;
    const flicker = instability * (0.4 + 0.6 * Math.sin(snapshot.time * 9.7));
    const trailAlpha = lerp(0.22, 0.075, instability);

    ctx.save();
    ctx.fillStyle = `rgba(3, 6, 11, ${trailAlpha})`;
    ctx.fillRect(0, 0, width, height);

    const bgGradient = ctx.createRadialGradient(width * 0.5, height * 0.5, 80, width * 0.5, height * 0.5, width * 0.8);
    bgGradient.addColorStop(0, `rgba(20, 29, 41, ${0.14 + snapshot.stability * 0.18})`);
    bgGradient.addColorStop(1, 'rgba(2, 4, 8, 0)');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    const jitter = instability * 2.6;
    const palette = {
      core: mixColor([107, 242, 255], [255, 90, 162], instability),
      halo: mixColor([100, 208, 255], [255, 142, 82], instability),
      link: mixColor([65, 129, 196], [255, 72, 132], instability),
      zone: mixColor([152, 255, 222], [255, 236, 109], instability),
    };

    ctx.strokeStyle = `rgba(120, 170, 255, ${0.1 + snapshot.stability * 0.14})`;
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD_WIDTH; x += 128) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y <= WORLD_HEIGHT; y += 128) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD_WIDTH, y);
      ctx.stroke();
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < snapshot.entities.length; i += 1) {
      const a = snapshot.entities[i];
      for (let j = i + 1; j < snapshot.entities.length; j += 1) {
        const b = snapshot.entities[j];
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > ENTITY_LINK_DISTANCE) continue;

        const tension = clamp(1 - dist / ENTITY_LINK_DISTANCE + (a.resonance + b.resonance) * 0.7, 0, 1.2);
        ctx.strokeStyle = `rgba(${instability > 0.5 ? '255, 106, 158' : '99, 182, 255'}, ${0.06 + tension * 0.2})`;
        ctx.lineWidth = 1 + tension * 1.8;
        ctx.beginPath();
        ctx.moveTo(a.position.x + Math.sin(snapshot.time * 8 + i) * jitter, a.position.y + Math.cos(snapshot.time * 7 + i) * jitter);
        ctx.lineTo(b.position.x - Math.sin(snapshot.time * 7 + j) * jitter, b.position.y - Math.cos(snapshot.time * 8 + j) * jitter);
        ctx.stroke();
      }
    }

    for (const entity of snapshot.entities) {
      const resonanceGlow = clamp(entity.resonance * 7 + entity.energy * 0.55, 0.35, 2.4);
      const radius = 4 + entity.energy * 6;
      const jitterX = Math.sin(entity.phase * 3 + snapshot.time * 9 + entity.id) * jitter;
      const jitterY = Math.cos(entity.phase * 2 + snapshot.time * 11 + entity.id) * jitter;
      const x = entity.position.x + jitterX * alpha;
      const y = entity.position.y + jitterY * alpha;

      ctx.fillStyle = palette.halo;
      ctx.globalAlpha = 0.05 * resonanceGlow;
      ctx.beginPath();
      ctx.arc(x, y, radius * 4.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = palette.core;
      ctx.globalAlpha = clamp(0.55 + resonanceGlow * 0.12 + flicker * 0.08, 0, 1);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = palette.link;
      ctx.globalAlpha = 0.2 + entity.energy * 0.2;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.8 + Math.sin(snapshot.time * 3 + entity.id) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (snapshot.zone.charge > 0.001) {
      const pulse = 1 + Math.sin(snapshot.time * 9) * 0.06;
      ctx.globalAlpha = 0.28 + snapshot.zone.charge * 0.18;
      ctx.strokeStyle = palette.zone;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(snapshot.zone.position.x, snapshot.zone.position.y, snapshot.zone.radius * pulse, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = 0.06 + snapshot.zone.charge * 0.08;
      ctx.fillStyle = palette.zone;
      ctx.beginPath();
      ctx.arc(snapshot.zone.position.x, snapshot.zone.position.y, snapshot.zone.radius * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    if (snapshot.lost) {
      ctx.fillStyle = 'rgba(255, 70, 120, 0.12)';
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '600 30px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Breach cascade detected', width / 2, height / 2 - 12);
      ctx.font = '400 16px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.fillText('Press R or use restart to reseed the field', width / 2, height / 2 + 22);
    }

    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.font = '500 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(GAME_TITLE, width - 16, height - 16);
  }
}
