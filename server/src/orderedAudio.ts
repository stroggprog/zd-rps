/**
 * Ordered audio emission for streamed replies.
 *
 * Sentences are spoken one at a time: TTS for several sentences may be
 * synthesizing concurrently, but chips must be emitted (and played) in
 * sentence order. `OrderedAudio` tracks per-sentence slots, holds results
 * until it is the slot's turn, and resolves once every slot has finished.
 */

export interface AudioResult {
  text: string;
  path: string;
}

export class OrderedAudio {
  private slots: (AudioResult | null | undefined)[] = [];
  private next = 0;
  private pending = 0;
  private waiters: (() => void)[] = [];

  /**
   * Whether every submitted slot has completed. Once true, the route can send
   * the `done` event; `emit` has already fired for every slot.
   */
  get idle(): boolean {
    return this.pending === 0;
  }

  /** Register a slot for a sentence. Call `finish` with the returned index. */
  submit(): number {
    const index = this.slots.length;
    this.slots.push(undefined);
    this.pending += 1;
    return index;
  }

  /**
   * Record a result for a slot and emit anything now in-order. `emit` receives
   * (index, result); it is called exactly once per slot, strictly by index,
   * and only after that slot's result exists.
   */
  finish(index: number, result: AudioResult, emit: (index: number, result: AudioResult) => void): void {
    this.slots[index] = result;
    this.pending -= 1;
    this.drain(emit);
    if (this.pending === 0) {
      const waiters = this.waiters;
      this.waiters = [];
      for (const w of waiters) w();
    }
  }

  /** Resolves when every submitted slot has completed (i.e. `idle`). */
  waitIdle(): Promise<void> {
    if (this.pending === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private drain(emit: (index: number, result: AudioResult) => void): void {
    while (this.slots[this.next] !== undefined) {
      const result = this.slots[this.next];
      this.slots[this.next] = null;
      this.next += 1;
      emit(this.next - 1, result as AudioResult);
    }
  }
}