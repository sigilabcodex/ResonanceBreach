import { GAME_TITLE, TOOLS, type ToolType } from '../config';
import type { SimulationSnapshot } from '../sim/types';

const toolLabels: Record<ToolType, string> = {
  observe: 'Resonance Focus',
  grow: 'Grow Field',
  feed: 'Feed Bloom',
  repel: 'Repel Wave',
  disrupt: 'Disrupt Field',
};

const toolDescriptions: Record<ToolType, string> = {
  observe: 'Dim the world and isolate a local pocket of motion and sound',
  grow: 'Temporary growth basin that attracts life and strengthens clustering',
  feed: 'Emit consumable particles that visibly fuel growth',
  repel: 'Expanding radial push that creates breathing room',
  disrupt: 'Destabilize rigid groups and unravel local order over time',
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
            <p class="hud__eyebrow">Continuous organic ecosystem</p>
            <h1>${GAME_TITLE}</h1>
            <p class="hud__subtle">Force fields, drifting zones, soft boundaries, and readable ecological cause and effect.</p>
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
            <span>Field tools</span>
            <span data-tool-hint>1–5 · click or paint to place fields</span>
          </div>
          <div class="hud__tool-grid"></div>
        </div>
        <div class="hud__panel hud__panel--status">
          <div class="hud__row"><span>Flow</span><span data-flow>Normal 1×</span></div>
          <div class="hud__row"><span>Unlocked</span><span data-unlocked>0%</span></div>
          <div class="hud__row hud__row--hint"><span>Field note</span><span data-hint>Watch how attractors, currents, and local density shape clusters before you intervene.</span></div>
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
        if (!unlocked) label.textContent = 'Locked by ecosystem progression';
        else if (snapshot.tool.active === tool && snapshot.tool.blocked) label.textContent = 'Need more Resonance Energy';
        else label.textContent = toolDescriptions[tool];
      }
    }

    if (snapshot.tool.blocked) {
      this.hintValue.textContent = 'Fields persist after placement, so wait for energy to recover before stacking too many interventions.';
    } else if (snapshot.stats.focus > 0.18 || snapshot.tool.active === 'observe') {
      this.hintValue.textContent = 'Resonance Focus slows local motion, dims the wider garden, and lets you hear and inspect nearby interactions.';
    } else if (snapshot.tool.active === 'grow') {
      this.hintValue.textContent = 'Grow bends local motion inward, amplifies clustering, and helps orbits lock into readable communities.';
    } else if (snapshot.tool.active === 'feed') {
      this.hintValue.textContent = 'Feed releases bright particles. Watch mobile entities seek them out and trigger visible growth pulses when consumed.';
    } else if (snapshot.tool.active === 'repel') {
      this.hintValue.textContent = 'Repel creates a clean shockwave. Use it to open space around predators or over-compressed groups.';
    } else if (snapshot.tool.active === 'disrupt') {
      this.hintValue.textContent = 'Disrupt injects instability over time, teasing apart clusters without a single violent break.';
    } else if (snapshot.stats.threat > 0.28) {
      this.hintValue.textContent = 'Predators are finding flockers. Softly redirect them with fields instead of relying on rigid boundaries.';
    } else {
      this.hintValue.textContent = 'Attractors, currents, and density gradients now shape the world continuously, so scan before acting.';
    }
  }
}
