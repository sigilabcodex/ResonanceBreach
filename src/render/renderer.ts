import { GAME_TITLE, WORLD_HEIGHT, WORLD_WIDTH, type EntityType, type TerrainType, type ToolType } from '../config';
import type { CameraState, Entity, SimulationSnapshot, TerrainCell } from '../sim/types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rgba = (color: readonly [number, number, number], alpha: number) => `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;

const terrainPalette: Record<TerrainType, readonly [number, number, number]> = {
  fluid: [105, 170, 198],
  dense: [120, 186, 132],
  hard: [114, 118, 132],
};

const entityPalette: Record<EntityType, readonly [number, number, number]> = {
  flocker: [204, 234, 248],
  cluster: [160, 244, 202],
  plant: [122, 214, 156],
  predator: [255, 157, 190],
};

const toolPalette: Record<ToolType, readonly [number, number, number]> = {
  observe: [180, 224, 255],
  grow: [154, 240, 171],
  feed: [255, 216, 136],
  repel: [255, 154, 186],
  disrupt: [208, 161, 255],
};

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable.');
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

    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, `rgba(10, 24, 36, ${0.94 - snapshot.stats.energy * 0.08})`);
    sky.addColorStop(0.52, 'rgba(4, 10, 17, 0.98)');
    sky.addColorStop(1, 'rgba(2, 5, 10, 1)');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(view.offsetX, view.offsetY);
    ctx.scale(view.scale, view.scale);

    this.drawWorldFrame(snapshot);
    this.drawTerrain(snapshot.terrain, snapshot);
    this.drawConnections(snapshot.entities, snapshot.time);
    this.drawEntityAuras(snapshot.entities, snapshot.time);
    this.drawEntities(snapshot.entities, snapshot.time);
    this.drawTool(snapshot);

    ctx.restore();

    this.drawMinimap(snapshot, width, height);

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

  private drawWorldFrame(snapshot: SimulationSnapshot): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${0.06 + snapshot.stats.energy * 0.08})`;
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    ctx.restore();
  }

  private drawTerrain(cells: TerrainCell[], snapshot: SimulationSnapshot): void {
    const { ctx } = this;
    for (const cell of cells) {
      const color = terrainPalette[cell.terrain];
      const alpha = cell.terrain === 'fluid' ? 0.12 : cell.terrain === 'dense' ? 0.14 : 0.16;
      const gradient = ctx.createRadialGradient(
        cell.center.x,
        cell.center.y,
        Math.min(cell.bounds.width, cell.bounds.height) * 0.15,
        cell.center.x,
        cell.center.y,
        Math.max(cell.bounds.width, cell.bounds.height) * 0.9,
      );
      gradient.addColorStop(0, rgba(color, alpha + cell.resonance * 0.12));
      gradient.addColorStop(0.58, rgba(color, alpha * 0.54));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(cell.bounds.x - 20, cell.bounds.y - 20, cell.bounds.width + 40, cell.bounds.height + 40);

      ctx.save();
      if (cell.terrain === 'fluid') {
        ctx.strokeStyle = rgba(color, 0.12 + cell.resonance * 0.08);
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (let i = 0; i <= 7; i += 1) {
          const x = cell.bounds.x + (cell.bounds.width / 7) * i;
          const y = cell.center.y + Math.sin(snapshot.time * 0.65 + i * 0.65 + cell.height * 4) * (8 + cell.resonance * 14);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else if (cell.terrain === 'dense') {
        ctx.strokeStyle = rgba(color, 0.1 + cell.fertility * 0.08);
        ctx.lineWidth = 1;
        for (let i = 0; i < 5; i += 1) {
          const px = cell.bounds.x + cell.bounds.width * (0.15 + i * 0.16);
          const py = cell.bounds.y + cell.bounds.height * (0.3 + (i % 2) * 0.18);
          ctx.beginPath();
          ctx.moveTo(px, py + 10);
          ctx.lineTo(px - 5, py - 10);
          ctx.lineTo(px + 5, py - 16);
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = rgba(color, 0.08 + cell.roughness * 0.08);
        for (let i = 0; i < 3; i += 1) {
          const size = 18 + i * 11 + cell.roughness * 12;
          const px = cell.center.x + Math.cos(cell.height * 7 + i) * 22;
          const py = cell.center.y + Math.sin(cell.roughness * 9 + i) * 20;
          ctx.beginPath();
          ctx.moveTo(px, py - size * 0.6);
          ctx.lineTo(px + size * 0.6, py);
          ctx.lineTo(px, py + size * 0.6);
          ctx.lineTo(px - size * 0.7, py);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  private drawConnections(entities: Entity[], time: number): void {
    const { ctx } = this;
    ctx.save();
    for (let i = 0; i < entities.length; i += 1) {
      const a = entities[i];
      for (let j = i + 1; j < entities.length; j += 1) {
        const b = entities[j];
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 120) continue;
        const strength = 1 - dist / 120;
        if (a.type === 'cluster' && b.type === 'cluster' && a.clusterId !== 0 && a.clusterId === b.clusterId) {
          ctx.strokeStyle = `rgba(168, 244, 210, ${0.08 + strength * 0.18})`;
        } else if ((a.type === 'predator' && b.type === 'flocker') || (a.type === 'flocker' && b.type === 'predator')) {
          ctx.strokeStyle = `rgba(255, 120, 170, ${0.05 + strength * 0.12})`;
        } else {
          continue;
        }
        ctx.lineWidth = 0.7 + strength * 1.2;
        ctx.beginPath();
        ctx.moveTo(a.position.x, a.position.y);
        ctx.lineTo(b.position.x + Math.sin(time + b.id) * 1.5, b.position.y + Math.cos(time + a.id) * 1.5);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawEntityAuras(entities: Entity[], time: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const entity of entities) {
      const color = entityPalette[entity.type];
      const pulse = 1 + Math.sin(time * (0.8 + entity.energy) + entity.id) * 0.05 + entity.pulse * 0.18;
      const radius = entity.size * (entity.type === 'cluster' ? 3.8 : entity.type === 'predator' ? 2.8 : 2.4) * pulse;
      const gradient = ctx.createRadialGradient(entity.position.x, entity.position.y, entity.size * 0.2, entity.position.x, entity.position.y, radius);
      gradient.addColorStop(0, rgba(color, 0.08 + entity.resonance * 0.08));
      gradient.addColorStop(0.55, rgba(color, 0.03 + entity.pulse * 0.08));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(entity.position.x, entity.position.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawEntities(entities: Entity[], time: number): void {
    for (const entity of entities) {
      if (entity.type === 'flocker') this.drawFlocker(entity, time);
      else if (entity.type === 'cluster') this.drawCluster(entity, time);
      else if (entity.type === 'plant') this.drawPlant(entity, time);
      else this.drawPredator(entity, time);
    }
  }

  private drawFlocker(entity: Entity, time: number): void {
    const { ctx } = this;
    const color = entityPalette.flocker;
    ctx.save();
    ctx.translate(entity.position.x, entity.position.y);
    ctx.rotate(entity.heading + Math.sin(time * 1.6 + entity.id) * 0.18);
    ctx.fillStyle = rgba(color, 0.88);
    ctx.beginPath();
    ctx.moveTo(entity.size * 1.1, 0);
    ctx.lineTo(-entity.size * 0.8, entity.size * (0.35 + entity.shape * 0.2));
    ctx.lineTo(-entity.size * 0.25, 0);
    ctx.lineTo(-entity.size * 0.8, -entity.size * (0.35 + entity.shape * 0.2));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(color, 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-entity.size * 0.65, 0);
    ctx.lineTo(-entity.size * 1.3, entity.size * 0.55);
    ctx.moveTo(-entity.size * 0.65, 0);
    ctx.lineTo(-entity.size * 1.3, -entity.size * 0.55);
    ctx.stroke();
    ctx.restore();
  }

  private drawCluster(entity: Entity, time: number): void {
    const { ctx } = this;
    const color = entityPalette.cluster;
    ctx.save();
    ctx.translate(entity.position.x, entity.position.y);
    ctx.fillStyle = rgba(color, 0.38 + entity.resonance * 0.22);
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const radius = entity.size * (0.84 + Math.sin(time * 0.7 + entity.id * 0.2 + i) * 0.15 + entity.shape * 0.12);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius * (0.78 + entity.shape * 0.22);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(color, 0.2 + entity.growth * 0.18);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  private drawPlant(entity: Entity, time: number): void {
    const { ctx } = this;
    const color = entityPalette.plant;
    ctx.save();
    ctx.translate(entity.position.x, entity.position.y);
    ctx.rotate(Math.sin(time * 0.8 + entity.id) * 0.12);
    ctx.strokeStyle = rgba(color, 0.56);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, entity.size * 1.2);
    ctx.lineTo(0, -entity.size * 0.9);
    ctx.stroke();
    ctx.fillStyle = rgba(color, 0.74);
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.ellipse((i - 1) * entity.size * 0.45, -entity.size * (0.35 + i * 0.12), entity.size * (0.26 + entity.shape * 0.08), entity.size * 0.58, (i - 1) * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPredator(entity: Entity, time: number): void {
    const { ctx } = this;
    const color = entityPalette.predator;
    ctx.save();
    ctx.translate(entity.position.x, entity.position.y);
    ctx.rotate(entity.heading);
    ctx.strokeStyle = rgba(color, 0.7);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(entity.size * 1.1, 0);
    ctx.lineTo(-entity.size * 0.2, entity.size * 0.72);
    ctx.lineTo(-entity.size * 0.9, 0);
    ctx.lineTo(-entity.size * 0.2, -entity.size * 0.72);
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 0.25 + entity.pulse * 0.16;
    ctx.beginPath();
    ctx.ellipse(0, 0, entity.size * 1.4, entity.size * 0.46, Math.sin(time * 1.2 + entity.id) * 0.25, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawTool(snapshot: SimulationSnapshot): void {
    if (!snapshot.tool.visible && snapshot.tool.strength <= 0.01) return;
    const { ctx } = this;
    const color = toolPalette[snapshot.tool.active];
    const radius = snapshot.tool.radius * (0.9 + snapshot.tool.pulse * 0.1);
    ctx.save();
    ctx.strokeStyle = rgba(color, snapshot.tool.blocked ? 0.44 : 0.18 + snapshot.tool.strength * 0.16);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(snapshot.tool.worldPosition.x, snapshot.tool.worldPosition.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    if (snapshot.tool.active === 'grow') {
      ctx.strokeStyle = rgba(color, 0.16 + snapshot.tool.strength * 0.18);
      for (let i = 0; i < 6; i += 1) {
        const angle = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(snapshot.tool.worldPosition.x + Math.cos(angle) * radius * 0.25, snapshot.tool.worldPosition.y + Math.sin(angle) * radius * 0.25);
        ctx.lineTo(snapshot.tool.worldPosition.x + Math.cos(angle) * radius * 0.78, snapshot.tool.worldPosition.y + Math.sin(angle) * radius * 0.78);
        ctx.stroke();
      }
    } else if (snapshot.tool.active === 'feed') {
      ctx.fillStyle = rgba(color, 0.18 + snapshot.tool.strength * 0.14);
      for (let i = 0; i < 12; i += 1) {
        const angle = snapshot.time * 2.4 + i * 0.52;
        const dist = radius * (0.18 + (i % 4) * 0.18);
        ctx.beginPath();
        ctx.arc(snapshot.tool.worldPosition.x + Math.cos(angle) * dist, snapshot.tool.worldPosition.y + Math.sin(angle) * dist, 2.2 + (i % 3), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (snapshot.tool.active === 'repel') {
      ctx.strokeStyle = rgba(color, 0.14 + snapshot.tool.strength * 0.18);
      for (let i = 0; i < 3; i += 1) {
        ctx.beginPath();
        ctx.arc(snapshot.tool.worldPosition.x, snapshot.tool.worldPosition.y, radius * (0.35 + i * 0.2), 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (snapshot.tool.active === 'disrupt') {
      ctx.strokeStyle = rgba(color, 0.18 + snapshot.tool.strength * 0.2);
      ctx.beginPath();
      for (let i = 0; i < 9; i += 1) {
        const angle = (i / 8) * Math.PI * 2;
        const wobble = 1 + Math.sin(snapshot.time * 6 + i) * 0.15;
        const x = snapshot.tool.worldPosition.x + Math.cos(angle) * radius * wobble;
        const y = snapshot.tool.worldPosition.y + Math.sin(angle) * radius * wobble;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    if (snapshot.tool.feedback) {
      const pulse = clamp(snapshot.tool.feedback.intensity, 0, 1);
      ctx.strokeStyle = rgba(color, 0.08 + pulse * 0.18);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(snapshot.tool.feedback.position.x, snapshot.tool.feedback.position.y, radius * (0.42 + pulse * 0.4), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawMinimap(snapshot: SimulationSnapshot, width: number, height: number): void {
    const { ctx } = this;
    const mapWidth = 160;
    const mapHeight = (WORLD_HEIGHT / WORLD_WIDTH) * mapWidth;
    const x = width - mapWidth - 18;
    const y = height - mapHeight - 42;

    ctx.save();
    ctx.fillStyle = 'rgba(4, 10, 18, 0.68)';
    ctx.strokeStyle = 'rgba(170, 210, 255, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, mapWidth, mapHeight, 16);
    ctx.fill();
    ctx.stroke();

    for (const cell of snapshot.terrain) {
      const color = terrainPalette[cell.terrain];
      const px = x + (cell.bounds.x / WORLD_WIDTH) * mapWidth;
      const py = y + (cell.bounds.y / WORLD_HEIGHT) * mapHeight;
      const pw = (cell.bounds.width / WORLD_WIDTH) * mapWidth;
      const ph = (cell.bounds.height / WORLD_HEIGHT) * mapHeight;
      ctx.fillStyle = rgba(color, 0.18);
      ctx.fillRect(px, py, pw, ph);
    }

    for (const entity of snapshot.entities.slice(0, 140)) {
      ctx.fillStyle = rgba(entityPalette[entity.type], entity.type === 'predator' ? 0.7 : 0.42);
      ctx.beginPath();
      ctx.arc(x + (entity.position.x / WORLD_WIDTH) * mapWidth, y + (entity.position.y / WORLD_HEIGHT) * mapHeight, entity.type === 'predator' ? 2 : 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    const baseScale = Math.min(this.canvas.clientWidth / WORLD_WIDTH, this.canvas.clientHeight / WORLD_HEIGHT);
    const visibleWorldWidth = this.canvas.clientWidth / (baseScale * snapshot.camera.zoom);
    const visibleWorldHeight = this.canvas.clientHeight / (baseScale * snapshot.camera.zoom);
    ctx.strokeStyle = 'rgba(255,255,255,0.44)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(
      x + ((snapshot.camera.center.x - visibleWorldWidth * 0.5) / WORLD_WIDTH) * mapWidth,
      y + ((snapshot.camera.center.y - visibleWorldHeight * 0.5) / WORLD_HEIGHT) * mapHeight,
      (visibleWorldWidth / WORLD_WIDTH) * mapWidth,
      (visibleWorldHeight / WORLD_HEIGHT) * mapHeight,
    );
    ctx.restore();
  }
}
