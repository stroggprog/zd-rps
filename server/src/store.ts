import { readFile, readdir, rm, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import type { Character, Chat, Lorebook, MessageAudio, Narrator, Persona, PersonaGender, Scenario, Stamped } from './types.js';
import type { Id } from './types.js';
import { DIR } from './paths.js';
import { atomicWrite, ensureDir, lookup, now, uuid } from './util.js';

type Input<T extends Stamped> = Omit<T, 'id' | 'created' | 'updated'>;
type Patch<T extends Stamped> = Partial<Omit<T, 'id' | 'created' | 'updated'>>;

const DEFAULT_RUNTIME = {
  temperature: 0.8,
  topP: 0.95,
  maxTokens: 4096,
  autoTts: false,
  disableThinking: true,
  llmConnectionId: null,
  ttsConnectionId: null,
} satisfies Chat['runtime'];

export function normalizeChat(chat: Chat): Chat {
  return {
    ...chat,
    title: typeof chat.title === 'string' ? chat.title : '',
    participantIds: Array.isArray(chat.participantIds) ? chat.participantIds : [],
    removedParticipants: Array.isArray(chat.removedParticipants) ? chat.removedParticipants : [],
    lorebookIds: Array.isArray(chat.lorebookIds) ? chat.lorebookIds : [],
    scenarioId: typeof chat.scenarioId === 'string' ? chat.scenarioId : null,
    narratorId: typeof chat.narratorId === 'string' ? chat.narratorId : null,
    personaId: typeof (chat as { personaId?: unknown }).personaId === 'string' ? (chat as { personaId: Id | null }).personaId : null,
    messages: Array.isArray(chat.messages)
      ? chat.messages.map((m) => ({
          ...m,
          content: typeof m.content === 'string' ? m.content : '',
          audioPath: typeof m.audioPath === 'string' ? m.audioPath : null,
          audio: Array.isArray((m as { audio?: unknown }).audio) ? (m as { audio: MessageAudio[] }).audio : [],
          images: Array.isArray(m.images) ? m.images : [],
        }))
      : [],
    runtime: { ...DEFAULT_RUNTIME, ...(chat.runtime ?? {}) },
  };
}

export function normalizeCharacter(character: Character): Character {
  return {
    ...character,
    name: typeof character.name === 'string' ? character.name : '',
    description: typeof character.description === 'string' ? character.description : '',
    personality: typeof character.personality === 'string' ? character.personality : '',
    system_prompt: typeof character.system_prompt === 'string' ? character.system_prompt : '',
    post_history_instructions:
      typeof character.post_history_instructions === 'string' ? character.post_history_instructions : '',
    mes_example: typeof character.mes_example === 'string' ? character.mes_example : '',
    tags: Array.isArray(character.tags) ? character.tags : [],
    avatarPath: typeof character.avatarPath === 'string' ? character.avatarPath : null,
    voiceSamplePath: typeof character.voiceSamplePath === 'string' ? character.voiceSamplePath : null,
    voiceSampleTranscript:
      typeof character.voiceSampleTranscript === 'string' ? character.voiceSampleTranscript : null,
  };
}

export function normalizeNarrator(narrator: Narrator): Narrator {
  return {
    ...narrator,
    name: typeof narrator.name === 'string' ? narrator.name : '',
    avatarPath: typeof narrator.avatarPath === 'string' ? narrator.avatarPath : null,
    voiceSamplePath: typeof narrator.voiceSamplePath === 'string' ? narrator.voiceSamplePath : null,
    voiceSampleTranscript:
      typeof narrator.voiceSampleTranscript === 'string' ? narrator.voiceSampleTranscript : null,
  };
}

const PERSONA_GENDERS: PersonaGender[] = ['male', 'female', 'other'];

export function normalizePersona(persona: Persona): Persona {
  const gender = (persona as { gender?: unknown }).gender;
  return {
    ...persona,
    name: typeof persona.name === 'string' ? persona.name : '',
    avatarPath: typeof persona.avatarPath === 'string' ? persona.avatarPath : null,
    description: typeof persona.description === 'string' ? persona.description : '',
    gender: PERSONA_GENDERS.includes(gender as PersonaGender) ? (gender as PersonaGender) : 'male',
  };
}

/**
 * One-time migration from the legacy design where narrators were characters
 * with `kind: 'narrator'`. Moves each such character to `DIR.narrators` under
 * the same id (so `chat.narratorId` references keep working), copying avatar
 * and voice-sample files and rewriting the /media/... paths. Run before the
 * collections load. Idempotent: a character without `kind` is left alone.
 */
export async function migrateLegacyNarrators(): Promise<void> {
  let files: string[] = [];
  try {
    files = await readdir(DIR.characters);
  } catch {
    return;
  }
  for (const entry of files) {
    let id: string;
    let charPath: string;
    if (entry.endsWith('.json')) {
      id = entry.replace(/\.json$/, '');
      charPath = path.join(DIR.characters, entry);
    } else {
      id = entry;
      charPath = path.join(DIR.characters, entry, 'character.json');
    }
    const srcDir = path.join(DIR.characters, id);
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(await readFile(charPath, 'utf8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (raw.kind !== 'narrator') continue;
    const destDir = path.join(DIR.narrators, id);
    await ensureDir(destDir);

    const moveMedia = async (sourceName: string, targetName: string): Promise<string | null> => {
      try {
        await copyFile(path.join(srcDir, sourceName), path.join(destDir, targetName));
        return `/media/narrators/${id}/${targetName}`;
      } catch {
        return null;
      }
    };

    const n: Narrator = {
      id,
      name: typeof raw.name === 'string' ? raw.name : '',
      avatarPath: await moveMedia('avatar.png', 'avatar.png'),
      voiceSamplePath: await moveMedia('voice-sample.wav', 'voice-sample.wav'),
      voiceSampleTranscript:
        typeof raw.voiceSampleTranscript === 'string' ? raw.voiceSampleTranscript : null,
      created: typeof raw.created === 'string' ? raw.created : now(),
      updated: now(),
    };
    await atomicWrite(path.join(DIR.narrators, `${id}.json`), JSON.stringify(n, null, 2));
    if (charPath !== path.join(srcDir, 'character.json')) {
      await rm(charPath, { force: true });
    }
    await rm(srcDir, { recursive: true, force: true });
    console.log(`[store] migrated narrator "${n.name}" from characters/ to narrators/`);
  }
}

export class JsonCollection<T extends Stamped> {
  private items = new Map<Id, T>();

  constructor(
    private readonly dir: string,
    private readonly label: string,
    private readonly sortKey: keyof T = 'name' as keyof T,
    private readonly normalize?: (raw: T) => T,
  ) {}

  async load(): Promise<void> {
    await ensureDir(this.dir);
    let files: string[] = [];
    try {
      files = await readdir(this.dir);
    } catch {
      files = [];
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await readFile(path.join(this.dir, file), 'utf8');
        const parsed = JSON.parse(raw) as T;
        this.items.set(parsed.id, this.normalize ? this.normalize(parsed) : parsed);
      } catch (err) {
        console.warn(`[store] skipping unreadable ${this.label} ${file}:`, (err as Error).message);
      }
    }
  }

  list(): T[] {
    return [...this.items.values()].sort((a, b) =>
      String(a[this.sortKey]).localeCompare(String(b[this.sortKey])),
    );
  }

  get(id: Id): T | undefined {
    return this.items.get(id);
  }

  getOrThrow(id: Id): T {
    return lookup(this.items, id, this.label);
  }

  exists(id: Id): boolean {
    return this.items.has(id);
  }

  create(input: Input<T>): T {
    const item = {
      ...input,
      id: uuid(),
      created: now(),
      updated: now(),
    } as unknown as T;
    this.items.set(item.id, item);
    void this.persist(item);
    return item;
  }

  update(id: Id, patch: Patch<T>): T | undefined {
    const current = this.items.get(id);
    if (!current) return undefined;
    const updated = { ...current, ...patch, id, created: current.created, updated: now() } as T;
    this.items.set(id, updated);
    void this.persist(updated);
    return updated;
  }

  delete(id: Id): boolean {
    const existed = this.items.delete(id);
    if (existed) {
      void this.removeFile(id);
    }
    return existed;
  }

  private file(id: Id): string {
    return path.join(this.dir, `${id}.json`);
  }

  private async persist(item: T): Promise<void> {
    await atomicWrite(this.file(item.id), JSON.stringify(item, null, 2));
  }

  private async removeFile(id: Id): Promise<void> {
    try {
      await rm(this.file(id), { force: true });
    } catch {
      // best effort
    }
  }
}

export interface DataStore {
  characters: JsonCollection<Character>;
  narrators: JsonCollection<Narrator>;
  personas: JsonCollection<Persona>;
  lorebooks: JsonCollection<Lorebook>;
  scenarios: JsonCollection<Scenario>;
  chats: JsonCollection<Chat>;
}

export function createStore(): DataStore {
  return {
    characters: new JsonCollection<Character>(DIR.characters, 'character', 'name' as keyof Character, normalizeCharacter),
    narrators: new JsonCollection<Narrator>(DIR.narrators, 'narrator', 'name' as keyof Narrator, normalizeNarrator),
    personas: new JsonCollection<Persona>(DIR.personas, 'persona', 'name' as keyof Persona, normalizePersona),
    lorebooks: new JsonCollection<Lorebook>(DIR.lorebooks, 'lorebook'),
    scenarios: new JsonCollection<Scenario>(DIR.scenarios, 'scenario'),
    chats: new JsonCollection<Chat>(DIR.chats, 'chat', 'title' as keyof Chat, normalizeChat),
  };
}

export async function loadStore(store: DataStore): Promise<void> {
  await migrateLegacyNarrators();
  await Promise.all([
    store.characters.load(),
    store.narrators.load(),
    store.personas.load(),
    store.lorebooks.load(),
    store.scenarios.load(),
    store.chats.load(),
  ]);
  if (store.personas.list().length === 0) {
    store.personas.create({
      name: 'You',
      avatarPath: null,
      description: '',
      gender: 'male',
    });
    console.log('[store] created default persona "You"');
  }
}

/** The chat's chosen persona, or the default one, or null when none exists. */
export function chatPersona(store: DataStore, chat: Chat): Persona | null {
  const persona = chat.personaId ? store.personas.get(chat.personaId) : undefined;
  if (persona) return persona;
  const list = store.personas.list();
  return list.find((p) => p.name === 'You') ?? list[0] ?? null;
}