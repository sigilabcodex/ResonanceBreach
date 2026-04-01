import type { WorldEvent } from '../../sim/events';
import type { SimulationSnapshot } from '../../types/world';
import { WorldMusicFeatureExtractor } from '../analysis/worldFeatureExtractor';
import { MusicScheduler } from '../events/scheduler';
import { PhrasePlanner } from '../phrase/planner';
import { createDefaultEnsemble } from '../presets/defaultEnsemble';
import type { MusicEngineSnapshot, MusicEngineUpdateInput, PlannedPhrase, ScheduledNoteEvent } from '../types/music';
import { MusicConductor } from './conductor';
import { MusicTransport } from './transport';

export class MusicEngine {
  private readonly transport = new MusicTransport();
  private readonly conductor = new MusicConductor();
  private readonly planner = new PhrasePlanner();
  private readonly scheduler = new MusicScheduler();
  private readonly featureExtractor = new WorldMusicFeatureExtractor();
  private readonly ensemble = createDefaultEnsemble();
  private activePhrase: PlannedPhrase | null = null;
  private lastPhraseIndex = -1;
  private latestScheduled: ScheduledNoteEvent[] = [];
  private latestWindow = this.scheduler.getWindow(0, 2);

  reset(): void {
    this.transport.reset();
    this.conductor.reset();
    this.scheduler.reset();
    this.featureExtractor.reset();
    this.activePhrase = null;
    this.lastPhraseIndex = -1;
    this.latestScheduled = [];
    this.latestWindow = this.scheduler.getWindow(0, 2);
  }

  updateFromSnapshot(snapshot: SimulationSnapshot, dt: number): MusicEngineSnapshot {
    const features = this.featureExtractor.extract(snapshot);
    const input: MusicEngineUpdateInput = {
      dt,
      worldTime: snapshot.time,
      events: snapshot.events,
      features,
    };
    return this.update(input);
  }

  update(input: MusicEngineUpdateInput): MusicEngineSnapshot {
    const transportState = this.transport.update(input.dt, input.features.activity);
    const conductorState = this.conductor.update(input.features, transportState);

    if (transportState.phraseIndex !== this.lastPhraseIndex) {
      this.activePhrase = this.planner.planPhrase(transportState, conductorState, this.ensemble);
      this.lastPhraseIndex = transportState.phraseIndex;
    }

    const recentEvents = this.filterEvents(input.events, input.worldTime);
    const lookaheadSeconds = recentEvents.length > 0 ? 2.4 : 1.8;
    this.latestWindow = this.scheduler.getWindow(input.worldTime, lookaheadSeconds);

    if (this.activePhrase) {
      this.latestScheduled = this.scheduler
        .schedulePhrase(this.activePhrase, transportState, conductorState, input.worldTime, lookaheadSeconds)
        .filter((event) => !event.rest);
    } else {
      this.latestScheduled = [];
    }

    return {
      transport: transportState,
      conductor: conductorState,
      activePhrase: this.activePhrase,
      scheduledWindow: this.latestWindow,
      scheduledEvents: this.latestScheduled,
    };
  }

  getDebugState(): MusicEngineSnapshot {
    return {
      transport: this.transport.getState(),
      conductor: this.conductor.getState(),
      activePhrase: this.activePhrase,
      scheduledWindow: this.latestWindow,
      scheduledEvents: this.latestScheduled,
    };
  }

  private filterEvents(events: WorldEvent[], worldTime: number): WorldEvent[] {
    return events.filter((event) => worldTime - event.time <= 6);
  }
}
