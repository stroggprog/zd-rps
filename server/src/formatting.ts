/**
 * Streaming normalizer that enforces the speech/narration formatting contract
 * on raw LLM output, regardless of how closely the model complies:
 * - line breaks inside a double-quoted speech block collapse to single spaces
 * - a blank line (double EOL) is inserted between narration and speech, and
 *   between speech and narration
 * Narration's own line structure is otherwise preserved.
 *
 * Char-stream incremental: `push(delta)` returns only the newly emitted text,
 * so it can feed a SentenceStream directly. Every double quote encountered
 * toggles speech state based on the previously emitted character, mirroring
 * QuotationTracker's open/close rules.
 */

const SPEECH_QUOTES = new Set(['"', '\u201C', '\u201D']);
/** Word characters survive sentence boundaries; a quote after one must be a close. */
const WORD = /[\p{L}\p{N}]/u;
/** Punctuation that may directly precede a closing or stray dialogue quote. */
const SPEECH_END = new Set(['.', '!', '?', '\u2026', ',', ';', ':']);

export class SpeechFormatter {
  private result = '';
  private consumed = 0;
  private speechOpen = false;
  private pendingNewlines = 0;
  private justClosed = false;
  /** True when the current speech block opened at a line start (paragraph-level speech). */
  private blockAtLineStart = false;
  private lastProcessed = '';

  /** Full normalized text emitted so far (after any `finish()` flush). */
  get text(): string {
    return this.result;
  }

  /** Feed a streamed delta; returns the newly normalized text (empty unless something was emitted). */
  push(delta: string): string {
    for (const ch of delta) {
      if (ch === '\r') {
        if (this.lastProcessed === '\n') continue;
        this.lastProcessed = ch;
        this.newline();
        continue;
      }
      if (ch === '\n') {
        if (this.lastProcessed === '\r') continue;
        this.lastProcessed = ch;
        this.newline();
        continue;
      }
      this.lastProcessed = ch;
      if (SPEECH_QUOTES.has(ch)) {
        this.quote(ch);
        continue;
      }
      if (this.pendingNewlines > 0) {
        // A closed speech block always restores a blank line; otherwise emit
        // the paragraph breaks the model wrote (capped at 2).
        this.result += '\n'.repeat(this.justClosed ? Math.max(2, this.pendingNewlines) : Math.min(2, Math.max(1, this.pendingNewlines)));
        this.pendingNewlines = 0;
        this.justClosed = false;
      }
      this.result += ch;
    }
    const out = this.result.slice(this.consumed);
    this.consumed = this.result.length;
    return out;
  }

  /** Flush any trailing newlines and return the rest of the normalized text. */
  finish(): string {
    if (this.pendingNewlines > 0) {
      this.result += '\n'.repeat(this.justClosed ? Math.max(2, this.pendingNewlines) : Math.min(2, Math.max(1, this.pendingNewlines)));
      this.pendingNewlines = 0;
      this.justClosed = false;
    }
    const out = this.result.slice(this.consumed);
    this.consumed = this.result.length;
    return out;
  }

  private newline(): void {
    if (this.speechOpen) {
      if (!this.result.endsWith(' ')) this.result += ' ';
      return;
    }
    if (this.pendingNewlines < 2) this.pendingNewlines++;
  }

  private quote(ch: string): void {
    // Trim any collapsed space just before a closing quote (e.g. "at me. ").
    if (this.speechOpen) {
      let end = this.result.length - 1;
      while (end >= 0 && this.result[end] === ' ') end--;
      const prev = end >= 0 ? this.result[end] : ' ';
      if (WORD.test(prev) || SPEECH_END.has(prev)) {
        this.result = this.result.slice(0, end + 1);
        this.speechOpen = false;
        this.justClosed = this.blockAtLineStart;
        this.blockAtLineStart = false;
      }
      this.result += ch;
      return;
    }
    const prev = this.result[this.result.length - 1] ?? ' ';
    if (WORD.test(prev)) {
      // Stray/closing quote in prose (no matching open, e.g. a scare term);
      // keep it literally without opening a speech block.
      this.result += ch;
      return;
    }
    const lead =
      this.pendingNewlines > 0 || (this.result.length > 0 && this.result.endsWith('\n'));
    if (lead && this.pendingNewlines > 0) {
      // The first paragraph must not gain leading newlines; wait for content.
      this.result += '\n\n';
      this.pendingNewlines = 0;
    }
    this.speechOpen = true;
    this.blockAtLineStart = lead;
    this.result += ch;
  }
}