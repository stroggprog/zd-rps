import { readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Character, Chat, Lorebook, MessageAudio, Scenario, Stamped } from './types.js';
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
    kind: character.kind === 'narrator' ? 'narrator' : 'character',
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
  lorebooks: JsonCollection<Lorebook>;
  scenarios: JsonCollection<Scenario>;
  chats: JsonCollection<Chat>;
}

export function createStore(): DataStore {
  return {
    characters: new JsonCollection<Character>(DIR.characters, 'character', 'name' as keyof Character, normalizeCharacter),
    lorebooks: new JsonCollection<Lorebook>(DIR.lorebooks, 'lorebook'),
    scenarios: new JsonCollection<Scenario>(DIR.scenarios, 'scenario'),
    chats: new JsonCollection<Chat>(DIR.chats, 'chat', 'title' as keyof Chat, normalizeChat),
  };
}

export async function loadStore(store: DataStore): Promise<void> {
  await Promise.all([
    store.characters.load(),
    store.lorebooks.load(),
    store.scenarios.load(),
    store.chats.load(),
  ]);
}