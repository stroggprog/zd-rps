/**
 * Streaming sentence tokenization for LLM output.
 *
 * Strips the "Name: " speaker prefix when it matches an active character
 * (as the model is told to emit it), then splits content into sentences at
 * punctuation boundaries. Deterministic and pure, so it is unit-tested.
 */

/** Name followed by a colon at the very start of the buffer. */
const PREFIX = /^\s*([A-Za-z0-9 _.'-]{1,60}):/s;

/** First sentence boundary (`.`, `!`, `?`, `…`) followed by space or end-of-buffer. */
const SENT_SPLIT = /^.*?(?:[.?!…]{1,3})(?=\s|$)/s;

/** After this many buffered characters without a matching prefix, stop looking. */
const NO_PREFIX_CUTOFF = 200;

export interface SentenceStreamOptions {
  /** Names of the active characters; a leading "Name: " prefix is stripped when it matches one of these. */
  activeNames: string[];
  /** Called once per completed sentence (trimmed, prefix stripped). `isLast` is true only for the final flush. */
  onSentence: (sentence: string, isLast: boolean) => void;
}

export class SentenceStream {
  private buffer = '';
  private stripped = false;
  private detectedSpeaker: string | null = null;
  private pending: string | null = null;
  private readonly names: string[];
  private readonly onSentence: (sentence: string, isLast: boolean) => void;

  constructor(options: SentenceStreamOptions) {
    this.names = options.activeNames.map((n) => n.toLowerCase());
    this.onSentence = options.onSentence;
  }

  /** The speaker attributed via the stripped prefix, if any. */
  get speaker(): string | null {
    return this.detectedSpeaker;
  }

  /** Feed a streamed delta from the LLM. May emit zero or more sentences. */
  push(delta: string): void {
    this.buffer += delta;
    this.tryStripPrefix();
    for (;;) {
      const m = SENT_SPLIT.exec(this.buffer);
      if (!m) break;
      const chunk = m[0];
      this.buffer = this.buffer.slice(chunk.length);
      const trimmed = chunk.trim();
      if (trimmed) this.defer(trimmed);
    }
  }

  /**
   * Flush the stream. The final sentence is always delivered with `isLast`.
   * Safe to call once, at stream end.
   */
  finish(): void {
    const rest = this.buffer.trim();
    this.buffer = '';
    if (rest) {
      this.flushPending();
      this.onSentence(rest, true);
    } else {
      this.flushPending(true);
    }
  }

  /** Sentences are deferred by one so the true final one can be flagged. */
  private defer(sentence: string): void {
    this.flushPending();
    this.pending = sentence;
  }

  private flushPending(forceLast = false): void {
    if (this.pending == null) return;
    this.onSentence(this.pending, forceLast);
    this.pending = null;
  }

  private tryStripPrefix(): void {
    if (this.stripped) return;
    const m = PREFIX.exec(this.buffer);
    if (m && this.names.includes(m[1].trim().toLowerCase())) {
      this.detectedSpeaker = m[1].trim();
      this.buffer = this.buffer.slice(m[0].length);
      this.stripped = true;
    } else if (this.buffer.length > NO_PREFIX_CUTOFF) {
      this.stripped = true;
    }
  }
}