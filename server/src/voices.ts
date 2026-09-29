import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './paths.js';
import { ensureDir, isObject, asString } from './util.js';

interface VoiceCacheEntry {
  voiceId: string;
  provider: string;
}

export interface VoiceCache {
  get(connId: string, charId: string): VoiceCacheEntry | undefined;
  set(connId: string, charId: string, entry: VoiceCacheEntry): void;
  /** Drop all cached clones for a subject (e.g. after its voice sample changed). */
  invalidate(charId: string): void;
  flush(): Promise<void>;
}

const FILE = path.join(DATA_DIR, 'voices.json');

export async function createVoiceCache(): Promise<VoiceCache> {
  await ensureDir(DATA_DIR);
  let map = new Map<string, VoiceCacheEntry>();
  try {
    const raw = JSON.parse(await readFile(FILE, 'utf8')) as unknown;
    if (isObject(raw)) {
      for (const [key, value] of Object.entries(raw)) {
        if (isObject(value)) {
          map.set(key, { voiceId: asString(value.voiceId), provider: asString(value.provider) });
        }
      }
    }
  } catch {
    map = new Map();
  }

  let dirty = false;
  const flush = async (): Promise<void> => {
    if (!dirty) return;
    const out: Record<string, VoiceCacheEntry> = {};
    for (const [key, value] of map) out[key] = value;
    await writeFile(FILE, JSON.stringify(out, null, 2), 'utf8');
    dirty = false;
  };

  return {
    get(connId, charId) {
      return map.get(`${connId}:${charId}`);
    },
    set(connId, charId, entry) {
      map.set(`${connId}:${charId}`, entry);
      dirty = true;
      void flush();
    },
    invalidate(charId) {
      for (const key of [...map.keys()]) {
        if (key.endsWith(`:${charId}`) || key.includes(charId)) {
          map.delete(key);
          dirty = true;
        }
      }
      void flush();
    },
    flush,
  };
}