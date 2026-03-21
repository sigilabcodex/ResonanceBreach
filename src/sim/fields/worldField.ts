import type { TerrainType } from '../../config';
import type { TerrainModifier, WorldFieldSample } from './types';
import type { Vec2 } from '../../types/world';

const TWO_PI = Math.PI * 2;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};

interface ScalarLayers {
  elevation: number;
  moisture: number;
  fertility: number;
  roughness: number;
  density: number;
  contour: number;
  flowAngle: number;
  flowBias: number;
}

interface WorldFieldInfluence {
  residueInfluence: number;
  modifiers: TerrainModifier[];
  delta: (a: Vec2, b: Vec2) => Vec2;
}

export class WorldFieldModel {
  private hash2(x: number, y: number, seed: number): number {
    const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
    return value - Math.floor(value);
  }

  private valueNoise(x: number, y: number, seed: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const n00 = this.hash2(x0, y0, seed);
    const n10 = this.hash2(x0 + 1, y0, seed);
    const n01 = this.hash2(x0, y0 + 1, seed);
    const n11 = this.hash2(x0 + 1, y0 + 1, seed);
    return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
  }

  private ridgeNoise(x: number, y: number, seed: number): number {
    return 1 - Math.abs(this.valueNoise(x, y, seed) * 2 - 1);
  }

  private fbm(x: number, y: number, seed: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let amplitude = 0.5;
    let frequency = 1;
    let sum = 0;
    let total = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
      sum += this.valueNoise(x * frequency, y * frequency, seed + octave * 17.13) * amplitude;
      total += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return total > 0 ? sum / total : 0;
  }

  private sampleLayers(x: number, y: number, time: number): ScalarLayers {
    const driftX = Math.sin(time * 0.00045) * 0.24;
    const driftY = Math.cos(time * 0.00038) * 0.18;
    const nx = x * 0.00032 + driftX;
    const ny = y * 0.00032 + driftY;

    const warpA = this.fbm(nx * 0.85 + 13.7, ny * 0.85 - 4.1, 1.7, 3, 2.1, 0.55) * 2 - 1;
    const warpB = this.fbm(nx * 1.45 - 8.2, ny * 1.35 + 5.4, 3.9, 3, 2.2, 0.52) * 2 - 1;
    const warpedX = nx + warpA * 0.68 + warpB * 0.24;
    const warpedY = ny - warpA * 0.44 + warpB * 0.31;

    const elevationLow = this.fbm(warpedX * 0.42, warpedY * 0.42, 7.1, 4, 2.04, 0.54);
    const elevationMid = this.ridgeNoise(warpedX * 0.88 + 6.1, warpedY * 0.82 - 2.7, 9.3);
    const elevationHigh = this.fbm(warpedX * 1.92 - 3.4, warpedY * 1.96 + 8.8, 11.9, 2, 2.2, 0.5);
    const elevation = clamp(elevationLow * 0.54 + elevationMid * 0.31 + elevationHigh * 0.15, 0, 1);

    const moistureLow = this.fbm(warpedX * 0.56 - 5.2, warpedY * 0.58 + 4.4, 5.6, 4, 2.05, 0.56);
    const moistureBands = this.fbm(warpedX * 1.18 + warpB * 0.4, warpedY * 1.12 - warpA * 0.35, 12.4, 3, 2.1, 0.48);
    const moisture = clamp(moistureLow * 0.76 + moistureBands * 0.24 - elevation * 0.16, 0, 1);

    const fertilityLow = this.fbm(warpedX * 0.61 + 2.8, warpedY * 0.63 - 7.5, 14.2, 4, 2.08, 0.55);
    const fertilityTexture = this.fbm(warpedX * 1.54 - 6.5, warpedY * 1.48 + 1.3, 16.8, 3, 2.15, 0.46);
    const fertility = clamp(fertilityLow * 0.68 + fertilityTexture * 0.2 + moisture * 0.18 - elevation * 0.09, 0, 1);

    const roughness = clamp(this.fbm(warpedX * 1.9 + 9.1, warpedY * 1.82 - 3.8, 19.4, 3, 2.2, 0.48), 0, 1);
    const density = clamp(this.fbm(warpedX * 0.96, warpedY * 1.04, 22.1, 3, 2.1, 0.54), 0, 1);
    const contour = clamp(this.fbm(warpedX * 1.32 - 1.8, warpedY * 1.28 + 2.9, 25.2, 3, 2.12, 0.5), 0, 1);
    const flowAngle = this.fbm(warpedX * 0.76 - 4.2, warpedY * 0.74 + 6.1, 27.4 + time * 0.0002, 3, 2.03, 0.52) * TWO_PI * 2;
    const flowBias = this.fbm(warpedX * 1.16 + 3.2, warpedY * 1.12 - 4.8, 31.7, 2, 2.14, 0.5) * 2 - 1;

    return { elevation, moisture, fertility, roughness, density, contour, flowAngle, flowBias };
  }

