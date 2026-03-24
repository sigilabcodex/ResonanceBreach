import { GAME_TITLE, WORLD_HEIGHT, WORLD_WIDTH, type EntityType, type TerrainType, type ToolType } from '../config';
import type { AudioDebugState } from '../audio/audioEngine';
import type { GameSettings } from '../settings';
import type { Attractor, CameraState, Entity, EventBurst, FeedParticle, PerformanceStats, Residue, SimulationSnapshot, TerrainCell, ToolField, Vec2 } from '../types/world';

const rgba = (color: readonly [number, number, number], alpha: number) => `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
const hsla = (h: number, s: number, l: number, a: number) => `hsla(${h} ${s}% ${l}% / ${a})`;
const wrapDelta = (from: number, to: number, size: number) => {
  let delta = to - from;
  if (delta > size * 0.5) delta -= size;
  else if (delta < -size * 0.5) delta += size;
  return delta;
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const wrap = (value: number, size: number) => ((value % size) + size) % size;

const entityPalette: Record<EntityType, readonly [number, number, number]> = {
  flocker: [220, 235, 244],
  cluster: [170, 206, 182],
  plant: [140, 212, 160],
  ephemeral: [202, 232, 126],
  canopy: [112, 184, 142],
  grazer: [214, 196, 164],
  parasite: [196, 132, 170],
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
  private view = { scale: 1, offsetX: 0, offsetY: 0, width: 1, height: 1 };
  private drawCallEstimate = 0;

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

  render(snapshot: SimulationSnapshot, settings: GameSettings, audioDebug?: AudioDebugState, performanceStats?: PerformanceStats): void {
    const { ctx, canvas } = this;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const view = this.getView(snapshot.camera, width, height);
    this.view = { ...view, width, height };
    this.drawCallEstimate = 0;

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
    this.drawAttentionWorld(snapshot, settings);
    this.drawToolPreview(snapshot);

    ctx.restore();

    if (performanceStats) performanceStats.drawCallEstimate = this.drawCallEstimate;
    this.drawOverlay(snapshot, width, height, settings, audioDebug, performanceStats);
  }

  private getView(camera: CameraState, width: number, height: number) {
    const scale = Math.max(width / WORLD_WIDTH, height / WORLD_HEIGHT) * camera.zoom;
    return {
      scale,
      offsetX: width * 0.5 - camera.center.x * scale,
      offsetY: height * 0.5 - camera.center.y * scale,
    };
  }

  private isVisible(position: Vec2, padding = 0): boolean {
    const screenX = position.x * this.view.scale + this.view.offsetX;
    const screenY = position.y * this.view.scale + this.view.offsetY;
    return (
      screenX >= -padding
      && screenX <= this.view.width + padding
      && screenY >= -padding
      && screenY <= this.view.height + padding
    );
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
    const motion = settings.visuals.reduceMotion ? 0.2 : 1;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const sample of samples) {
      const center = this.wrappedPoint(sample.center, camera);
      if (!this.isVisible(center, sample.radius * this.view.scale + 48)) continue;
      const density = this.getTerrainDensity(sample);
      const moistureWeight = clamp(sample.moisture * 0.8 + sample.habitatWeights.wetland * 0.7 + sample.habitatWeights.basin * 0.35, 0, 1.45);
      const contourAngle = Math.atan2(sample.gradient.y || sample.flow.y || 0.001, sample.gradient.x || sample.flow.x || 0.001) + Math.PI * 0.5;
      const lineCount = Math.max(2, Math.min(11, Math.round(2 + sample.slope * 3 + density * 1.8 + moistureWeight * 2.2 + sample.habitatWeights.highland * 2.4)));
      const spacing = sample.radius * clamp(0.07 + (1 - moistureWeight) * 0.13 + sample.habitatWeights.highland * 0.03 + (1 - sample.slope) * 0.03, 0.05, 0.19);
      const halfLength = sample.radius * (0.2 + sample.traversability * 0.17 + density * 0.1 + sample.habitatWeights.wetland * 0.12 + sample.habitatWeights.basin * 0.08);

      const ecologicalColor = this.getEcologicalTerrainColor(sample, density);
      ctx.strokeStyle = ecologicalColor.stroke;
      ctx.lineWidth = 0.42 + sample.slope * 0.18 + moistureWeight * 0.16 + sample.habitatWeights.highland * 0.2;

      for (let band = 0; band < lineCount; band += 1) {
        const offsetAmount = (band - (lineCount - 1) * 0.5) * spacing;
        this.traceContourStroke(center, sample, contourAngle, time * motion, offsetAmount, halfLength, band);
        ctx.stroke();
        this.drawCallEstimate += 1;
      }

      this.drawTerrainMicroPatterns(center, sample, time * motion, ecologicalColor.hue);
    }

    ctx.restore();
  }

  private drawEnvironmentalFlows(samples: TerrainCell[], camera: CameraState, time: number, settings: GameSettings): void {
    const { ctx } = this;
    const motion = settings.visuals.reduceMotion ? 0.14 : 1;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const sample of samples) {
      const center = this.wrappedPoint(sample.center, camera);
      if (!this.isVisible(center, sample.radius * this.view.scale + 48)) continue;
      const accent = terrainColors[sample.terrain].accent;
      const basinWater = clamp(sample.habitatWeights.wetland * 0.7 + sample.habitatWeights.basin * 0.45 + (sample.terrain === 'water' ? 0.35 : 0), 0, 1.5);
      const alpha = sample.terrain === 'water'
        ? 0.05 + sample.resonance * 0.02 + basinWater * 0.022
        : sample.terrain === 'fertile'
          ? 0.024 + sample.nutrient * 0.02 + sample.habitatWeights.basin * 0.012
          : 0.012 + sample.density * 0.012;
      ctx.strokeStyle = rgba(accent, alpha);
      ctx.lineWidth = 0.34 + basinWater * 0.16 + sample.moisture * 0.08;

      const streamCount = Math.max(1, Math.round(1 + sample.moisture * 1.2 + sample.habitatWeights.wetland * 1.6 + sample.habitatWeights.basin * 1.2));
      for (let stream = 0; stream < streamCount; stream += 1) {
        this.traceFlowLine(center, sample, time * motion, stream);
        ctx.stroke();
        this.drawCallEstimate += 1;
      }
    }

    ctx.restore();
  }

  private getTerrainDensity(sample: TerrainCell): number {
    return clamp(sample.density * 0.36 + sample.height * 0.24 + sample.roughness * 0.14 + sample.slope * 0.26, 0, 1);
  }

  private traceContourStroke(center: Vec2, sample: TerrainCell, contourAngle: number, time: number, offsetAmount: number, halfLength: number, band: number): void {
    const { ctx } = this;
    const alongAngle = contourAngle + sample.habitatWeights.wetland * 0.14 - sample.habitatWeights.highland * 0.08;
    const normalAngle = contourAngle + Math.PI * 0.5;
    const basinWater = clamp(sample.habitatWeights.wetland * 0.75 + sample.habitatWeights.basin * 0.5, 0, 1.3);
    const windDirection = Math.atan2(sample.flow.y || sample.flowTendency.y || 0.001, sample.flow.x || sample.flowTendency.x || 0.001);
    const windInfluence = (Math.cos(windDirection - contourAngle) * 0.5 + 0.5) * (0.6 + sample.habitatWeights.wetland * 0.36);
    const curvature = (sample.flowTendency.x * Math.cos(normalAngle) + sample.flowTendency.y * Math.sin(normalAngle)) * sample.radius * (0.045 + sample.habitatWeights.basin * 0.06 + sample.habitatWeights.wetland * 0.1);
    const wobbleStrength = sample.habitatWeights.highland * 0.008 + sample.habitatWeights.basin * 0.006 + sample.habitatWeights.wetland * 0.004;
    const basinPulse = sample.radius * (0.006 + basinWater * 0.02);
    ctx.beginPath();
    for (let step = 0; step <= 12; step += 1) {
      const t = step / 12;
      const along = (t - 0.5) * halfLength * 2;
      const wobble = Math.sin(time * (0.5 + sample.habitatWeights.wetland * 0.16) + sample.index * 0.23 + band * 0.6 + t * Math.PI * 2) * sample.radius * wobbleStrength;
      const bend = Math.sin(t * Math.PI + sample.roughness * (4 + sample.habitatWeights.highland * 1.6) + band) * curvature;
      const windDrift = Math.sin(time * 0.24 + sample.index * 0.17 + band * 0.4 + t * Math.PI * (1.4 + sample.moisture * 0.4)) * sample.radius * (0.01 + windInfluence * 0.022);
      const basinOscillation = Math.sin(time * (0.28 + basinWater * 0.12) + t * Math.PI * 2 + sample.index * 0.3) * basinPulse;
      const x = center.x + Math.cos(alongAngle) * along + Math.cos(normalAngle) * (offsetAmount + bend + wobble + windDrift + basinOscillation);
      const y = center.y + Math.sin(alongAngle) * along + Math.sin(normalAngle) * (offsetAmount + bend + wobble + windDrift + basinOscillation);
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }

  private traceFlowLine(center: Vec2, sample: TerrainCell, time: number, stream: number): void {
    const { ctx } = this;
    const flowAngle = Math.atan2(sample.flow.y || sample.flowTendency.y || 0.001, sample.flow.x || sample.flowTendency.x || 0.001) + sample.habitatWeights.wetland * 0.08;
    const normalAngle = flowAngle + Math.PI * 0.5;
    const span = sample.radius * (0.28 + sample.moisture * 0.18 + sample.habitatWeights.wetland * 0.26 + sample.habitatWeights.basin * 0.08);
    const offset = sample.radius * ((stream - 1) * 0.12 + (sample.density - 0.5) * 0.04);
    ctx.beginPath();
    for (let step = 0; step <= 16; step += 1) {
      const t = step / 16;
      const along = (t - 0.5) * span * 2;
      const drift = Math.sin(time * (0.72 + sample.habitatWeights.wetland * 0.28) + sample.index * 0.13 + stream * 0.8 + t * Math.PI * 2) * sample.radius * (0.012 + sample.habitatWeights.wetland * 0.022);
      const turbulence = (sample.gradient.x * Math.cos(normalAngle) + sample.gradient.y * Math.sin(normalAngle)) * sample.radius * (0.03 + sample.habitatWeights.highland * 0.07) * Math.sin(t * Math.PI);
      const x = center.x + Math.cos(flowAngle) * along + Math.cos(normalAngle) * (offset + drift + turbulence);
      const y = center.y + Math.sin(flowAngle) * along + Math.sin(normalAngle) * (offset + drift + turbulence);
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }

  private getEcologicalTerrainColor(sample: TerrainCell, density: number): { stroke: string; hue: number } {
    const waterWeight = clamp((sample.terrain === 'water' ? 0.55 : 0) + sample.habitatWeights.wetland * 0.6 + sample.moisture * 0.24, 0, 1);
    const fertilityWeight = clamp(sample.fertility * 0.64 + sample.nutrient * 0.24 + sample.habitatWeights.basin * 0.3, 0, 1);
    const decayWeight = clamp(sample.roughness * 0.48 + (1 - sample.stability) * 0.54 + sample.habitatWeights.highland * 0.16, 0, 1);
    const blendTotal = Math.max(0.0001, waterWeight + fertilityWeight + decayWeight);
    const normalizedWater = waterWeight / blendTotal;
    const normalizedFertility = fertilityWeight / blendTotal;
    const normalizedDecay = decayWeight / blendTotal;

    const hue = normalizedWater * (198 + sample.moisture * 14)
      + normalizedFertility * (128 + sample.fertility * 20)
      + normalizedDecay * (298 + sample.roughness * 30);
    const saturation = 10 + normalizedWater * 6 + normalizedFertility * 4 + normalizedDecay * 5;
    const lightness = 56 + sample.nutrient * 6 - sample.habitatWeights.highland * 3 + normalizedWater * 3;
    const alpha = 0.028 + density * 0.028 + sample.slope * 0.02 + sample.moisture * 0.01 + sample.habitatWeights.basin * 0.012;
    return {
      stroke: hsla(hue, saturation, lightness, alpha),
      hue,
    };
  }

  private drawTerrainMicroPatterns(center: Vec2, sample: TerrainCell, time: number, hue: number): void {
    const { ctx } = this;
    const textureStrength = clamp(sample.roughness * 0.46 + sample.resonance * 0.36 + sample.density * 0.22, 0, 1.1);
    if (textureStrength < 0.22) return;

    const hatchCount = Math.max(1, Math.round(1 + textureStrength * 2 + sample.habitatWeights.highland * 1.4));
    const hatchSpan = sample.radius * (0.09 + textureStrength * 0.08);
    const hatchAngle = Math.atan2(sample.gradient.y || 0.001, sample.gradient.x || 0.001) + Math.PI * (0.18 + sample.habitatWeights.highland * 0.2);
    const normalAngle = hatchAngle + Math.PI * 0.5;
    ctx.strokeStyle = hsla(hue + 8, 12, 62, 0.018 + textureStrength * 0.028);
    ctx.lineWidth = 0.38;
    for (let hatch = 0; hatch < hatchCount; hatch += 1) {
      const offset = (hatch - (hatchCount - 1) * 0.5) * sample.radius * 0.08;
      ctx.beginPath();
      for (let step = 0; step <= 6; step += 1) {
        const t = step / 6;
        const along = (t - 0.5) * hatchSpan * 2;
        const jitter = Math.sin(time * 0.35 + sample.index * 0.2 + hatch + t * Math.PI * 2) * sample.radius * (0.005 + textureStrength * 0.005);
        const x = center.x + Math.cos(hatchAngle) * along + Math.cos(normalAngle) * (offset + jitter);
        const y = center.y + Math.sin(hatchAngle) * along + Math.sin(normalAngle) * (offset + jitter);
        if (step === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      this.drawCallEstimate += 1;
    }

    const dotCount = Math.max(0, Math.round((sample.resonance * 0.8 + sample.nutrient * 0.6) * 3));
    if (dotCount <= 0) return;
    ctx.fillStyle = hsla(hue - 10, 10, 60, 0.018 + sample.resonance * 0.02);
    for (let dot = 0; dot < dotCount; dot += 1) {
      const seed = sample.index * 0.11 + dot * 1.87;
      const r = sample.radius * (0.08 + ((Math.sin(seed * 5.3 + time * 0.08) * 0.5 + 0.5) * 0.18));
      const theta = seed * 2.4 + time * 0.04;
      ctx.beginPath();
      ctx.arc(
        center.x + Math.cos(theta) * r,
        center.y + Math.sin(theta) * r,
        0.55 + sample.roughness * 0.35,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      this.drawCallEstimate += 1;
    }
  }

  private drawAttractors(attractors: Attractor[], camera: CameraState): void {
    const { ctx } = this;
    ctx.save();
    for (const attractor of attractors) {
      const position = this.wrappedPoint(attractor.position, camera);
      if (!this.isVisible(position, attractor.radius * this.view.scale * 0.4 + 24)) continue;
      const hue = 186 + attractor.hue * 30;
      ctx.strokeStyle = hsla(hue, 22, 72, 0.045);
      ctx.lineWidth = 0.8;
      for (let ring = 0; ring < 2; ring += 1) {
        ctx.beginPath();
        ctx.arc(position.x, position.y, attractor.radius * (0.22 + ring * 0.16), 0, Math.PI * 2);
        ctx.stroke();
        this.drawCallEstimate += 1;
      }
    }
    ctx.restore();
  }

  private drawResidues(residues: Residue[], camera: CameraState): void {
    const { ctx } = this;
    ctx.save();
    for (const residue of residues) {
      const position = this.wrappedPoint(residue.position, camera);
      if (!this.isVisible(position, residue.radius * this.view.scale + 24)) continue;
      const alpha = (1 - residue.age / residue.duration) * (0.12 + residue.richness * 0.16);
      const hue = residue.sourceType === 'flocker' ? 32 : residue.sourceType === 'grazer' ? 18 : residue.sourceType === 'cluster' ? 122 : residue.sourceType === 'parasite' ? 320 : residue.sourceType === 'canopy' ? 128 : residue.sourceType === 'ephemeral' ? 82 : 102;
      ctx.strokeStyle = hsla(hue, 22, 70, alpha * 0.62);
      ctx.lineWidth = 0.7;
      for (let i = 0; i < 3; i += 1) {
        const ring = residue.radius * (0.18 + i * 0.16 + residue.richness * 0.05);
        ctx.beginPath();
        ctx.arc(position.x, position.y, ring, i * 0.7, i * 0.7 + Math.PI * 0.9);
        ctx.stroke();
        this.drawCallEstimate += 1;
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
      if (!this.isVisible(position, field.radius * this.view.scale + 24)) continue;
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
      this.drawCallEstimate += 1;

      if (field.tool === 'observe') {
        ctx.strokeStyle = rgba(color, 0.1 + fade * 0.16);
        for (let i = 0; i < 3; i += 1) {
          const ring = field.radius * (0.34 + i * 0.19);
          ctx.beginPath();
          ctx.arc(position.x, position.y, ring, 0, Math.PI * 2);
          ctx.stroke();
          this.drawCallEstimate += 1;
        }

        ctx.save();
        ctx.strokeStyle = rgba(color, 0.22 + fade * 0.18);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(position.x, position.y, field.radius * 0.98, Math.PI * 0.16, Math.PI * 1.88);
        ctx.stroke();
        this.drawCallEstimate += 1;
        ctx.restore();
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
          this.drawCallEstimate += 1;
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
      if (!this.isVisible(position, 18)) continue;
      const alpha = 1 - particle.age / particle.duration;
      if (particle.kind === 'fruit') {
        ctx.strokeStyle = hsla(36, 84, 74, 0.18 + alpha * 0.34);
        ctx.lineWidth = 0.9;
        ctx.fillStyle = hsla(24 + alpha * 8, 74, 68, 0.14 + alpha * 0.34);
        ctx.beginPath();
        ctx.moveTo(position.x, position.y - particle.radius * 1.3);
        ctx.quadraticCurveTo(position.x + particle.radius * 1.4, position.y - particle.radius * 0.2, position.x, position.y + particle.radius * 1.3);
        ctx.quadraticCurveTo(position.x - particle.radius * 1.4, position.y - particle.radius * 0.2, position.x, position.y - particle.radius * 1.3);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(position.x, position.y - particle.radius * 1.15);
        ctx.lineTo(position.x + particle.radius * 0.16, position.y - particle.radius * 1.9);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(position.x, position.y + particle.radius * 0.1, particle.radius * (1.5 + alpha * 0.4), 0, Math.PI * 2);
        ctx.strokeStyle = hsla(44, 70, 76, 0.06 + alpha * 0.12);
        ctx.stroke();
      } else {
        const hue = 42;
        ctx.fillStyle = hsla(hue, 82, 74, 0.1 + alpha * 0.3);
        ctx.beginPath();
        ctx.arc(position.x, position.y, particle.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      this.drawCallEstimate += 1;
    }
    ctx.restore();
  }

  private drawBursts(bursts: EventBurst[], camera: CameraState): void {
    const { ctx } = this;
    ctx.save();
    for (const burst of bursts) {
      const position = this.wrappedPoint(burst.position, camera);
      if (!this.isVisible(position, burst.radius * this.view.scale * 1.6 + 24)) continue;
      const progress = burst.age / burst.duration;
      const alpha = (1 - progress) * (burst.type === 'death' ? 0.16 : burst.type === 'disrupt' ? 0.2 : 0.14);
      const hue = burst.type === 'feed' ? 36 : burst.type === 'birth' ? 126 : burst.type === 'disrupt' ? 274 : 356;
      ctx.strokeStyle = hsla(hue + burst.hue * 22, 42, 76, alpha);
      ctx.lineWidth = burst.type === 'disrupt' ? 1.4 : 1;
      ctx.beginPath();
      ctx.arc(position.x, position.y, burst.radius * (0.6 + progress * 0.8), 0, Math.PI * 2);
      ctx.stroke();
      this.drawCallEstimate += 1;
    }
    ctx.restore();
  }

  private drawEntityAuras(entities: Entity[], camera: CameraState): void {
    const { ctx } = this;
    ctx.save();
    for (const entity of entities) {
      if (entity.activity < 0.14 && entity.visualPulse < 0.1 && entity.pollination < 0.18) continue;
      const position = this.wrappedPoint(entity.position, camera);
      if (!this.isVisible(position, entity.size * this.view.scale * 4 + 24)) continue;
      const color = entityPalette[entity.type];
      const radius = entity.size * (entity.type === 'plant' || entity.type === 'ephemeral' || entity.type === 'canopy' ? 2.8 : entity.type === 'cluster' || entity.type === 'parasite' ? 2.3 : entity.type === 'grazer' ? 2.7 : 2.5) * (0.82 + entity.activity * 0.44 + entity.visualPulse * 0.22 + entity.pollination * 0.08);
      const gradient = ctx.createRadialGradient(position.x, position.y, entity.size * 0.1, position.x, position.y, radius);
      gradient.addColorStop(0, rgba(color, 0.04 + entity.activity * 0.06 + entity.pollination * 0.03));
      gradient.addColorStop(0.65, rgba(color, 0.02 + entity.visualPulse * 0.06));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
      ctx.fill();
      this.drawCallEstimate += 1;
    }
    ctx.restore();
  }

  private drawEntities(entities: Entity[], camera: CameraState, time: number, settings: GameSettings): void {
    for (const entity of entities) {
      const position = this.wrappedPoint(entity.position, camera);
      if (!this.isVisible(position, entity.size * this.view.scale * 4 + 28)) continue;
      if (entity.type === 'flocker') this.drawFlocker(entity, position, time, camera, settings);
      else if (entity.type === 'cluster' || entity.type === 'parasite') this.drawCluster(entity, position, time, camera, settings);
      else if (entity.type === 'grazer') this.drawGrazer(entity, position, time, camera, settings);
      else if (entity.type === 'plant' || entity.type === 'ephemeral' || entity.type === 'canopy') this.drawPlant(entity, position, time);
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
        if (!this.isVisible(trailPoint, 12)) continue;
        const alpha = ((entity.trail.length - i) / Math.max(1, entity.trail.length)) * (settings.visuals.reduceMotion ? 0.04 : 0.08);
        ctx.fillStyle = rgba(color, alpha);
        ctx.beginPath();
        ctx.arc(trailPoint.x, trailPoint.y, 0.9 + i * 0.18, 0, Math.PI * 2);
        ctx.fill();
        this.drawCallEstimate += 1;
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
    this.drawCallEstimate += 1;
    ctx.beginPath();
    ctx.moveTo(-entity.size * 0.22, 0);
    ctx.lineTo(entity.size * 0.54, 0);
    ctx.stroke();
    this.drawCallEstimate += 1;
    if (maturity > 0.34) {
      ctx.beginPath();
      ctx.arc(-entity.size * 0.3, 0, entity.size * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = rgba(color, 0.72);
      ctx.fill();
      this.drawCallEstimate += 1;
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
        if (!this.isVisible(trailPoint, 12)) continue;
        const alpha = ((entity.trail.length - i) / Math.max(1, entity.trail.length)) * (settings.visuals.reduceMotion ? 0.028 : 0.05);
        ctx.strokeStyle = rgba(color, alpha);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(trailPoint.x, trailPoint.y, 1.2 + i * 0.1, 0, Math.PI * 2);
        ctx.stroke();
        this.drawCallEstimate += 1;
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
      this.drawCallEstimate += 1;
    }
    ctx.fillStyle = rgba(color, 0.4 + maturity * 0.22);
    ctx.beginPath();
    ctx.arc(0, 0, entity.size * (0.24 + maturity * 0.12), 0, Math.PI * 2);
    ctx.fill();
    this.drawCallEstimate += 1;
    ctx.restore();
  }

  private drawGrazer(entity: Entity, position: Vec2, time: number, camera: CameraState, settings: GameSettings): void {
    const { ctx } = this;
    const color = entityPalette.grazer;
    const maturity = Math.min(1, entity.stageProgress * 1.1 + entity.growth * 0.26 + entity.food * 0.18);
    ctx.save();
    if (settings.visuals.motionTrails) {
      for (let i = entity.trail.length - 1; i >= 0; i -= 1) {
        const trailPoint = this.wrappedPoint(entity.trail[i] as Vec2, camera);
        if (!this.isVisible(trailPoint, 14)) continue;
        const alpha = ((entity.trail.length - i) / Math.max(1, entity.trail.length)) * (settings.visuals.reduceMotion ? 0.022 : 0.042);
        ctx.strokeStyle = rgba(color, alpha);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(trailPoint.x - 1.1, trailPoint.y);
        ctx.lineTo(trailPoint.x + 1.1, trailPoint.y);
        ctx.stroke();
        this.drawCallEstimate += 1;
      }
    }

    ctx.translate(position.x, position.y);
    ctx.rotate(entity.heading + Math.sin(time * 0.05 + entity.id) * (settings.visuals.reduceMotion ? 0.02 : 0.05));
    ctx.globalAlpha = entity.boundaryFade * (0.48 + entity.activity * 0.5);
    ctx.strokeStyle = rgba(color, 0.88);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(entity.size * 1.1, 0);
    ctx.lineTo(entity.size * 0.3, -entity.size * (0.58 + maturity * 0.08));
    ctx.lineTo(-entity.size * 0.74, -entity.size * 0.42);
    ctx.lineTo(-entity.size * 1.02, 0);
    ctx.lineTo(-entity.size * 0.74, entity.size * 0.42);
    ctx.lineTo(entity.size * 0.3, entity.size * (0.58 + maturity * 0.08));
    ctx.closePath();
    ctx.stroke();
    this.drawCallEstimate += 1;

    ctx.beginPath();
    ctx.moveTo(-entity.size * 0.42, -entity.size * 0.18);
    ctx.lineTo(entity.size * 0.52, -entity.size * 0.18);
    ctx.moveTo(-entity.size * 0.42, entity.size * 0.18);
    ctx.lineTo(entity.size * 0.52, entity.size * 0.18);
    ctx.stroke();
    this.drawCallEstimate += 1;

    if (entity.visualState === 'feeding' || entity.food > 0.72) {
      ctx.fillStyle = rgba([236, 212, 162], 0.18 + Math.min(0.24, entity.visualPulse * 0.22));
      ctx.beginPath();
      ctx.arc(entity.size * 0.92, 0, entity.size * 0.32, 0, Math.PI * 2);
      ctx.fill();
      this.drawCallEstimate += 1;
    }
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
    this.drawCallEstimate += 1;
    ctx.beginPath();
    ctx.moveTo(0, entity.size * 0.82);
    ctx.lineTo(0, -entity.size * (0.9 + maturity * 0.38));
    ctx.stroke();
    this.drawCallEstimate += 1;
    ctx.fillStyle = rgba(color, 0.66 + entity.pollination * 0.1);
    for (let i = 0; i < crownNodes; i += 1) {
      const angle = -Math.PI * 0.9 + (i / Math.max(1, crownNodes - 1)) * Math.PI * 0.8;
      const radius = entity.size * (0.46 + maturity * 0.34 + Math.sin(time * 0.06 + entity.id + i) * 0.04);
      const x = Math.cos(angle) * radius;
      const y = -entity.size * (0.92 + maturity * 0.22) + Math.sin(angle) * radius * 0.46;
      ctx.beginPath();
      ctx.arc(x, y, entity.size * (0.12 + maturity * 0.08), 0, Math.PI * 2);
      ctx.fill();
      this.drawCallEstimate += 1;
    }
    if (entity.stage !== 'birth') {
      ctx.strokeStyle = rgba(color, 0.38 + entity.pollination * 0.16);
      ctx.beginPath();
      ctx.arc(0, -entity.size * (1.04 + maturity * 0.16), entity.size * (0.48 + entity.pollination * 0.16), Math.PI * 0.1, Math.PI * 0.9);
      ctx.stroke();
      this.drawCallEstimate += 1;
    }
    if (entity.visualState === 'reproducing' || entity.pollination > 0.4) {
      ctx.fillStyle = rgba([236, 208, 152], 0.6);
      ctx.beginPath();
      ctx.arc(entity.size * 0.16, -entity.size * 0.52, entity.size * 0.14, 0, Math.PI * 2);
      ctx.fill();
      this.drawCallEstimate += 1;
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
    this.drawCallEstimate += 1;
    ctx.restore();
  }

  private drawToolPreview(snapshot: SimulationSnapshot): void {
    if (!snapshot.tool.visible || snapshot.tool.active === 'observe') return;
    const { ctx } = this;
    const color = toolPalette[snapshot.tool.active];
    const position = this.wrappedPoint(snapshot.tool.worldPosition, snapshot.camera);
    if (!this.isVisible(position, snapshot.tool.radius * this.view.scale + 16)) return;
    ctx.save();
    ctx.strokeStyle = rgba(color, snapshot.tool.blocked ? 0.24 : 0.14 + snapshot.tool.pulse * 0.1);
    ctx.lineWidth = 1;
    ctx.setLineDash([10, 16]);
    ctx.beginPath();
    ctx.arc(position.x, position.y, snapshot.tool.radius, 0, Math.PI * 2);
    ctx.stroke();
    this.drawCallEstimate += 1;
    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawAttentionWorld(snapshot: SimulationSnapshot, settings: GameSettings): void {
    const dragStart = snapshot.attention.dragStart;
    const dragCurrent = snapshot.attention.dragCurrent;
    if (snapshot.attention.dragging && dragStart && dragCurrent) {
      this.drawAttentionRegion(dragStart, dragCurrent, snapshot.camera, true, settings);
    }

    if (snapshot.attention.mode === 'region') {
      this.drawAttentionRegion(snapshot.attention.position, undefined, snapshot.camera, false, settings, snapshot.attention.radius);
      return;
    }

    if (snapshot.attention.mode !== 'entity' || snapshot.attention.entityId === null) return;
    const selected = snapshot.entities.find((entity) => entity.id === snapshot.attention.entityId);
    if (!selected) return;

    const relatedIds = new Set(snapshot.attention.relatedEntityIds);
    for (const entity of snapshot.entities) {
      if (!relatedIds.has(entity.id)) continue;
      const position = this.wrappedPoint(entity.position, snapshot.camera);
      if (!this.isVisible(position, entity.size * this.view.scale * 3 + 20)) continue;
      this.drawAttentionEntityMarker(position, entity.size * 2.2, 0.18, false);
    }

    const position = this.wrappedPoint(selected.position, snapshot.camera);
    if (!this.isVisible(position, selected.size * this.view.scale * 3 + 20)) return;
    this.drawAttentionTarget(snapshot, selected);
    this.drawAttentionEntityMarker(position, selected.size * 2.8, 0.42, true);
    this.drawAttentionInfoLabel(selected, position);
  }

  private drawAttentionTarget(snapshot: SimulationSnapshot, entity: Entity): void {
    if (entity.targetId === undefined || !entity.targetKind) return;
    let position: Vec2 | undefined;
    if (entity.targetKind === 'bloom') {
      position = snapshot.entities.find((candidate) => candidate.id === entity.targetId)?.position;
    } else if (entity.targetKind === 'fruit' || entity.targetKind === 'feed') {
      position = snapshot.particles.find((particle) => particle.id === entity.targetId)?.position;
    } else if (entity.targetKind === 'residue') {
      position = snapshot.residues.find((residue) => residue.id === entity.targetId)?.position;
    }
    if (!position) return;

    const a = this.wrappedPoint(entity.position, snapshot.camera);
    const b = this.wrappedPoint(position, snapshot.camera);
    if (!this.isVisible(b, 24)) return;
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = 'rgba(216, 232, 238, 0.18)';
    ctx.lineWidth = 0.9;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(b.x, b.y, entity.targetKind === 'residue' ? 10 : 8, 0, Math.PI * 2);
    ctx.strokeStyle = entity.targetKind === 'residue' ? 'rgba(170, 206, 182, 0.32)' : entity.targetKind === 'bloom' ? 'rgba(140, 212, 160, 0.28)' : 'rgba(236, 208, 156, 0.34)';
    ctx.stroke();
    this.drawCallEstimate += 2;
    ctx.restore();
  }

  private drawAttentionEntityMarker(position: Vec2, radius: number, alpha: number, primary: boolean): void {
    const { ctx } = this;
    ctx.save();
    const glow = ctx.createRadialGradient(position.x, position.y, radius * 0.2, position.x, position.y, radius * 1.95);
    glow.addColorStop(0, `rgba(212, 238, 248, ${alpha * 0.18})`);
    glow.addColorStop(0.64, `rgba(182, 220, 242, ${alpha * 0.1})`);
    glow.addColorStop(1, 'rgba(182, 220, 242, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(position.x, position.y, radius * 1.95, 0, Math.PI * 2);
    ctx.fill();
    this.drawCallEstimate += 1;

    ctx.strokeStyle = `rgba(212, 236, 248, ${alpha * (primary ? 0.88 : 0.8)})`;
    ctx.lineWidth = primary ? 1.3 : 0.9;
    ctx.beginPath();
    ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    this.drawCallEstimate += 1;

    if (primary) {
      ctx.strokeStyle = `rgba(236, 248, 255, ${alpha * 0.72})`;
      ctx.lineWidth = 0.95;
      ctx.beginPath();
      ctx.arc(position.x, position.y, radius * 1.28, Math.PI * 0.16, Math.PI * 1.84);
      ctx.stroke();
      this.drawCallEstimate += 1;

      ctx.fillStyle = `rgba(230, 244, 252, ${alpha * 0.18})`;
      ctx.beginPath();
      ctx.arc(position.x, position.y, Math.max(1.2, radius * 0.12), 0, Math.PI * 2);
      ctx.fill();
      this.drawCallEstimate += 1;
    }
    ctx.restore();
  }

  private drawAttentionRegion(
    anchor: Vec2,
    current: Vec2 | undefined,
    camera: CameraState,
    preview: boolean,
    settings: GameSettings,
    fixedRadius?: number,
  ): void {
    const { ctx } = this;
    const center = current
      ? this.wrapPosition({
        x: anchor.x + wrapDelta(anchor.x, current.x, WORLD_WIDTH) * 0.5,
        y: anchor.y + wrapDelta(anchor.y, current.y, WORLD_HEIGHT) * 0.5,
      })
      : anchor;
    const radius = fixedRadius ?? Math.hypot(wrapDelta(anchor.x, current!.x, WORLD_WIDTH), wrapDelta(anchor.y, current!.y, WORLD_HEIGHT)) * 0.5;
    const wrapped = this.wrappedPoint(center, camera);
    if (!this.isVisible(wrapped, radius * this.view.scale + 20)) return;
    const motionAlpha = settings.visuals.reduceMotion ? 0.14 : 0.2;

    const gradient = ctx.createRadialGradient(wrapped.x, wrapped.y, radius * 0.2, wrapped.x, wrapped.y, radius * 1.02);
    gradient.addColorStop(0, preview ? 'rgba(214, 236, 246, 0.03)' : `rgba(214, 236, 246, ${motionAlpha * 0.22})`);
    gradient.addColorStop(0.7, preview ? 'rgba(214, 236, 246, 0.014)' : `rgba(214, 236, 246, ${motionAlpha * 0.1})`);
    gradient.addColorStop(1, 'rgba(214, 236, 246, 0)');

    ctx.save();
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(wrapped.x, wrapped.y, radius, 0, Math.PI * 2);
    ctx.fill();
    this.drawCallEstimate += 1;
    ctx.strokeStyle = preview ? 'rgba(214, 236, 246, 0.28)' : 'rgba(214, 236, 246, 0.22)';
    ctx.lineWidth = preview ? 1 : 1.15;
    if (preview) ctx.setLineDash([12, 12]);
    ctx.beginPath();
    ctx.arc(wrapped.x, wrapped.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    this.drawCallEstimate += 1;
    ctx.setLineDash([]);

    ctx.strokeStyle = preview ? 'rgba(236, 246, 252, 0.12)' : 'rgba(236, 246, 252, 0.14)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(wrapped.x, wrapped.y, radius * 0.82, Math.PI * 0.14, Math.PI * 1.86);
    ctx.stroke();
    this.drawCallEstimate += 1;

    ctx.fillStyle = preview ? 'rgba(226, 240, 248, 0.16)' : 'rgba(226, 240, 248, 0.18)';
    ctx.beginPath();
    ctx.arc(wrapped.x, wrapped.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
    this.drawCallEstimate += 1;
    ctx.restore();
  }

  private wrapPosition(position: Vec2): Vec2 {
    return {
      x: wrap(position.x, WORLD_WIDTH),
      y: wrap(position.y, WORLD_HEIGHT),
    };
  }

  private drawAttentionInfoLabel(entity: Entity, position: Vec2): void {
    const { ctx } = this;
    const status = entity.type === 'grazer'
      ? entity.visualState === 'feeding'
        ? 'feeding'
        : entity.energy < 0.22 || entity.food < 0.18
          ? 'weakening'
          : entity.targetKind === 'fruit' || entity.targetKind === 'bloom'
            ? `seeking ${entity.targetKind}`
            : 'ranging'
      : entity.visualState === 'feeding'
        ? 'active'
        : entity.visualState;
    const label = entity.type === 'grazer'
      ? `Grazer · ${status}`
      : entity.type === 'plant'
        ? `Bloom · ${entity.targetKind === 'bloom' ? 'visited' : entity.visualState}`
        : entity.type === 'cluster'
          ? `Decomposer · ${status}`
          : 'Drifter';

    ctx.save();
    ctx.font = '500 11px Inter, system-ui, sans-serif';
    const textWidth = ctx.measureText(label).width;
    const x = position.x - textWidth * 0.5 - 8;
    const y = position.y - entity.size * 3.4;
    ctx.fillStyle = 'rgba(10, 16, 20, 0.72)';
    ctx.fillRect(x, y - 11, textWidth + 16, 18);
    ctx.strokeStyle = 'rgba(218, 232, 238, 0.16)';
    ctx.strokeRect(x, y - 11, textWidth + 16, 18);
    ctx.fillStyle = 'rgba(228, 238, 242, 0.88)';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 8, y + 2);
    this.drawCallEstimate += 3;
    ctx.restore();
  }


  private drawOverlay(
    _snapshot: SimulationSnapshot,
    width: number,
    height: number,
    _settings: GameSettings,
    _audioDebug?: AudioDebugState,
    _performanceStats?: PerformanceStats,
  ): void {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.font = '500 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(GAME_TITLE, width - 16, height - 16);


  }
}
