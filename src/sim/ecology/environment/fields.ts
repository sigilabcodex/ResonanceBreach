import { WORLD_HEIGHT, WORLD_WIDTH } from '../../../config';
import type { Vec2 } from '../../../types/world';

export interface EnvironmentalFieldBuffers {
  nutrientField: Float32Array;
  nutrientBaseline: Float32Array;
  temperatureField: Float32Array;
  temperatureBaseline: Float32Array;
}

export interface EnvironmentalFieldGrid {
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  size: number;
}

export interface InitializeEnvironmentalFieldsContext {
  grid: EnvironmentalFieldGrid;
  sampleBaseField: (x: number, y: number) => { fertility: number; moisture: number; nutrient: number; temperature: number; elevation: number };
}

export interface SampleEnvironmentalFieldsContext {
  grid: EnvironmentalFieldGrid;
  buffers: Pick<EnvironmentalFieldBuffers, 'nutrientField' | 'temperatureField'>;
}

export interface AffectEnvironmentContext {
  grid: EnvironmentalFieldGrid;
  buffers: Pick<EnvironmentalFieldBuffers, 'nutrientField' | 'temperatureField'>;
  delta: (from: Vec2, to: Vec2) => Vec2;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrap = (value: number, size: number) => ((value % size) + size) % size;

export const fieldIndex = (grid: EnvironmentalFieldGrid, col: number, row: number): number => {
  const wrappedCol = (col + grid.cols) % grid.cols;
  const wrappedRow = (row + grid.rows) % grid.rows;
  return wrappedRow * grid.cols + wrappedCol;
};

export const initializeEnvironmentalFields = (
  context: InitializeEnvironmentalFieldsContext,
): EnvironmentalFieldBuffers => {
  const nutrientField = new Float32Array(context.grid.size);
  const nutrientBaseline = new Float32Array(context.grid.size);
  const temperatureField = new Float32Array(context.grid.size);
  const temperatureBaseline = new Float32Array(context.grid.size);

  for (let row = 0; row < context.grid.rows; row += 1) {
    for (let col = 0; col < context.grid.cols; col += 1) {
      const x = (col + 0.5) * context.grid.cellWidth;
      const y = (row + 0.5) * context.grid.cellHeight;
      const base = context.sampleBaseField(x, y);
      const index = fieldIndex(context.grid, col, row);
      const nutrient = clamp(base.fertility * 0.52 + base.moisture * 0.18 + base.nutrient * 0.2, 0.08, 0.92);
      const temperature = clamp(base.temperature * 0.7 + base.elevation * 0.14 + (1 - base.moisture) * 0.08, 0.08, 0.92);
      nutrientBaseline[index] = nutrient;
      nutrientField[index] = nutrient;
      temperatureBaseline[index] = temperature;
      temperatureField[index] = temperature;
    }
  }

  return { nutrientField, nutrientBaseline, temperatureField, temperatureBaseline };
};

export const sampleEnvironmentalFields = (
  context: SampleEnvironmentalFieldsContext,
  x: number,
  y: number,
): { nutrient: number; temperature: number } => {
  const gx = wrap(x, WORLD_WIDTH) / context.grid.cellWidth;
  const gy = wrap(y, WORLD_HEIGHT) / context.grid.cellHeight;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = gx - x0;
  const ty = gy - y0;
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const n00 = context.buffers.nutrientField[fieldIndex(context.grid, x0, y0)];
  const n10 = context.buffers.nutrientField[fieldIndex(context.grid, x1, y0)];
  const n01 = context.buffers.nutrientField[fieldIndex(context.grid, x0, y1)];
  const n11 = context.buffers.nutrientField[fieldIndex(context.grid, x1, y1)];
  const t00 = context.buffers.temperatureField[fieldIndex(context.grid, x0, y0)];
  const t10 = context.buffers.temperatureField[fieldIndex(context.grid, x1, y0)];
  const t01 = context.buffers.temperatureField[fieldIndex(context.grid, x0, y1)];
  const t11 = context.buffers.temperatureField[fieldIndex(context.grid, x1, y1)];

  return {
    nutrient: lerp(lerp(n00, n10, tx), lerp(n01, n11, tx), ty),
    temperature: lerp(lerp(t00, t10, tx), lerp(t01, t11, tx), ty),
  };
};

export const affectEnvironment = (
  context: AffectEnvironmentContext,
  position: Vec2,
  radius: number,
  nutrientDelta: number,
  temperatureDelta: number,
): void => {
  const minCol = Math.floor((wrap(position.x - radius, WORLD_WIDTH)) / context.grid.cellWidth) - 1;
  const maxCol = Math.floor((wrap(position.x + radius, WORLD_WIDTH)) / context.grid.cellWidth) + 1;
  const minRow = Math.floor((wrap(position.y - radius, WORLD_HEIGHT)) / context.grid.cellHeight) - 1;
  const maxRow = Math.floor((wrap(position.y + radius, WORLD_HEIGHT)) / context.grid.cellHeight) + 1;

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const center = {
        x: ((col + context.grid.cols) % context.grid.cols + 0.5) * context.grid.cellWidth,
        y: ((row + context.grid.rows) % context.grid.rows + 0.5) * context.grid.cellHeight,
      };
      const offset = context.delta(position, center);
      const dist = Math.hypot(offset.x, offset.y);
      if (dist > radius) continue;
      const falloff = smoothstep(radius, 0, dist);
      const index = fieldIndex(context.grid, col, row);
      context.buffers.nutrientField[index] = clamp(context.buffers.nutrientField[index] + nutrientDelta * falloff, 0, 1);
      context.buffers.temperatureField[index] = clamp(context.buffers.temperatureField[index] + temperatureDelta * falloff, 0, 1);
    }
  }
};

export const updateEnvironmentalFields = (
  grid: EnvironmentalFieldGrid,
  buffers: EnvironmentalFieldBuffers,
  dt: number,
): EnvironmentalFieldBuffers => {
  const nextNutrient = new Float32Array(grid.size);
  const nextTemperature = new Float32Array(grid.size);

  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      const index = fieldIndex(grid, col, row);
      const left = fieldIndex(grid, col - 1, row);
      const right = fieldIndex(grid, col + 1, row);
      const up = fieldIndex(grid, col, row - 1);
      const down = fieldIndex(grid, col, row + 1);
      const nutrientAverage = (buffers.nutrientField[left] + buffers.nutrientField[right] + buffers.nutrientField[up] + buffers.nutrientField[down]) * 0.25;
      const temperatureAverage = (buffers.temperatureField[left] + buffers.temperatureField[right] + buffers.temperatureField[up] + buffers.temperatureField[down]) * 0.25;
      nextNutrient[index] = clamp(buffers.nutrientField[index] + (nutrientAverage - buffers.nutrientField[index]) * dt * 0.32 + (buffers.nutrientBaseline[index] - buffers.nutrientField[index]) * dt * 0.06, 0, 1);
      nextTemperature[index] = clamp(buffers.temperatureField[index] + (temperatureAverage - buffers.temperatureField[index]) * dt * 0.18 + (buffers.temperatureBaseline[index] - buffers.temperatureField[index]) * dt * 0.04, 0, 1);
    }
  }

  return {
    nutrientField: nextNutrient,
    nutrientBaseline: buffers.nutrientBaseline,
    temperatureField: nextTemperature,
    temperatureBaseline: buffers.temperatureBaseline,
  };
};
