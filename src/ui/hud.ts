import { GAME_TITLE, HUD_REFRESH_RATE } from '../config';
import type { SimulationSnapshot } from '../sim/types';

export class Hud {
  readonly element: HTMLDivElement;
  readonly restartButton: HTMLButtonElement;
  private readonly stabilityBar: HTMLDivElement;
  private readonly stabilityValue: HTMLSpanElement;
  private readonly entityValue: HTMLSpanElement;
  private readonly hintValue: HTMLSpanElement;
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
      </div>
      <div class="hud__panel hud__panel--stats">
        <div class="hud__row">
          <span>Entities</span>
          <span data-entity-count>0</span>
        </div>
        <div class="hud__row hud__row--hint">
          <span>Controls</span>
          <span data-hint>Click / drag to place a stabilizer zone · R to reseed</span>
        </div>
      </div>
    `;

    this.restartButton = this.element.querySelector('.hud__restart') as HTMLButtonElement;
    this.stabilityBar = this.element.querySelector('[data-stability-bar]') as HTMLDivElement;
    this.stabilityValue = this.element.querySelector('[data-stability-value]') as HTMLSpanElement;
    this.entityValue = this.element.querySelector('[data-entity-count]') as HTMLSpanElement;
    this.hintValue = this.element.querySelector('[data-hint]') as HTMLSpanElement;
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
    this.stabilityBar.style.width = `${percentage}%`;
    this.stabilityValue.textContent = `${percentage}%`;
    this.entityValue.textContent = String(snapshot.entities.length);
    this.hintValue.textContent = snapshot.lost
      ? 'Breach cascade detected · Press R or use restart to reseed'
      : 'Click / drag to place a stabilizer zone · R to reseed';
  }
}
