import { ENTITY_LINK_DISTANCE, GAME_TITLE, WORLD_HEIGHT, WORLD_WIDTH } from '../config';
import type { BarrierSegment, FieldCell, SimulationSnapshot } from '../sim/types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const mixColor = (stable: [number, number, number], unstable: [number, number, number], t: number) =>
  [
    Math.round(lerp(stable[0], unstable[0], t)),
    Math.round(lerp(stable[1], unstable[1], t)),
    Math.round(lerp(stable[2], unstable[2], t)),
  ] as const;

const rgba = (color: readonly [number, number, number], alpha: number) => `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;

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
    const flicker = instability * (0.3 + 0.7 * Math.sin(snapshot.time * 8.8));
    const trailAlpha = lerp(0.19, 0.065, instability);

    ctx.save();
    ctx.fillStyle = `rgba(2, 5, 10, ${trailAlpha})`;
    ctx.fillRect(0, 0, width, height);

    const bgGradient = ctx.createRadialGradient(width * 0.52, height * 0.48, 100, width * 0.5, height * 0.5, width * 0.9);
    bgGradient.addColorStop(0, `rgba(21, 39, 54, ${0.15 + snapshot.stability * 0.14})`);
    bgGradient.addColorStop(0.5, `rgba(10, 18, 29, ${0.2 + instability * 0.05})`);
    bgGradient.addColorStop(1, 'rgba(1, 3, 7, 0.95)');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    const jitter = instability * 2.1;
    const palette = {
      core: mixColor([118, 236, 255], [255, 104, 168], instability),
      halo: mixColor([89, 182, 255], [255, 151, 106], instability),
      link: mixColor([82, 134, 194], [255, 89, 146], instability),
      zone: mixColor([164, 255, 227], [255, 233, 148], instability),
      chamber: mixColor([29, 62, 88], [103, 38, 62], instability),
      barrier: mixColor([119, 168, 224], [198, 98, 118], instability),
    };

    this.drawField(snapshot.field, instability, snapshot.time, palette.chamber);
    this.drawBarriers(snapshot.barriers, instability, palette.barrier);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const hotspot of snapshot.hotspots) {
      const gradient = ctx.createRadialGradient(hotspot.x, hotspot.y, hotspot.radius * 0.1, hotspot.x, hotspot.y, hotspot.radius * 1.7);
      gradient.addColorStop(0, `rgba(255, 155, 120, ${0.11 + hotspot.intensity * 0.11})`);
      gradient.addColorStop(0.6, `rgba(255, 92, 148, ${0.05 + hotspot.intensity * 0.06})`);
      gradient.addColorStop(1, 'rgba(255, 92, 148, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(hotspot.x, hotspot.y, hotspot.radius * (1.2 + Math.sin(snapshot.time * 1.8 + hotspot.x * 0.01) * 0.04), 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = 0; i < snapshot.entities.length; i += 1) {
      const a = snapshot.entities[i];
      for (let j = i + 1; j < snapshot.entities.length; j += 1) {
        const b = snapshot.entities[j];
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > ENTITY_LINK_DISTANCE) continue;

        const tension = clamp(1 - dist / ENTITY_LINK_DISTANCE + (a.resonance + b.resonance) * 1.1 + (a.charge + b.charge) * 0.34, 0, 1.6);
        if (tension < 0.08) continue;
        ctx.strokeStyle = instability > 0.5 ? `rgba(255, 118, 152, ${0.03 + tension * 0.18})` : `rgba(99, 187, 255, ${0.03 + tension * 0.18})`;
        ctx.lineWidth = 0.8 + tension * 1.6;
        ctx.beginPath();
        ctx.moveTo(
          a.position.x + Math.sin(snapshot.time * 4 + i) * jitter,
          a.position.y + Math.cos(snapshot.time * 3.6 + i) * jitter,
        );
        ctx.lineTo(
          b.position.x - Math.sin(snapshot.time * 3.8 + j) * jitter,
          b.position.y - Math.cos(snapshot.time * 4.2 + j) * jitter,
        );
        ctx.stroke();
      }
    }

    for (const entity of snapshot.entities) {
      const resonanceGlow = clamp(entity.resonance * 8 + entity.energy * 0.4 + entity.cluster * 0.55, 0.35, 2.8);
      const chargeGlow = clamp(entity.charge, 0, 1.6);
      const radius = 3.6 + entity.energy * 5.4;
      const jitterX = Math.sin(entity.phase * 2.6 + snapshot.time * 5 + entity.id) * jitter;
      const jitterY = Math.cos(entity.phase * 2.1 + snapshot.time * 5.8 + entity.id) * jitter;
      const x = entity.position.x + jitterX * alpha;
      const y = entity.position.y + jitterY * alpha;

      ctx.fillStyle = rgba(palette.halo, 1);
      ctx.globalAlpha = 0.04 * resonanceGlow + chargeGlow * 0.04;
      ctx.beginPath();
      ctx.arc(x, y, radius * (3.8 + chargeGlow * 1.2), 0, Math.PI * 2);
      ctx.fill();

      if (chargeGlow > 0.2) {
        ctx.strokeStyle = `rgba(255, 208, 146, ${0.2 + chargeGlow * 0.18})`;
        ctx.globalAlpha = clamp(0.32 + chargeGlow * 0.1, 0, 0.85);
        ctx.lineWidth = 1 + chargeGlow * 1.2;
        ctx.beginPath();
        ctx.arc(x, y, radius * (1.9 + chargeGlow * 0.6 + Math.sin(snapshot.time * 9 + entity.id) * 0.08), 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = rgba(palette.core, 1);
      ctx.globalAlpha = clamp(0.48 + resonanceGlow * 0.12 + flicker * 0.05, 0, 1);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = rgba(palette.link, 1);
      ctx.globalAlpha = 0.14 + entity.energy * 0.16 + chargeGlow * 0.08;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.6 + Math.sin(snapshot.time * 2.2 + entity.id) * 1.6, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (snapshot.zone.charge > 0.001) {
      const pulse = 1 + Math.sin(snapshot.time * 8.5) * 0.08 + snapshot.zone.pulse * 0.08;
      const radius = snapshot.zone.radius * pulse;
      const containmentResponse = snapshot.zone.recovery * 40;
      const gradient = ctx.createRadialGradient(
        snapshot.zone.position.x,
        snapshot.zone.position.y,
        radius * 0.2,
        snapshot.zone.position.x,
        snapshot.zone.position.y,
        radius,
      );
      gradient.addColorStop(0, `rgba(182, 255, 223, ${0.16 + snapshot.zone.charge * 0.06 + snapshot.zone.recovery * 0.4})`);
      gradient.addColorStop(0.7, `rgba(118, 233, 255, ${0.06 + snapshot.zone.charge * 0.08})`);
      gradient.addColorStop(1, 'rgba(118, 233, 255, 0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(snapshot.zone.position.x, snapshot.zone.position.y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = rgba(palette.zone, 1);
      ctx.globalAlpha = 0.42 + snapshot.zone.charge * 0.12;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(snapshot.zone.position.x, snapshot.zone.position.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = 0.18 + snapshot.zone.recovery * 1.6;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(snapshot.zone.position.x, snapshot.zone.position.y, radius * 0.68 + containmentResponse, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();

    if (snapshot.lost) {
      ctx.fillStyle = 'rgba(255, 70, 120, 0.12)';
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '600 30px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Containment failure', width / 2, height / 2 - 12);
      ctx.font = '400 16px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.fillText('Press R or use restart to reseed the breach field', width / 2, height / 2 + 22);
    }

    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.font = '500 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(GAME_TITLE, width - 16, height - 16);
  }

  private drawField(field: FieldCell[], instability: number, time: number, chamberColor: readonly [number, number, number]): void {
    const { ctx } = this;

    for (const cell of field) {
      const calmness = clamp(1 - cell.hazard * 0.8, 0, 1);
      const regionGradient = ctx.createRadialGradient(
        cell.center.x,
        cell.center.y,
        Math.min(cell.bounds.width, cell.bounds.height) * 0.12,
        cell.center.x,
        cell.center.y,
        Math.max(cell.bounds.width, cell.bounds.height) * 0.8,
      );
      regionGradient.addColorStop(0, `rgba(88, 173, 212, ${0.02 + calmness * 0.05 + cell.containment * 0.04})`);
      regionGradient.addColorStop(0.65, `rgba(60, 100, 148, ${0.02 + cell.containment * 0.035})`);
      regionGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = regionGradient;
      ctx.fillRect(cell.bounds.x, cell.bounds.y, cell.bounds.width, cell.bounds.height);

      ctx.strokeStyle = `rgba(122, 171, 230, ${0.05 + calmness * 0.06})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(cell.bounds.x + 0.5, cell.bounds.y + 0.5, cell.bounds.width - 1, cell.bounds.height - 1);

      const waveAlpha = 0.028 + cell.hazard * 0.055 + instability * 0.02;
      ctx.strokeStyle = rgba(chamberColor, waveAlpha);
      ctx.beginPath();
      for (let i = 0; i <= 8; i += 1) {
        const x = cell.bounds.x + (cell.bounds.width / 8) * i;
        const y = cell.center.y + Math.sin(time * 0.8 + x * 0.018 + cell.row) * (6 + cell.hazard * 10);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  private drawBarriers(barriers: BarrierSegment[], instability: number, barrierColor: readonly [number, number, number]): void {
    const { ctx } = this;
    ctx.save();
    ctx.lineCap = 'round';

    for (const barrier of barriers) {
      const alpha = 0.12 + barrier.strength * 0.08 + instability * 0.04;
      ctx.strokeStyle = rgba(barrierColor, alpha);
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (barrier.axis === 'vertical') {
        const gateStart = barrier.gateCenter - barrier.gateSize * 0.5;
        const gateEnd = barrier.gateCenter + barrier.gateSize * 0.5;
        ctx.moveTo(barrier.position, barrier.spanStart + 10);
        ctx.lineTo(barrier.position, gateStart);
        ctx.moveTo(barrier.position, gateEnd);
        ctx.lineTo(barrier.position, barrier.spanEnd - 10);
      } else {
        const gateStart = barrier.gateCenter - barrier.gateSize * 0.5;
        const gateEnd = barrier.gateCenter + barrier.gateSize * 0.5;
        ctx.moveTo(barrier.spanStart + 10, barrier.position);
        ctx.lineTo(gateStart, barrier.position);
        ctx.moveTo(gateEnd, barrier.position);
        ctx.lineTo(barrier.spanEnd - 10, barrier.position);
      }
      ctx.stroke();
    }

    ctx.restore();
  }
}
