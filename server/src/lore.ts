import type { LoreEntry, Lorebook } from './types.js';

export interface Highlight {
  entry: LoreEntry;
  bookId: string;
  bookName: string;
}

export interface LoreScanResult {
  before: string[];
  after: string[];
}

/**
 * Scans chat text against the attached lorebooks and returns the matching
 * entry contents, ordered by (insertion_order, priority). Honors each book's
 * scan_depth (characters of the chat window searched) and token_budget
 * (approximate 4 chars/token cap on inserted content).
 */
export function scanLore(books: Lorebook[], chatText: string): LoreScanResult {
  const before: Highlight[] = [];
  const after: Highlight[] = [];

  for (const book of books) {
    const windowText = book.scan_depth > 0 ? chatText.slice(-book.scan_depth) : chatText;
    let budget = book.token_budget > 0 ? book.token_budget * 4 : Number.POSITIVE_INFINITY;
    const hits: Highlight[] = [];

    for (const entry of book.entries) {
      if (!entry.enabled) continue;
      if (entry.constant) {
        hits.push({ entry, bookId: book.id, bookName: book.name });
        continue;
      }
      if (keysHit(entry, windowText)) {
        hits.push({ entry, bookId: book.id, bookName: book.name });
      }
    }

    hits.sort(
      (a, b) =>
        a.entry.insertion_order - b.entry.insertion_order ||
        a.entry.priority - b.entry.priority,
    );

    for (const hit of hits) {
      const cost = hit.entry.content.length + 2;
      if (cost > budget) continue;
      budget -= cost;
      const target = hit.entry.position === 'after_char' ? after : before;
      target.push(hit);
    }
  }

  return { before: before.map((h) => h.entry.content), after: after.map((h) => h.entry.content) };
}

function keysHit(entry: LoreEntry, text: string): boolean {
  const primary = keysMatch(entry.keys, entry.case_sensitive, text);
  if (!primary) return false;
  if (!entry.selective) return true;
  return keysMatch(entry.secondary_keys, entry.case_sensitive, text);
}

function keysMatch(keys: string[], caseSensitive: boolean, text: string): boolean {
  if (keys.length === 0) return false;
  const haystack = caseSensitive ? text : text.toLowerCase();
  return keys.some((key) => {
    if (!key) return false;
    return haystack.includes(caseSensitive ? key : key.toLowerCase());
  });
}