import { GAME_TITLE, TOOLS, type ToolType } from '../config';
import { TOOL_DEFINITIONS } from '../interaction/tools';
import type { SimulationSnapshot } from '../types/world';

const timeLabels: Record<string, string> = {
  '0.5': 'Slow 0.5×',
  '1': 'Normal 1×',
  '2': 'Fast 2×',
};

export class Hud {
  readonly element: HTMLDivElement;
  readonly restartButton: HTMLButtonElement;
  private readonly harmonyValue: HTMLSpanElement;
  private readonly growthValue: HTMLSpanElement;
  private readonly threatValue: HTMLSpanElement;
  private readonly energyValue: HTMLSpanElement;
  private readonly stabilityValue: HTMLSpanElement;
  private readonly biodiversityValue: HTMLSpanElement;
  private readonly nutrientsValue: HTMLSpanElement;
  private readonly fruitValue: HTMLSpanElement;
  private readonly unlockValue: HTMLSpanElement;
  private readonly hintValue: HTMLSpanElement;
  private readonly flowValue: HTMLSpanElement;
  private readonly toolButtons = new Map<ToolType, HTMLButtonElement>();

  constructor(onToolSelect: (tool: ToolType) => void) {
    this.element = document.createElement('div');
    this.element.className = 'hud';
    this.element.innerHTML = `
      <div class="hud__top">
        <div class="hud__panel hud__panel--title">
          <div>
            <p class="hud__eyebrow">Calm ecological sandbox</p>
            <h1>${GAME_TITLE}</h1>
            <p class="hud__subtle">Water, fertile soil, and solid ground drift slowly while plants, creatures, fruit, and residue form a closed loop.</p>
          </div>
          <button class="hud__restart" type="button">Reseed</button>
        </div>
        <div class="hud__panel hud__panel--stats">
          <div class="hud__row"><span>Resonance Energy</span><span data-energy>0%</span></div>
          <div class="hud__row"><span>Harmony</span><span data-harmony>0%</span></div>
          <div class="hud__row"><span>Stability</span><span data-stability>0%</span></div>
          <div class="hud__row"><span>Growth</span><span data-growth>0%</span></div>
          <div class="hud__row"><span>Nutrients</span><span data-nutrients>0%</span></div>
          <div class="hud__row"><span>Fruit</span><span data-fruit>0%</span></div>
          <div class="hud__row"><span>Diversity</span><span data-biodiversity>0%</span></div>
          <div class="hud__row"><span>Threat</span><span data-threat>0%</span></div>
        </div>
      </div>
      <div class="hud__bottom">
        <div class="hud__panel hud__panel--tools">
          <div class="hud__row hud__row--tools-head">
            <span>Field tools</span>
            <span data-tool-hint>1–5 · hold focus, click to place other fields</span>
          </div>
          <div class="hud__tool-grid"></div>
        </div>
        <div class="hud__panel hud__panel--status">
          <div class="hud__row"><span>Flow</span><span data-flow>Normal 1×</span></div>
          <div class="hud__row"><span>Unlocked</span><span data-unlocked>0%</span></div>
          <div class="hud__row hud__row--hint"><span>Field note</span><span data-hint>Observe the garden long enough to see fruit, feeding, death, and residue fold back into soil.</span></div>
        </div>
      </div>
    `;

    this.restartButton = this.element.querySelector('.hud__restart') as HTMLButtonElement;
    this.energyValue = this.element.querySelector('[data-energy]') as HTMLSpanElement;
    this.harmonyValue = this.element.querySelector('[data-harmony]') as HTMLSpanElement;
    this.stabilityValue = this.element.querySelector('[data-stability]') as HTMLSpanElement;
    this.growthValue = this.element.querySelector('[data-growth]') as HTMLSpanElement;
    this.threatValue = this.element.querySelector('[data-threat]') as HTMLSpanElement;
    this.biodiversityValue = this.element.querySelector('[data-biodiversity]') as HTMLSpanElement;
    this.nutrientsValue = this.element.querySelector('[data-nutrients]') as HTMLSpanElement;
    this.fruitValue = this.element.querySelector('[data-fruit]') as HTMLSpanElement;
    this.unlockValue = this.element.querySelector('[data-unlocked]') as HTMLSpanElement;
    this.hintValue = this.element.querySelector('[data-hint]') as HTMLSpanElement;
    this.flowValue = this.element.querySelector('[data-flow]') as HTMLSpanElement;

    const toolGrid = this.element.querySelector('.hud__tool-grid') as HTMLDivElement;
    TOOLS.forEach((tool, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hud__tool';
      button.innerHTML = `<span>${index + 1}. ${TOOL_DEFINITIONS[tool].label}</span><small>${TOOL_DEFINITIONS[tool].description}</small>`;
      button.addEventListener('click', () => onToolSelect(tool));
      this.toolButtons.set(tool, button);
      toolGrid.append(button);
    });
  }

