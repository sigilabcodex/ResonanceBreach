import { GAME_TITLE, HUD_REFRESH_RATE } from '../config';
import type { SimulationSnapshot } from '../sim/types';

const phaseLabels: Record<SimulationSnapshot['phaseState']['current'], string> = {
  calm: 'Calm',
  anomaly: 'Anomaly',
  emergence: 'Emergence',
  pressure: 'Pressure',
  breach: 'Breach',
};

const timeLabels: Record<string, string> = {
  '0.5': 'Slow 0.5×',
  '1': 'Normal 1×',
  '2': 'Fast 2×',
};

export class Hud {
  readonly element: HTMLDivElement;
  readonly restartButton: HTMLButtonElement;
  private readonly stabilityBar: HTMLDivElement;
  private readonly stabilityValue: HTMLSpanElement;
  private readonly entityValue: HTMLSpanElement;
  private readonly pocketValue: HTMLSpanElement;
  private readonly hintValue: HTMLSpanElement;
  private readonly phaseValue: HTMLSpanElement;
  private readonly timeValue: HTMLSpanElement;
  private frames = 0;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'hud';
    this.element.innerHTML = `
      <div class="hud__panel hud__panel--title">
        <div>
          <p class="hud__eyebrow">Containment Prototype</p>
          <h1>${GAME_TITLE}</h1>
        </div>
        <button class="hud__restart" type="button">Restart</button>
      </div>
      <div class="hud__panel">
        <div class="hud__row">
          <span>Stability</span>
          <span data-stability-value>0%</span>
        </div>
        <div class="hud__bar"><div data-stability-bar></div></div>
        <div class="hud__row hud__row--minor">
          <span>Phase</span>
          <span data-phase>Calm</span>
        </div>
        <div class="hud__row hud__row--minor">
          <span>Flow</span>
          <span data-time>Normal 1×</span>
        </div>
      </div>
      <div class="hud__panel hud__panel--stats">
        <div class="hud__row">
          <span>Entities</span>
          <span data-entity-count>0</span>
        </div>
        <div class="hud__row">
          <span>Pockets</span>
          <span data-pocket-count>Quiet</span>
        </div>
        <div class="hud__row hud__row--hint">
          <span>Controls</span>
          <span data-hint>Left drag contain · Wheel zoom · Right drag / WASD pan · Shift slow · Space fast</span>
        </div>
      </div>
    `;

    this.restartButton = this.element.querySelector('.hud__restart') as HTMLButtonElement;
    this.stabilityBar = this.element.querySelector('[data-stability-bar]') as HTMLDivElement;
    this.stabilityValue = this.element.querySelector('[data-stability-value]') as HTMLSpanElement;
    this.entityValue = this.element.querySelector('[data-entity-count]') as HTMLSpanElement;
    this.pocketValue = this.element.querySelector('[data-pocket-count]') as HTMLSpanElement;
    this.hintValue = this.element.querySelector('[data-hint]') as HTMLSpanElement;
    this.phaseValue = this.element.querySelector('[data-phase]') as HTMLSpanElement;
    this.timeValue = this.element.querySelector('[data-time]') as HTMLSpanElement;
  }

  attach(target: HTMLElement): void {
    target.append(this.element);
  }

  update(snapshot: SimulationSnapshot): void {
    this.frames += 1;
    if (this.frames % HUD_REFRESH_RATE !== 0 && !snapshot.lost) {
      return;
    }

    const percentage = Math.round(snapshot.stability * 100);
    const hotspotLabel = snapshot.hotspots.length === 0
      ? 'Quiet'
      : `${snapshot.hotspots.length} active · ${Math.round((snapshot.hotspots[0]?.intensity ?? 0) * 100)}%`;

    this.stabilityBar.style.width = `${percentage}%`;
    this.stabilityValue.textContent = `${percentage}%`;
    this.entityValue.textContent = String(snapshot.entities.length);
    this.pocketValue.textContent = hotspotLabel;
    this.phaseValue.textContent = phaseLabels[snapshot.phaseState.current];
    this.timeValue.textContent = timeLabels[String(snapshot.timeScale)] ?? `Flow ${snapshot.timeScale.toFixed(1)}×`;
    this.hintValue.textContent = snapshot.lost
      ? 'Containment failure · Press R or use restart to reseed'
      : 'Left drag contain · Wheel zoom · Right drag / WASD pan · Shift slow · Space fast';
  }
}
