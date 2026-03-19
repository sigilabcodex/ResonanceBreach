import { ENTITY_LINK_DISTANCE, GAME_TITLE, WORLD_HEIGHT, WORLD_WIDTH } from '../config';
import type { BarrierSegment, CameraState, Entity, FieldCell, SimulationSnapshot } from '../sim/types';

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
    const view = this.getView(snapshot.camera, width, height);
    const instability = 1 - snapshot.stability;
    const trailAlpha = lerp(0.14, 0.045, clamp(instability + snapshot.phaseState.blend.breach * 0.25, 0, 1));

    ctx.save();
    ctx.fillStyle = `rgba(2, 5, 10, ${trailAlpha})`;
    ctx.fillRect(0, 0, width, height);

    const bgGradient = ctx.createRadialGradient(width * 0.5, height * 0.46, 80, width * 0.5, height * 0.5, width * 0.92);
    bgGradient.addColorStop(0, `rgba(21, 40, 56, ${0.12 + snapshot.phaseState.blend.calm * 0.08})`);
    bgGradient.addColorStop(0.5, `rgba(9, 18, 29, ${0.28 + instability * 0.06})`);
    bgGradient.addColorStop(1, 'rgba(1, 3, 7, 0.96)');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    ctx.translate(view.offsetX, view.offsetY);
    ctx.scale(view.scale, view.scale);

    const palette = {
      harmonic: mixColor([123, 236, 255], [132, 188, 255], snapshot.phaseState.blend.emergence),
      anomaly: mixColor([153, 196, 255], [255, 147, 185], snapshot.phaseState.blend.pressure + snapshot.phaseState.blend.breach * 0.3),
      breach: mixColor([255, 164, 135], [255, 92, 148], snapshot.phaseState.blend.breach),
      field: mixColor([34, 66, 94], [87, 38, 60], instability),
      barrier: mixColor([104, 148, 198], [192, 91, 122], instability),
      zone: mixColor([164, 255, 227], [255, 233, 148], snapshot.rhythmicPressure * 0.5),
    };

    this.drawField(snapshot.field, snapshot, palette.field);
    this.drawBarriers(snapshot.barriers, instability, palette.barrier);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const hotspot of snapshot.hotspots) {
      const gradient = ctx.createRadialGradient(hotspot.x, hotspot.y, hotspot.radius * 0.08, hotspot.x, hotspot.y, hotspot.radius * 1.8);
      gradient.addColorStop(0, `rgba(255, 168, 128, ${0.06 + hotspot.intensity * 0.05})`);
      gradient.addColorStop(0.6, `rgba(255, 90, 145, ${0.04 + hotspot.intensity * 0.06})`);
      gradient.addColorStop(1, 'rgba(255, 90, 145, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(hotspot.x, hotspot.y, hotspot.radius * (1.1 + Math.sin(snapshot.time * 1.2 + hotspot.x * 0.01) * 0.04), 0, Math.PI * 2);
      ctx.fill();
    }

    this.drawLinks(snapshot.entities, snapshot, alpha);
    for (const entity of snapshot.entities) {
      this.drawEntity(entity, snapshot, palette, alpha);
    }

    this.drawZone(snapshot, palette.zone);
    ctx.restore();
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

    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.font = '500 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(GAME_TITLE, width - 16, height - 16);
  }

  private getView(camera: CameraState, width: number, height: number) {
    const scale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT) * camera.zoom;
    return {
      scale,
      offsetX: width * 0.5 - camera.center.x * scale,
      offsetY: height * 0.5 - camera.center.y * scale,
    };
  }

  private drawField(field: FieldCell[], snapshot: SimulationSnapshot, fieldColor: readonly [number, number, number]): void {
    const { ctx } = this;
    for (const cell of field) {
      const phaseStress = snapshot.phaseState.blend.pressure * 0.4 + snapshot.phaseState.blend.breach * 0.75;
      const regionGradient = ctx.createRadialGradient(
        cell.center.x,
        cell.center.y,
        Math.min(cell.bounds.width, cell.bounds.height) * 0.1,
        cell.center.x,
        cell.center.y,
        Math.max(cell.bounds.width, cell.bounds.height) * 0.85,
      );
      regionGradient.addColorStop(0, `rgba(84, 173, 214, ${0.02 + (1 - cell.hazard) * 0.04 + cell.containment * 0.04})`);
      regionGradient.addColorStop(0.7, `rgba(${fieldColor[0]}, ${fieldColor[1]}, ${fieldColor[2]}, ${0.03 + cell.hazard * 0.05 + phaseStress * 0.04})`);
      regionGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = regionGradient;
      ctx.fillRect(cell.bounds.x, cell.bounds.y, cell.bounds.width, cell.bounds.height);

      ctx.strokeStyle = `rgba(118, 164, 224, ${0.04 + (1 - cell.hazard) * 0.04})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(cell.bounds.x + 0.5, cell.bounds.y + 0.5, cell.bounds.width - 1, cell.bounds.height - 1);

      const waveAlpha = 0.02 + cell.hazard * 0.04 + phaseStress * 0.03;
      ctx.strokeStyle = rgba(fieldColor, waveAlpha);
      ctx.beginPath();
      for (let i = 0; i <= 7; i += 1) {
        const x = cell.bounds.x + (cell.bounds.width / 7) * i;
        const y = cell.center.y + Math.sin(snapshot.time * 0.45 + x * 0.014 + cell.row) * (4 + cell.hazard * 8);
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
      const alpha = 0.09 + barrier.strength * 0.06 + instability * 0.04;
      ctx.strokeStyle = rgba(barrierColor, alpha);
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      if (barrier.axis === 'vertical') {
        const gateStart = barrier.gateCenter - barrier.gateSize * 0.5;
        const gateEnd = barrier.gateCenter + barrier.gateSize * 0.5;
        ctx.moveTo(barrier.position, barrier.spanStart + 8);
        ctx.lineTo(barrier.position, gateStart);
        ctx.moveTo(barrier.position, gateEnd);
        ctx.lineTo(barrier.position, barrier.spanEnd - 8);
      } else {
        const gateStart = barrier.gateCenter - barrier.gateSize * 0.5;
        const gateEnd = barrier.gateCenter + barrier.gateSize * 0.5;
        ctx.moveTo(barrier.spanStart + 8, barrier.position);
        ctx.lineTo(gateStart, barrier.position);
        ctx.moveTo(gateEnd, barrier.position);
        ctx.lineTo(barrier.spanEnd - 8, barrier.position);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawLinks(entities: Entity[], snapshot: SimulationSnapshot, alpha: number): void {
    const { ctx } = this;
    for (let i = 0; i < entities.length; i += 1) {
      const a = entities[i];
      if (a.role === 'anomaly') continue;
      for (let j = i + 1; j < entities.length; j += 1) {
        const b = entities[j];
        if (b.role === 'anomaly') continue;
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > ENTITY_LINK_DISTANCE) continue;

        const tension = clamp(1 - dist / ENTITY_LINK_DISTANCE + (a.charge + b.charge) * 0.25, 0, 1.3);
        if (tension < 0.08) continue;

        const breachBias = a.role === 'breach' || b.role === 'breach';
        ctx.strokeStyle = breachBias
          ? `rgba(255, 108, 152, ${0.04 + tension * 0.14})`
          : `rgba(98, 188, 255, ${0.03 + tension * 0.08})`;
        ctx.lineWidth = breachBias ? 1.1 + tension : 0.8 + tension * 0.5;
        ctx.beginPath();
        ctx.moveTo(a.position.x + Math.sin(snapshot.time * 2 + i) * alpha, a.position.y + Math.cos(snapshot.time * 2.2 + i) * alpha);
        ctx.lineTo(b.position.x - Math.sin(snapshot.time * 1.7 + j) * alpha, b.position.y - Math.cos(snapshot.time * 2.4 + j) * alpha);
        ctx.stroke();
      }
    }
  }

  private drawEntity(
    entity: Entity,
    snapshot: SimulationSnapshot,
    palette: Record<'harmonic' | 'anomaly' | 'breach' | 'field' | 'barrier' | 'zone', readonly [number, number, number]>,
    alpha: number,
  ): void {
    const { ctx } = this;
    const x = entity.position.x + Math.sin(entity.phase * 2.2 + snapshot.time * 0.8 + entity.id) * alpha * 0.9;
    const y = entity.position.y + Math.cos(entity.phase * 2 + snapshot.time * 0.7 + entity.id) * alpha * 0.9;

    if (entity.role === 'harmonic') {
      const radius = 2.8 + entity.energy * 6;
      ctx.fillStyle = rgba(palette.harmonic, 1);
      ctx.globalAlpha = 0.04 + entity.resonance * 0.22;
      ctx.beginPath();
      ctx.arc(x, y, radius * 3.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.5 + entity.resonance * 0.35;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = rgba(palette.harmonic, 1);
      ctx.globalAlpha = 0.14 + entity.resonance * 0.24;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(x, y, radius * (1.8 + Math.sin(snapshot.time + entity.id) * 0.08), 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    if (entity.role === 'anomaly') {
      const radius = 9 + entity.instability * 12;
      const rotation = snapshot.time * 0.8 + entity.phase;
      ctx.strokeStyle = rgba(palette.anomaly, 1);
      ctx.globalAlpha = 0.1 + entity.instability * 0.18;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 4; i += 1) {
        const angle = rotation + i * (Math.PI / 2);
        const inner = radius * 0.2;
        const outer = radius * (0.65 + Math.sin(snapshot.time * 3 + entity.id + i) * 0.08);
        ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
        ctx.lineTo(x + Math.cos(angle + 0.28) * outer, y + Math.sin(angle + 0.28) * outer);
      }
      ctx.stroke();

      ctx.globalAlpha = 0.06 + entity.instability * 0.1;
      ctx.beginPath();
      ctx.ellipse(x, y, radius * 1.1, radius * 0.42, rotation, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    const pulse = 1 + Math.sin(snapshot.time * (3.4 + snapshot.rhythmicPressure * 3.5) + entity.id) * 0.12 + entity.pulse * 0.14;
    const coreRadius = 5 + entity.energy * 5.5;
    ctx.fillStyle = rgba(palette.breach, 1);
    ctx.globalAlpha = 0.08 + entity.charge * 0.12 + snapshot.rhythmicPressure * 0.04;
    ctx.beginPath();
    ctx.arc(x, y, coreRadius * 3.3 * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = rgba(palette.breach, 1);
    ctx.globalAlpha = 0.32 + entity.charge * 0.16;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 3; i += 1) {
      const angle = entity.phase + i * (Math.PI * 2) / 3;
      const tip = coreRadius * (1.8 + entity.charge * 0.5) * pulse;
      const side = coreRadius * 0.7;
      if (i === 0) {
        ctx.moveTo(x + Math.cos(angle) * tip, y + Math.sin(angle) * tip);
      }
      ctx.lineTo(x + Math.cos(angle + 1.5) * side, y + Math.sin(angle + 1.5) * side);
      ctx.lineTo(x + Math.cos(angle + 3) * tip * 0.74, y + Math.sin(angle + 3) * tip * 0.74);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(x, y, coreRadius * 0.48, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawZone(snapshot: SimulationSnapshot, zoneColor: readonly [number, number, number]): void {
    const { ctx } = this;
    if (snapshot.zone.charge <= 0.001) return;

    const pulse = 1 + Math.sin(snapshot.time * 6.2) * 0.05 + snapshot.zone.pulse * 0.08;
    const radius = snapshot.zone.radius * pulse;
    const gradient = ctx.createRadialGradient(
      snapshot.zone.position.x,
      snapshot.zone.position.y,
      radius * 0.18,
      snapshot.zone.position.x,
      snapshot.zone.position.y,
      radius,
    );
    gradient.addColorStop(0, `rgba(182, 255, 223, ${0.1 + snapshot.zone.charge * 0.06 + snapshot.zone.recovery * 0.24})`);
    gradient.addColorStop(0.75, `rgba(118, 233, 255, ${0.04 + snapshot.zone.charge * 0.05})`);
    gradient.addColorStop(1, 'rgba(118, 233, 255, 0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(snapshot.zone.position.x, snapshot.zone.position.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = rgba(zoneColor, 1);
    ctx.globalAlpha = 0.28 + snapshot.zone.charge * 0.1;
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    ctx.arc(snapshot.zone.position.x, snapshot.zone.position.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
}
