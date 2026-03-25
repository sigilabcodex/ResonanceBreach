import type { HabitatType, TerrainType } from '../../config';
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
  macro: number;
  meso: number;
  micro: number;
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
    const driftX = Math.sin(time * 0.0002) * 0.12;
    const driftY = Math.cos(time * 0.00018) * 0.1;
    const nx = x * 0.00022 + driftX;
    const ny = y * 0.00022 + driftY;
    const nonPeriodicA = this.fbm(nx * 0.43 + 11.2, ny * 0.39 - 7.1, 1.7, 3, 2.07, 0.53) * 2 - 1;
    const nonPeriodicB = this.fbm(nx * 0.91 - 13.4, ny * 0.86 + 9.8, 3.9, 3, 2.16, 0.5) * 2 - 1;
    const nonPeriodicC = this.fbm(nx * 1.63 + 4.7, ny * 1.49 - 10.6, 6.2, 2, 2.24, 0.47) * 2 - 1;
    const warpedX = nx + nonPeriodicA * 0.72 + nonPeriodicB * 0.33 + nonPeriodicC * 0.14;
    const warpedY = ny - nonPeriodicA * 0.46 + nonPeriodicB * 0.38 - nonPeriodicC * 0.12;

    const macroBase = this.fbm(warpedX * 0.21 - 8.4, warpedY * 0.2 + 3.6, 8.1, 5, 2.0, 0.57);
    const macroRidge = this.ridgeNoise(warpedX * 0.32 + 5.2, warpedY * 0.34 - 9.7, 10.6);
    const macro = clamp(macroBase * 0.68 + macroRidge * 0.32, 0, 1);

    const mesoBands = this.fbm(warpedX * 0.58 + nonPeriodicB * 0.25, warpedY * 0.62 - nonPeriodicA * 0.18, 14.1, 4, 2.1, 0.53);
    const mesoCorridor = this.ridgeNoise(warpedX * 0.74 - 6.7, warpedY * 0.7 + 2.4, 16.4);
    const meso = clamp(mesoBands * 0.62 + mesoCorridor * 0.38, 0, 1);

    const microTexture = this.fbm(warpedX * 1.76 + 7.3, warpedY * 1.82 - 1.9, 19.2, 3, 2.2, 0.48);
    const microFilament = this.fbm(warpedX * 2.32 - 2.8, warpedY * 2.26 + 4.1, 23.8, 2, 2.3, 0.44);
    const micro = clamp(microTexture * 0.64 + microFilament * 0.36, 0, 1);

    const elevation = clamp(macro * 0.62 + meso * 0.3 + micro * 0.08, 0, 1);
    const moistureMacro = this.fbm(warpedX * 0.28 - 12.2, warpedY * 0.26 + 8.4, 26.7, 4, 2.04, 0.55);
    const moisture = clamp(moistureMacro * 0.62 + meso * 0.24 + (1 - macro) * 0.14 - elevation * 0.16, 0, 1);

    const fertilityMacro = this.fbm(warpedX * 0.41 + 4.8, warpedY * 0.43 - 11.6, 29.4, 4, 2.1, 0.54);
    const fertility = clamp(fertilityMacro * 0.54 + meso * 0.28 + moisture * 0.22 + micro * 0.08 - macro * 0.12, 0, 1);

    const roughness = clamp(micro * 0.58 + meso * 0.2 + (1 - macro) * 0.12 + this.fbm(warpedX * 1.34 + 1.1, warpedY * 1.28 - 3.2, 33.6, 2, 2.22, 0.48) * 0.1, 0, 1);
    const density = clamp(this.fbm(warpedX * 0.8 + macro * 0.4, warpedY * 0.88 - meso * 0.3, 35.8, 3, 2.08, 0.54) * 0.52 + meso * 0.3 + moisture * 0.18, 0, 1);
    const contour = clamp(macro * 0.46 + meso * 0.38 + micro * 0.16, 0, 1);
    const flowAngle = this.fbm(warpedX * 0.62 - 4.2, warpedY * 0.64 + 6.1, 39.4 + time * 0.00013, 3, 2.03, 0.52) * TWO_PI * 2;
    const flowBias = this.fbm(warpedX * 1.02 + 3.2, warpedY * 0.96 - 4.8, 41.7, 2, 2.14, 0.5) * 2 - 1;

    return { macro, meso, micro, elevation, moisture, fertility, roughness, density, contour, flowAngle, flowBias };
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
    const samplePlusX = this.sampleLayers(x + step, y, time);
    const sampleMinusX = this.sampleLayers(x - step, y, time);
    const samplePlusY = this.sampleLayers(x, y + step, time);
    const sampleMinusY = this.sampleLayers(x, y - step, time);

    const elevationDx = samplePlusX.elevation - sampleMinusX.elevation;
    const elevationDy = samplePlusY.elevation - sampleMinusY.elevation;
    const fertilityDx = samplePlusX.fertility - sampleMinusX.fertility;
    const fertilityDy = samplePlusY.fertility - sampleMinusY.fertility;
    const moistureDx = samplePlusX.moisture - sampleMinusX.moisture;
    const moistureDy = samplePlusY.moisture - sampleMinusY.moisture;

    const slope = clamp(Math.hypot(elevationDx, elevationDy) * 8.5, 0, 1);
    const basin = smoothstep(0.74, 0.18, elevation + slope * 0.24 - moisture * 0.24 - fertility * 0.1);
    const ridge = smoothstep(0.56, 0.92, elevation + slope * 0.28 + layers.contour * 0.12 + layers.roughness * 0.08);
    const wetland = smoothstep(0.48, 0.9, moisture + basin * 0.42 - ridge * 0.36 - slope * 0.12);
    const fertileBasin = smoothstep(0.4, 0.9, basin * 0.54 + fertility * 0.34 + moisture * 0.18 + influence.residueInfluence * 0.24 - ridge * 0.22);
    const highland = smoothstep(0.46, 0.94, ridge * 0.62 + elevation * 0.2 + slope * 0.18 + layers.roughness * 0.08);
    const denseWeight = smoothstep(0.46, 0.82, layers.density * 0.62 + layers.roughness * 0.3 + fertility * 0.24 - ridge * 0.18);

    const habitat: HabitatType = highland >= fertileBasin && highland >= wetland
      ? 'highland'
      : wetland >= fertileBasin
        ? 'wetland'
        : 'basin';

    const terrain: TerrainType = highland > 0.7
      ? 'solid'
      : wetland > 0.64 && elevation < 0.76
        ? 'water'
        : fertileBasin > 0.52
          ? 'fertile'
          : denseWeight > 0.48
            ? 'dense'
            : moisture > 0.62
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

    const directional = {
      x: Math.cos(layers.flowAngle) * (wetland > 0.38 ? 0.62 : 1),
      y: Math.sin(layers.flowAngle) * (wetland > 0.38 ? 0.76 : 1),
    };
    const flowStrength = highland > 0.58
      ? 1.2 + slope * 1.8 + highland * 0.8
      : terrain === 'water'
        ? 16 + wetland * 14 + moisture * 8 + basin * 5
        : fertileBasin > 0.4
          ? 7 + fertileBasin * 5 + fertility * 4
          : terrain === 'dense'
            ? 4 + layers.density * 2
            : 1.6 + slope * 2;
    const flow = {
      x: (directional.x * (wetland > 0.48 ? 0.68 : 0.48) + downhill.x * (highland > 0.4 ? 0.94 : 0.72) + fertilityGradient.x * (fertileBasin > 0.46 ? 0.34 : 0.2) + layers.flowBias * 0.18) * flowStrength,
      y: (directional.y * (wetland > 0.48 ? 0.72 : 0.48) + downhill.y * (highland > 0.4 ? 0.9 : 0.72) + fertilityGradient.y * (fertileBasin > 0.46 ? 0.34 : 0.2) - layers.flowBias * 0.18) * flowStrength,
    };

    const traversability = clamp(1 - slope * 0.66 - highland * 0.44 - wetland * 0.16 - (terrain === 'dense' ? 0.15 : 0), 0, 1);
    const nutrient = clamp(influence.residueInfluence * 0.84 + fertility * 0.42 + moisture * 0.12 + fertileBasin * 0.24 + wetland * 0.06 - highland * 0.18, 0, 1);
    const temperature = clamp(0.22 + elevation * 0.3 + highland * 0.16 + fertility * 0.06 + layers.flowBias * 0.04 - moisture * 0.22 - wetland * 0.16 + Math.sin((x + y) * 0.0007 + time * 0.04) * 0.04, 0, 1);
    const density = clamp(0.18 + fertility * 0.18 + moisture * 0.12 + denseWeight * 0.28 + highland * 0.08 + fertileBasin * 0.1, 0, 1);
    const resonance = clamp(0.2 + moisture * 0.22 + fertility * 0.22 + nutrient * 0.14 + wetland * 0.08 + fertileBasin * 0.1 - highland * 0.1, 0, 1);
    const stability = clamp(0.28 + fertileBasin * 0.22 + traversability * 0.24 + nutrient * 0.16 + highland * 0.08 - wetland * 0.05, 0, 1);
    const hue = clamp(
      terrain === 'water'
        ? 0.46 + moisture * 0.12 + wetland * 0.04
        : terrain === 'fertile'
          ? 0.22 + fertility * 0.1 + fertileBasin * 0.08
          : terrain === 'dense'
            ? 0.54 + denseWeight * 0.08
            : 0.68 + highland * 0.08,
      0,
      1,
    );

    return {
      macro: layers.macro,
      meso: layers.meso,
      micro: layers.micro,
      terrain,
      habitat,
      habitatWeights: {
        wetland,
        highland,
        basin: fertileBasin,
      },
      elevation,
      moisture,
      fertility: terrain === 'solid' ? fertility * 0.16 : terrain === 'dense' ? fertility * 0.54 : terrain === 'water' ? fertility * 0.68 + fertileBasin * 0.06 : clamp(fertility + fertileBasin * 0.12, 0, 1),
      slope,
      traversability,
      stability,
      density,
      resonance,
      roughness: layers.roughness,
      nutrient,
      temperature,
      flow,
      flowTendency: directional,
      gradient: downhill,
      fertilityGradient,
      moistureGradient,
      hue,
    };
  }
}
