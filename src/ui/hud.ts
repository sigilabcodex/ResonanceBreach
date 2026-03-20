import { GAME_TITLE, TOOLS, type ToolType } from '../config';
import type { SimulationSnapshot } from '../sim/types';

const toolLabels: Record<ToolType, string> = {
  observe: 'Observe',
  grow: 'Grow',
  feed: 'Feed',
  repel: 'Repel',
  disrupt: 'Disrupt',
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
  private readonly activityValue: HTMLSpanElement;
  private readonly mysteryValue: HTMLSpanElement;
  private readonly growthValue: HTMLSpanElement;
  private readonly hintValue: HTMLSpanElement;
  private readonly toolButtons = new Map<ToolType, HTMLButtonElement>();

  constructor(onToolSelect: (tool: ToolType) => void) {
    this.element = document.createElement('div');
    this.element.className = 'hud';
    this.element.innerHTML = `
      <div class="hud__top">
        <div class="hud__panel hud__panel--title">
          <div>
            <p class="hud__eyebrow">Phase 1 · Onboarding layer</p>
            <h1>${GAME_TITLE}</h1>
            <p class="hud__subtle">A calm generative ecosystem for discovery.</p>
          </div>
          <button class="hud__restart" type="button">Reseed</button>
        </div>
        <div class="hud__panel hud__panel--stats">
          <div class="hud__row"><span>Harmony</span><span data-harmony>0%</span></div>
          <div class="hud__row"><span>Activity</span><span data-activity>0%</span></div>
          <div class="hud__row"><span>Growth</span><span data-growth>0%</span></div>
          <div class="hud__row"><span>Mystery</span><span data-mystery>0%</span></div>
        </div>
      </div>
      <div class="hud__bottom">
        <div class="hud__panel hud__panel--tools">
          <div class="hud__row hud__row--tools-head">
            <span>Tool palette</span>
            <span data-tool-hint>1–5</span>
          </div>
          <div class="hud__tool-grid"></div>
        </div>
        <div class="hud__panel hud__panel--status">
          <div class="hud__row"><span>Flow</span><span data-flow>Normal 1×</span></div>
          <div class="hud__row hud__row--hint"><span>Garden</span><span data-hint>Pan, zoom, and touch the field to learn how it responds.</span></div>
        </div>
      </div>
    `;

    this.restartButton = this.element.querySelector('.hud__restart') as HTMLButtonElement;
    this.harmonyValue = this.element.querySelector('[data-harmony]') as HTMLSpanElement;
    this.activityValue = this.element.querySelector('[data-activity]') as HTMLSpanElement;
    this.growthValue = this.element.querySelector('[data-growth]') as HTMLSpanElement;
    this.mysteryValue = this.element.querySelector('[data-mystery]') as HTMLSpanElement;
    this.hintValue = this.element.querySelector('[data-hint]') as HTMLSpanElement;

    const toolGrid = this.element.querySelector('.hud__tool-grid') as HTMLDivElement;
    TOOLS.forEach((tool, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hud__tool';
      button.innerHTML = `<span>${index + 1}. ${toolLabels[tool]}</span><small>Locked</small>`;
      button.addEventListener('click', () => onToolSelect(tool));
      this.toolButtons.set(tool, button);
      toolGrid.append(button);
    });
  }

  attach(target: HTMLElement): void {
    target.append(this.element);
  }

  update(snapshot: SimulationSnapshot): void {
    this.harmonyValue.textContent = `${Math.round(snapshot.stats.harmony * 100)}%`;
    this.activityValue.textContent = `${Math.round(snapshot.stats.activity * 100)}%`;
    this.growthValue.textContent = `${Math.round(snapshot.stats.growth * 100)}%`;
    this.mysteryValue.textContent = `${Math.round(snapshot.stats.mystery * 100)}%`;

    const flow = this.element.querySelector('[data-flow]') as HTMLSpanElement;
    flow.textContent = timeLabels[String(snapshot.timeScale)] ?? `Flow ${snapshot.timeScale.toFixed(1)}×`;

    for (const tool of TOOLS) {
      const button = this.toolButtons.get(tool);
      if (!button) continue;
      const unlocked = snapshot.tool.unlocked.includes(tool);
      button.disabled = !unlocked;
      button.classList.toggle('is-active', snapshot.tool.active === tool);
      button.classList.toggle('is-locked', !unlocked);
      const label = button.querySelector('small');
      if (label) {
        label.textContent = unlocked ? (snapshot.tool.active === tool ? 'Selected' : 'Ready') : 'Locked';
      }
    }

    if (snapshot.anomalyPulse > 0.6 || snapshot.narrativeHint > 0.52) {
      this.hintValue.textContent = 'A few visitors are beginning to phase between rules. Stay curious.';
    } else if (snapshot.tool.active === 'observe') {
      this.hintValue.textContent = 'Watch where motion settles: drift calms, fertile pockets thicken, resonant pockets sing.';
    } else if (snapshot.tool.active === 'grow') {
      this.hintValue.textContent = 'Grow encourages gathering. Hold it over soft knots and let them answer back.';
    } else if (snapshot.tool.active === 'feed') {
      this.hintValue.textContent = 'Feed brightens local motion and wakes the nearby pulse.';
    } else if (snapshot.tool.active === 'repel') {
      this.hintValue.textContent = 'Repel parts crowded forms without breaking the garden’s calm.';
    } else {
      this.hintValue.textContent = 'Disrupt introduces a brief wobble. Use it gently to loosen rigid patterns.';
    }
  }
}
