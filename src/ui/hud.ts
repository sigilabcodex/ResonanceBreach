import { GAME_TITLE, TOOLS, type ToolType } from '../config';
import type { SimulationSnapshot } from '../sim/types';

const toolLabels: Record<ToolType, string> = {
  observe: 'Observe',
  grow: 'Grow',
  feed: 'Feed',
  repel: 'Repel',
  disrupt: 'Disrupt',
};

const toolDescriptions: Record<ToolType, string> = {
  observe: 'Survey terrain and local harmony',
  grow: 'Pull nearby life into clusters',
  feed: 'Release absorbable energy particles',
  repel: 'Push entities outward immediately',
  disrupt: 'Break rigid groups and stability',
};

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
            <p class="hud__eyebrow">Interactive ecology layer</p>
            <h1>${GAME_TITLE}</h1>
            <p class="hud__subtle">A living field of terrain, lifecycles, energy, and resonance tradeoffs.</p>
          </div>
          <button class="hud__restart" type="button">Reseed</button>
        </div>
        <div class="hud__panel hud__panel--stats">
          <div class="hud__row"><span>Resonance Energy</span><span data-energy>0%</span></div>
          <div class="hud__row"><span>Harmony</span><span data-harmony>0%</span></div>
          <div class="hud__row"><span>Stability</span><span data-stability>0%</span></div>
          <div class="hud__row"><span>Growth</span><span data-growth>0%</span></div>
          <div class="hud__row"><span>Threat</span><span data-threat>0%</span></div>
          <div class="hud__row"><span>Diversity</span><span data-biodiversity>0%</span></div>
        </div>
      </div>
      <div class="hud__bottom">
        <div class="hud__panel hud__panel--tools">
          <div class="hud__row hud__row--tools-head">
            <span>Tool palette</span>
            <span data-tool-hint>1–5 · drag to apply</span>
          </div>
          <div class="hud__tool-grid"></div>
        </div>
        <div class="hud__panel hud__panel--status">
          <div class="hud__row"><span>Flow</span><span data-flow>Normal 1×</span></div>
          <div class="hud__row"><span>Unlocked</span><span data-unlocked>0%</span></div>
          <div class="hud__row hud__row--hint"><span>Field note</span><span data-hint>Pan, zoom, and test different regions to learn which systems stay stable.</span></div>
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
    this.unlockValue = this.element.querySelector('[data-unlocked]') as HTMLSpanElement;
    this.hintValue = this.element.querySelector('[data-hint]') as HTMLSpanElement;
    this.flowValue = this.element.querySelector('[data-flow]') as HTMLSpanElement;

    const toolGrid = this.element.querySelector('.hud__tool-grid') as HTMLDivElement;
    TOOLS.forEach((tool, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hud__tool';
      button.innerHTML = `<span>${index + 1}. ${toolLabels[tool]}</span><small>${toolDescriptions[tool]}</small>`;
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
        if (!unlocked) label.textContent = 'Locked by progression';
        else if (snapshot.tool.active === tool && snapshot.tool.blocked) label.textContent = 'Need more energy';
        else label.textContent = toolDescriptions[tool];
      }
    }

    if (snapshot.tool.blocked) {
      this.hintValue.textContent = 'Tools draw from Resonance Energy. Let stable regions recover before forcing another intervention.';
    } else if (snapshot.stats.energy < 0.22) {
      this.hintValue.textContent = 'Energy is draining. Protect harmonious fluid and dense regions to recharge the garden.';
    } else if (snapshot.tool.active === 'grow') {
      this.hintValue.textContent = 'Grow is strongest in stable dense pockets: it pulls mature entities together and encourages reproduction.';
    } else if (snapshot.tool.active === 'feed') {
      this.hintValue.textContent = 'Feed creates visible absorption bursts. Use it to push young entities through growth into maturity.';
    } else if (snapshot.tool.active === 'repel') {
      this.hintValue.textContent = 'Repel creates immediate spacing. Use it to protect fragile clusters or steer flocks out of danger.';
    } else if (snapshot.tool.active === 'disrupt') {
      this.hintValue.textContent = 'Disrupt breaks rigid groups, but it also lowers stability and can starve your energy economy.';
    } else if (snapshot.stats.threat > 0.34) {
      this.hintValue.textContent = 'Predators are actively consuming flockers. Repel them or rebuild safer dense corridors.';
    } else {
      this.hintValue.textContent = 'Fluid lanes accelerate flockers, dense zones grow clusters and plants, and hard ground shapes navigation.';
    }
  }
}
