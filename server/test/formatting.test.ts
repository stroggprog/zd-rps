import { describe, expect, it } from 'vitest';
import { SpeechFormatter } from '../src/formatting.js';

function format(deltas: string[]): string {
  const f = new SpeechFormatter();
  for (const d of deltas) f.push(d);
  f.finish();
  return f.text;
}

describe('SpeechFormatter', () => {
  it('collapses EOLs inside speech and inserts blank lines around it', () => {
    const input = [
      "*Amy lets out a delighted laugh.*",
      '"Are you okay?\nI am fine.\nYes."',
      '*She winks.',
    ].join('\n');
    expect(format([input])).toBe(
      "*Amy lets out a delighted laugh.*\n\n" +
        '"Are you okay? I am fine. Yes."\n\n' +
        '*She winks.',
    );
  });

  it('preserves single-EOL structure inside narration paragraphs', () => {
    const input = '*She winks.\nShe seems to feed off your curiosity.*\nThen she smiles.';
    expect(format([input])).toBe(input);
  });

  it('leaves pure narration untouched', () => {
    const input = 'The night was quiet.\nShe pulled the door closed.';
    expect(format([input])).toBe(input);
  });

  it('collapses a blank line inside speech to a single space', () => {
    const input = '"Wait.\n\nThat is strange."';
    expect(format([input])).toBe('"Wait. That is strange."');
  });

  it('trims a collapsed space before the closing quote', () => {
    expect(format(['"At me. \n\n"'])).toBe('"At me."');
  });

  it('is incremental: deltas concatenate to the same result', () => {
    const f = new SpeechFormatter();
    const one = f.push('*Step.*\n"Say');
    const two = f.push(' too');
    const three = f.push('.\nFine."\n*Step two.');
    const rest = f.finish();
    expect(one + two + three + rest).toBe("*Step.*\n\n\"Say too. Fine.\"\n\n*Step two.");
  });

  it('does not split a stray closing quote in prose into speech', () => {
    const f = new SpeechFormatter();
    expect(f.push('He called it "a trap" and left.\nShe agreed.')).toContain('"a trap"');
    f.finish();
    expect(f.text).toBe('He called it "a trap" and left.\nShe agreed.');
  });

  it('keeps untouched the opening quote that follows a word (close-without-open)', () => {
    const f = new SpeechFormatter();
    expect(f.push('word" then more')).toBe('word" then more');
  });
});