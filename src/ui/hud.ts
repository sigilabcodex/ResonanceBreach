import { GAME_TITLE, TOOLS, type ToolType } from '../config';
import { TOOL_DEFINITIONS } from '../interaction/tools';
import { DEFAULT_SETTINGS, normalizeSettings, type GameSettings } from '../settings';
import type { SimulationSnapshot } from '../types/world';

const timeLabels: Record<string, string> = {
  '0.5': 'Slow 0.5×',
  '1': 'Normal 1×',
  '2': 'Fast 2×',
};

const percent = (value: number) => `${Math.round(value * 100)}%`;

export class Hud {
  readonly element: HTMLDivElement;
  readonly restartButton: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly settingsPanel: HTMLDivElement;
  private readonly settingsDialog: HTMLDivElement;
  private readonly settingsCloseButton: HTMLButtonElement;
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
  private readonly rangeInputs = new Map<string, HTMLInputElement>();
  private readonly rangeOutputs = new Map<string, HTMLSpanElement>();
  private readonly toggleInputs = new Map<string, HTMLInputElement>();
  private settingsOpen = false;
  private settings: GameSettings;
  private lastFocusedElement: HTMLElement | null = null;

  constructor(
    onToolSelect: (tool: ToolType) => void,
    private readonly onSettingsChange: (settings: GameSettings) => void,
    initialSettings: GameSettings = DEFAULT_SETTINGS,
  ) {
    this.settings = normalizeSettings(initialSettings);
    this.element = document.createElement('div');
    this.element.className = 'hud';
    this.element.innerHTML = `
      <div class="hud__top">
        <div class="hud__panel hud__panel--title">
          <div>
            <p class="hud__eyebrow">Calm ecological sandbox</p>
            <h1>${GAME_TITLE}</h1>
            <p class="hud__subtle">A wrapped living surface rendered as contour lines, current lines, and quiet ecological motion.</p>
          </div>
          <div class="hud__actions">
            <button class="hud__action" data-settings-toggle type="button" aria-expanded="false">Settings</button>
            <button class="hud__restart" type="button">Reseed</button>
          </div>
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
          <div class="hud__row hud__row--hint"><span>Field note</span><span data-hint>Observe the garden long enough to see blooms fruit, drifters visit, residue linger, and decomposers return it to the soil.</span></div>
        </div>
      </div>
      <div class="hud__settings" data-settings-panel hidden>
        <div class="hud__panel hud__panel--settings" data-settings-dialog role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1">
          <div class="hud__settings-head">
            <div>
              <p class="hud__eyebrow">World substrate</p>
              <h2 id="settings-title">Settings</h2>
            </div>
            <button class="hud__action" data-settings-close type="button">Close</button>
          </div>
          <div class="hud__settings-grid">
            <section class="hud__settings-group" data-group="audio">
              <h3>Audio</h3>
            </section>
            <section class="hud__settings-group" data-group="visuals">
              <h3>Visuals</h3>
            </section>
          </div>
        </div>
      </div>
    `;

    this.restartButton = this.element.querySelector('.hud__restart') as HTMLButtonElement;
    this.settingsButton = this.element.querySelector('[data-settings-toggle]') as HTMLButtonElement;
    this.settingsPanel = this.element.querySelector('[data-settings-panel]') as HTMLDivElement;
    this.settingsDialog = this.element.querySelector('[data-settings-dialog]') as HTMLDivElement;
    this.settingsCloseButton = this.element.querySelector('[data-settings-close]') as HTMLButtonElement;
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

    this.buildControls();

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

    this.settingsButton.addEventListener('click', () => this.setSettingsOpen(!this.settingsOpen));
    this.settingsCloseButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setSettingsOpen(false);
    });
    this.settingsPanel.addEventListener('click', (event) => {
      if (event.target === this.settingsPanel) this.setSettingsOpen(false);
    });
    this.settingsDialog.addEventListener('click', (event) => event.stopPropagation());
    this.settingsDialog.addEventListener('pointerdown', (event) => event.stopPropagation());
    window.addEventListener('keydown', this.handleWindowKeyDown);
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
      this.hintValue.textContent = 'Hold Resonance Focus to sharpen the interior like a listening lens: nearby life brightens, distant life softens, and grouped sound resolves into detail.';
    } else if (snapshot.tool.active === 'grow') {
      this.hintValue.textContent = 'Grow gently enriches soil for several seconds, helping Rooted Blooms mature, fruit, and hold pollination.';
    } else if (snapshot.tool.active === 'feed') {
      this.hintValue.textContent = 'Feed releases visible particles. Watch Pollinator Drifters curve toward them and nearby blooms.';
    } else if (snapshot.tool.active === 'repel') {
      this.hintValue.textContent = 'Repel opens calm empty space without introducing jitter or abrupt flashes.';
    } else if (snapshot.tool.active === 'disrupt') {
      this.hintValue.textContent = 'Disrupt waits, then bursts outward: some entities die into nutrient residue while terrain shifts slightly.';
    } else if (snapshot.stats.nutrients > 0.42) {
      this.hintValue.textContent = 'Residue is feeding the soil. Fertile bloom patches should start fruiting while Decomposers work the substrate.';
    } else {
      this.hintValue.textContent = 'Observe the garden long enough to see blooms fruit, drifters visit, residue linger, and decomposers return it to the soil.';
    }
  }

  syncSettings(settings: GameSettings): void {
    this.settings = normalizeSettings(settings);
    this.rangeOutputs.get('masterVolume')!.textContent = percent(this.settings.audio.masterVolume);
    this.rangeOutputs.get('ambienceVolume')!.textContent = percent(this.settings.audio.ambienceVolume);
    this.rangeOutputs.get('entityVolume')!.textContent = percent(this.settings.audio.entityVolume);
    this.rangeInputs.get('masterVolume')!.value = String(this.settings.audio.masterVolume);
    this.rangeInputs.get('ambienceVolume')!.value = String(this.settings.audio.ambienceVolume);
    this.rangeInputs.get('entityVolume')!.value = String(this.settings.audio.entityVolume);
    this.toggleInputs.get('terrainLines')!.checked = this.settings.visuals.terrainLines;
    this.toggleInputs.get('motionTrails')!.checked = this.settings.visuals.motionTrails;
    this.toggleInputs.get('debugOverlays')!.checked = this.settings.visuals.debugOverlays;
    this.toggleInputs.get('reduceMotion')!.checked = this.settings.visuals.reduceMotion;
  }

  private setSettingsOpen(open: boolean): void {
    if (this.settingsOpen === open) return;

    if (open) {
      this.lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    this.settingsOpen = open;
    this.settingsPanel.hidden = !open;
    this.settingsButton.setAttribute('aria-expanded', String(open));

    if (open) {
      window.requestAnimationFrame(() => {
        this.settingsDialog.focus({ preventScroll: true });
      });
      return;
    }

    const focusTarget = this.lastFocusedElement && this.lastFocusedElement.isConnected
      ? this.lastFocusedElement
      : this.settingsButton;
    this.lastFocusedElement = null;
    window.requestAnimationFrame(() => {
      focusTarget.focus({ preventScroll: true });
    });
  }

  private readonly handleWindowKeyDown = (event: KeyboardEvent): void => {
    if (!this.settingsOpen || event.key !== 'Escape') return;

    event.preventDefault();
    event.stopPropagation();
    this.setSettingsOpen(false);
  };

  private buildControls(): void {
    const audioGroup = this.element.querySelector('[data-group="audio"]') as HTMLElement;
    const visualsGroup = this.element.querySelector('[data-group="visuals"]') as HTMLElement;

    this.createRangeControl(audioGroup, 'Master volume', 'masterVolume', this.settings.audio.masterVolume, (value) => {
      this.settings = { ...this.settings, audio: { ...this.settings.audio, masterVolume: value } };
      this.emitSettings();
    });
    this.createRangeControl(audioGroup, 'Ambience volume', 'ambienceVolume', this.settings.audio.ambienceVolume, (value) => {
      this.settings = { ...this.settings, audio: { ...this.settings.audio, ambienceVolume: value } };
      this.emitSettings();
    });
    this.createRangeControl(audioGroup, 'Entity volume', 'entityVolume', this.settings.audio.entityVolume, (value) => {
      this.settings = { ...this.settings, audio: { ...this.settings.audio, entityVolume: value } };
      this.emitSettings();
    });

    this.createToggleControl(visualsGroup, 'Terrain lines', 'terrainLines', this.settings.visuals.terrainLines, (checked) => {
      this.settings = { ...this.settings, visuals: { ...this.settings.visuals, terrainLines: checked } };
      this.emitSettings();
    });
    this.createToggleControl(visualsGroup, 'Motion trails', 'motionTrails', this.settings.visuals.motionTrails, (checked) => {
      this.settings = { ...this.settings, visuals: { ...this.settings.visuals, motionTrails: checked } };
      this.emitSettings();
    });
    this.createToggleControl(visualsGroup, 'Debug overlays', 'debugOverlays', this.settings.visuals.debugOverlays, (checked) => {
      this.settings = { ...this.settings, visuals: { ...this.settings.visuals, debugOverlays: checked } };
      this.emitSettings();
    });
    this.createToggleControl(visualsGroup, 'Reduce motion', 'reduceMotion', this.settings.visuals.reduceMotion, (checked) => {
      this.settings = { ...this.settings, visuals: { ...this.settings.visuals, reduceMotion: checked } };
      this.emitSettings();
    });

    this.syncSettings(this.settings);
  }

  private createRangeControl(
    parent: HTMLElement,
    label: string,
    key: string,
    value: number,
    onInput: (value: number) => void,
  ): void {
    const row = document.createElement('label');
    row.className = 'hud__setting';
    row.innerHTML = `
      <span class="hud__setting-head"><span>${label}</span><span data-output>${percent(value)}</span></span>
      <input type="range" min="0" max="1" step="0.01" value="${value}">
    `;
    const input = row.querySelector('input') as HTMLInputElement;
    const output = row.querySelector('[data-output]') as HTMLSpanElement;
    input.addEventListener('input', () => {
      const nextValue = Number(input.value);
      output.textContent = percent(nextValue);
      onInput(nextValue);
    });
    this.rangeInputs.set(key, input);
    this.rangeOutputs.set(key, output);
    parent.append(row);
  }

  private createToggleControl(
    parent: HTMLElement,
    label: string,
    key: string,
    checked: boolean,
    onToggle: (checked: boolean) => void,
  ): void {
    const row = document.createElement('label');
    row.className = 'hud__toggle';
    row.innerHTML = `
      <span>${label}</span>
      <input type="checkbox" ${checked ? 'checked' : ''}>
    `;
    const input = row.querySelector('input') as HTMLInputElement;
    input.addEventListener('change', () => onToggle(input.checked));
    this.toggleInputs.set(key, input);
    parent.append(row);
  }

  private emitSettings(): void {
    const normalized = normalizeSettings(this.settings);
    this.settings = normalized;
    this.syncSettings(normalized);
    this.onSettingsChange(normalized);
  }
}
