import { GAME_TITLE, WORLD_HEIGHT, WORLD_WIDTH, type EntityType, type TerrainType, type ToolType } from '../config';
import type { Attractor, CameraState, Entity, EventBurst, FeedParticle, Residue, SimulationSnapshot, TerrainCell, ToolField, Vec2 } from '../types/world';

const rgba = (color: readonly [number, number, number], alpha: number) => `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
const hsla = (h: number, s: number, l: number, a: number) => `hsla(${h} ${s}% ${l}% / ${a})`;
const wrapDelta = (from: number, to: number, size: number) => {
  let delta = to - from;
  if (delta > size * 0.5) delta -= size;
  else if (delta < -size * 0.5) delta += size;
  return delta;
};

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

const terrainColors: Record<TerrainType, { hue: number; sat: number; light: number; accent: readonly [number, number, number] }> = {
  water: { hue: 198, sat: 28, light: 24, accent: [124, 158, 176] },
  fertile: { hue: 136, sat: 20, light: 26, accent: [120, 156, 128] },
  dense: { hue: 214, sat: 10, light: 23, accent: [138, 146, 156] },
  solid: { hue: 246, sat: 8, light: 20, accent: [154, 150, 164] },
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

    this.drawTerrain(snapshot.terrain, snapshot.camera, snapshot.time);
    this.drawAttractors(snapshot.attractors, snapshot.camera);
    this.drawResidues(snapshot.residues, snapshot.camera);
    this.drawFields(snapshot.fields, snapshot.camera, snapshot.time);
    this.drawParticles(snapshot.particles, snapshot.camera);
    this.drawBursts(snapshot.bursts, snapshot.camera);
    this.drawEntityAuras(snapshot.entities, snapshot.camera);
    this.drawEntities(snapshot.entities, snapshot.camera, snapshot.time);
    this.drawToolPreview(snapshot);

    ctx.restore();

    this.drawFocusedInterior(snapshot, view.scale, view.offsetX, view.offsetY);
    this.drawFocusMask(snapshot, width, height, view.scale, view.offsetX, view.offsetY);
    this.drawOverlay(snapshot, width, height);
  }

  private getView(camera: CameraState, width: number, height: number) {
    const scale = Math.max(width / WORLD_WIDTH, height / WORLD_HEIGHT) * camera.zoom;
    return {
      scale,
      offsetX: width * 0.5 - camera.center.x * scale,
      offsetY: height * 0.5 - camera.center.y * scale,
    };
  }

  private wrappedPoint(position: Vec2, camera: CameraState): Vec2 {
    return {
      x: camera.center.x + wrapDelta(camera.center.x, position.x, WORLD_WIDTH),
      y: camera.center.y + wrapDelta(camera.center.y, position.y, WORLD_HEIGHT),
    };
  }

  private drawBackdrop(snapshot: SimulationSnapshot, width: number, height: number): void {
    const { ctx } = this;
    const base = ctx.createLinearGradient(0, 0, 0, height);
    base.addColorStop(0, 'rgba(7, 14, 19, 1)');
    base.addColorStop(0.56, 'rgba(5, 10, 14, 1)');
    base.addColorStop(1, 'rgba(3, 6, 10, 1)');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);

    const upperGlow = ctx.createRadialGradient(width * 0.62, height * 0.18, 20, width * 0.62, height * 0.18, width * 0.66);
    upperGlow.addColorStop(0, 'rgba(72, 104, 114, 0.12)');
    upperGlow.addColorStop(0.45, 'rgba(32, 58, 70, 0.06)');
    upperGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = upperGlow;
    ctx.fillRect(0, 0, width, height);

    const lowGlow = ctx.createRadialGradient(width * 0.28, height * 0.78, 10, width * 0.28, height * 0.78, width * 0.54);
    lowGlow.addColorStop(0, `rgba(92, 118, 108, ${0.05 + snapshot.stats.nutrients * 0.06})`);
    lowGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = lowGlow;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(170, 188, 196, 0.032)';
    for (let band = 0; band < 6; band += 1) {
      const baseY = (band + 0.62) * (height / 6);
      ctx.beginPath();
      for (let step = 0; step <= 26; step += 1) {
        const x = (step / 26) * width;
        const y = baseY
          + Math.sin(step * 0.58 + band * 1.2 + snapshot.time * 0.028) * 12
          + Math.cos(step * 0.23 + band * 0.9 + snapshot.time * 0.018) * 7
          + Math.sin((x / Math.max(1, width)) * Math.PI * 3.1 + band * 0.7) * 4;
        if (step === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(154, 174, 184, 0.022)';
    for (let i = 0; i < 18; i += 1) {
      const x = ((i + 0.35) / 18) * width;
      const y = height * (0.14 + ((i * 37) % 100) / 150);
      const len = 18 + ((i * 23) % 20);
      ctx.beginPath();
      ctx.moveTo(x - len * 0.55, y - 2);
      ctx.quadraticCurveTo(x, y + 5, x + len * 0.45, y - 3);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawTerrain(samples: TerrainCell[], camera: CameraState, time: number): void {
    const { ctx } = this;

    for (const sample of samples) {
      const center = this.wrappedPoint(sample.center, camera);
      const palette = terrainColors[sample.terrain];
      const baseRadius = sample.radius * (sample.terrain === 'water' ? 1.64 : sample.terrain === 'fertile' ? 1.44 : sample.terrain === 'dense' ? 1.3 : 1.14);
      const stretch = sample.terrain === 'water' ? 0.76 : sample.terrain === 'dense' ? 0.68 : 0.74;
      const rotation = Math.atan2(sample.flow.y, sample.flow.x) * 0.48 + sample.height * 0.4;
      const gradient = ctx.createRadialGradient(center.x, center.y, baseRadius * 0.1, center.x, center.y, baseRadius * 1.14);
      gradient.addColorStop(0, hsla(palette.hue + sample.hue * 7, palette.sat + sample.nutrient * 7, palette.light + sample.fertility * 10, 0.13));
      gradient.addColorStop(0.52, hsla(palette.hue, palette.sat, palette.light + sample.nutrient * 4, 0.06));
      gradient.addColorStop(1, hsla(palette.hue, palette.sat, palette.light, 0));
      ctx.fillStyle = gradient;
      this.traceWarpedPatch(center, baseRadius, stretch, rotation, sample, time);
      ctx.fill();
    }

    ctx.save();
    for (const sample of samples) {
      const center = this.wrappedPoint(sample.center, camera);
      const palette = terrainColors[sample.terrain];
      const detail = sample.terrain === 'solid' ? 3 : 2;
      ctx.strokeStyle = hsla(palette.hue, palette.sat + 3, 72, sample.terrain === 'solid' ? 0.1 : 0.065);
      ctx.lineWidth = sample.terrain === 'solid' ? 1 : 0.8;
      for (let band = 0; band < detail; band += 1) {
        this.traceContourBand(center, sample, time, band);
        ctx.stroke();
      }

      const accent = terrainColors[sample.terrain].accent;
      ctx.strokeStyle = rgba(accent, sample.terrain === 'water' ? 0.048 : 0.032);
      ctx.lineWidth = 0.72;
      this.traceFlowBand(center, sample, time, -1);
      ctx.stroke();
      this.traceFlowBand(center, sample, time, 1);
      ctx.stroke();
    }
    ctx.restore();
  }

  private traceWarpedPatch(center: Vec2, radius: number, stretch: number, rotation: number, sample: TerrainCell, time: number): void {
    const { ctx } = this;
    ctx.beginPath();
    for (let step = 0; step <= 20; step += 1) {
      const angle = (step / 20) * Math.PI * 2;
      const sweep = angle + rotation;
      const swell = 1
        + Math.sin(sample.index * 0.41 + angle * 2.3 + time * 0.014) * 0.09
        + Math.cos(sample.height * 5.4 + angle * 1.7) * 0.06
        + Math.sin(sample.roughness * 6 + angle * 3.2) * 0.03;
      const localRadius = radius * swell;
      const x = center.x + Math.cos(sweep) * localRadius;
      const y = center.y + Math.sin(sweep) * localRadius * stretch;
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  private traceContourBand(center: Vec2, sample: TerrainCell, time: number, band: number): void {
    const { ctx } = this;
    const flowAngle = Math.atan2(sample.flow.y, sample.flow.x);
    const arcStart = flowAngle - 1.1 + sample.height * 0.7 + band * 0.2;
    const arcLength = Math.PI * (0.84 + sample.roughness * 0.18);
    const radius = sample.radius * (0.44 + band * 0.2 + sample.height * 0.08);
    ctx.beginPath();
    for (let step = 0; step <= 18; step += 1) {
      const angle = arcStart + (step / 18) * arcLength;
      const wobble = 1
        + Math.sin(time * 0.022 + sample.index * 0.4 + angle * 2.1 + band) * 0.03
        + Math.cos(sample.height * 4.2 + angle * 1.4) * 0.02;
      const x = center.x + Math.cos(angle) * radius * wobble;
      const y = center.y + Math.sin(angle) * radius * wobble * (sample.terrain === 'water' ? 0.68 : 0.82);
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }

  private traceFlowBand(center: Vec2, sample: TerrainCell, time: number, side: -1 | 1): void {
    const { ctx } = this;
    const flowAngle = Math.atan2(sample.flow.y, sample.flow.x);
    const normalAngle = flowAngle + Math.PI * 0.5;
    const offset = sample.radius * (0.12 + sample.height * 0.06) * side;
    const length = sample.radius * (0.68 + sample.nutrient * 0.12);
    const startX = center.x - Math.cos(flowAngle) * length * 0.52 + Math.cos(normalAngle) * offset;
    const startY = center.y - Math.sin(flowAngle) * length * 0.52 + Math.sin(normalAngle) * offset * 0.8;
    const endX = center.x + Math.cos(flowAngle) * length * 0.52 + Math.cos(normalAngle) * offset * 0.6;
    const endY = center.y + Math.sin(flowAngle) * length * 0.52 + Math.sin(normalAngle) * offset * 0.5;
    const drift = Math.sin(time * 0.018 + sample.index * 0.31 + side) * sample.radius * 0.1;
    const controlX = center.x + Math.cos(flowAngle + side * 0.5) * length * 0.18 + Math.cos(normalAngle) * drift;
    const controlY = center.y + Math.sin(flowAngle + side * 0.5) * length * 0.18 + Math.sin(normalAngle) * drift * 0.7;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(controlX, controlY, endX, endY);
  }

  private drawAttractors(attractors: Attractor[], camera: CameraState): void {
    const { ctx } = this;
    ctx.save();
    for (const attractor of attractors) {
      const position = this.wrappedPoint(attractor.position, camera);
      const hue = 186 + attractor.hue * 30;
      const gradient = ctx.createRadialGradient(position.x, position.y, attractor.radius * 0.08, position.x, position.y, attractor.radius);
      gradient.addColorStop(0, hsla(hue, 36, 66, 0.06));
      gradient.addColorStop(0.56, hsla(hue, 24, 44, 0.03));
      gradient.addColorStop(1, hsla(hue, 18, 34, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(position.x, position.y, attractor.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = hsla(hue, 24, 74, 0.05);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(position.x, position.y, attractor.radius * 0.4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawResidues(residues: Residue[], camera: CameraState): void {
    const { ctx } = this;
    ctx.save();
    for (const residue of residues) {
      const position = this.wrappedPoint(residue.position, camera);
      const alpha = (1 - residue.age / residue.duration) * 0.18;
      const gradient = ctx.createRadialGradient(position.x, position.y, residue.radius * 0.08, position.x, position.y, residue.radius);
      gradient.addColorStop(0, hsla(118, 30, 50, alpha));
      gradient.addColorStop(0.74, hsla(102, 18, 34, alpha * 0.32));
      gradient.addColorStop(1, hsla(96, 16, 24, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(position.x, position.y, residue.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawFields(fields: ToolField[], camera: CameraState, time: number): void {
    const { ctx } = this;
    ctx.save();
    for (const field of fields) {
      const position = this.wrappedPoint(field.position, camera);
      const color = toolPalette[field.tool];
      const fade = field.tool === 'observe' ? 0.18 : Math.max(field.strength, 0.15);
      const gradient = ctx.createRadialGradient(position.x, position.y, field.radius * 0.14, position.x, position.y, field.radius);
      gradient.addColorStop(0, rgba(color, 0.1 * fade));
      gradient.addColorStop(0.72, rgba(color, 0.038 * fade));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(position.x, position.y, field.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = rgba(color, field.tool === 'observe' ? 0.22 : 0.14 * fade);
      ctx.lineWidth = field.tool === 'observe' ? 1.2 : 1;
      ctx.beginPath();
      const waveRadius = field.tool === 'repel'
        ? field.radius * (0.28 + field.age * 0.18)
        : field.tool === 'disrupt'
          ? field.radius * (0.24 + Math.min(field.age, 1.8) * 0.16)
          : field.radius * 0.92;
      ctx.arc(position.x, position.y, Math.min(field.radius, waveRadius), 0, Math.PI * 2);
      ctx.stroke();

      if (field.tool === 'grow') {
        ctx.strokeStyle = rgba(color, 0.1 * fade);
        for (let i = 0; i < 4; i += 1) {
          const angle = time * 0.05 + i * (Math.PI / 2);
          ctx.beginPath();
          ctx.moveTo(position.x + Math.cos(angle) * field.radius * 0.18, position.y + Math.sin(angle) * field.radius * 0.18);
          ctx.quadraticCurveTo(
            position.x + Math.cos(angle + 0.4) * field.radius * 0.42,
            position.y + Math.sin(angle + 0.4) * field.radius * 0.42,
            position.x + Math.cos(angle + 0.2) * field.radius * 0.68,
            position.y + Math.sin(angle + 0.2) * field.radius * 0.68,
          );
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  private drawParticles(particles: FeedParticle[], camera: CameraState): void {
    const { ctx } = this;
    ctx.save();
    for (const particle of particles) {
      const position = this.wrappedPoint(particle.position, camera);
      const alpha = 1 - particle.age / particle.duration;
      const hue = particle.kind === 'feed' ? 42 : 24;
      ctx.fillStyle = hsla(hue, particle.kind === 'feed' ? 82 : 70, particle.kind === 'feed' ? 74 : 66, 0.1 + alpha * 0.3);
      ctx.beginPath();
      ctx.arc(position.x, position.y, particle.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawBursts(bursts: EventBurst[], camera: CameraState): void {
    const { ctx } = this;
    ctx.save();
    for (const burst of bursts) {
      const position = this.wrappedPoint(burst.position, camera);
      const progress = burst.age / burst.duration;
      const alpha = (1 - progress) * (burst.type === 'death' ? 0.16 : burst.type === 'disrupt' ? 0.2 : 0.14);
      const hue = burst.type === 'feed' ? 36 : burst.type === 'birth' ? 126 : burst.type === 'disrupt' ? 274 : 356;
      ctx.strokeStyle = hsla(hue + burst.hue * 22, 42, 76, alpha);
      ctx.lineWidth = burst.type === 'disrupt' ? 1.6 : 1;
      ctx.beginPath();
      ctx.arc(position.x, position.y, burst.radius * (0.6 + progress * 0.8), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawEntityAuras(entities: Entity[], camera: CameraState): void {
    const { ctx } = this;
    ctx.save();
    for (const entity of entities) {
      if (entity.activity < 0.14 && entity.visualPulse < 0.1) continue;
      const position = this.wrappedPoint(entity.position, camera);
      const color = entityPalette[entity.type];
      const radius = entity.size * (entity.type === 'plant' ? 2.2 : entity.type === 'cluster' ? 2.8 : 2.4) * (0.86 + entity.activity * 0.5 + entity.visualPulse * 0.2);
      const gradient = ctx.createRadialGradient(position.x, position.y, entity.size * 0.1, position.x, position.y, radius);
      gradient.addColorStop(0, rgba(color, 0.04 + entity.activity * 0.06));
      gradient.addColorStop(0.65, rgba(color, 0.02 + entity.visualPulse * 0.06));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawEntities(entities: Entity[], camera: CameraState, time: number): void {
    for (const entity of entities) {
      const position = this.wrappedPoint(entity.position, camera);
      if (entity.type === 'flocker') this.drawFlocker(entity, position, time);
      else if (entity.type === 'cluster') this.drawCluster(entity, position, time);
      else if (entity.type === 'plant') this.drawPlant(entity, position, time);
      else this.drawPredator(entity, position, time);
    }
  }

  private drawFlocker(entity: Entity, position: Vec2, time: number): void {
    const { ctx } = this;
    const color = entityPalette.flocker;
    ctx.save();
    ctx.translate(position.x, position.y);
    ctx.rotate(entity.heading + Math.sin(time * 0.12 + entity.id) * 0.04);
    ctx.globalAlpha = entity.boundaryFade * (0.36 + entity.activity * 0.64);
    ctx.fillStyle = rgba(color, 0.88);
    ctx.beginPath();
    ctx.moveTo(entity.size * 1.1, 0);
    ctx.quadraticCurveTo(entity.size * 0.2, entity.size * 0.64, -entity.size * 0.9, 0);
    ctx.quadraticCurveTo(entity.size * 0.2, -entity.size * 0.64, entity.size * 1.1, 0);
    ctx.fill();
    ctx.restore();
  }

  private drawCluster(entity: Entity, position: Vec2, time: number): void {
    const { ctx } = this;
    const color = entityPalette.cluster;
    ctx.save();
    ctx.translate(position.x, position.y);
    ctx.rotate(time * 0.03 + entity.id * 0.06);
    ctx.globalAlpha = entity.boundaryFade * (0.34 + entity.activity * 0.66);
    ctx.fillStyle = rgba(color, 0.44 + entity.activity * 0.14);
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      const radius = entity.size * (0.7 + Math.sin(angle * 2 + entity.id + time * 0.05) * 0.08 + entity.shape * 0.12);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius * 0.8;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawPlant(entity: Entity, position: Vec2, time: number): void {
    const { ctx } = this;
    const color = entityPalette.plant;
    ctx.save();
    ctx.translate(position.x, position.y);
    ctx.rotate(Math.sin(time * 0.05 + entity.id) * 0.03);
    ctx.globalAlpha = entity.boundaryFade * (0.42 + entity.activity * 0.58);
    ctx.strokeStyle = rgba(color, 0.54);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, entity.size * 1.04);
    ctx.lineTo(0, -entity.size * 0.9);
    ctx.stroke();
    ctx.fillStyle = rgba(color, 0.68);
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

  private drawPredator(entity: Entity, position: Vec2, time: number): void {
    const { ctx } = this;
    const color = entityPalette.predator;
    ctx.save();
    ctx.translate(position.x, position.y);
    ctx.rotate(entity.heading + Math.sin(time * 0.08 + entity.id) * 0.03);
    ctx.globalAlpha = entity.boundaryFade * (0.38 + entity.activity * 0.62);
    ctx.strokeStyle = rgba(color, 0.78);
    ctx.lineWidth = 1.1;
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
    const position = this.wrappedPoint(snapshot.tool.worldPosition, snapshot.camera);
    ctx.save();
    ctx.strokeStyle = rgba(color, snapshot.tool.blocked ? 0.24 : 0.1 + snapshot.tool.pulse * 0.08);
    ctx.lineWidth = 1;
    ctx.setLineDash(snapshot.tool.active === 'observe' ? [] : [10, 16]);
    ctx.beginPath();
    ctx.arc(position.x, position.y, snapshot.tool.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawFocusMask(snapshot: SimulationSnapshot, width: number, height: number, scale: number, offsetX: number, offsetY: number): void {
    const focusField = snapshot.fields.find((field) => field.tool === 'observe');
    if (!focusField) return;
    const { ctx } = this;
    const wrapped = this.wrappedPoint(focusField.position, snapshot.camera);
    const x = wrapped.x * scale + offsetX;
    const y = wrapped.y * scale + offsetY;
    const radius = focusField.radius * scale;

    ctx.save();
    ctx.fillStyle = `rgba(1, 4, 8, ${0.42 + snapshot.stats.focus * 0.22})`;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'destination-out';
    const aperture = ctx.createRadialGradient(x, y, radius * 0.32, x, y, radius * 1.22);
    aperture.addColorStop(0, 'rgba(0,0,0,0.98)');
    aperture.addColorStop(0.62, 'rgba(0,0,0,0.42)');
    aperture.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = aperture;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    const glow = ctx.createRadialGradient(x, y, radius * 0.1, x, y, radius);
    glow.addColorStop(0, `rgba(228, 244, 250, ${0.12 + snapshot.stats.focus * 0.18})`);
    glow.addColorStop(0.56, `rgba(190, 226, 246, ${0.05 + snapshot.stats.focus * 0.06})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(182, 220, 242, ${0.18 + snapshot.stats.focus * 0.14})`;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = `rgba(214, 232, 242, ${0.09 + snapshot.stats.focus * 0.12})`;
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 3; i += 1) {
      const ring = radius * (0.42 + i * 0.17);
      ctx.beginPath();
      ctx.arc(x, y, ring, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawFocusedInterior(snapshot: SimulationSnapshot, scale: number, offsetX: number, offsetY: number): void {
    const focusField = snapshot.fields.find((field) => field.tool === 'observe');
    if (!focusField) return;

    const { ctx } = this;
    const wrapped = this.wrappedPoint(focusField.position, snapshot.camera);
    const x = wrapped.x * scale + offsetX;
    const y = wrapped.y * scale + offsetY;
    const radius = focusField.radius * scale;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.98, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.globalAlpha = 0.42 + snapshot.stats.focus * 0.2;
    this.drawTerrain(snapshot.terrain, snapshot.camera, snapshot.time);
    ctx.globalAlpha = 0.56 + snapshot.stats.focus * 0.24;
    this.drawEntityAuras(snapshot.entities, snapshot.camera);
    this.drawResidues(snapshot.residues, snapshot.camera);
    this.drawParticles(snapshot.particles, snapshot.camera);
    this.drawEntities(snapshot.entities, snapshot.camera, snapshot.time);
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
      ctx.strokeStyle = `rgba(182,220,242,${0.12 + snapshot.stats.focus * 0.1})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(width * 0.5, height * 0.5, Math.min(width, height) * 0.12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}
