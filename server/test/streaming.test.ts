import { describe, expect, it } from 'vitest';
import { SentenceStream } from '../src/streaming.js';

function collect(activeNames: string[], deltas: string[]) {
  const sentences: { text: string; isLast: boolean }[] = [];
  const stream = new SentenceStream({
    activeNames,
    onSentence: (text, isLast) => sentences.push({ text, isLast }),
  });
  for (const d of deltas) stream.push(d);
  stream.finish();
  return { sentences, speaker: stream.speaker };
}

describe('SentenceStream', () => {
  it('splits a paragraph into sentences on boundary punctuation', () => {
    const { sentences } = collect(['Amy'], ['Hello there. How are you today! Fine, thanks.']);
    expect(sentences.map((s) => s.text)).toEqual(['Hello there.', 'How are you today!', 'Fine, thanks.']);
    expect(sentences.map((s) => s.isLast)).toEqual([false, false, true]);
  });

  it('flushes an open-ended tail only at finish()', () => {
    const { sentences } = collect(['Amy'], ['One sentence. And an unfinished']);
    expect(sentences.map((s) => s.text)).toEqual(['One sentence.', 'And an unfinished']);
    expect(sentences.at(-1)?.isLast).toBe(true);
  });

  it('does not split decimals into separate sentences', () => {
    const { sentences } = collect(['Amy'], ['pi is 3.14. Next']);
    expect(sentences.map((s) => s.text).join(' ')).toBe('pi is 3.14. Next');
  });

  it('strips a matching "Name: " prefix and attributes the speaker', () => {
    const { sentences, speaker } = collect(['Amy'], ['Amy: Hello there. How are you?']);
    expect(speaker).toBe('Amy');
    expect(sentences[0].text).toBe('Hello there.');
  });

  it('strips the prefix even when it arrives across multiple deltas', () => {
    const { sentences, speaker } = collect(['Amy'], ['Am', 'y: Hello wor', 'ld.']);
    expect(speaker).toBe('Amy');
    expect(sentences.map((s) => s.text)).toEqual(['Hello world.']);
  });

  it('strips the prefix when preceded by leading whitespace or blank lines', () => {
    const { sentences, speaker } = collect(['Amy'], ['\n\nAmy: Hi there.\n\n']);
    expect(speaker).toBe('Amy');
    expect(sentences.map((s) => s.text)).toEqual(['Hi there.']);
  });

  it('does not strip a prefix that is not an active character', () => {
    const { sentences, speaker } = collect(['Amy'], ['Bob said: we should go.']);
    expect(speaker).toBeNull();
    expect(sentences[0].text).toBe('Bob said: we should go.');
  });

  it('leaves speaker null when no prefix and multiple characters are possible', () => {
    const { sentences, speaker } = collect(['Amy', 'Bob'], ['A shared reply with no name.']);
    expect(speaker).toBeNull();
    expect(sentences[0].text).toBe('A shared reply with no name.');
  });

  it('stops looking for a prefix after a long prefix-free buffer', () => {
    const long = `${'a'.repeat(201)} then Amy: arrives late.`;
    const { speaker, sentences } = collect(['Amy'], [long]);
    expect(speaker).toBeNull();
    expect(sentences.map((s) => s.text).join(' ')).toContain('Amy: arrives late.');
  });

  it('emits nothing for empty or whitespace-only input', () => {
    const { sentences } = collect(['Amy'], ['   ', '\n\n', '']);
    expect(sentences).toHaveLength(0);
  });
});