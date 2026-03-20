import { GAME_TITLE, WORLD_HEIGHT, WORLD_WIDTH, type EntityType, type TerrainType, type ToolType } from '../config';
import type { Attractor, CameraState, Entity, EventBurst, FeedParticle, Residue, SimulationSnapshot, TerrainCell, ToolField } from '../types/world';

const rgba = (color: readonly [number, number, number], alpha: number) => `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
const hsla = (h: number, s: number, l: number, a: number) => `hsla(${h} ${s}% ${l}% / ${a})`;

const entityPalette: Record<EntityType, readonly [number, number, number]> = {
  flocker: [206, 234, 244],
  cluster: [182, 228, 202],
  plant: [130, 205, 146],
  predator: [244, 176, 202],
};

const toolPalette: Record<ToolType, readonly [number, number, number]> = {
  observe: [182, 220, 242],
  grow: [160, 224, 164],
  feed: [244, 204, 128],
  repel: [232, 170, 192],
  disrupt: [198, 176, 244],
};

const terrainColors: Record<TerrainType, { hue: number; sat: number; light: number }> = {
  water: { hue: 197, sat: 34, light: 28 },
  fertile: { hue: 136, sat: 26, light: 28 },
  solid: { hue: 244, sat: 13, light: 24 },
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

    this.drawTerrain(snapshot.terrain);
    this.drawTerrainContours(snapshot.terrain, snapshot.time);
    this.drawAttractors(snapshot.attractors);
    this.drawResidues(snapshot.residues);
    this.drawFields(snapshot.fields, snapshot.time);
    this.drawParticles(snapshot.particles);
    this.drawBursts(snapshot.bursts);
    this.drawEntityAuras(snapshot.entities);
    this.drawEntities(snapshot.entities, snapshot.time);
    this.drawToolPreview(snapshot);
    this.drawBoundaryFade();

    ctx.restore();

    this.drawFocusMask(snapshot, width, height, view.scale, view.offsetX, view.offsetY);
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
    const base = ctx.createLinearGradient(0, 0, 0, height);
    base.addColorStop(0, 'rgba(8, 18, 24, 1)');
    base.addColorStop(0.55, 'rgba(4, 11, 16, 1)');
    base.addColorStop(1, 'rgba(3, 6, 10, 1)');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);

    const bloom = ctx.createRadialGradient(width * 0.48, height * 0.42, 60, width * 0.48, height * 0.42, Math.max(width, height) * 0.75);
    bloom.addColorStop(0, 'rgba(66, 114, 126, 0.12)');
    bloom.addColorStop(0.4, 'rgba(36, 74, 94, 0.05)');
    bloom.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, width, height);

    const lowMist = ctx.createRadialGradient(width * 0.32, height * 0.76, 20, width * 0.32, height * 0.76, width * 0.44);
    lowMist.addColorStop(0, `rgba(102, 142, 126, ${0.06 + snapshot.stats.nutrients * 0.08})`);
    lowMist.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lowMist;
    ctx.fillRect(0, 0, width, height);
  }

  private drawTerrain(samples: TerrainCell[]): void {
    const { ctx } = this;
    for (const sample of samples) {
      const palette = terrainColors[sample.terrain];
      const gradient = ctx.createRadialGradient(sample.center.x, sample.center.y, sample.radius * 0.08, sample.center.x, sample.center.y, sample.radius * 1.4);
      gradient.addColorStop(0, hsla(palette.hue + sample.hue * 8, palette.sat + sample.nutrient * 12, palette.light + sample.fertility * 10, 0.22));
      gradient.addColorStop(0.55, hsla(palette.hue, palette.sat, palette.light + sample.nutrient * 6, 0.1));
      gradient.addColorStop(1, hsla(palette.hue, palette.sat, palette.light, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(sample.center.x, sample.center.y, sample.radius * 1.2, sample.radius * 0.96, sample.flow.x * 0.002, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawTerrainContours(samples: TerrainCell[], time: number): void {
    const { ctx } = this;
    ctx.save();
    for (const sample of samples) {
      const palette = terrainColors[sample.terrain];
      const alpha = sample.terrain === 'solid' ? 0.1 : 0.08;
      ctx.strokeStyle = hsla(palette.hue + sample.hue * 10, palette.sat + 8, 72, alpha + sample.nutrient * 0.04);
      ctx.lineWidth = sample.terrain === 'solid' ? 1.1 : 0.85;
      for (let ring = 0; ring < 2; ring += 1) {
        const radius = sample.radius * (0.46 + ring * 0.24);
        ctx.beginPath();
        for (let step = 0; step <= 20; step += 1) {
          const angle = (step / 20) * Math.PI * 2;
          const wobble = 1 + Math.sin(time * 0.1 + sample.index * 0.6 + angle * 2 + ring) * 0.04;
          const x = sample.center.x + Math.cos(angle) * radius * wobble;
          const y = sample.center.y + Math.sin(angle) * radius * wobble * 0.82;
          if (step === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawAttractors(attractors: Attractor[]): void {
    const { ctx } = this;
    ctx.save();
    for (const attractor of attractors) {
      const hue = 186 + attractor.hue * 34;
      const gradient = ctx.createRadialGradient(attractor.position.x, attractor.position.y, attractor.radius * 0.06, attractor.position.x, attractor.position.y, attractor.radius);
      gradient.addColorStop(0, hsla(hue, 44, 68, 0.08));
      gradient.addColorStop(0.7, hsla(hue, 28, 48, 0.02));
      gradient.addColorStop(1, hsla(hue, 22, 38, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(attractor.position.x, attractor.position.y, attractor.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawResidues(residues: Residue[]): void {
    const { ctx } = this;
    ctx.save();
    for (const residue of residues) {
      const alpha = (1 - residue.age / residue.duration) * 0.22;
      const gradient = ctx.createRadialGradient(residue.position.x, residue.position.y, residue.radius * 0.08, residue.position.x, residue.position.y, residue.radius);
      gradient.addColorStop(0, hsla(118, 34, 52, alpha));
      gradient.addColorStop(0.7, hsla(106, 22, 38, alpha * 0.4));
      gradient.addColorStop(1, hsla(96, 18, 26, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(residue.position.x, residue.position.y, residue.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawFields(fields: ToolField[], time: number): void {
    const { ctx } = this;
    ctx.save();
    for (const field of fields) {
      const color = toolPalette[field.tool];
      const fade = field.tool === 'observe' ? 0.16 : Math.max(field.strength, 0.15);
      const gradient = ctx.createRadialGradient(field.position.x, field.position.y, field.radius * 0.14, field.position.x, field.position.y, field.radius);
      gradient.addColorStop(0, rgba(color, 0.12 * fade));
      gradient.addColorStop(0.72, rgba(color, 0.045 * fade));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(field.position.x, field.position.y, field.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = rgba(color, field.tool === 'observe' ? 0.24 : 0.16 * fade);
      ctx.lineWidth = field.tool === 'observe' ? 1.3 : 1.15;
      ctx.beginPath();
      const waveRadius = field.tool === 'repel' ? field.radius * (0.28 + field.age * 0.18) : field.tool === 'disrupt' ? field.radius * (0.24 + Math.min(field.age, 1.8) * 0.16) : field.radius * 0.92;
      ctx.arc(field.position.x, field.position.y, Math.min(field.radius, waveRadius), 0, Math.PI * 2);
      ctx.stroke();

      if (field.tool === 'disrupt' && !field.exploded) {
        ctx.setLineDash([6, 10]);
        ctx.strokeStyle = rgba(color, 0.22);
        ctx.beginPath();
        ctx.arc(field.position.x, field.position.y, field.radius * 0.36, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (field.tool === 'grow') {
        ctx.strokeStyle = rgba(color, 0.12 * fade);
        for (let i = 0; i < 4; i += 1) {
          const angle = time * 0.08 + i * (Math.PI / 2);
          ctx.beginPath();
          ctx.moveTo(field.position.x + Math.cos(angle) * field.radius * 0.18, field.position.y + Math.sin(angle) * field.radius * 0.18);
          ctx.quadraticCurveTo(
            field.position.x + Math.cos(angle + 0.4) * field.radius * 0.44,
            field.position.y + Math.sin(angle + 0.4) * field.radius * 0.44,
            field.position.x + Math.cos(angle + 0.2) * field.radius * 0.72,
            field.position.y + Math.sin(angle + 0.2) * field.radius * 0.72,
          );
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  private drawParticles(particles: FeedParticle[]): void {
    const { ctx } = this;
    ctx.save();
    for (const particle of particles) {
      const alpha = 1 - particle.age / particle.duration;
      const hue = particle.kind === 'feed' ? 42 : 24;
      ctx.fillStyle = hsla(hue, particle.kind === 'feed' ? 82 : 70, particle.kind === 'feed' ? 74 : 66, 0.12 + alpha * 0.36);
      ctx.beginPath();
      ctx.arc(particle.position.x, particle.position.y, particle.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawBursts(bursts: EventBurst[]): void {
    const { ctx } = this;
    ctx.save();
    for (const burst of bursts) {
      const progress = burst.age / burst.duration;
      const alpha = (1 - progress) * (burst.type === 'death' ? 0.2 : burst.type === 'disrupt' ? 0.26 : 0.18);
      const hue = burst.type === 'feed' ? 36 : burst.type === 'birth' ? 126 : burst.type === 'disrupt' ? 274 : 356;
      ctx.strokeStyle = hsla(hue + burst.hue * 22, 48, 76, alpha);
      ctx.lineWidth = burst.type === 'disrupt' ? 1.8 : 1.1;
      ctx.beginPath();
      ctx.arc(burst.position.x, burst.position.y, burst.radius * (0.6 + progress * 0.8), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawEntityAuras(entities: Entity[]): void {
    const { ctx } = this;
    ctx.save();
    for (const entity of entities) {
      if (entity.activity < 0.14 && entity.visualPulse < 0.1) continue;
      const color = entityPalette[entity.type];
      const radius = entity.size * (entity.type === 'plant' ? 2.2 : entity.type === 'cluster' ? 2.8 : 2.4) * (0.86 + entity.activity * 0.5 + entity.visualPulse * 0.2);
      const gradient = ctx.createRadialGradient(entity.position.x, entity.position.y, entity.size * 0.1, entity.position.x, entity.position.y, radius);
      gradient.addColorStop(0, rgba(color, 0.05 + entity.activity * 0.08));
      gradient.addColorStop(0.65, rgba(color, 0.02 + entity.visualPulse * 0.08));
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
    ctx.rotate(entity.heading + Math.sin(time * 0.18 + entity.id) * 0.06);
    ctx.globalAlpha = entity.boundaryFade * (0.36 + entity.activity * 0.64);
    ctx.fillStyle = rgba(color, 0.9);
    ctx.beginPath();
    ctx.moveTo(entity.size * 1.1, 0);
    ctx.quadraticCurveTo(entity.size * 0.2, entity.size * 0.64, -entity.size * 0.9, 0);
    ctx.quadraticCurveTo(entity.size * 0.2, -entity.size * 0.64, entity.size * 1.1, 0);
    ctx.fill();
    ctx.restore();
  }

  private drawCluster(entity: Entity, time: number): void {
    const { ctx } = this;
    const color = entityPalette.cluster;
    ctx.save();
    ctx.translate(entity.position.x, entity.position.y);
    ctx.rotate(time * 0.05 + entity.id * 0.06);
    ctx.globalAlpha = entity.boundaryFade * (0.34 + entity.activity * 0.66);
    ctx.fillStyle = rgba(color, 0.46 + entity.activity * 0.16);
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      const radius = entity.size * (0.7 + Math.sin(angle * 2 + entity.id + time * 0.08) * 0.08 + entity.shape * 0.12);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius * 0.8;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawPlant(entity: Entity, time: number): void {
    const { ctx } = this;
    const color = entityPalette.plant;
    ctx.save();
    ctx.translate(entity.position.x, entity.position.y);
    ctx.rotate(Math.sin(time * 0.08 + entity.id) * 0.05);
    ctx.globalAlpha = entity.boundaryFade * (0.42 + entity.activity * 0.58);
    ctx.strokeStyle = rgba(color, 0.56);
    ctx.lineWidth = 1.05;
    ctx.beginPath();
    ctx.moveTo(0, entity.size * 1.04);
    ctx.lineTo(0, -entity.size * 0.9);
    ctx.stroke();
    ctx.fillStyle = rgba(color, 0.72);
    ctx.beginPath();
    ctx.ellipse(-entity.size * 0.3, -entity.size * 0.1, entity.size * 0.24, entity.size * 0.56, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(entity.size * 0.3, -entity.size * 0.28, entity.size * 0.24, entity.size * 0.58, 0.46, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -entity.size * 1.06, Math.max(1.2, entity.size * 0.18), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawPredator(entity: Entity, time: number): void {
    const { ctx } = this;
    const color = entityPalette.predator;
    ctx.save();
    ctx.translate(entity.position.x, entity.position.y);
    ctx.rotate(entity.heading + Math.sin(time * 0.12 + entity.id) * 0.04);
    ctx.globalAlpha = entity.boundaryFade * (0.38 + entity.activity * 0.62);
    ctx.strokeStyle = rgba(color, 0.8);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(entity.size * 1.16, 0);
    ctx.lineTo(-entity.size * 0.12, entity.size * 0.72);
    ctx.lineTo(-entity.size * 1, 0);
    ctx.lineTo(-entity.size * 0.12, -entity.size * 0.72);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  private drawToolPreview(snapshot: SimulationSnapshot): void {
    if (!snapshot.tool.visible) return;
    const { ctx } = this;
    const color = toolPalette[snapshot.tool.active];
    ctx.save();
    ctx.strokeStyle = rgba(color, snapshot.tool.blocked ? 0.28 : 0.12 + snapshot.tool.pulse * 0.1);
    ctx.lineWidth = 1;
    ctx.setLineDash(snapshot.tool.active === 'observe' ? [] : [10, 14]);
    ctx.beginPath();
    ctx.arc(snapshot.tool.worldPosition.x, snapshot.tool.worldPosition.y, snapshot.tool.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawBoundaryFade(): void {
    const { ctx } = this;
    ctx.save();
    const vignette = ctx.createRadialGradient(WORLD_WIDTH * 0.5, WORLD_HEIGHT * 0.5, WORLD_HEIGHT * 0.24, WORLD_WIDTH * 0.5, WORLD_HEIGHT * 0.5, WORLD_WIDTH * 0.74);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(0.76, 'rgba(0,0,0,0.03)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    ctx.restore();
  }

  private drawFocusMask(snapshot: SimulationSnapshot, width: number, height: number, scale: number, offsetX: number, offsetY: number): void {
    const focusField = snapshot.fields.find((field) => field.tool === 'observe');
    if (!focusField) return;
    const { ctx } = this;
    const x = focusField.position.x * scale + offsetX;
    const y = focusField.position.y * scale + offsetY;
    const radius = focusField.radius * scale;

    ctx.save();
    ctx.fillStyle = `rgba(1, 3, 6, ${0.26 + snapshot.stats.focus * 0.22})`;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'destination-out';
    const gradient = ctx.createRadialGradient(x, y, radius * 0.42, x, y, radius * 1.1);
    gradient.addColorStop(0, 'rgba(0,0,0,0.9)');
    gradient.addColorStop(0.72, 'rgba(0,0,0,0.3)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = `rgba(182, 220, 242, ${0.16 + snapshot.stats.focus * 0.18})`;
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawOverlay(snapshot: SimulationSnapshot, width: number, height: number): void {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font = '500 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(GAME_TITLE, width - 16, height - 16);

    if (snapshot.stats.focus > 0.06) {
      ctx.save();
      ctx.strokeStyle = `rgba(182,220,242,${0.14 + snapshot.stats.focus * 0.14})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(width * 0.5, height * 0.5, Math.min(width, height) * 0.12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}
