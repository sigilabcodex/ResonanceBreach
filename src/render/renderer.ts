import { GAME_TITLE, WORLD_HEIGHT, WORLD_WIDTH, type EntityType, type TerrainType, type ToolType } from '../config';
import type { GameSettings } from '../settings';
import type { Attractor, CameraState, Entity, EventBurst, FeedParticle, Residue, SimulationSnapshot, TerrainCell, ToolField, Vec2 } from '../types/world';

const rgba = (color: readonly [number, number, number], alpha: number) => `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
const hsla = (h: number, s: number, l: number, a: number) => `hsla(${h} ${s}% ${l}% / ${a})`;
const wrapDelta = (from: number, to: number, size: number) => {
  let delta = to - from;
  if (delta > size * 0.5) delta -= size;
  else if (delta < -size * 0.5) delta += size;
  return delta;
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const entityPalette: Record<EntityType, readonly [number, number, number]> = {
  flocker: [220, 235, 244],
  cluster: [170, 206, 182],
  plant: [140, 212, 160],
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
  water: { hue: 198, sat: 24, light: 60, accent: [124, 158, 176] },
  fertile: { hue: 136, sat: 22, light: 66, accent: [120, 156, 128] },
  dense: { hue: 214, sat: 12, light: 62, accent: [138, 146, 156] },
  solid: { hue: 246, sat: 10, light: 58, accent: [154, 150, 164] },
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

  render(snapshot: SimulationSnapshot, settings: GameSettings): void {
    const { ctx, canvas } = this;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const view = this.getView(snapshot.camera, width, height);

    ctx.clearRect(0, 0, width, height);
    this.drawBackdrop(snapshot, width, height, settings);

    ctx.save();
    ctx.translate(view.offsetX, view.offsetY);
    ctx.scale(view.scale, view.scale);

    if (settings.visuals.terrainLines) {
      this.drawTerrain(snapshot.terrain, snapshot.camera, snapshot.time, settings);
      this.drawEnvironmentalFlows(snapshot.terrain, snapshot.camera, snapshot.time, settings);
    }
    this.drawAttractors(snapshot.attractors, snapshot.camera);
    this.drawResidues(snapshot.residues, snapshot.camera);
    this.drawFields(snapshot.fields, snapshot.camera, snapshot.time, settings);
    this.drawParticles(snapshot.particles, snapshot.camera);
    this.drawBursts(snapshot.bursts, snapshot.camera);
    this.drawEntityAuras(snapshot.entities, snapshot.camera);
    this.drawEntities(snapshot.entities, snapshot.camera, snapshot.time, settings);
    this.drawToolPreview(snapshot);

    ctx.restore();

    this.drawFocusedInterior(snapshot, view.scale, view.offsetX, view.offsetY, settings);
    this.drawFocusMask(snapshot, width, height, view.scale, view.offsetX, view.offsetY, settings);
    this.drawOverlay(snapshot, width, height, settings);
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

  private drawBackdrop(snapshot: SimulationSnapshot, width: number, height: number, settings: GameSettings): void {
    const { ctx } = this;
    const base = ctx.createLinearGradient(0, 0, 0, height);
    base.addColorStop(0, 'rgba(4, 10, 14, 1)');
    base.addColorStop(0.5, 'rgba(3, 7, 11, 1)');
    base.addColorStop(1, 'rgba(1, 4, 8, 1)');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);

    const motion = settings.visuals.reduceMotion ? 0.18 : 1;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let layer = 0; layer < 2; layer += 1) {
      const alpha = layer === 0 ? 0.045 : 0.028;
      const parallax = layer === 0 ? 0.000028 : 0.000016;
      const driftX = snapshot.camera.center.x * parallax + snapshot.time * 0.0016 * motion * (layer === 0 ? 1 : -0.6);
      const driftY = snapshot.camera.center.y * parallax + snapshot.time * 0.0012 * motion * (layer === 0 ? -0.7 : 0.45);
      ctx.strokeStyle = `rgba(164, 194, 208, ${alpha})`;
      ctx.lineWidth = layer === 0 ? 1 : 0.8;

      for (let band = 0; band < 5; band += 1) {
        ctx.beginPath();
        for (let step = 0; step <= 30; step += 1) {
          const nx = step / 30;
          const x = nx * width;
          const y = height * (0.16 + band * 0.18)
            + Math.sin(nx * Math.PI * (2.4 + layer * 0.8) + driftX * 12 + band * 0.8) * (10 + layer * 7)
            + Math.cos(nx * Math.PI * 1.6 - driftY * 9 + band * 1.1) * (7 + layer * 5);
          if (step === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawTerrain(samples: TerrainCell[], camera: CameraState, time: number, settings: GameSettings): void {
    const { ctx } = this;
    const motion = settings.visuals.reduceMotion ? 0.22 : 1;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const sample of samples) {
      const center = this.wrappedPoint(sample.center, camera);
      const palette = terrainColors[sample.terrain];
      const density = this.getTerrainDensity(sample);
      const contourCount = sample.terrain === 'water' ? 3 : sample.terrain === 'solid' ? 5 : 4;
      const baseAlpha = sample.terrain === 'water' ? 0.12 : sample.terrain === 'solid' ? 0.1 : 0.085;
      const flowAngle = Math.atan2(sample.flow.y, sample.flow.x || 0.0001);
      const drift = Math.sin(time * 0.026 * motion + sample.index * 0.31) * sample.radius * 0.06;

      ctx.strokeStyle = hsla(palette.hue + sample.hue * 6, palette.sat, palette.light + sample.nutrient * 10, baseAlpha + density * 0.05);
      ctx.lineWidth = sample.terrain === 'solid' ? 0.95 : 0.75;
      for (let band = 0; band < contourCount; band += 1) {
        this.traceContourLine(center, sample, flowAngle, time * motion, band, drift);
        ctx.stroke();
      }

      ctx.strokeStyle = rgba(palette.accent, sample.terrain === 'water' ? 0.08 : 0.05);
      ctx.lineWidth = 0.7;
      for (let stream = 0; stream < (sample.terrain === 'water' ? 3 : 2); stream += 1) {
        this.traceCurvatureLine(center, sample, flowAngle, time * motion, stream);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  private drawEnvironmentalFlows(samples: TerrainCell[], camera: CameraState, time: number, settings: GameSettings): void {
    const { ctx } = this;
    const motion = settings.visuals.reduceMotion ? 0.16 : 1;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const sample of samples) {
      const center = this.wrappedPoint(sample.center, camera);
      const accent = terrainColors[sample.terrain].accent;
      const alpha = sample.terrain === 'water'
        ? 0.072 + sample.resonance * 0.03
        : sample.terrain === 'fertile'
          ? 0.038 + sample.nutrient * 0.025
          : 0.02 + sample.density * 0.018;
      ctx.strokeStyle = rgba(accent, alpha);
      ctx.lineWidth = sample.terrain === 'water' ? 0.78 : 0.58;

      const streamCount = sample.terrain === 'water' ? 3 : sample.terrain === 'fertile' ? 2 : 1;
      for (let stream = 0; stream < streamCount; stream += 1) {
        this.traceFlowLine(center, sample, time * motion, stream);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  private getTerrainDensity(sample: TerrainCell): number {
    return clamp(sample.density * 0.5 + sample.height * 0.3 + sample.roughness * 0.2, 0, 1);
  }

  private traceContourLine(center: Vec2, sample: TerrainCell, flowAngle: number, time: number, band: number, drift: number): void {
    const { ctx } = this;
    const density = this.getTerrainDensity(sample);
    const radius = sample.radius * (0.24 + band * 0.15 + density * 0.08);
    const length = Math.PI * (1.1 + density * 0.6 + (sample.terrain === 'solid' ? 0.22 : 0));
    const start = flowAngle - length * 0.5 + sample.height * 0.8 + band * 0.18;
    const curvature = sample.terrain === 'water' ? 0.42 : sample.terrain === 'solid' ? 0.88 : 0.66;
    ctx.beginPath();
    for (let step = 0; step <= 24; step += 1) {
      const t = step / 24;
      const angle = start + length * t;
      const wobble = 1
        + Math.sin(time * 0.8 + sample.index * 0.33 + angle * 1.8 + band) * 0.028
        + Math.cos(sample.roughness * 5.6 + angle * 1.4) * 0.018;
      const offset = Math.sin(t * Math.PI * 2 + sample.nutrient * 4 + band) * drift;
      const x = center.x + Math.cos(angle) * radius * wobble + Math.cos(flowAngle + Math.PI * 0.5) * offset * 0.24;
      const y = center.y + Math.sin(angle) * radius * wobble * curvature + Math.sin(flowAngle + Math.PI * 0.5) * offset * 0.18;
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }

  private traceCurvatureLine(center: Vec2, sample: TerrainCell, flowAngle: number, time: number, stream: number): void {
    const { ctx } = this;
    const side = stream % 2 === 0 ? -1 : 1;
    const normalAngle = flowAngle + Math.PI * 0.5;
    const reach = sample.radius * (0.44 + stream * 0.14 + sample.nutrient * 0.08);
    const offset = sample.radius * (0.08 + stream * 0.09) * side;
    ctx.beginPath();
    for (let step = 0; step <= 18; step += 1) {
      const t = step / 18;
      const along = (t - 0.5) * reach * 2;
      const sweep = Math.sin(t * Math.PI + time * 0.7 + sample.index * 0.21 + stream) * sample.radius * 0.06;
      const bend = Math.sin(t * Math.PI * 2 + sample.height * 5 + stream) * sample.radius * 0.03;
      const x = center.x
        + Math.cos(flowAngle) * along
        + Math.cos(normalAngle) * (offset + sweep + bend);
      const y = center.y
        + Math.sin(flowAngle) * along * (sample.terrain === 'water' ? 0.92 : 0.76)
        + Math.sin(normalAngle) * (offset * 0.7 + sweep * 0.6 + bend);
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }

  private traceFlowLine(center: Vec2, sample: TerrainCell, time: number, stream: number): void {
    const { ctx } = this;
    const flowAngle = Math.atan2(sample.flow.y, sample.flow.x || 0.0001);
    const normalAngle = flowAngle + Math.PI * 0.5;
    const span = sample.radius * (sample.terrain === 'water' ? 0.92 : 0.7);
    const offset = sample.radius * (-0.2 + stream * 0.18);
    ctx.beginPath();
    for (let step = 0; step <= 22; step += 1) {
      const t = step / 22;
      const along = (t - 0.5) * span * 2;
      const drift = Math.sin(time * 1.1 + sample.index * 0.19 + t * Math.PI * 2 + stream * 0.8) * sample.radius * 0.05;
      const turbulence = Math.cos(sample.roughness * 6 + t * Math.PI * 3) * sample.radius * 0.02;
      const x = center.x + Math.cos(flowAngle) * along + Math.cos(normalAngle) * (offset + drift + turbulence);
      const y = center.y + Math.sin(flowAngle) * along + Math.sin(normalAngle) * (offset * 0.8 + drift * 0.7 + turbulence);
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }

  private drawAttractors(attractors: Attractor[], camera: CameraState): void {
    const { ctx } = this;
    ctx.save();
    for (const attractor of attractors) {
      const position = this.wrappedPoint(attractor.position, camera);
      const hue = 186 + attractor.hue * 30;
      ctx.strokeStyle = hsla(hue, 22, 72, 0.045);
      ctx.lineWidth = 0.8;
      for (let ring = 0; ring < 2; ring += 1) {
        ctx.beginPath();
        ctx.arc(position.x, position.y, attractor.radius * (0.22 + ring * 0.16), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawResidues(residues: Residue[], camera: CameraState): void {
    const { ctx } = this;
    ctx.save();
    for (const residue of residues) {
      const position = this.wrappedPoint(residue.position, camera);
      const alpha = (1 - residue.age / residue.duration) * (0.12 + residue.richness * 0.16);
      const hue = residue.sourceType === 'flocker' ? 32 : residue.sourceType === 'cluster' ? 122 : 102;
      ctx.strokeStyle = hsla(hue, 22, 70, alpha * 0.62);
      ctx.lineWidth = 0.7;
      for (let i = 0; i < 3; i += 1) {
        const ring = residue.radius * (0.18 + i * 0.16 + residue.richness * 0.05);
        ctx.beginPath();
        ctx.arc(position.x, position.y, ring, i * 0.7, i * 0.7 + Math.PI * 0.9);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawFields(fields: ToolField[], camera: CameraState, time: number, settings: GameSettings): void {
    const { ctx } = this;
    const motion = settings.visuals.reduceMotion ? 0.3 : 1;
    ctx.save();
    for (const field of fields) {
      const position = this.wrappedPoint(field.position, camera);
      const color = toolPalette[field.tool];
      const fade = field.tool === 'observe' ? 0.16 : Math.max(field.strength, 0.15);

      ctx.strokeStyle = rgba(color, field.tool === 'observe' ? 0.18 : 0.12 * fade);
      ctx.lineWidth = field.tool === 'observe' ? 1 : 0.9;
      ctx.beginPath();
      const waveRadius = field.tool === 'repel'
        ? field.radius * (0.28 + field.age * 0.18)
        : field.tool === 'disrupt'
          ? field.radius * (0.24 + Math.min(field.age, 1.8) * 0.16)
          : field.radius * 0.92;
      ctx.arc(position.x, position.y, Math.min(field.radius, waveRadius), 0, Math.PI * 2);
      ctx.stroke();

      if (field.tool === 'observe') {
        ctx.strokeStyle = rgba(color, 0.08 + fade * 0.12);
        for (let i = 0; i < 3; i += 1) {
          const ring = field.radius * (0.36 + i * 0.18);
          ctx.beginPath();
          ctx.arc(position.x, position.y, ring, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      if (field.tool === 'grow') {
        ctx.strokeStyle = rgba(color, 0.1 * fade);
        for (let i = 0; i < 4; i += 1) {
          const angle = time * 0.05 * motion + i * (Math.PI / 2);
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
      if (particle.kind === 'fruit') {
        ctx.moveTo(position.x, position.y - particle.radius * 1.3);
        ctx.quadraticCurveTo(position.x + particle.radius * 1.4, position.y - particle.radius * 0.2, position.x, position.y + particle.radius * 1.3);
        ctx.quadraticCurveTo(position.x - particle.radius * 1.4, position.y - particle.radius * 0.2, position.x, position.y - particle.radius * 1.3);
      } else {
        ctx.arc(position.x, position.y, particle.radius, 0, Math.PI * 2);
      }
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
      ctx.lineWidth = burst.type === 'disrupt' ? 1.4 : 1;
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
      if (entity.activity < 0.14 && entity.visualPulse < 0.1 && entity.pollination < 0.18) continue;
      const position = this.wrappedPoint(entity.position, camera);
      const color = entityPalette[entity.type];
      const radius = entity.size * (entity.type === 'plant' ? 2.8 : entity.type === 'cluster' ? 2.3 : 2.5) * (0.82 + entity.activity * 0.44 + entity.visualPulse * 0.22 + entity.pollination * 0.08);
      const gradient = ctx.createRadialGradient(position.x, position.y, entity.size * 0.1, position.x, position.y, radius);
      gradient.addColorStop(0, rgba(color, 0.04 + entity.activity * 0.06 + entity.pollination * 0.03));
      gradient.addColorStop(0.65, rgba(color, 0.02 + entity.visualPulse * 0.06));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawEntities(entities: Entity[], camera: CameraState, time: number, settings: GameSettings): void {
    for (const entity of entities) {
      const position = this.wrappedPoint(entity.position, camera);
      if (entity.type === 'flocker') this.drawFlocker(entity, position, time, camera, settings);
      else if (entity.type === 'cluster') this.drawCluster(entity, position, time, camera, settings);
      else if (entity.type === 'plant') this.drawPlant(entity, position, time);
      else this.drawPredator(entity, position, time);
    }
  }

  private drawFlocker(entity: Entity, position: Vec2, time: number, camera: CameraState, settings: GameSettings): void {
    const { ctx } = this;
    const color = entityPalette.flocker;
    const maturity = Math.min(1, entity.stageProgress * 1.2 + entity.growth * 0.3);
    ctx.save();
    if (settings.visuals.motionTrails) {
      for (let i = entity.trail.length - 1; i >= 0; i -= 1) {
        const trailPoint = this.wrappedPoint(entity.trail[i] as Vec2, camera);
        const alpha = ((entity.trail.length - i) / Math.max(1, entity.trail.length)) * (settings.visuals.reduceMotion ? 0.04 : 0.08);
        ctx.fillStyle = rgba(color, alpha);
        ctx.beginPath();
        ctx.arc(trailPoint.x, trailPoint.y, 0.9 + i * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.translate(position.x, position.y);
    ctx.rotate(entity.heading + Math.sin(time * 0.16 + entity.id) * (settings.visuals.reduceMotion ? 0.05 : 0.12));
    ctx.globalAlpha = entity.boundaryFade * (0.52 + entity.activity * 0.58);
    ctx.strokeStyle = rgba(color, 0.92);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-entity.size * 0.85, 0);
    ctx.quadraticCurveTo(entity.size * 0.1, -entity.size * (0.9 + maturity * 0.6), entity.size * (1.1 + maturity * 0.2), 0);
    ctx.quadraticCurveTo(entity.size * 0.1, entity.size * (0.9 + maturity * 0.6), -entity.size * 0.85, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-entity.size * 0.22, 0);
    ctx.lineTo(entity.size * 0.54, 0);
    ctx.stroke();
    if (maturity > 0.34) {
      ctx.beginPath();
      ctx.arc(-entity.size * 0.3, 0, entity.size * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = rgba(color, 0.72);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawCluster(entity: Entity, position: Vec2, time: number, camera: CameraState, settings: GameSettings): void {
    const { ctx } = this;
    const color = entityPalette.cluster;
    const maturity = Math.min(1, entity.stageProgress * 1.18 + entity.growth * 0.22 + entity.memory * 0.18);
    ctx.save();
    if (settings.visuals.motionTrails) {
      for (let i = entity.trail.length - 1; i >= 0; i -= 1) {
        const trailPoint = this.wrappedPoint(entity.trail[i] as Vec2, camera);
        const alpha = ((entity.trail.length - i) / Math.max(1, entity.trail.length)) * (settings.visuals.reduceMotion ? 0.028 : 0.05);
        ctx.strokeStyle = rgba(color, alpha);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(trailPoint.x, trailPoint.y, 1.2 + i * 0.1, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.translate(position.x, position.y);
    ctx.rotate(time * (settings.visuals.reduceMotion ? 0.01 : 0.02) + entity.id * 0.08);
    ctx.globalAlpha = entity.boundaryFade * (0.44 + entity.activity * 0.58);
    ctx.strokeStyle = rgba(color, 0.82);
    ctx.lineWidth = 1;
    const branches = 3 + Math.round(maturity * 3);
    for (let i = 0; i < branches; i += 1) {
      const angle = (i / branches) * Math.PI * 2 + Math.sin(time * 0.04 + entity.id * 0.2) * (settings.visuals.reduceMotion ? 0.08 : 0.2);
      const reach = entity.size * (0.7 + maturity * 0.6 + Math.sin(angle * 2 + entity.id) * 0.1);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(
        Math.cos(angle + 0.35) * reach * 0.36,
        Math.sin(angle + 0.35) * reach * 0.36,
        Math.cos(angle) * reach,
        Math.sin(angle) * reach,
      );
      ctx.stroke();
    }
    ctx.fillStyle = rgba(color, 0.4 + maturity * 0.22);
    ctx.beginPath();
    ctx.arc(0, 0, entity.size * (0.24 + maturity * 0.12), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawPlant(entity: Entity, position: Vec2, time: number): void {
    const { ctx } = this;
    const color = entityPalette.plant;
    const maturity = Math.min(1, entity.stageProgress * 1.12 + entity.growth * 0.28);
    const crownNodes = 3 + Math.round(maturity * 4);
    ctx.save();
    ctx.translate(position.x, position.y);
    ctx.rotate(Math.sin(time * 0.04 + entity.id) * 0.03);
    ctx.globalAlpha = entity.boundaryFade * (0.5 + entity.activity * 0.5 + entity.pollination * 0.08);
    ctx.strokeStyle = rgba(color, 0.62 + entity.pollination * 0.12);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-entity.size * 0.44, entity.size * 0.92);
    ctx.lineTo(0, entity.size * 0.38);
    ctx.lineTo(entity.size * 0.44, entity.size * 0.92);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, entity.size * 0.82);
    ctx.lineTo(0, -entity.size * (0.9 + maturity * 0.38));
    ctx.stroke();
    ctx.fillStyle = rgba(color, 0.66 + entity.pollination * 0.1);
    for (let i = 0; i < crownNodes; i += 1) {
      const angle = -Math.PI * 0.9 + (i / Math.max(1, crownNodes - 1)) * Math.PI * 0.8;
      const radius = entity.size * (0.46 + maturity * 0.34 + Math.sin(time * 0.06 + entity.id + i) * 0.04);
      const x = Math.cos(angle) * radius;
      const y = -entity.size * (0.92 + maturity * 0.22) + Math.sin(angle) * radius * 0.46;
      ctx.beginPath();
      ctx.arc(x, y, entity.size * (0.12 + maturity * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }
    if (entity.stage !== 'birth') {
      ctx.strokeStyle = rgba(color, 0.38 + entity.pollination * 0.16);
      ctx.beginPath();
      ctx.arc(0, -entity.size * (1.04 + maturity * 0.16), entity.size * (0.48 + entity.pollination * 0.16), Math.PI * 0.1, Math.PI * 0.9);
      ctx.stroke();
    }
    if (entity.visualState === 'reproducing' || entity.pollination > 0.4) {
      ctx.fillStyle = rgba([236, 208, 152], 0.6);
      ctx.beginPath();
      ctx.arc(entity.size * 0.16, -entity.size * 0.52, entity.size * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPredator(entity: Entity, position: Vec2, time: number): void {
    const { ctx } = this;
    const color = entityPalette.predator;
    ctx.save();
    ctx.translate(position.x, position.y);
    ctx.rotate(entity.heading + Math.sin(time * 0.08 + entity.id) * 0.03);
    ctx.globalAlpha = entity.boundaryFade * (0.44 + entity.activity * 0.58);
    ctx.strokeStyle = rgba(color, 0.84);
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
    ctx.strokeStyle = rgba(color, snapshot.tool.blocked ? 0.24 : 0.12 + snapshot.tool.pulse * 0.08);
    ctx.lineWidth = 1;
    ctx.setLineDash(snapshot.tool.active === 'observe' ? [] : [10, 16]);
    ctx.beginPath();
    ctx.arc(position.x, position.y, snapshot.tool.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawFocusMask(snapshot: SimulationSnapshot, width: number, height: number, scale: number, offsetX: number, offsetY: number, settings: GameSettings): void {
    const focusField = snapshot.fields.find((field) => field.tool === 'observe');
    if (!focusField) return;
    const { ctx } = this;
    const wrapped = this.wrappedPoint(focusField.position, snapshot.camera);
    const x = wrapped.x * scale + offsetX;
    const y = wrapped.y * scale + offsetY;
    const radius = focusField.radius * scale;
    const exteriorDim = settings.visuals.reduceMotion ? 0.12 : 0.16;

    ctx.save();
    ctx.fillStyle = `rgba(1, 4, 8, ${exteriorDim + snapshot.stats.focus * 0.08})`;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'destination-out';
    const aperture = ctx.createRadialGradient(x, y, radius * 0.18, x, y, radius * 1.18);
    aperture.addColorStop(0, 'rgba(0,0,0,0.96)');
    aperture.addColorStop(0.58, 'rgba(0,0,0,0.52)');
    aperture.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = aperture;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    const glow = ctx.createRadialGradient(x, y, radius * 0.08, x, y, radius * 1.04);
    glow.addColorStop(0, `rgba(236, 248, 255, ${0.1 + snapshot.stats.focus * 0.14})`);
    glow.addColorStop(0.44, `rgba(204, 232, 246, ${0.06 + snapshot.stats.focus * 0.08})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.02, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(196, 226, 244, ${0.16 + snapshot.stats.focus * 0.12})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawFocusedInterior(snapshot: SimulationSnapshot, scale: number, offsetX: number, offsetY: number, settings: GameSettings): void {
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
    ctx.globalAlpha = 0.18 + snapshot.stats.focus * 0.12;
    if (settings.visuals.terrainLines) {
      this.drawTerrain(snapshot.terrain, snapshot.camera, snapshot.time, settings);
      this.drawEnvironmentalFlows(snapshot.terrain, snapshot.camera, snapshot.time, settings);
    }
    ctx.globalAlpha = 0.22 + snapshot.stats.focus * 0.18;
    this.drawEntityAuras(snapshot.entities, snapshot.camera);
    this.drawResidues(snapshot.residues, snapshot.camera);
    this.drawParticles(snapshot.particles, snapshot.camera);
    this.drawEntities(snapshot.entities, snapshot.camera, snapshot.time, settings);
    ctx.restore();
  }

  private drawOverlay(snapshot: SimulationSnapshot, width: number, height: number, settings: GameSettings): void {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font = '500 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(GAME_TITLE, width - 16, height - 16);

    if (snapshot.stats.focus > 0.06) {
      ctx.save();
      ctx.strokeStyle = `rgba(182,220,242,${0.08 + snapshot.stats.focus * 0.08})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(width * 0.5, height * 0.5, Math.min(width, height) * 0.12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (!settings.visuals.debugOverlays) return;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = '500 12px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(214, 230, 242, 0.78)';
    const lines = [
      `camera ${Math.round(snapshot.camera.center.x)}, ${Math.round(snapshot.camera.center.y)} @ ${snapshot.camera.zoom.toFixed(2)}×`,
      `wrap ${snapshot.dimensions.width} × ${snapshot.dimensions.height} torus`,
      `terrain ${snapshot.terrain.length} samples · entities ${snapshot.entities.length}`,
    ];
    lines.forEach((line, index) => ctx.fillText(line, 18, height - 58 - index * 16));
    ctx.restore();
  }
}
