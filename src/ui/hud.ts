import type { AudioDebugState } from '../audio/audioEngine';
import { GAME_TITLE, TOOLS, type ToolType } from '../config';
import { TOOL_DEFINITIONS } from '../interaction/tools';
import { DEFAULT_SETTINGS, normalizeSettings, type GameSettings } from '../settings';
import type { Entity, PerformanceStats, SimulationSnapshot, TerrainCell, Vec2 } from '../types/world';

const timeLabels: Record<string, string> = {
  '0.5': 'Slow 0.5×',
  '1': 'Normal 1×',
  '2': 'Fast 2×',
};

const percent = (value: number) => `${Math.round(value * 100)}%`;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const wrapDelta = (from: number, to: number, size: number) => {
  let delta = to - from;
  if (delta > size * 0.5) delta -= size;
  else if (delta < -size * 0.5) delta += size;
  return delta;
};
const wrappedDistance = (a: Vec2, b: Vec2, width: number, height: number) => Math.hypot(
  wrapDelta(a.x, b.x, width),
  wrapDelta(a.y, b.y, height),
);
const entityLabels: Record<Entity['type'], string> = {
  flocker: 'Pollinator drifter',
  cluster: 'Decomposer cluster',
  plant: 'Rooted bloom',
  ephemeral: 'Ephemeral bloom',
  canopy: 'Canopy bloom',
  grazer: 'Grazer',
  parasite: 'Parasitic tendril',
  predator: 'Predator',
};

const describeEntityState = (entity: Entity): string => {
  if (entity.visualState === 'dying') return entity.type === 'cluster' || entity.type === 'parasite' ? 'decomposing' : 'decaying';
  if (entity.visualState === 'reproducing') return entity.type === 'plant' || entity.type === 'ephemeral' || entity.type === 'canopy' ? 'blooming' : 'reproducing';
  if (entity.visualState === 'feeding') {
    if (entity.type === 'plant' || entity.type === 'ephemeral' || entity.type === 'canopy') return 'blooming';
    if (entity.type === 'cluster' || entity.type === 'parasite') return 'decomposing';
    return 'feeding';
  }
  if (entity.type === 'grazer') {
    if (entity.targetKind === 'fruit' || entity.targetKind === 'feed') return 'seeking fruit';
    if (entity.targetKind === 'bloom') return 'grazing bloom patch';
    return entity.activity > 0.3 ? 'foraging' : 'drifting';
  }
  if (entity.type === 'flocker') {
    if (entity.targetKind === 'bloom') return 'seeking bloom';
    if (entity.targetKind === 'fruit' || entity.targetKind === 'feed') return 'seeking fruit';
    return entity.activity > 0.28 ? 'drifting' : 'hovering';
  }
  if (entity.type === 'cluster' || entity.type === 'parasite') {
    if (entity.targetKind === 'residue') return 'seeking residue';
    return entity.activity > 0.24 ? 'working the soil' : 'resting';
  }
  if (entity.type === 'plant' || entity.type === 'ephemeral' || entity.type === 'canopy') return entity.stage === 'decay' ? 'decaying' : entity.stage === 'mature' ? 'blooming' : 'maturing';
  return entity.activity > 0.35 ? 'hunting' : 'circling';
};

type PanelKey = 'left' | 'right' | 'debug';
type PanelState = Record<PanelKey, boolean>;

const DEFAULT_COLLAPSED: PanelState = {
  left: false,
  right: false,
  debug: false,
};