  sample(x: number, y: number, time: number, influence: WorldFieldInfluence): WorldFieldSample {
    const layers = this.sampleLayers(x, y, time);
    let elevation = layers.elevation;
    let moisture = layers.moisture;
    let fertility = layers.fertility;

    for (const modifier of influence.modifiers) {
      const offset = influence.delta({ x, y }, modifier.position);
      const dist = Math.hypot(offset.x, offset.y);
      if (dist > modifier.radius) continue;
      const strength = smoothstep(modifier.radius, 0, dist) * (1 - modifier.age / modifier.duration);
      fertility = clamp(fertility + modifier.fertility * strength, 0, 1);
      moisture = clamp(moisture + modifier.moisture * strength, 0, 1);
      elevation = clamp(elevation + modifier.solidity * strength, 0, 1);
    }

    fertility = clamp(fertility + influence.residueInfluence * 0.18, 0, 1);
    moisture = clamp(moisture + influence.residueInfluence * 0.1, 0, 1);

    const step = 18;
    const elevationDx = this.sampleLayers(x + step, y, time).elevation - this.sampleLayers(x - step, y, time).elevation;
    const elevationDy = this.sampleLayers(x, y + step, time).elevation - this.sampleLayers(x, y - step, time).elevation;
    const fertilityDx = this.sampleLayers(x + step, y, time).fertility - this.sampleLayers(x - step, y, time).fertility;
    const fertilityDy = this.sampleLayers(x, y + step, time).fertility - this.sampleLayers(x, y - step, time).fertility;
    const moistureDx = this.sampleLayers(x + step, y, time).moisture - this.sampleLayers(x - step, y, time).moisture;
    const moistureDy = this.sampleLayers(x, y + step, time).moisture - this.sampleLayers(x, y - step, time).moisture;

    const slope = clamp(Math.hypot(elevationDx, elevationDy) * 8.5, 0, 1);
    const basin = smoothstep(0.72, 0.2, elevation + slope * 0.18 - moisture * 0.16);
    const ridge = smoothstep(0.58, 0.92, elevation + slope * 0.26 + layers.contour * 0.08);
    const waterWeight = smoothstep(0.46, 0.86, moisture + basin * 0.38 - ridge * 0.28);
    const fertileWeight = smoothstep(0.42, 0.88, fertility + moisture * 0.2 + influence.residueInfluence * 0.34 - slope * 0.2 - ridge * 0.24);
    const denseWeight = smoothstep(0.46, 0.82, layers.density * 0.62 + layers.roughness * 0.3 + fertility * 0.24 - ridge * 0.18);

    const terrain: TerrainType = ridge > 0.68
      ? 'solid'
      : waterWeight > 0.62 && elevation < 0.7
        ? 'water'
        : fertileWeight > 0.56
          ? 'fertile'
          : denseWeight > 0.48
            ? 'dense'
            : moisture > 0.6
              ? 'water'
              : 'fertile';

    const downhill = {
      x: clamp(-elevationDx * 140, -1, 1),
      y: clamp(-elevationDy * 140, -1, 1),
    };
    const fertilityGradient = {
      x: clamp(fertilityDx * 130, -1, 1),
      y: clamp(fertilityDy * 130, -1, 1),
    };
    const moistureGradient = {
      x: clamp(moistureDx * 130, -1, 1),
      y: clamp(moistureDy * 130, -1, 1),
    };

    const directional = { x: Math.cos(layers.flowAngle), y: Math.sin(layers.flowAngle) };
    const flowStrength = terrain === 'water'
      ? 18 + waterWeight * 10 + moisture * 8
      : terrain === 'fertile'
        ? 8 + fertility * 4
        : terrain === 'dense'
          ? 4 + layers.density * 2
          : 1.4 + slope * 2;
    const flow = {
      x: (directional.x * 0.52 + downhill.x * 0.78 + fertilityGradient.x * 0.24 + layers.flowBias * 0.18) * flowStrength,
      y: (directional.y * 0.52 + downhill.y * 0.78 + fertilityGradient.y * 0.24 - layers.flowBias * 0.18) * flowStrength,
    };

    const traversability = clamp(1 - slope * 0.72 - ridge * 0.38 - (terrain === 'water' ? 0.26 : 0) - (terrain === 'dense' ? 0.18 : 0), 0, 1);
    const nutrient = clamp(influence.residueInfluence * 0.82 + fertility * 0.48 + moisture * 0.12 + (terrain === 'fertile' ? 0.18 : terrain === 'water' ? 0.06 : 0), 0, 1);
    const density = clamp(0.18 + fertility * 0.2 + moisture * 0.18 + denseWeight * 0.3 - ridge * 0.08, 0, 1);
    const resonance = clamp(0.24 + moisture * 0.24 + fertility * 0.24 + nutrient * 0.16 - slope * 0.12, 0, 1);
    const stability = clamp(0.34 + fertility * 0.16 + traversability * 0.26 + nutrient * 0.16 - waterWeight * 0.08, 0, 1);
    const hue = clamp(
      terrain === 'water'
        ? 0.48 + moisture * 0.14
        : terrain === 'fertile'
          ? 0.24 + fertility * 0.14
          : terrain === 'dense'
            ? 0.56 + denseWeight * 0.08
            : 0.7 + ridge * 0.06,
      0,
      1,
    );

    return {
      terrain,
      elevation,
      moisture,
      fertility: terrain === 'solid' ? fertility * 0.18 : terrain === 'dense' ? fertility * 0.52 : terrain === 'water' ? fertility * 0.72 : clamp(fertility + 0.08, 0, 1),
      slope,
      traversability,
      stability,
      density,
      resonance,
      roughness: layers.roughness,
      nutrient,
      flow,
      flowTendency: directional,
      gradient: downhill,
      fertilityGradient,
      moistureGradient,
      hue,
    };
  }
}
