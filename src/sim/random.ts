export class Rng {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  next(): number {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  pick<T>(values: readonly T[]): T {
    return values[Math.floor(this.next() * values.length)] ?? values[0];
  }
}
