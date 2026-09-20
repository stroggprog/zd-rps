import type { DataStore } from './store.js';
import type { VoiceCache } from './voices.js';

export interface AppContext {
  store: DataStore;
  voiceCache: VoiceCache;
}