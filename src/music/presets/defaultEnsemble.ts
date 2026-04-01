import { DEFAULT_INSTRUMENT_PROFILES } from '../instruments/profiles';
import type { InstrumentProfile } from '../types/music';

export const createDefaultEnsemble = (): InstrumentProfile[] => DEFAULT_INSTRUMENT_PROFILES.map((profile) => ({ ...profile }));
