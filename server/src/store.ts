import { readFile, readdir, rm, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import type { Character, CharacterGroup, Chat, Lorebook, MessageAudio, Narrator, Persona, PersonaGender, Scenario, Stamped, Story } from './types.js';
import type { Id } from './types.js';
import { DIR } from './paths.js';
import { getConfig } from './config.js';
import { atomicWrite, ensureDir, lookup, now, uuid } from './util.js';

type Input<T extends Stamped> = Omit<T, 'id' | 'created' | 'updated'>;
type Patch<T extends Stamped> = Partial<Omit<T, 'id' | 'created' | 'updated'>>;

/** Runtime defaults; `dialogueOnly` inherits the last remembered toggle. */
export function chatRuntimeDefaults(): Chat['runtime'] {
  return defaultRuntime();
}

function defaultRuntime(): Chat['runtime'] {
  return {
    temperature: 0.8,
    topP: 0.95,
    maxTokens: 4096,
    autoTts: false,
    disableThinking: true,
    dialogueOnly: getConfig().dialogueOnly,
    sequentialTurns: false,
    llmConnectionId: null,
    ttsConnectionId: null,
  };
}

/** Accepts an inline ad-hoc scenario attached to a chat; tolerant of bad shapes. */
function normalizeInlineScenario(chat: Chat): Chat['scenarioInline'] {
  const raw = (chat as { scenarioInline?: unknown }).scenarioInline;
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { name?: unknown; scenario?: unknown; first_mes?: unknown };
  const scenario = typeof obj.scenario === 'string' ? obj.scenario : '';
  if (!scenario.trim()) return null;
  return {
    name: typeof obj.name === 'string' && obj.name.trim() ? obj.name : 'Ad-hoc scenario',
    scenario,
    first_mes: typeof obj.first_mes === 'string' ? obj.first_mes : '',
  };
}

export function normalizeChat(chat: Chat): Chat {
  return {
    ...chat,
    title: typeof chat.title === 'string' ? chat.title : '',
    participantIds: Array.isArray(chat.participantIds) ? chat.participantIds : [],
    removedParticipants: Array.isArray(chat.removedParticipants) ? chat.removedParticipants : [],
    lorebookIds: Array.isArray(chat.lorebookIds) ? chat.lorebookIds : [],
    scenarioId: typeof chat.scenarioId === 'string' ? chat.scenarioId : null,
    scenarioInline: normalizeInlineScenario(chat),
    storyId: typeof (chat as { storyId?: unknown }).storyId === 'string' ? (chat as { storyId: Id | null }).storyId : null,
    audioBookDir: typeof (chat as { audioBookDir?: unknown }).audioBookDir === 'string' ? (chat as { audioBookDir: string | null }).audioBookDir : null,
    narratorId: typeof chat.narratorId === 'string' ? chat.narratorId : null,
    personaId: typeof (chat as { personaId?: unknown }).personaId === 'string' ? (chat as { personaId: Id | null }).personaId : null,
    messages: Array.isArray(chat.messages)
      ? chat.messages.map((m) => ({
          ...m,
          id: m.id || `${uuid()}`,
          content: typeof m.content === 'string' ? m.content : '',
          audioPath: typeof m.audioPath === 'string' ? m.audioPath : null,
          audio: Array.isArray((m as { audio?: unknown }).audio) ? (m as { audio: MessageAudio[] }).audio : [],
          images: Array.isArray(m.images) ? m.images : [],
        }))
      : [],
    runtime: (() => {
      const defaults = defaultRuntime();
      const given = chat.runtime && typeof chat.runtime === 'object' ? chat.runtime : undefined;
      if (!given) return defaults;
      return {
        ...defaults,
        ...given,
        // dialogueOnly defaults live: only the explicitly absent field inherits.
        dialogueOnly: given.dialogueOnly !== undefined ? given.dialogueOnly : defaults.dialogueOnly,
      };
    })(),
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
    creator_notes:
      typeof (character as { creator_notes?: unknown }).creator_notes === 'string'
        ? (character as { creator_notes: string | null }).creator_notes
        : null,
    avatarPath: typeof character.avatarPath === 'string' ? character.avatarPath : null,
    voiceSamplePath: typeof character.voiceSamplePath === 'string' ? character.voiceSamplePath : null,
    voiceSampleTranscript:
      typeof character.voiceSampleTranscript === 'string' ? character.voiceSampleTranscript : null,
    llmConnectionId:
      typeof (character as { llmConnectionId?: unknown }).llmConnectionId === 'string'
        ? (character as { llmConnectionId: string | null }).llmConnectionId
        : null,
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

export function normalizeStory(story: Story): Story {
  return {
    ...story,
    name: typeof story.name === 'string' ? story.name : '',
    summary: typeof story.summary === 'string' ? story.summary : '',
  };
}

export function normalizeGroup(group: CharacterGroup): CharacterGroup {
  return {
    ...group,
    name: typeof group.name === 'string' ? group.name : '',
    description: typeof group.description === 'string' ? group.description : '',
    avatarPath: typeof group.avatarPath === 'string' ? group.avatarPath : null,
    memberIds: Array.isArray(group.memberIds)
      ? group.memberIds.filter((id) => typeof id === 'string' && id)
      : [],
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
    voiceSamplePath: typeof (persona as { voiceSamplePath?: unknown }).voiceSamplePath === 'string'
      ? (persona as { voiceSamplePath: string | null }).voiceSamplePath
      : null,
    voiceSampleTranscript:
      typeof (persona as { voiceSampleTranscript?: unknown }).voiceSampleTranscript === 'string'
        ? (persona as { voiceSampleTranscript: string | null }).voiceSampleTranscript
        : null,
    thoughtSamplePath: typeof (persona as { thoughtSamplePath?: unknown }).thoughtSamplePath === 'string'
      ? (persona as { thoughtSamplePath: string | null }).thoughtSamplePath
      : null,
    thoughtSampleTranscript:
      typeof (persona as { thoughtSampleTranscript?: unknown }).thoughtSampleTranscript === 'string'
        ? (persona as { thoughtSampleTranscript: string | null }).thoughtSampleTranscript
        : null,
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
    // Ignore undefined patch values so partial updates can't wipe fields.
    const clean: Record<string, unknown> = { ...patch };
    for (const key of Object.keys(clean)) {
      if (clean[key] === undefined) delete clean[key];
    }
    const updated = { ...current, ...clean, id, created: current.created, updated: now() } as T;
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
  groups: JsonCollection<CharacterGroup>;
  stories: JsonCollection<Story>;
  lorebooks: JsonCollection<Lorebook>;
  scenarios: JsonCollection<Scenario>;
  chats: JsonCollection<Chat>;
}

export function createStore(): DataStore {
  return {
    characters: new JsonCollection<Character>(DIR.characters, 'character', 'name' as keyof Character, normalizeCharacter),
    narrators: new JsonCollection<Narrator>(DIR.narrators, 'narrator', 'name' as keyof Narrator, normalizeNarrator),
    personas: new JsonCollection<Persona>(DIR.personas, 'persona', 'name' as keyof Persona, normalizePersona),
    groups: new JsonCollection<CharacterGroup>(DIR.groups, 'group', 'name' as keyof CharacterGroup, normalizeGroup),
    stories: new JsonCollection<Story>(DIR.stories, 'story', 'name' as keyof Story, normalizeStory),
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
    store.groups.load(),
    store.stories.load(),
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
      voiceSamplePath: null,
      voiceSampleTranscript: null,
      thoughtSamplePath: null,
      thoughtSampleTranscript: null,
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