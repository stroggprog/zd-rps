import { describe, expect, it } from 'vitest';
import { chatPersona, normalizeChat, normalizePersona } from '../src/store.js';
import { buildLlmMessages, userNameFor } from '../src/pipeline.js';
import type { Chat, ChatMessage, Persona } from '../src/types.js';

function persona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: 'p1',
    name: 'You',
    avatarPath: null,
    description: '',
    gender: 'male',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('normalizePersona', () => {
  it('fills defaults for missing fields', () => {
    const n = normalizePersona({ id: 'x', created: '', updated: '', name: 42, gender: 'banana' } as unknown as Persona);
    expect(n.name).toBe('');
    expect(n.gender).toBe('male');
    expect(n.avatarPath).toBeNull();
    expect(n.description).toBe('');
  });

  it('keeps valid gender values', () => {
    const n = normalizePersona({ ...persona(), gender: 'female' });
    expect(n.gender).toBe('female');
  });
});

describe('normalizeChat personaId', () => {
  it('defaults personaId to null', () => {
    const chat = normalizeChat({ id: 'c', title: '', messages: [] } as unknown as Chat);
    expect(chat.personaId).toBeNull();
  });
});

describe('chatPersona', () => {
  const store = { personas: { get: (id: string) => (id === 'p1' ? persona({ id: 'p1' }) : undefined), list: () => [persona({ id: 'p1' })] } };

  it('returns the chat persona when set', () => {
    expect(chatPersona(store as never, { personaId: 'p1' } as Chat)?.id).toBe('p1');
  });

  it('falls back to the "You" persona', () => {
    expect(chatPersona(store as never, { personaId: null } as Chat)?.id).toBe('p1');
    expect(chatPersona(store as never, { personaId: 'gone' } as Chat)?.id).toBe('p1');
  });
});

describe('userNameFor', () => {
  it('uses persona name when set', () => {
    expect(userNameFor(persona({ name: 'Phil' }))).toBe('Phil');
  });
  it('falls back to User', () => {
    expect(userNameFor(null)).toBe('User');
    expect(userNameFor(persona({ name: '  ' }))).toBe('User');
  });
});

describe('persona in buildLlmMessages', () => {
  const chat: Chat = {
    id: 'c',
    title: '',
    participantIds: [],
    removedParticipants: [],
    lorebookIds: [],
    scenarioId: null,
    narratorId: null,
    personaId: 'p1',
    messages: [],
    runtime: {
      temperature: 1,
      topP: 1,
      maxTokens: 1,
      autoTts: false,
      disableThinking: true,
      llmConnectionId: null,
      ttsConnectionId: null,
    },
    created: '',
    updated: '',
  };
  const ctx = {
    chat,
    activeCharacters: [],
    removed: [],
    lorebooks: [],
    scenario: null,
    persona: persona({ name: 'Phil', description: 'A curious traveller.', gender: 'other' }),
  };

  it('injects a persona block and uses the persona name', () => {
    const msgs = buildLlmMessages(ctx, 0);
    const system = msgs[0].content;
    expect(system).toContain('[The user: Phil]');
    expect(system).toContain('About Phil: A curious traveller.');
    expect(system).toContain('never speak for Phil');
  });

  it('omits the persona block for the bare default persona', () => {
    const msgs = buildLlmMessages({ ...ctx, persona: persona() }, 0);
    expect(msgs[0].content).not.toContain('[The user:');
  });
});
