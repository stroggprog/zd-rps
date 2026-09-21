/**
 * Tracks speech across a streamed reply to decide whether each sentence is
 * dialogue (speech) or narration.
 *
 * The LLM is given a formatting contract: speech is written in double quotes
 * (") in its own paragraph, single quotes are used only for quotations or
 * borrowed terms, emphasis is _underscores_, bold is **asterisks**. So only
 * double quotes toggle speech state; single quotes and everything else are
 * inert (apostrophes never matter).
 *
 * Rules:
 * - A sentence whose text BEGINS with a double quote opens a speech block.
 *   The block spans paragraph/line breaks until its closing quote arrives,
 *   so a multi-line quoted monologue is voiced as one speaker. Quotes
 *   encountered inside an open block are treated as emphasis and ignored,
 *   so they never end the block early.
 * - A genuine double quote appearing mid-sentence outside a block is an
 *   inline dialogue marker (`She said, "No."`).
 * - Sentence boundaries and quotation detection are context-aware: an
 *   opening quote follows a non-word char, a closing quote is followed by a
 *   non-word char (or preceded by speech punctuation like a comma).
 */

const DOUBLE = new Set(['"', '\u201C', '\u201D']);
/** Punctuation that may directly precede a closing dialogue quote. */
const CLOSE_BEFORE = new Set([',', ';', ':', '.', '!', '?', '\u2026', '\u2014', '\u2013']);
const WORD = /[\p{L}\p{N}]/u;

/** Classifies a double-quote char as open/close, or not a quote at all. */
function quoteKind(text: string, i: number): 'open' | 'close' | null {
  const prev = i > 0 ? text[i - 1] : ' ';
  const next = i < text.length - 1 ? text[i + 1] : ' ';
  const prevWord = WORD.test(prev);
  const nextWord = WORD.test(next);
  if (!prevWord && nextWord) return 'open';
  if (!nextWord && (prevWord || CLOSE_BEFORE.has(prev))) return 'close';
  return null;
}

export class QuotationTracker {
  /** Open quote block spanning from a sentence-initial quote until its close. */
  private block = false;

  /** Speech opened by an inline mid-sentence quote that has not yet closed. */
  private inline = false;

  /**
   * Classifies a sentence as speech or narration and advances the internal
   * quote state. Call once per sentence, in stream order.
   */
  isSpeech(sentence: string): boolean {
    const trimmed = sentence.trimStart();
    const leadOpens = DOUBLE.has(trimmed[0]) && trimmed.length > 1 && WORD.test(trimmed[1]);

    let speech = this.block || this.inline;
    if (leadOpens) {
      this.block = true;
      speech = true;
    }

    for (let i = 0; i < trimmed.length; i++) {
      if (!DOUBLE.has(trimmed[i])) continue;
      if (this.block) {
        if (quoteKind(trimmed, i) === 'close') this.block = false;
        continue;
      }
      const kind = quoteKind(trimmed, i);
      if (kind === 'open') {
        this.inline = true;
        speech = true;
      } else if (kind === 'close') {
        this.inline = false;
        speech = true;
      }
    }
    return speech;
  }
}