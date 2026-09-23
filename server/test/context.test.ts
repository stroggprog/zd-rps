import { describe, expect, it } from 'vitest';
import { estimateTokens, historyTailFor } from '../src/pipeline.js';
import type { Chat, ChatMessage, SpeakerSnapshot } from '../src/types.js';

const speaker = (name: string): SpeakerSnapshot => ({
  characterId: null,
  name,
  avatarPath: null,
  voiceSamplePath: null,
});

const msg = (name: string, content: string): ChatMessage => ({
  id: name + content.length,
  role: 'assistant',
  speaker: speaker(name),
  content,
  audioPath: null,
  audio: [],
  images: [],
  ts: '',
});

const mkChat = (namesContents: [string, string][]): Chat => ({
  id: 'c',
  title: '',
  participantIds: [],
  removedParticipants: [],
  lorebookIds: [],
  scenarioId: null,
  scenarioInline: null,
  narratorId: null,
  personaId: null,
  messages: namesContents.map(([n, c]) => msg(n, c)),
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
});

describe('estimateTokens', () => {
  it('scales with length and keeps headroom', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(32))).toBe(10);
  });
});

describe('historyTailFor', () => {
  const chat = mkChat([
    ['A', 'a'.repeat(9000)], // ~1563 tokens
    ['B', 'b'.repeat(64000)], // ~20000 tokens
    ['A', 'c'.repeat(3200)], // ~1000 tokens
    ['B', 'short last'],
  ]);

  it('returns full length when contextTokens is huge', () => {
    expect(historyTailFor(chat, 0.999 + 1e6, 100)).toBe(chat.messages.length);
  });

  it('keeps at least the last 2 messages when budget is tight', () => {
    expect(historyTailFor(chat, 100, 100)).toBe(2);
  });

  it('trims to fit the budget including the generation reservation', () => {
    // context 25000, maxTokens 1000 -> budget 24000 tokens of history.
    // All messages total ~22.6k tokens -> whole transcript fits except none...
    const tail = historyTailFor(chat, 25000, 1000);
    expect(tail).toBe(chat.messages.length);
  });

  it('drops older messages once the budget would be exceeded', () => {
    const tail = historyTailFor(chat, 22000, 1000); // budget 21000
    // ~1005 tokens (last two) fit; adding the 20000-token one would exceed.
    expect(tail).toBe(2);
  });
});