export class Hud {
  readonly element: HTMLDivElement;
  readonly restartButton: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly settingsPanel: HTMLDivElement;
  private readonly settingsDialog: HTMLDivElement;
  private readonly settingsCloseButton: HTMLButtonElement;
  private readonly minimalHintValue: HTMLSpanElement;
  private readonly inspectModule: HTMLElement;
  private readonly inspectEyebrow: HTMLParagraphElement;
  private readonly inspectTitle: HTMLHeadingElement;
  private readonly inspectBody: HTMLDivElement;
  private readonly harmonyValue: HTMLSpanElement;
  private readonly growthValue: HTMLSpanElement;
  private readonly threatValue: HTMLSpanElement;
  private readonly energyValue: HTMLSpanElement;
  private readonly stabilityValue: HTMLSpanElement;
  private readonly biodiversityValue: HTMLSpanElement;
  private readonly nutrientsValue: HTMLSpanElement;
  private readonly fruitValue: HTMLSpanElement;
  private readonly temperatureValue: HTMLSpanElement;
  private readonly unlockValue: HTMLSpanElement;
  private readonly hintValue: HTMLSpanElement;
  private readonly flowValue: HTMLSpanElement;
  private readonly debugBody: HTMLDivElement;
  private readonly debugSummary: HTMLSpanElement;
  private readonly toolButtons = new Map<ToolType, HTMLButtonElement>();
  private readonly rangeInputs = new Map<string, HTMLInputElement>();
  private readonly rangeOutputs = new Map<string, HTMLSpanElement>();
  private readonly toggleInputs = new Map<string, HTMLInputElement>();
  private readonly panelElements: Record<PanelKey, HTMLElement>;
  private readonly panelBodies: Record<PanelKey, HTMLElement>;
  private readonly panelToggleButtons = new Map<PanelKey, HTMLButtonElement>();
  private readonly dockButtons = new Map<PanelKey | 'minimal', HTMLButtonElement>();
  private settingsOpen = false;
  private settings: GameSettings;
  private collapsed: PanelState = { ...DEFAULT_COLLAPSED };
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
      <div class="hud__dock" aria-label="HUD controls">
        <div class="hud__dock-group">
          <button class="hud__dock-button" data-settings-toggle type="button" aria-expanded="false">Settings</button>
          <button class="hud__dock-button" data-dock-toggle="left" type="button" aria-pressed="true">Left panel</button>
          <button class="hud__dock-button" data-dock-toggle="right" type="button" aria-pressed="true">Right panel</button>
          <button class="hud__dock-button" data-dock-toggle="debug" type="button" aria-pressed="false">Debug</button>
          <button class="hud__dock-button" data-dock-toggle="minimal" type="button" aria-pressed="false">Minimal HUD</button>
        </div>
      </div>
      <aside class="hud__module hud__module--left" data-panel="left">
        <section class="hud__panel hud__panel--primary">
          <header class="hud__panel-head">
            <div>
              <p class="hud__eyebrow">Calm ecological sandbox</p>
              <h1>${GAME_TITLE}</h1>
              <p class="hud__subtle">A wrapped living surface rendered as contour lines, current lines, and quiet ecological motion.</p>
            </div>
            <div class="hud__panel-actions">
              <button class="hud__panel-toggle" data-collapse-toggle="left" type="button" aria-expanded="true">Collapse</button>
              <button class="hud__restart" type="button">Reseed</button>
            </div>
          </header>
          <div class="hud__panel-body" data-panel-body="left">
            <div class="hud__tools-card">
              <div class="hud__row hud__row--tools-head">
                <span>Field tools</span>
                <span data-tool-hint>1–5 select tools · drag places regions · O opens settings</span>
              </div>
              <div class="hud__tool-grid"></div>
            </div>
          </div>
        </section>
      </aside>
      <aside class="hud__module hud__module--right" data-panel="right">
        <section class="hud__panel hud__panel--secondary">
          <header class="hud__panel-head">
            <div>
              <p class="hud__eyebrow">Field readout</p>
              <h2>System status</h2>
            </div>
            <button class="hud__panel-toggle" data-collapse-toggle="right" type="button" aria-expanded="true">Collapse</button>
          </header>
          <div class="hud__panel-body" data-panel-body="right">
            <div class="hud__panel-section">
              <div class="hud__row"><span>Resonance Energy</span><span data-energy>0%</span></div>
              <div class="hud__row"><span>Harmony</span><span data-harmony>0%</span></div>
              <div class="hud__row"><span>Stability</span><span data-stability>0%</span></div>
              <div class="hud__row"><span>Growth</span><span data-growth>0%</span></div>
              <div class="hud__row"><span>Nutrients</span><span data-nutrients>0%</span></div>
              <div class="hud__row"><span>Fruit</span><span data-fruit>0%</span></div>
              <div class="hud__row"><span>Temperature</span><span data-temperature>0%</span></div>
              <div class="hud__row"><span>Diversity</span><span data-biodiversity>0%</span></div>
              <div class="hud__row"><span>Threat</span><span data-threat>0%</span></div>
            </div>
            <div class="hud__panel-section">
              <div class="hud__row"><span>Flow</span><span data-flow>Normal 1×</span></div>
              <div class="hud__row"><span>Unlocked</span><span data-unlocked>0%</span></div>
              <div class="hud__row hud__row--hint"><span>Field note</span><span data-hint>Observe the garden long enough to see blooms fruit, grazers feed, residue linger, and decomposers return it to the soil.</span></div>
            </div>
          </div>
        </section>
      </aside>
      <aside class="hud__module hud__module--debug" data-panel="debug">
        <section class="hud__panel hud__panel--debug">
          <header class="hud__panel-head">
            <div>
              <p class="hud__eyebrow">Diagnostics</p>
              <h2>Performance</h2>
            </div>
            <div class="hud__panel-actions">
              <span class="hud__debug-summary" data-debug-summary>Off</span>
              <button class="hud__panel-toggle" data-collapse-toggle="debug" type="button" aria-expanded="true">Collapse</button>
            </div>
          </header>
          <div class="hud__panel-body hud__panel-body--debug" data-panel-body="debug">
            <div class="hud__debug" data-debug-body></div>
          </div>
        </section>
      </aside>
      <aside class="hud__module hud__module--inspect" data-inspect-card hidden>
        <section class="hud__panel hud__panel--inspect">
          <header class="hud__panel-head hud__panel-head--compact">
            <div>
              <p class="hud__eyebrow" data-inspect-eyebrow>Inspection</p>
              <h2 data-inspect-title>Nothing selected</h2>
            </div>
          </header>
          <div class="hud__panel-body hud__panel-body--inspect" data-inspect-body></div>
        </section>
      </aside>
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
            <section class="hud__settings-group" data-group="hud">
              <h3>HUD</h3>
            </section>
          </div>
        </div>
      </div>
      <div class="hud__minimal" data-minimal-overlay aria-live="polite">
        <span data-minimal-hint>Minimal HUD · H restores the full interface · O opens settings</span>
      </div>
    `;

    this.restartButton = this.element.querySelector('.hud__restart') as HTMLButtonElement;
    this.settingsButton = this.element.querySelector('[data-settings-toggle]') as HTMLButtonElement;
    this.settingsPanel = this.element.querySelector('[data-settings-panel]') as HTMLDivElement;
    this.settingsDialog = this.element.querySelector('[data-settings-dialog]') as HTMLDivElement;
    this.settingsCloseButton = this.element.querySelector('[data-settings-close]') as HTMLButtonElement;
    this.minimalHintValue = this.element.querySelector('[data-minimal-hint]') as HTMLSpanElement;
    this.inspectModule = this.element.querySelector('[data-inspect-card]') as HTMLElement;
    this.inspectEyebrow = this.element.querySelector('[data-inspect-eyebrow]') as HTMLParagraphElement;
    this.inspectTitle = this.element.querySelector('[data-inspect-title]') as HTMLHeadingElement;
    this.inspectBody = this.element.querySelector('[data-inspect-body]') as HTMLDivElement;
    this.energyValue = this.element.querySelector('[data-energy]') as HTMLSpanElement;
    this.harmonyValue = this.element.querySelector('[data-harmony]') as HTMLSpanElement;
    this.stabilityValue = this.element.querySelector('[data-stability]') as HTMLSpanElement;
    this.growthValue = this.element.querySelector('[data-growth]') as HTMLSpanElement;
    this.threatValue = this.element.querySelector('[data-threat]') as HTMLSpanElement;
    this.biodiversityValue = this.element.querySelector('[data-biodiversity]') as HTMLSpanElement;
    this.nutrientsValue = this.element.querySelector('[data-nutrients]') as HTMLSpanElement;
    this.fruitValue = this.element.querySelector('[data-fruit]') as HTMLSpanElement;
    this.temperatureValue = this.element.querySelector('[data-temperature]') as HTMLSpanElement;
    this.unlockValue = this.element.querySelector('[data-unlocked]') as HTMLSpanElement;
    this.hintValue = this.element.querySelector('[data-hint]') as HTMLSpanElement;
    this.flowValue = this.element.querySelector('[data-flow]') as HTMLSpanElement;
    this.debugBody = this.element.querySelector('[data-debug-body]') as HTMLDivElement;
    this.debugSummary = this.element.querySelector('[data-debug-summary]') as HTMLSpanElement;

    this.panelElements = {
      left: this.element.querySelector('[data-panel="left"]') as HTMLElement,
      right: this.element.querySelector('[data-panel="right"]') as HTMLElement,
      debug: this.element.querySelector('[data-panel="debug"]') as HTMLElement,
    };
    this.panelBodies = {
      left: this.element.querySelector('[data-panel-body="left"]') as HTMLElement,
      right: this.element.querySelector('[data-panel-body="right"]') as HTMLElement,
      debug: this.element.querySelector('[data-panel-body="debug"]') as HTMLElement,
    };

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

    this.element.querySelectorAll<HTMLElement>('[data-collapse-toggle]').forEach((button) => {
      const key = button.dataset.collapseToggle as PanelKey;
      this.panelToggleButtons.set(key, button as HTMLButtonElement);
      button.addEventListener('click', () => this.togglePanelCollapsed(key));
    });

    this.element.querySelectorAll<HTMLElement>('[data-dock-toggle]').forEach((button) => {
      const key = button.dataset.dockToggle as PanelKey | 'minimal';
      this.dockButtons.set(key, button as HTMLButtonElement);
      button.addEventListener('click', () => {
        if (key === 'minimal') {
          this.setMinimalHud(!this.settings.visuals.minimalHud);
          return;
        }

        this.setPanelVisible(key, !this.isPanelVisible(key));
      });
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

    this.syncSettings(this.settings);
    this.renderPanelState();
    this.renderDebugOverlay(undefined, undefined, undefined);
  }

  attach(target: HTMLElement): void {
    target.append(this.element);
  }

  update(snapshot: SimulationSnapshot, audioDebug?: AudioDebugState, performanceStats?: PerformanceStats): void {
    this.energyValue.textContent = `${Math.round(snapshot.stats.energy * 100)}%`;
    this.harmonyValue.textContent = `${Math.round(snapshot.stats.harmony * 100)}%`;
    this.stabilityValue.textContent = `${Math.round(snapshot.stats.stability * 100)}%`;
    this.growthValue.textContent = `${Math.round(snapshot.stats.growth * 100)}%`;
    this.threatValue.textContent = `${Math.round(snapshot.stats.threat * 100)}%`;
    this.biodiversityValue.textContent = `${Math.round(snapshot.stats.biodiversity * 100)}%`;
    this.nutrientsValue.textContent = `${Math.round(snapshot.stats.nutrients * 100)}%`;
    this.fruitValue.textContent = `${Math.round(snapshot.stats.fruit * 100)}%`;
    this.temperatureValue.textContent = `${Math.round(snapshot.stats.temperature * 100)}%`;
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
    } else if (snapshot.attention.mode === 'entity' && snapshot.attention.entityId !== null) {
      const entity = snapshot.entities.find((candidate) => candidate.id === snapshot.attention.entityId);
      this.hintValue.textContent = entity
        ? `Following ${entityLabels[entity.type].toLowerCase()} · ${describeEntityState(entity)} · click empty space to clear.`
        : 'Attention lost; click an entity to follow it again or drag a region to listen broadly.';
    } else if (snapshot.attention.mode === 'region') {
      this.hintValue.textContent = 'Listening region active: drag to redraw the patch, or click empty space to return to a wider field listen.';
    } else if (snapshot.tool.blocked) {
      this.hintValue.textContent = 'Let the field recover before stacking more interventions; low density keeps the garden readable.';
    } else if (snapshot.tool.active === 'observe') {
      this.hintValue.textContent = 'ATTENTION mode: click an entity to follow and clarify it, drag to create a listening region, and click empty space to clear.';
    } else if (snapshot.tool.active === 'grow') {
      this.hintValue.textContent = 'Grow gently enriches soil for several seconds, helping Rooted Blooms mature, fruit, and keep grazers supplied.';
    } else if (snapshot.tool.active === 'feed') {
      this.hintValue.textContent = 'Feed releases visible particles. Watch Pollinator Drifters curve toward them and nearby blooms.';
    } else if (snapshot.tool.active === 'repel') {
      this.hintValue.textContent = 'Repel opens calm empty space without introducing jitter or abrupt flashes.';
    } else if (snapshot.tool.active === 'disrupt') {
      this.hintValue.textContent = 'Disrupt waits, then bursts outward: some entities die into nutrient residue while terrain shifts slightly.';
    } else if (snapshot.stats.nutrients > 0.42) {
      this.hintValue.textContent = 'Residue is feeding the soil. Fertile bloom patches should fruit while grazers and Decomposers work the substrate.';
    } else {
      this.hintValue.textContent = 'Observe the garden long enough to see blooms fruit, grazers feed, residue linger, and decomposers return it to the soil.';
    }

    this.minimalHintValue.textContent = this.settings.visuals.minimalHud
      ? snapshot.attention.mode === 'entity' && snapshot.attention.entityId !== null
        ? 'Minimal HUD · following selection · H restores full HUD · O opens settings'
        : snapshot.attention.mode === 'region'
          ? 'Minimal HUD · listening region active · H restores full HUD · O opens settings'
          : `Minimal HUD · ${TOOL_DEFINITIONS[snapshot.tool.active].label} active · H restores full HUD · O opens settings`
      : 'Minimal HUD · H restores the full interface · O opens settings';

    this.renderInspectionCard(snapshot);
    this.renderDebugOverlay(snapshot, audioDebug, performanceStats);
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
    this.toggleInputs.get('showLeftPanel')!.checked = this.settings.visuals.showLeftPanel;
    this.toggleInputs.get('showRightPanel')!.checked = this.settings.visuals.showRightPanel;
    this.toggleInputs.get('minimalHud')!.checked = this.settings.visuals.minimalHud;
    this.element.classList.toggle('is-reduced-motion', this.settings.visuals.reduceMotion);
    this.element.classList.toggle('is-minimal', this.settings.visuals.minimalHud);
    this.renderPanelState();
  }

  toggleMinimalHud(): void {
    this.setMinimalHud(!this.settings.visuals.minimalHud);
  }

  toggleSettings(): void {
    this.setSettingsOpen(!this.settingsOpen);
  }

  private setPanelVisible(panel: PanelKey, visible: boolean): void {
    const visuals = {
      ...this.settings.visuals,
      showLeftPanel: panel === 'left' ? visible : this.settings.visuals.showLeftPanel,
      showRightPanel: panel === 'right' ? visible : this.settings.visuals.showRightPanel,
      debugOverlays: panel === 'debug' ? visible : this.settings.visuals.debugOverlays,
    };
    this.settings = { ...this.settings, visuals };
    this.emitSettings();
  }

  private isPanelVisible(panel: PanelKey): boolean {
    if (panel === 'left') return this.settings.visuals.showLeftPanel;
    if (panel === 'right') return this.settings.visuals.showRightPanel;
    return this.settings.visuals.debugOverlays;
  }

  private setMinimalHud(minimalHud: boolean): void {
    this.settings = {
      ...this.settings,
      visuals: {
        ...this.settings.visuals,
        minimalHud,
      },
    };
    this.emitSettings();
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

    const fallbackFocusTarget = this.settingsButton;
    const focusTarget = this.lastFocusedElement && this.lastFocusedElement.isConnected
      ? this.lastFocusedElement
      : fallbackFocusTarget;
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
    const hudGroup = this.element.querySelector('[data-group="hud"]') as HTMLElement;

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
    this.createToggleControl(visualsGroup, 'Debug overlay', 'debugOverlays', this.settings.visuals.debugOverlays, (checked) => {
      this.settings = { ...this.settings, visuals: { ...this.settings.visuals, debugOverlays: checked } };
      this.emitSettings();
    });
    this.createToggleControl(visualsGroup, 'Reduce motion', 'reduceMotion', this.settings.visuals.reduceMotion, (checked) => {
      this.settings = { ...this.settings, visuals: { ...this.settings.visuals, reduceMotion: checked } };
      this.emitSettings();
    });

    this.createToggleControl(hudGroup, 'Show left panel', 'showLeftPanel', this.settings.visuals.showLeftPanel, (checked) => {
      this.settings = { ...this.settings, visuals: { ...this.settings.visuals, showLeftPanel: checked } };
      this.emitSettings();
    });
    this.createToggleControl(hudGroup, 'Show right panel', 'showRightPanel', this.settings.visuals.showRightPanel, (checked) => {
      this.settings = { ...this.settings, visuals: { ...this.settings.visuals, showRightPanel: checked } };
      this.emitSettings();
    });
    this.createToggleControl(hudGroup, 'Minimal HUD mode', 'minimalHud', this.settings.visuals.minimalHud, (checked) => {
      this.settings = { ...this.settings, visuals: { ...this.settings.visuals, minimalHud: checked } };
      this.emitSettings();
    });
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

  private togglePanelCollapsed(panel: PanelKey): void {
    this.collapsed = {
      ...this.collapsed,
      [panel]: !this.collapsed[panel],
    };
    this.renderPanelState();
  }

  private renderPanelState(): void {
    const panelVisibility: PanelState = {
      left: this.settings.visuals.showLeftPanel && !this.settings.visuals.minimalHud,
      right: this.settings.visuals.showRightPanel && !this.settings.visuals.minimalHud,
      debug: this.settings.visuals.debugOverlays,
    };

    (Object.keys(this.panelElements) as PanelKey[]).forEach((panel) => {
      const module = this.panelElements[panel];
      const body = this.panelBodies[panel];
      const visible = panelVisibility[panel];
      const collapsed = this.collapsed[panel];
      module.hidden = !visible;
      module.classList.toggle('is-collapsed', collapsed);
      body.hidden = collapsed;
      const toggle = this.panelToggleButtons.get(panel);
      if (toggle) {
        toggle.textContent = collapsed ? 'Expand' : 'Collapse';
        toggle.setAttribute('aria-expanded', String(!collapsed));
      }
      const dock = this.dockButtons.get(panel);
      if (dock) {
        dock.setAttribute('aria-pressed', String(visible));
        dock.classList.toggle('is-active', visible);
      }
    });

    const minimalButton = this.dockButtons.get('minimal');
    if (minimalButton) {
      minimalButton.setAttribute('aria-pressed', String(this.settings.visuals.minimalHud));
      minimalButton.classList.toggle('is-active', this.settings.visuals.minimalHud);
    }
  }

  private renderInspectionCard(snapshot: SimulationSnapshot): void {
    const hidden = this.settings.visuals.minimalHud || snapshot.attention.mode === 'none';
    this.inspectModule.hidden = hidden;
    if (hidden) return;

    if (snapshot.attention.mode === 'entity' && snapshot.attention.entityId !== null) {
      const entity = snapshot.entities.find((candidate) => candidate.id === snapshot.attention.entityId);
      if (!entity) {
        this.inspectModule.hidden = true;
        return;
      }

      this.inspectEyebrow.textContent = `Following ${entity.role}`;
      this.inspectTitle.textContent = entityLabels[entity.type];

      this.inspectBody.innerHTML = `
        <div class="hud__inspect-grid">
          <div class="hud__inspect-copy">
            <div class="hud__inspect-line"><span>State</span><strong>${describeEntityState(entity)}</strong></div>
            <div class="hud__inspect-line"><span>Life stage</span><strong>${entity.lifecycleState.stage} · ${percent(clamp(entity.lifecycleState.progress, 0, 1))}</strong></div>
            <div class="hud__inspect-line"><span>Habitat pull</span><strong>${entity.habitatPreference.primary}${entity.habitatPreference.secondary ? ` → ${entity.habitatPreference.secondary}` : ''}</strong></div>
          </div>
          <div class="hud__inspect-metrics">
            <div class="hud__inspect-metric"><span>Energy</span><strong>${percent(clamp(entity.resourceState.energy, 0, 1))}</strong></div>
            <div class="hud__inspect-metric"><span>Hunger</span><strong>${percent(clamp(entity.resourceState.hunger, 0, 1))}</strong></div>
            <div class="hud__inspect-metric"><span>Vitality</span><strong>${percent(clamp(entity.resourceState.vitality, 0, 1))}</strong></div>
            <div class="hud__inspect-metric"><span>Propagule charge</span><strong>${percent(clamp(entity.lifecycleState.propaguleCharge, 0, 1))}</strong></div>
          </div>
        </div>
      `;
      return;
    }

    if (snapshot.attention.mode === 'region') {
      const summary = this.summarizeAttentionRegion(snapshot);
      this.inspectEyebrow.textContent = 'Listening region';
      this.inspectTitle.textContent = summary.title;
      this.inspectBody.innerHTML = `
        <div class="hud__inspect-grid">
          <div class="hud__inspect-copy">
            <div class="hud__inspect-line"><span>Dominant life</span><strong>${summary.dominant}</strong></div>
            <div class="hud__inspect-line"><span>Patch read</span><strong>${summary.patch}</strong></div>
            <div class="hud__inspect-line"><span>Audio focus</span><strong>${summary.audio}</strong></div>
          </div>
          <div class="hud__inspect-metrics">
            <div class="hud__inspect-metric"><span>Activity</span><strong>${summary.activity}</strong></div>
            <div class="hud__inspect-metric"><span>Fertility</span><strong>${summary.fertility}</strong></div>
          </div>
        </div>
      `;
    }
  }

  private summarizeAttentionRegion(snapshot: SimulationSnapshot): {
    title: string;
    dominant: string;
    activity: string;
    fertility: string;
    patch: string;
    audio: string;
  } {
    const { attention, dimensions } = snapshot;
    const entities = snapshot.entities.filter((entity) => wrappedDistance(entity.position, attention.position, dimensions.width, dimensions.height) <= attention.radius);
    const terrain = snapshot.terrain.filter((cell) => wrappedDistance(cell.center, attention.position, dimensions.width, dimensions.height) <= attention.radius + cell.radius * 0.35);
    const counts = new Map<Entity['type'], number>();
    let activitySum = 0;

    for (const entity of entities) {
      counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1);
      activitySum += entity.activity;
    }

    const dominantType = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const dominant = dominantType ? entityLabels[dominantType] : 'Sparse mixed life';
    const activity = percent(entities.length > 0 ? activitySum / entities.length : 0);
    const fertilityMean = terrain.length > 0
      ? terrain.reduce((sum, cell) => sum + this.cellFertility(cell), 0) / terrain.length
      : 0;
    const densityMean = terrain.length > 0
      ? terrain.reduce((sum, cell) => sum + cell.density, 0) / terrain.length
      : 0;
    const wetness = terrain.length > 0
      ? terrain.reduce((sum, cell) => sum + cell.habitatWeights.wetland, 0) / terrain.length
      : 0;
    const fertility = percent(fertilityMean);
    const patch = densityMean > 0.58
      ? wetness > 0.5 ? 'Dense wet patch with layered motion' : 'Dense patch with overlapping ecological traffic'
      : fertilityMean > 0.56
        ? 'Fertile patch supporting fruiting and return'
        : wetness > 0.48
          ? 'Open wet patch with softer movement'
          : 'Open patch with intermittent motion';
    const audio = dominantType === 'plant'
      ? 'Rooted bloom tones gather into the main field.'
      : dominantType === 'cluster'
        ? 'Low decomposer texture becomes the dominant bed.'
        : dominantType === 'grazer'
          ? 'Foraging movement leads while distant ambience falls back.'
          : dominantType === 'flocker'
            ? 'Lighter drifting tones group together in the foreground.'
            : 'The selected patch becomes the clearest ecological layer.';

    return {
      title: `Region · ${Math.round(attention.radius)} radius`,
      dominant,
      activity,
      fertility,
      patch,
      audio,
    };
  }

  private cellFertility(cell: TerrainCell): number {
    return clamp(cell.fertility * 0.58 + cell.nutrient * 0.26 + cell.moisture * 0.16, 0, 1);
  }

  private renderDebugOverlay(
    snapshot?: SimulationSnapshot,
    audioDebug?: AudioDebugState,
    performanceStats?: PerformanceStats,
  ): void {
    const debugVisible = this.settings.visuals.debugOverlays;
    this.debugSummary.textContent = debugVisible
      ? `${performanceStats?.fps.toFixed(0) ?? '0'} FPS`
      : 'Off';

    if (!debugVisible || !snapshot) {
      this.debugBody.innerHTML = '<div class="hud__debug-line">Enable the debug overlay from Settings or press F3.</div>';
      return;
    }

    const lines = [
      `fps ${performanceStats?.fps.toFixed(1) ?? '0.0'} · frame ${performanceStats?.frameTimeMs.toFixed(2) ?? '0.00'} ms · steps ${performanceStats?.simSteps ?? 0}${performanceStats?.simStepCapped ? ' · capped' : ''}`,
      `update ${performanceStats?.updateTimeMs.toFixed(2) ?? '0.00'} ms · render ${performanceStats?.renderTimeMs.toFixed(2) ?? '0.00'} ms · audio ${performanceStats?.audioUpdateTimeMs.toFixed(2) ?? '0.00'} ms`,
      `lag ${performanceStats?.simAccumulatorMs.toFixed(2) ?? '0.00'} ms · dropped ${performanceStats?.droppedSimTimeMs.toFixed(2) ?? '0.00'} ms · draws ${performanceStats?.drawCallEstimate ?? 0}`,
      `camera ${Math.round(snapshot.camera.center.x)}, ${Math.round(snapshot.camera.center.y)} @ ${snapshot.camera.zoom.toFixed(2)}×`,
      `attention ${snapshot.attention.mode}${snapshot.attention.dragging ? ' · dragging' : ''}`,
      `terrain ${snapshot.terrain.length} samples · entities ${snapshot.entities.length} · focused ${snapshot.diagnostics.counts.focusedEntities}`,
      `fruit ${snapshot.diagnostics.counts.fruit} · feed ${snapshot.diagnostics.counts.feed} · residue ${snapshot.diagnostics.counts.residues} · propagules ${snapshot.diagnostics.counts.propagules} · modifiers ${snapshot.diagnostics.counts.terrainModifiers}`,
      `queries field ${snapshot.diagnostics.queryCounts.terrainSamples} · neighbor ${snapshot.diagnostics.queryCounts.neighbors} · food ${snapshot.diagnostics.queryCounts.foodSearches} · residue ${snapshot.diagnostics.queryCounts.residueSearches}`,
      `targets reuse ${snapshot.diagnostics.queryCounts.targetReuses} · retarget ${snapshot.diagnostics.queryCounts.targetRetargets} · attention ${snapshot.diagnostics.queryCounts.attentionRefreshes}`,
      `species plant ${snapshot.diagnostics.speciesUpdateTimeMs.plant.toFixed(2)} · ephemeral ${snapshot.diagnostics.speciesUpdateTimeMs.ephemeral.toFixed(2)} · canopy ${snapshot.diagnostics.speciesUpdateTimeMs.canopy.toFixed(2)} · grazer ${snapshot.diagnostics.speciesUpdateTimeMs.grazer.toFixed(2)} · parasite ${snapshot.diagnostics.speciesUpdateTimeMs.parasite.toFixed(2)} · cluster ${snapshot.diagnostics.speciesUpdateTimeMs.cluster.toFixed(2)} ms`,
      `lifecycle propagules ${snapshot.diagnostics.lifecycleTransitions.propagulesCreated} · germinations ${snapshot.diagnostics.lifecycleTransitions.germinations} · deaths ${snapshot.diagnostics.lifecycleTransitions.deaths} · fruiting ${snapshot.diagnostics.lifecycleTransitions.fruitingBursts}`,
      `audio master ${audioDebug ? (audioDebug.masterGain * 100).toFixed(0) : '0'}% · foreground ${audioDebug?.foregroundVoiceCount ?? 0} · focused ${audioDebug?.focusedVoiceCount ?? 0} · grouped ${audioDebug?.groupedVoiceCount ?? 0}`,
      `music state ${audioDebug?.mode ?? 'calm'} · tonic ${audioDebug ? audioDebug.tonalCenterHz.toFixed(0) : '0'} Hz · fg balance ${audioDebug ? Math.round(audioDebug.foregroundBalance * 100) : 0}%`,
      `roles bloom ${audioDebug ? Math.round(audioDebug.roleLevels.bloom * 100) : 0}% · pollinator ${audioDebug ? Math.round(audioDebug.roleLevels.pollinator * 100) : 0}% · grazer ${audioDebug ? Math.round(audioDebug.roleLevels.grazer * 100) : 0}% · decay ${audioDebug ? Math.round(audioDebug.roleLevels.decay * 100) : 0}%`,
    ];

    if (snapshot.diagnostics.topHotspots.length > 0) {
      lines.push(`hotspots ${snapshot.diagnostics.topHotspots.join(' · ')}`);
    }

    if (snapshot.attention.mode === 'entity' && snapshot.attention.entityId !== null) {
      const entity = snapshot.entities.find((candidate) => candidate.id === snapshot.attention.entityId);
      if (entity) {
        lines.push(`focus ${entity.type} · ${entity.visualState} · ${entity.stage}`);
        lines.push(`focus energy ${Math.round(entity.energy * 100)}% · activity ${Math.round(entity.activity * 100)}%`);
      }
    } else if (snapshot.attention.mode === 'region') {
      lines.push(`region radius ${Math.round(snapshot.attention.radius)}`);
    }

    this.debugBody.replaceChildren(
      ...lines.map((line) => {
        const item = document.createElement('div');
        item.className = 'hud__debug-line';
        item.textContent = line;
        return item;
      }),
    );
  }

  private emitSettings(): void {
    const normalized = normalizeSettings(this.settings);
    this.settings = normalized;
    this.syncSettings(normalized);
    this.onSettingsChange(normalized);
  }
}
