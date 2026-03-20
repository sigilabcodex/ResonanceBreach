import { GAME_TITLE, WORLD_HEIGHT, WORLD_WIDTH, type EntityType, type ToolType, type ZoneType } from '../config';
import type { CameraState, Entity, SimulationSnapshot, ZoneCell } from '../sim/types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rgba = (color: readonly [number, number, number], alpha: number) => `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;

const zonePalette: Record<ZoneType, readonly [number, number, number]> = {
  drift: [116, 180, 210],
  resonant: [149, 230, 218],
  fertile: [134, 206, 140],
  unstable: [211, 130, 218],
};

const entityPalette: Record<EntityType, readonly [number, number, number]> = {
  seed: [183, 234, 255],
  cluster: [154, 244, 214],
  filament: [141, 189, 255],
  alien: [244, 165, 255],
};

const toolPalette: Record<ToolType, readonly [number, number, number]> = {
  observe: [180, 224, 255],
  grow: [154, 240, 171],
  feed: [255, 219, 143],
  repel: [255, 154, 186],
  disrupt: [208, 161, 255],
};

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

  render(snapshot: SimulationSnapshot): void {
    const { ctx, canvas } = this;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const view = this.getView(snapshot.camera, width, height);

    ctx.clearRect(0, 0, width, height);

    const sky = ctx.createRadialGradient(width * 0.5, height * 0.45, 60, width * 0.5, height * 0.52, width * 0.9);
    sky.addColorStop(0, `rgba(16, 30, 45, ${0.82 + snapshot.stats.harmony * 0.08})`);
    sky.addColorStop(0.55, `rgba(7, 14, 24, 0.95)`);
    sky.addColorStop(1, 'rgba(2, 5, 10, 1)');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(view.offsetX, view.offsetY);
    ctx.scale(view.scale, view.scale);

    this.drawZones(snapshot.zones, snapshot);
    this.drawEntityAuras(snapshot.entities, snapshot);
    this.drawFilamentFlows(snapshot.entities, snapshot);
    this.drawEntities(snapshot.entities, snapshot);
    this.drawTool(snapshot);

    ctx.restore();

    if (snapshot.narrativeHint > 0.42) {
      this.drawAnomalyGlitch(snapshot, width, height);
    }

    ctx.fillStyle = 'rgba(255,255,255,0.14)';
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

  private drawZones(zones: ZoneCell[], snapshot: SimulationSnapshot): void {
    const { ctx } = this;
    for (const cell of zones) {
      for (const zoneType of Object.keys(cell.weights) as ZoneType[]) {
        const weight = cell.weights[zoneType];
        if (weight < 0.14) continue;
        const color = zonePalette[zoneType];
        const gradient = ctx.createRadialGradient(
          cell.center.x,
          cell.center.y,
          Math.min(cell.bounds.width, cell.bounds.height) * 0.08,
          cell.center.x,
          cell.center.y,
          Math.max(cell.bounds.width, cell.bounds.height) * 0.9,
        );
        const flicker = 0.92 + Math.sin(snapshot.time * 0.18 + cell.shimmer * 12) * 0.08;
        gradient.addColorStop(0, rgba(color, 0.018 + weight * 0.08 * flicker));
        gradient.addColorStop(0.65, rgba(color, 0.008 + weight * 0.038));
        gradient.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = gradient;
        ctx.fillRect(cell.bounds.x - 10, cell.bounds.y - 10, cell.bounds.width + 20, cell.bounds.height + 20);
      }

      const waveColor = zonePalette[this.primaryZone(cell)];
      ctx.strokeStyle = rgba(waveColor, 0.045 + cell.weights.resonant * 0.05 + cell.weights.unstable * 0.02);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= 6; i += 1) {
        const x = cell.bounds.x + (cell.bounds.width / 6) * i;
        const y = cell.center.y + Math.sin(snapshot.time * 0.4 + i * 0.7 + cell.shimmer * 5) * (4 + cell.weights.drift * 10);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  private drawEntityAuras(entities: Entity[], snapshot: SimulationSnapshot): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const entity of entities) {
      const color = entityPalette[entity.type];
      const pulse = 1 + Math.sin(snapshot.time * (0.6 + entity.energy) + entity.phase) * 0.08 + entity.pulse * 0.18;
      const radius = entity.size * (entity.type === 'cluster' ? 3.8 : entity.type === 'alien' ? 3.2 : 2.6) * pulse;
      const gradient = ctx.createRadialGradient(entity.position.x, entity.position.y, entity.size * 0.25, entity.position.x, entity.position.y, radius);
      gradient.addColorStop(0, rgba(color, entity.type === 'alien' ? 0.16 : 0.08 + entity.resonance * 0.08));
      gradient.addColorStop(0.55, rgba(color, 0.025 + entity.pulse * 0.06));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(entity.position.x, entity.position.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawFilamentFlows(entities: Entity[], snapshot: SimulationSnapshot): void {
    const { ctx } = this;
    ctx.save();
    for (const entity of entities) {
      if (entity.type !== 'filament') continue;
      const color = entityPalette.filament;
      ctx.strokeStyle = rgba(color, 0.12 + entity.resonance * 0.12);
      ctx.lineWidth = 1.4 + entity.growth * 1.2;
      ctx.beginPath();
      for (let i = 0; i < 9; i += 1) {
        const t = i / 8;
        const offset = (t - 0.5) * 54;
        const sway = Math.sin(snapshot.time * 0.75 + entity.id * 0.4 + t * Math.PI) * (6 + entity.growth * 8);
        const x = entity.position.x + Math.cos(entity.heading) * offset - Math.sin(entity.heading) * sway;
        const y = entity.position.y + Math.sin(entity.heading) * offset + Math.cos(entity.heading) * sway;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawEntities(entities: Entity[], snapshot: SimulationSnapshot): void {
    for (const entity of entities) {
      if (entity.type === 'seed') this.drawSeed(entity, snapshot);
      else if (entity.type === 'cluster') this.drawCluster(entity, snapshot);
      else if (entity.type === 'filament') this.drawFilamentNode(entity);
      else this.drawAlien(entity, snapshot);
    }
  }

  private drawSeed(entity: Entity, snapshot: SimulationSnapshot): void {
    const { ctx } = this;
    const color = entityPalette.seed;
    const angle = entity.heading + Math.sin(snapshot.time * 0.9 + entity.id) * 0.2;
    ctx.save();
    ctx.translate(entity.position.x, entity.position.y);
    ctx.rotate(angle);
    ctx.fillStyle = rgba(color, 0.82);
    ctx.beginPath();
    ctx.ellipse(0, 0, entity.size * 0.9, entity.size * 0.56, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(color, 0.46);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-entity.size * 0.8, 0);
    ctx.lineTo(entity.size * 1.1, 0);
    ctx.stroke();
    ctx.restore();
  }

  private drawCluster(entity: Entity, snapshot: SimulationSnapshot): void {
    const { ctx } = this;
    const color = entityPalette.cluster;
    const pulse = 1 + Math.sin(snapshot.time * 0.5 + entity.phase) * 0.05 + entity.pulse * 0.12;
    ctx.save();
    ctx.translate(entity.position.x, entity.position.y);
    ctx.fillStyle = rgba(color, 0.42 + entity.resonance * 0.18);
    ctx.beginPath();
    for (let i = 0; i < 7; i += 1) {
      const angle = (i / 7) * Math.PI * 2;
      const radius = entity.size * (0.84 + Math.sin(snapshot.time * 0.7 + entity.id + i) * 0.12) * pulse;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius * (0.85 + Math.cos(snapshot.time * 0.6 + i) * 0.06);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.quadraticCurveTo(px * 1.08, py * 1.08, px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(color, 0.22 + entity.growth * 0.16);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  private drawFilamentNode(entity: Entity): void {
    const { ctx } = this;
    const color = entityPalette.filament;
    ctx.save();
    ctx.translate(entity.position.x, entity.position.y);
    ctx.rotate(entity.heading);
    ctx.fillStyle = rgba(color, 0.7);
    ctx.beginPath();
    ctx.ellipse(0, 0, entity.size * 1.2, entity.size * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(color, 0.3 + entity.resonance * 0.18);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-entity.size * 1.6, 0);
    ctx.lineTo(entity.size * 1.8, 0);
    ctx.stroke();
    ctx.restore();
  }

  private drawAlien(entity: Entity, snapshot: SimulationSnapshot): void {
    const { ctx } = this;
    const color = entityPalette.alien;
    const rotation = snapshot.time * 0.35 + entity.phase;
    ctx.save();
    ctx.translate(entity.position.x, entity.position.y);
    ctx.rotate(rotation);
    ctx.strokeStyle = rgba(color, 0.58);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < 5; i += 1) {
      const angle = (i / 5) * Math.PI * 2;
      const radius = entity.size * (0.7 + Math.sin(snapshot.time * 3 + i + entity.id) * 0.18);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 0.32 + snapshot.anomalyPulse * 0.22;
    ctx.beginPath();
    ctx.ellipse(0, 0, entity.size * 1.9, entity.size * 0.65, Math.sin(snapshot.time + entity.id) * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawTool(snapshot: SimulationSnapshot): void {
    if (!snapshot.tool.visible && snapshot.tool.strength <= 0.01) return;
    const { ctx } = this;
    const color = toolPalette[snapshot.tool.active];
    const radius = snapshot.tool.radius * (0.9 + snapshot.tool.pulse * 0.1);
    ctx.save();
    ctx.strokeStyle = rgba(color, 0.18 + snapshot.tool.strength * 0.15);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(snapshot.tool.worldPosition.x, snapshot.tool.worldPosition.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = rgba(color, 0.12 + snapshot.tool.pulse * 0.18);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(snapshot.tool.worldPosition.x, snapshot.tool.worldPosition.y, radius * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawAnomalyGlitch(snapshot: SimulationSnapshot, width: number, height: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const alpha = clamp((snapshot.narrativeHint - 0.42) * 0.18, 0, 0.12);
    for (let i = 0; i < 3; i += 1) {
      const y = (snapshot.time * 24 + i * 160) % height;
      ctx.fillStyle = `rgba(221, 164, 255, ${alpha})`;
      ctx.fillRect(0, y, width, 1 + i);
    }
    ctx.restore();
  }

  private primaryZone(cell: ZoneCell): ZoneType {
    let zone: ZoneType = 'drift';
    for (const key of Object.keys(cell.weights) as ZoneType[]) {
      if (cell.weights[key] > cell.weights[zone]) zone = key;
    }
    return zone;
  }
}
