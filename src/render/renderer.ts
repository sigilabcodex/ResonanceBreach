import { GAME_TITLE, WORLD_HEIGHT, WORLD_WIDTH, type EntityType, type ToolType } from '../config';
import type { Attractor, CameraState, Entity, EventBurst, FeedParticle, SimulationSnapshot, TerrainCell, ToolField } from '../sim/types';

const rgba = (color: readonly [number, number, number], alpha: number) => `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
const hsla = (h: number, s: number, l: number, a: number) => `hsla(${h} ${s}% ${l}% / ${a})`;

const entityPalette: Record<EntityType, readonly [number, number, number]> = {
  flocker: [205, 236, 248],
  cluster: [157, 244, 208],
  plant: [122, 214, 156],
  predator: [255, 154, 188],
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
    this.drawBackdrop(snapshot, width, height);

    ctx.save();
    ctx.translate(view.offsetX, view.offsetY);
    ctx.scale(view.scale, view.scale);

    this.drawTerrain(snapshot.terrain, snapshot.time);
    this.drawFlows(snapshot.terrain, snapshot.time);
    this.drawAttractors(snapshot.attractors, snapshot.time);
    this.drawBursts(snapshot.bursts);
    this.drawParticles(snapshot.particles);
    this.drawConnections(snapshot.entities, snapshot.time);
    this.drawEntityAuras(snapshot.entities);
    this.drawEntities(snapshot.entities, snapshot.time);
    this.drawFields(snapshot.fields, snapshot.time);
    this.drawToolPreview(snapshot);
    this.drawBoundaryFade(snapshot.time);

    ctx.restore();

    this.drawMinimap(snapshot, width, height);
    this.drawOverlay(snapshot, width, height);
  }

  private getView(camera: CameraState, width: number, height: number) {
    const scale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT) * camera.zoom;
    return {
      scale,
      offsetX: width * 0.5 - camera.center.x * scale,
      offsetY: height * 0.5 - camera.center.y * scale,
    };
  }

  private drawBackdrop(snapshot: SimulationSnapshot, width: number, height: number): void {
    const { ctx } = this;
    const focus = snapshot.stats.focus;
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, `rgba(8, 20, 31, ${0.92 + focus * 0.05})`);
    sky.addColorStop(0.45, 'rgba(4, 10, 17, 0.98)');
    sky.addColorStop(1, 'rgba(1, 4, 8, 1)');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const bloom = ctx.createRadialGradient(width * 0.45, height * 0.42, 80, width * 0.45, height * 0.42, Math.max(width, height) * 0.65);
    bloom.addColorStop(0, 'rgba(66, 120, 144, 0.12)');
    bloom.addColorStop(0.5, 'rgba(44, 70, 110, 0.05)');
    bloom.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, width, height);

    if (focus > 0.05) {
      ctx.fillStyle = `rgba(0, 0, 0, ${0.12 + focus * 0.22})`;
      ctx.fillRect(0, 0, width, height);
    }
  }

  private drawTerrain(samples: TerrainCell[], time: number): void {
    const { ctx } = this;
    for (const sample of samples) {
      const hue = sample.terrain === 'dense' ? 132 + sample.hue * 20 : sample.terrain === 'hard' ? 248 + sample.hue * 12 : 194 + sample.hue * 18;
      const sat = sample.terrain === 'hard' ? 18 : sample.terrain === 'dense' ? 36 : 30;
      const light = sample.terrain === 'hard' ? 30 : sample.terrain === 'dense' ? 34 : 28;
      const gradient = ctx.createRadialGradient(sample.center.x, sample.center.y, sample.radius * 0.14, sample.center.x, sample.center.y, sample.radius * 1.3);
      gradient.addColorStop(0, hsla(hue, sat, light + sample.fertility * 10, 0.22 + sample.resonance * 0.16));
      gradient.addColorStop(0.52, hsla(hue, sat, light, 0.08 + sample.stability * 0.06));
      gradient.addColorStop(1, hsla(hue, sat, light, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(sample.center.x, sample.center.y, sample.radius * (1 + Math.sin(time * 0.08 + sample.index) * 0.03), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawFlows(samples: TerrainCell[], time: number): void {
    const { ctx } = this;
    ctx.save();
    for (const sample of samples) {
      const hue = sample.terrain === 'dense' ? 142 : sample.terrain === 'hard' ? 252 : 200;
      ctx.strokeStyle = hsla(hue, 40, 74, sample.terrain === 'hard' ? 0.06 : 0.1 + sample.resonance * 0.06);
      ctx.lineWidth = sample.terrain === 'hard' ? 1 : 1.3;
      const flowLen = sample.terrain === 'dense' ? 28 : sample.terrain === 'hard' ? 18 : 36;
      const baseAngle = Math.atan2(sample.flow.y, sample.flow.x);
      ctx.beginPath();
      for (let i = 0; i < 3; i += 1) {
        const phase = time * 0.4 + i * 0.9 + sample.index * 0.15;
        const offsetX = Math.cos(baseAngle + Math.PI * 0.5) * (i - 1) * 10;
        const offsetY = Math.sin(baseAngle + Math.PI * 0.5) * (i - 1) * 10;
        const startX = sample.center.x + offsetX - Math.cos(baseAngle) * flowLen * 0.5;
        const startY = sample.center.y + offsetY - Math.sin(baseAngle) * flowLen * 0.5;
        const midX = sample.center.x + offsetX + Math.sin(phase) * 8;
        const midY = sample.center.y + offsetY + Math.cos(phase) * 8;
        const endX = sample.center.x + offsetX + Math.cos(baseAngle) * flowLen * 0.5;
        const endY = sample.center.y + offsetY + Math.sin(baseAngle) * flowLen * 0.5;
        ctx.moveTo(startX, startY);
        ctx.quadraticCurveTo(midX, midY, endX, endY);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawAttractors(attractors: Attractor[], time: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const attractor of attractors) {
      const hue = 190 + attractor.hue * 70;
      const gradient = ctx.createRadialGradient(attractor.position.x, attractor.position.y, attractor.radius * 0.05, attractor.position.x, attractor.position.y, attractor.radius * 1.05);
      gradient.addColorStop(0, hsla(hue, 62, 72, 0.18));
      gradient.addColorStop(0.55, hsla(hue, 46, 58, 0.07));
      gradient.addColorStop(1, hsla(hue, 32, 40, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(attractor.position.x, attractor.position.y, attractor.radius * 1.05, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = hsla(hue, 44, 78, 0.14);
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 2; i += 1) {
        ctx.beginPath();
        ctx.ellipse(attractor.position.x, attractor.position.y, attractor.radius * (0.34 + i * 0.22), attractor.radius * (0.22 + i * 0.14), time * 0.1 + attractor.orbit * 0.4 + i * 0.7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawBursts(bursts: EventBurst[]): void {
    const { ctx } = this;
    ctx.save();
    for (const burst of bursts) {
      const progress = burst.age / burst.duration;
      const alpha = (1 - progress) * (burst.type === 'death' ? 0.3 : 0.45);
      const radius = burst.radius * (0.55 + progress * 1.3);
      const hue = burst.type === 'feed' ? 42 : burst.type === 'birth' ? 138 : 334;
      ctx.strokeStyle = hsla(hue + burst.hue * 40, burst.type === 'death' ? 52 : 68, 72, alpha);
      ctx.lineWidth = burst.type === 'death' ? 1.6 : 2.2;
      ctx.beginPath();
      ctx.arc(burst.position.x, burst.position.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawParticles(particles: FeedParticle[]): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const particle of particles) {
      const alpha = 1 - particle.age / particle.duration;
      ctx.fillStyle = hsla(44 + particle.energy * 24, 88, 76, 0.18 + alpha * 0.42);
      ctx.beginPath();
      ctx.arc(particle.position.x, particle.position.y, 1.8 + particle.energy * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
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
        if (dist > 96) continue;
        const strength = 1 - dist / 96;
        if (a.type === 'cluster' && b.type === 'cluster') {
          ctx.strokeStyle = `rgba(168, 244, 210, ${0.04 + strength * 0.1})`;
        } else if ((a.type === 'predator' && b.type === 'flocker') || (a.type === 'flocker' && b.type === 'predator')) {
          ctx.strokeStyle = `rgba(255, 124, 170, ${0.04 + strength * 0.08})`;
        } else if (a.type === 'flocker' && b.type === 'flocker') {
          ctx.strokeStyle = `rgba(208, 236, 248, ${0.02 + strength * 0.05})`;
        } else {
          continue;
        }
        ctx.lineWidth = 0.6 + strength * 0.8;
        ctx.beginPath();
        ctx.moveTo(a.position.x, a.position.y);
        ctx.quadraticCurveTo((a.position.x + b.position.x) * 0.5 + Math.sin(time + a.id + b.id) * 4, (a.position.y + b.position.y) * 0.5 + Math.cos(time * 1.1 + a.id - b.id) * 4, b.position.x, b.position.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawEntityAuras(entities: Entity[]): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const entity of entities) {
      const color = entityPalette[entity.type];
      const stateBoost = entity.visualState === 'feeding' ? 0.18 : entity.visualState === 'reproducing' ? 0.22 : entity.visualState === 'dying' ? 0.14 : 0;
      const radius = entity.size * (entity.type === 'cluster' ? 4.2 : entity.type === 'predator' ? 3 : 2.6) * (1 + entity.pulse * 0.14 + stateBoost);
      const gradient = ctx.createRadialGradient(entity.position.x, entity.position.y, entity.size * 0.15, entity.position.x, entity.position.y, radius);
      gradient.addColorStop(0, rgba(color, (0.08 + entity.resonance * 0.08 + stateBoost) * entity.boundaryFade));
      gradient.addColorStop(0.6, rgba(color, (0.03 + entity.visualPulse * 0.08) * entity.boundaryFade));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(entity.position.x, entity.position.y, radius, 0, Math.PI * 2);
      ctx.fill();

      if (entity.visualState !== 'idle') {
        const accentHue = entity.visualState === 'feeding' ? 42 : entity.visualState === 'reproducing' ? 142 : 334;
        ctx.strokeStyle = hsla(accentHue, 80, 72, (0.08 + entity.visualPulse * 0.22) * entity.boundaryFade);
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(entity.position.x, entity.position.y, radius * 0.72, 0, Math.PI * 2);
        ctx.stroke();
      }
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
    ctx.rotate(entity.heading + Math.sin(time * 1.8 + entity.id) * 0.16);
    ctx.globalAlpha = entity.boundaryFade;
    ctx.fillStyle = rgba(color, 0.88);
    ctx.beginPath();
    ctx.moveTo(entity.size * 1.15, 0);
    ctx.lineTo(-entity.size * 0.85, entity.size * (0.28 + entity.shape * 0.24));
    ctx.lineTo(-entity.size * 0.3, 0);
    ctx.lineTo(-entity.size * 0.85, -entity.size * (0.28 + entity.shape * 0.24));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(color, 0.36);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-entity.size * 0.5, 0);
    ctx.lineTo(-entity.size * 1.2, entity.size * 0.46);
    ctx.moveTo(-entity.size * 0.5, 0);
    ctx.lineTo(-entity.size * 1.2, -entity.size * 0.46);
    ctx.stroke();
    ctx.restore();
  }

  private drawCluster(entity: Entity, time: number): void {
    const { ctx } = this;
    const color = entityPalette.cluster;
    ctx.save();
    ctx.translate(entity.position.x, entity.position.y);
    ctx.rotate(time * 0.06 + entity.id * 0.08);
    ctx.globalAlpha = entity.boundaryFade;
    ctx.fillStyle = rgba(color, 0.38 + entity.resonance * 0.24);
    ctx.beginPath();
    for (let i = 0; i < 7; i += 1) {
      const angle = (i / 7) * Math.PI * 2;
      const radius = entity.size * (0.78 + Math.sin(time * 0.8 + entity.id * 0.25 + i) * 0.16 + entity.shape * 0.14);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius * (0.72 + entity.shape * 0.24);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(color, 0.24 + entity.growth * 0.16);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  private drawPlant(entity: Entity, time: number): void {
    const { ctx } = this;
    const color = entityPalette.plant;
    ctx.save();
    ctx.translate(entity.position.x, entity.position.y);
    ctx.rotate(Math.sin(time * 0.7 + entity.id) * 0.11);
    ctx.globalAlpha = entity.boundaryFade;
    ctx.strokeStyle = rgba(color, 0.54);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, entity.size * 1.24);
    ctx.lineTo(0, -entity.size * 0.9);
    ctx.stroke();
    ctx.fillStyle = rgba(color, 0.72);
    ctx.beginPath();
    ctx.ellipse(-entity.size * 0.35, -entity.size * 0.2, entity.size * (0.28 + entity.shape * 0.08), entity.size * 0.62, -0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(entity.size * 0.34, -entity.size * 0.34, entity.size * (0.26 + entity.shape * 0.1), entity.size * 0.64, 0.48, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-entity.size * 0.15, -entity.size * 0.62);
    ctx.lineTo(entity.size * 0.6, -entity.size * 1.14);
    ctx.lineTo(entity.size * 0.24, -entity.size * 0.26);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawPredator(entity: Entity, time: number): void {
    const { ctx } = this;
    const color = entityPalette.predator;
    ctx.save();
    ctx.translate(entity.position.x, entity.position.y);
    ctx.rotate(entity.heading + Math.sin(time * 0.9 + entity.id) * 0.08);
    ctx.globalAlpha = entity.boundaryFade;
    ctx.strokeStyle = rgba(color, 0.68);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(entity.size * 1.18, 0);
    ctx.lineTo(-entity.size * 0.1, entity.size * 0.74);
    ctx.lineTo(-entity.size * 0.96, 0);
    ctx.lineTo(-entity.size * 0.1, -entity.size * 0.74);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-entity.size * 0.3, 0);
    ctx.lineTo(-entity.size * 1.2, entity.size * 0.26);
    ctx.lineTo(-entity.size * 1.2, -entity.size * 0.26);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  private drawFields(fields: ToolField[], time: number): void {
    const { ctx } = this;
    ctx.save();
    for (const field of fields) {
      const color = toolPalette[field.tool];
      const alpha = field.tool === 'observe' ? 0.08 + field.strength * 0.1 : 0.12 + field.strength * 0.18;
      const radius = field.radius * (1 + Math.sin(time * 1.4 + field.id) * 0.02);
      const gradient = ctx.createRadialGradient(field.position.x, field.position.y, radius * 0.2, field.position.x, field.position.y, radius);
      gradient.addColorStop(0, rgba(color, alpha + field.pulse * 0.08));
      gradient.addColorStop(0.62, rgba(color, alpha * 0.38));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(field.position.x, field.position.y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = rgba(color, field.tool === 'observe' ? 0.18 : 0.14 + field.strength * 0.18);
      ctx.lineWidth = field.tool === 'observe' ? 1.2 : 1.8;
      ctx.beginPath();
      ctx.arc(field.position.x, field.position.y, radius * (field.tool === 'repel' ? 0.65 + field.age * 0.2 : 1), 0, Math.PI * 2);
      ctx.stroke();

      if (field.tool === 'grow') {
        ctx.strokeStyle = rgba(color, 0.12 + field.strength * 0.16);
        for (let i = 0; i < 6; i += 1) {
          const angle = time * 0.5 + i * (Math.PI / 3);
          ctx.beginPath();
          ctx.moveTo(field.position.x + Math.cos(angle) * radius * 0.2, field.position.y + Math.sin(angle) * radius * 0.2);
          ctx.lineTo(field.position.x + Math.cos(angle) * radius * 0.78, field.position.y + Math.sin(angle) * radius * 0.78);
          ctx.stroke();
        }
      } else if (field.tool === 'repel') {
        ctx.strokeStyle = rgba(color, 0.1 + field.strength * 0.22);
        for (let i = 0; i < 3; i += 1) {
          ctx.beginPath();
          ctx.arc(field.position.x, field.position.y, radius * (0.32 + i * 0.18 + field.age * 0.08), 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (field.tool === 'disrupt') {
        ctx.strokeStyle = rgba(color, 0.14 + field.strength * 0.2);
        ctx.beginPath();
        for (let i = 0; i <= 12; i += 1) {
          const angle = (i / 12) * Math.PI * 2;
          const wobble = 1 + Math.sin(time * 6 + field.id + i) * 0.14;
          const x = field.position.x + Math.cos(angle) * radius * wobble;
          const y = field.position.y + Math.sin(angle) * radius * wobble;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawToolPreview(snapshot: SimulationSnapshot): void {
    if (!snapshot.tool.visible) return;
    const { ctx } = this;
    const color = toolPalette[snapshot.tool.active];
    ctx.save();
    ctx.strokeStyle = rgba(color, snapshot.tool.blocked ? 0.42 : 0.12 + snapshot.tool.pulse * 0.14);
    ctx.lineWidth = 1.2;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.arc(snapshot.tool.worldPosition.x, snapshot.tool.worldPosition.y, snapshot.tool.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (snapshot.tool.feedback) {
      ctx.strokeStyle = rgba(color, 0.12 + snapshot.tool.feedback.intensity * 0.18);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(snapshot.tool.feedback.position.x, snapshot.tool.feedback.position.y, snapshot.tool.radius * (0.35 + snapshot.tool.feedback.intensity * 0.4), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBoundaryFade(time: number): void {
    const { ctx } = this;
    ctx.save();
    const vignette = ctx.createRadialGradient(WORLD_WIDTH * 0.5, WORLD_HEIGHT * 0.5, WORLD_HEIGHT * 0.3, WORLD_WIDTH * 0.5, WORLD_HEIGHT * 0.5, WORLD_WIDTH * 0.72);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(0.78, 'rgba(0,0,0,0.02)');
    vignette.addColorStop(1, `rgba(0,0,0,${0.14 + Math.sin(time * 0.08) * 0.02})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
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

    for (const sample of snapshot.terrain) {
      const hue = sample.terrain === 'dense' ? 138 : sample.terrain === 'hard' ? 246 : 196;
      ctx.fillStyle = hsla(hue, sample.terrain === 'hard' ? 18 : 34, sample.terrain === 'hard' ? 52 : 58, 0.14);
      ctx.beginPath();
      ctx.arc(x + (sample.center.x / WORLD_WIDTH) * mapWidth, y + (sample.center.y / WORLD_HEIGHT) * mapHeight, (sample.radius / WORLD_WIDTH) * mapWidth, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const entity of snapshot.entities.slice(0, 160)) {
      ctx.fillStyle = rgba(entityPalette[entity.type], entity.type === 'predator' ? 0.72 : 0.42);
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

  private drawOverlay(snapshot: SimulationSnapshot, width: number, height: number): void {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.font = '500 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(GAME_TITLE, width - 16, height - 16);

    if (snapshot.stats.focus > 0.05) {
      ctx.save();
      ctx.strokeStyle = `rgba(180,224,255,${0.08 + snapshot.stats.focus * 0.18})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(width * 0.5, height * 0.5, Math.min(width, height) * (0.16 + snapshot.stats.focus * 0.1), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}
