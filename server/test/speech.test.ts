import { describe, expect, it } from 'vitest';
import { QuotationTracker } from '../src/speech.js';

describe('QuotationTracker', () => {
  it('tags plain narration as narration', () => {
    const t = new QuotationTracker();
    expect(t.isSpeech('The night was quiet.')).toBe(false);
    expect(t.isSpeech('She pulled the door closed')).toBe(false);
  });

  it('ignores single-quoted quotations and apostrophes', () => {
    const t = new QuotationTracker();
    expect(t.isSpeech("She called it 'the old way.'")).toBe(false);
    expect(t.isSpeech("She's ready, the glint doesn't vanish.")).toBe(false);
  });

  it('tags a sentence opening with double-quoted speech as speech', () => {
    const t = new QuotationTracker();
    expect(t.isSpeech('"Hello," she said.')).toBe(true);
  });

  it('tags a sentence containing an inline quoted passage as speech', () => {
    const t = new QuotationTracker();
    expect(t.isSpeech('She said, "No."')).toBe(true);
  });

  it('keeps a multi-line quote tagged as speech across sentences', () => {
    const t = new QuotationTracker();
    expect(t.isSpeech('"It feels strange.')).toBe(true);
    expect(t.isSpeech('Almost too quiet.')).toBe(true);
    expect(t.isSpeech('But we should go."')).toBe(true);
    expect(t.isSpeech('She shivered.')).toBe(false);
  });

  it('treats the tail of speech ending before narration as speech', () => {
    const t = new QuotationTracker();
    expect(t.isSpeech('"Spoken like a true leader.')).toBe(true);
    expect(t.isSpeech('Take charge, she says, her voice dropping."')).toBe(true);
    expect(t.isSpeech('The transition is seamless.')).toBe(false);
  });

  it('returns to narration after the closing quote', () => {
    const t = new QuotationTracker();
    expect(t.isSpeech('"What now?"')).toBe(true);
    expect(t.isSpeech('He looked around the empty room.')).toBe(false);
  });

  it('keeps a double-quoted multi-line monologue as speech throughout', () => {
    const t = new QuotationTracker();
    expect(t.isSpeech('"A sample weather report?')).toBe(true);
    expect(t.isSpeech('Say no more.')).toBe(true);
    expect(t.isSpeech("Since you gave me creative liberty, I won't just give you a boring 'sunny with a chance of rain' update.")).toBe(true);
    expect(t.isSpeech("I'll give you something with a bit more...")).toBe(true);
    expect(t.isSpeech('atmosphere.')).toBe(true);
    expect(t.isSpeech("Let's set the scene in a neo-noir coastal city.")).toBe(true);
    expect(t.isSpeech('I will step into the role of a Senior Analyst."')).toBe(true);
    expect(t.isSpeech('The scene was set.')).toBe(false);
  });

  it('handles curly double quotes the same as straight ones', () => {
    const t = new QuotationTracker();
    expect(t.isSpeech('\u201CWell then,\u201D she mused.')).toBe(true);
    expect(t.isSpeech('\u201CWhat now?\u201D')).toBe(true);
    expect(t.isSpeech('The silence returned.')).toBe(false);
  });
});