import { describe, expect, it } from 'vitest';
import { normalizeChat, normalizeCharacter, normalizeNarrator } from '../src/store.js';
import type { Chat, Character, Narrator } from '../src/types.js';

function bareChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    title: 'Chat',
    participantIds: ['c1'],
    removedParticipants: [],
lorebookIds: [],
      scenarioId: null,
      narratorId: null,
      messages: [],
    runtime: {
      temperature: 0.8,
      topP: 0.95,
      maxTokens: 4096,
      autoTts: false,
      disableThinking: true,
      llmConnectionId: null,
      ttsConnectionId: null,
    },
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('normalizeChat', () => {
  it('fills runtime defaults when runtime is missing', () => {
    const { runtime } = normalizeChat(bareChat({ runtime: undefined as unknown as Chat['runtime'] }));
    expect(runtime.maxTokens).toBe(4096);
    expect(runtime.disableThinking).toBe(true);
    expect(runtime.temperature).toBe(0.8);
    expect(runtime.ttsConnectionId).toBeNull();
  });

  it('keeps explicit runtime overrides', () => {
    const { runtime } = normalizeChat(
      bareChat({
        runtime: {
          temperature: 1.1,
          topP: 0.5,
          maxTokens: 2048,
          autoTts: true,
          disableThinking: false,
          sequentialTurns: false,
          llmConnectionId: 'l1',
          ttsConnectionId: 't1',
        },
      }),
    );
    expect(runtime).toEqual({
      temperature: 1.1,
      topP: 0.5,
      maxTokens: 2048,
      autoTts: true,
      disableThinking: false,
      sequentialTurns: false,
      llmConnectionId: 'l1',
      ttsConnectionId: 't1',
    });
  });

  it('backs old messages up with an empty audio array and null audioPath', () => {
    const normalized = normalizeChat(
      bareChat({
        messages: [
          {
            id: 'm1',
            role: 'user',
            speaker: { characterId: null, name: 'User', avatarPath: null, voiceSamplePath: null },
            content: 'hi',
            images: ['/img/a.png'],
            ts: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    );
    expect(normalized.messages[0].audio).toEqual([]);
    expect(normalized.messages[0].audioPath).toBeNull();
    expect(normalized.messages[0].images).toEqual(['/img/a.png']);
  });

  it('preserves existing audio clips', () => {
    const clip = { id: 'clip-1', text: 'hello', path: '/media/audio/a.wav', ts: '2026-01-01T00:00:00.000Z' };
    const { messages } = normalizeChat(
      bareChat({
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            speaker: { characterId: 'c1', name: 'Amy', avatarPath: null, voiceSamplePath: null },
            content: 'hello',
            audioPath: null,
            audio: [clip],
            images: [],
            ts: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    );
    expect(messages[0].audio).toEqual([clip]);
  });

  it('does not crash on a nearly-empty stored object and fills missing collections', () => {
    const normalized = normalizeChat(
      bareChat({ participantIds: undefined as unknown as string[], lorebookIds: undefined as unknown as string[] }),
    );
    expect(normalized.participantIds).toEqual([]);
    expect(normalized.lorebookIds).toEqual([]);
    expect(normalized.narratorId).toBeNull();
  });

  it('keeps a persisted narratorId and defaults missing one to null', () => {
    expect(normalizeChat(bareChat()).narratorId).toBeNull();
    expect(normalizeChat(bareChat({ narratorId: 'c-narr' })).narratorId).toBe('c-narr');
  });
});

describe('normalizeCharacter', () => {
  const bare = (over: Partial<Character> = {}): Character => ({
    name: 'Amy',
    description: '',
    personality: '',
    system_prompt: '',
    post_history_instructions: '',
    mes_example: '',
    tags: [],
    avatarPath: null,
    voiceSamplePath: null,
    voiceSampleTranscript: null,
    created: '',
    updated: '',
    id: 'c1',
    ...over,
  });

  it('coerces bad optional fields to safe defaults', () => {
    const n = normalizeCharacter(
      bare({ name: undefined as unknown as string, avatarPath: undefined as unknown as string | null }),
    );
    expect(n.name).toBe('');
    expect(n.avatarPath).toBeNull();
  });
});

describe('normalizeNarrator', () => {
  const bare = (over: Partial<Narrator> = {}): Narrator => ({
    id: 'n1',
    name: 'The Narrator',
    avatarPath: null,
    voiceSamplePath: null,
    voiceSampleTranscript: null,
    created: '',
    updated: '',
    ...over,
  });

  it('keeps media and defaults missing voice transcript to null', () => {
    const n = normalizeNarrator(
      bare({ avatarPath: '/media/narrators/n1/avatar.png', voiceSamplePath: undefined as unknown as string | null }),
    );
    expect(n.name).toBe('The Narrator');
    expect(n.avatarPath).toBe('/media/narrators/n1/avatar.png');
    expect(n.voiceSamplePath).toBeNull();
    expect(n.voiceSampleTranscript).toBeNull();
  });
});