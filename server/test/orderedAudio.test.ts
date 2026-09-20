import { describe, expect, it } from 'vitest';
import { OrderedAudio } from '../src/orderedAudio.js';

function delayed<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe('OrderedAudio', () => {
  it('emits slots strictly in order even when they complete out of order', async () => {
    const queue = new OrderedAudio();
    const emitted: number[] = [];
    const emit = (i: number) => emitted.push(i);

    const a = queue.submit();
    const b = queue.submit();
    const c = queue.submit();

    queue.finish(c, { text: 'c', path: '/c' }, (i) => emit(i));
    expect(emitted).toEqual([]);
    queue.finish(a, { text: 'a', path: '/a' }, (i) => emit(i));
    expect(emitted).toEqual([0]);
    queue.finish(b, { text: 'b', path: '/b' }, (i) => emit(i));
    expect(emitted).toEqual([0, 1, 2]);
    expect(queue.idle).toBe(true);
  });

  it('emits each slot exactly once', () => {
    const queue = new OrderedAudio();
    let calls = 0;
    const s0 = queue.submit();
    const s1 = queue.submit();
    queue.finish(s0, { text: 'a', path: '/a' }, () => calls++);
    queue.finish(s1, { text: 'b', path: '/b' }, () => calls++);
    // finishing min... finishing already-done slots must not re-emit
    expect(calls).toBe(2);
    queue.finish(s0, { text: 'a', path: '/a' }, () => calls++);
    queue.finish(s1, { text: 'b', path: '/b' }, () => calls++);
    expect(calls).toBe(2);
  });

  it('resolves waitIdle only after every slot has completed', async () => {
    const queue = new OrderedAudio();
    let resolved = false;
    const s0 = queue.submit();
    const s1 = queue.submit();
    void queue.waitIdle().then(() => {
      resolved = true;
    });
    await delayed(20, null);
    expect(resolved).toBe(false);
    queue.finish(s0, { text: 'a', path: '/a' }, () => {});
    await delayed(20, null);
    expect(resolved).toBe(false);
    queue.finish(s1, { text: 'b', path: '/b' }, () => {});
    await delayed(20, null);
    expect(resolved).toBe(true);
  });

  it('resolves waitIdle immediately when nothing is pending', async () => {
    const queue = new OrderedAudio();
    expect(queue.idle).toBe(true);
    await expect(queue.waitIdle()).resolves.toBeUndefined();
  });
});