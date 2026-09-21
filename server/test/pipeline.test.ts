import { describe, expect, it } from 'vitest';
import { attributeReply, buildLlmMessages, USER_NAME } from '../src/pipeline.js';
import type { Chat, Character, ChatContext, Lorebook, RemovedParticipant } from '../src/types.js';

const amy: Character = {
  id: 'c-amy',
  name: 'Amy',
  description: 'A curious wanderer.',
  personality: 'Playful',
  system_prompt: '',
  post_history_instructions: '',
  mes_example: '',
  tags: [],
  avatarPath: null,
  voiceSamplePath: null,
  voiceSampleTranscript: null,
  created: '',
  updated: '',
};

function context(chat: Partial<Chat> = {}, extra: Partial<ChatContext> = {}): ChatContext {
  return {
    chat: {
      id: 'c1',
      title: 'Chat',
      participantIds: ['c-amy'],
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
      created: '',
      updated: '',
      ...chat,
    },
    activeCharacters: [amy],
    removed: [],
    lorebooks: [] as Lorebook[],
    scenario: null,
    ...extra,
  };
}

describe('buildLlmMessages', () => {
  it('lists active characters in the system message', () => {
    const [system, ...rest] = buildLlmMessages(context(), 0);
    expect(system.role).toBe('system');
    expect(system.content).toContain('Amy');
    expect(rest).toHaveLength(0);
  });

  it('sends the entire history by default (historyTail = 0)', () => {
    const messages = [
      { id: 'm1', role: 'user', speaker: { characterId: null, name: USER_NAME }, content: 'hello', audioPath: null, audio: [], images: [], ts: '' },
      { id: 'm2', role: 'assistant', speaker: { characterId: 'c-amy', name: 'Amy' }, content: 'hi there', audioPath: null, audio: [], images: [], ts: '' },
    ] as Chat['messages'];
    const built = buildLlmMessages(context({ messages }), 0);
    expect(built).toHaveLength(3);
    expect(built[1]).toEqual({ role: 'user', content: 'User: hello' });
    expect(built[2]).toEqual({ role: 'assistant', content: 'Amy: hi there' });
  });

  it('includes removed participants and lorebook matches as system context', () => {
    const removed: RemovedParticipant[] = [{ characterId: 'c-bob', name: 'Bob', avatarPath: null, removedAt: '' }];
    const lorebook: Lorebook = {
      id: 'l1',
      name: 'World',
      description: '',
      scan_depth: 200,
      token_budget: 1000,
      recursive_scanning: false,
      extensions: {},
      entries: [
        {
          id: 'e1',
          keys: ['tower'],
          content: 'The tower glows at night.',
          name: 'Tower',
          enabled: true,
          insertion_order: 0,
          case_sensitive: false,
          priority: 10,
          selective: false,
          secondary_keys: [],
          constant: false,
          comment: '',
          position: 'before_char',
        },
      ],
      created: '',
      updated: '',
    };
    const [system] = buildLlmMessages(context({ removedParticipants: removed, messages: [{ id: 'm1', role: 'user', speaker: { characterId: null, name: USER_NAME }, content: 'the tower looms', audioPath: null, audio: [], images: [], ts: '' }] as Chat['messages'] }, { removed, lorebooks: [lorebook] }), 0);
    expect(system.content).toContain('Bob');
    expect(system.content).toContain('The tower glows at night.');
  });
});

describe('attributeReply', () => {
  it('strips a leading "Amy: " prefix when Amy is active', () => {
    expect(attributeReply('Amy: Here we go.', ['Amy'])).toEqual({ name: 'Amy', content: 'Here we go.' });
  });

  it('matches names case-insensitively', () => {
    expect(attributeReply('amy: hi', ['Amy'])).toEqual({ name: 'Amy', content: 'hi' });
  });

  it('does not attribute a prefix that matches no active character', () => {
    expect(attributeReply('Bob: hi', ['Amy'])).toEqual({ name: null, content: 'Bob: hi' });
  });

  it('returns the reply untouched with null name when there is no prefix', () => {
    expect(attributeReply('Just a line.', ['Amy'])).toEqual({ name: null, content: 'Just a line.' });
  });
});