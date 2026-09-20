import { describe, expect, it } from 'vitest';
import { SentenceStream } from '../src/streaming.js';
import { OrderedAudio } from '../src/orderedAudio.js';
import type { AudioResult } from '../src/orderedAudio.js';

/**
 * Reproduces the streaming route's orchestration without HTTP or a live TTS:
 * stream deltas through SentenceStream; for each sentence register an audio
 * slot whose TTS completes after a random delay (mimicking OmniVoice latency
 * variability), then finish and drain. Asserts audio is emitted strictly in
 * sentence order and chips/paths line up with the right sentences.
 */
function runStream(deltas: string[], ttsDelayMs: number[]) {
  const eventLog: string[] = [];
  const chips: AudioResult[] = [];
  const audioQueue = new OrderedAudio();

  let i = 0;
  const stream = new SentenceStream({
    activeNames: ['Amy'],
    onSentence: (sentence) => {
      eventLog.push(`sentence:${sentence}`);
      const slot = audioQueue.submit();
      const delay = ttsDelayMs[i++] ?? 0;
      void delayed(delay).then(() => {
        audioQueue.finish(
          slot,
          { text: sentence, path: `/audio/${slot}.wav` },
          (index, result) => {
            eventLog.push(`audio:${result.path}`);
            chips[index] = result;
          },
        );
      });
    },
  });

  return {
    push: (d: string) => stream.push(d),
    finish: () => stream.finish(),
    waitIdle: () => audioQueue.waitIdle(),
    speaker: () => stream.speaker,
    get eventLog() {
      return eventLog;
    },
    get chips() {
      return chips.filter(Boolean);
    },
  };
}

function delayed(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('streamed reply with concurrent TTS', () => {
  it('emits audio in sentence order regardless of TTS completion order', async () => {
    const run = runStream(['Amy: First sentence.', ' Second one!', ' Last.'],
      [30, 0, 10]); // slot 1 finishes first, then slot 2, then slot 0
    run.push('Amy: First sentence.');
    run.push(' Second one!');
    run.push(' Last.');
    run.finish();
    await run.waitIdle();

    expect(run.speaker()).toBe('Amy');
    expect(run.eventLog.filter((e) => e.startsWith('sentence:'))).toEqual([
      'sentence:First sentence.',
      'sentence:Second one!',
      'sentence:Last.',
    ]);
    expect(run.eventLog.filter((e) => e.startsWith('audio:'))).toEqual([
      'audio:/audio/0.wav',
      'audio:/audio/1.wav',
      'audio:/audio/2.wav',
    ]);
    expect(run.chips.map((c) => c.text)).toEqual(['First sentence.', 'Second one!', 'Last.']);
  });

  it('keeps every slot emitted once even when TTS fails mid-stream', async () => {
    const queue = new OrderedAudio();
    const log: string[] = [];
    const good = queue.submit();
    const bad = queue.submit();
    const goodAgain = queue.submit();

    // slot 1 (bad) fails first with empty path
    queue.finish(bad, { text: 'B', path: '' }, (i, r) => log.push(`${i}:${r.path}`));
    queue.finish(goodAgain, { text: 'C', path: '/2.wav' }, (i, r) => log.push(`${i}:${r.path}`));
    queue.finish(good, { text: 'A', path: '/0.wav' }, (i, r) => log.push(`${i}:${r.path}`));

    expect(log).toEqual(['0:/0.wav', '1:', '2:/2.wav']);
    expect(queue.idle).toBe(true);
  });
});