  attach(target: HTMLElement): void {
    target.append(this.element);
  }

  update(snapshot: SimulationSnapshot): void {
    this.energyValue.textContent = `${Math.round(snapshot.stats.energy * 100)}%`;
    this.harmonyValue.textContent = `${Math.round(snapshot.stats.harmony * 100)}%`;
    this.stabilityValue.textContent = `${Math.round(snapshot.stats.stability * 100)}%`;
    this.growthValue.textContent = `${Math.round(snapshot.stats.growth * 100)}%`;
    this.threatValue.textContent = `${Math.round(snapshot.stats.threat * 100)}%`;
    this.biodiversityValue.textContent = `${Math.round(snapshot.stats.biodiversity * 100)}%`;
    this.nutrientsValue.textContent = `${Math.round(snapshot.stats.nutrients * 100)}%`;
    this.fruitValue.textContent = `${Math.round(snapshot.stats.fruit * 100)}%`;
    this.unlockValue.textContent = `${Math.round(snapshot.unlockedProgress * 100)}%`;
    this.flowValue.textContent = timeLabels[String(snapshot.timeScale)] ?? `Flow ${snapshot.timeScale.toFixed(1)}×`;

    for (const tool of TOOLS) {
      const button = this.toolButtons.get(tool);
      if (!button) continue;
      const unlocked = snapshot.tool.unlocked.includes(tool);
      button.disabled = !unlocked;
      button.classList.toggle('is-active', snapshot.tool.active === tool);
      button.classList.toggle('is-locked', !unlocked);
      button.classList.toggle('is-blocked', snapshot.tool.active === tool && snapshot.tool.blocked);
      const label = button.querySelector('small');
      if (label) {
        if (!unlocked) label.textContent = 'Locked by ecosystem progression';
        else if (snapshot.tool.active === tool && snapshot.tool.blocked) label.textContent = 'Need more Resonance Energy';
        else label.textContent = TOOL_DEFINITIONS[tool].description;

      }
    }

    const latestNotification = snapshot.notifications.recent[0];

    if (latestNotification) {
      this.hintValue.textContent = latestNotification;
    } else if (snapshot.tool.blocked) {
      this.hintValue.textContent = 'Let the field recover before stacking more interventions; low density keeps the garden readable.';
    } else if (snapshot.tool.active === 'observe' || snapshot.stats.focus > 0.16) {
      this.hintValue.textContent = 'Hold Resonance Focus to brighten the interior, subdue the outside, and hear nearby life more clearly.';
    } else if (snapshot.tool.active === 'grow') {
      this.hintValue.textContent = 'Grow gently enriches soil for several seconds, helping plants mature and fruit.';
    } else if (snapshot.tool.active === 'feed') {
      this.hintValue.textContent = 'Feed releases visible particles. Watch creatures move toward them and reproduce after sustained feeding.';
    } else if (snapshot.tool.active === 'repel') {
      this.hintValue.textContent = 'Repel opens calm empty space without introducing jitter or abrupt flashes.';
    } else if (snapshot.tool.active === 'disrupt') {
      this.hintValue.textContent = 'Disrupt waits, then bursts outward: some entities die into nutrient residue while terrain shifts slightly.';
    } else if (snapshot.stats.nutrients > 0.42) {
      this.hintValue.textContent = 'Residue is feeding the soil. Mature plants in fertile patches should begin producing fruit.';
    } else {
      this.hintValue.textContent = 'Observe the garden long enough to see fruit, feeding, death, and residue fold back into soil.';
    }
  }
}
