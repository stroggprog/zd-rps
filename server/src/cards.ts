import type { Lorebook, LoreEntry } from './types.js';
import { ApiError, asBoolean, asNumber, asString, isObject, uuid } from './util.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CARA_KEYWORD = 'chara';

export interface ParsedCard {
  kind: 'png' | 'json';
  card: Record<string, unknown>;
  /** PNG file bytes when imported from an image, used as the avatar. */
  imageBuffer: Buffer | null;
}

export interface ImportResult {
  character: {
    name: string;
    description: string;
    personality: string;
    system_prompt: string;
    post_history_instructions: string;
    mes_example: string;
    tags: string[];
  };
  avatarBuffer: Buffer | null;
  lorebook: Lorebook | null;
  scenario: {
    name: string;
    description: string;
    first_mes: string;
    scenario: string;
    alternate_greetings: string[];
  } | null;
}

const CRC_TABLE = ((): Int32Array => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface Chunk {
  type: string;
  data: Buffer;
}

export function readPngChunks(buffer: Buffer): Chunk[] {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new ApiError('Not a PNG file', 400);
  }
  const chunks: Chunk[] = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('latin1');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

function encodeChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  const crc = crc32(Buffer.concat([Buffer.from(type, 'latin1'), data]));
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

/** Reads every tEXt chunk, decoding the latin-1 value. */
export function readPngText(buffer: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  for (const chunk of readPngChunks(buffer)) {
    if (chunk.type !== 'tEXt') continue;
    const nul = chunk.data.indexOf(0);
    if (nul < 0) continue;
    const key = chunk.data.subarray(0, nul).toString('latin1');
    const value = chunk.data.subarray(nul + 1).toString('latin1');
    out[key] = value;
  }
  return out;
}

/** Returns a new PNG buffer with a given tEXt chunk set (replacing any existing). */
export function writePngText(buffer: Buffer, keyword: string, text: string): Buffer {
  const marker = Buffer.from(keyword, 'latin1');
  const data = Buffer.concat([marker, Buffer.from([0]), Buffer.from(text, 'latin1')]);
  const existing = `${keyword}\0`;
  const chunks = readPngChunks(buffer).filter(
    (c) => c.type !== 'tEXt' || c.data.subarray(0, existing.length).toString('latin1') !== existing,
  );

  const kept: Chunk[] = [];
  let injected = false;
  for (const chunk of chunks) {
    if (!injected && chunk.type === 'IDAT') {
      kept.push({ type: 'tEXt', data });
      injected = true;
    }
    kept.push(chunk);
  }
  if (!injected) {
    const iend = kept.findIndex((c) => c.type === 'IEND');
    const textChunk = { type: 'tEXt', data };
    if (iend >= 0) kept.splice(iend, 0, textChunk);
    else kept.push(textChunk);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    ...kept.map((c) => encodeChunk(c.type, c.data)),
  ]);
}

export function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
}

export function parseCard(buffer: Buffer): ParsedCard {
  if (isPng(buffer)) {
    const text = readPngText(buffer);
    const raw = text[CARA_KEYWORD];
    if (!raw) {
      throw new ApiError('PNG contains no "chara" tEXt chunk; not a SillyTavern card', 400);
    }
    let json: unknown;
    try {
      json = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch {
      throw new ApiError('Could not decode "chara" payload (expected base64-encoded JSON)', 400);
    }
    if (!isObject(json)) throw new ApiError('Card JSON is not an object', 400);
    return { kind: 'png', card: json, imageBuffer: buffer };
  }

  let json: unknown;
  try {
    json = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new ApiError('Unsupported card file: expected a PNG or JSON', 400);
  }
  if (!isObject(json)) throw new ApiError('Card JSON is not an object', 400);
  return { kind: 'json', card: json, imageBuffer: null };
}

export function dataUrlBuffer(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  return { buffer: Buffer.from(match[2], 'base64'), mime: match[1] };
}

export function buildImportResult(parsed: ParsedCard): ImportResult {
  const card = parsed.card;
  const name = asString(card.name, 'Unnamed');

  const avatarBuffer =
    parsed.imageBuffer ??
    (typeof card.avatar === 'string' ? dataUrlBuffer(card.avatar)?.buffer ?? null : null);

  const lorebook = normalizeLorebook(card.character_book, name);
  const scenario = normalizeScenario(
    {
      scenario: card.scenario,
      first_mes: card.first_mes,
      alternate_greetings: card.alternate_greetings,
    },
    name,
  );

  return {
    character: {
      name,
      description: asString(card.description),
      personality: asString(card.personality),
      system_prompt: asString(card.system_prompt),
      post_history_instructions: asString(card.post_history_instructions),
      mes_example: asString(card.mes_example),
      tags: Array.isArray(card.tags) ? card.tags.map((t) => asString(t)).filter(Boolean) : [],
    },
    avatarBuffer,
    lorebook,
    scenario,
  };
}

export function normalizeScenario(
  raw: { scenario?: unknown; first_mes?: unknown; alternate_greetings?: unknown },
  charName: string,
): ImportResult['scenario'] {
  const firstMes = asString(raw.first_mes);
  const scenarioText = asString(raw.scenario);
  const alts = Array.isArray(raw.alternate_greetings)
    ? raw.alternate_greetings.map((a) => asString(a)).filter(Boolean)
    : [];
  if (!firstMes && !scenarioText && alts.length === 0) return null;
  return {
    name: `${charName} - greeting`,
    description: `Opening scenario extracted from the "${charName}" character card.`,
    first_mes: firstMes,
    scenario: scenarioText,
    alternate_greetings: alts,
  };
}

export function normalizeLorebook(raw: unknown, charName: string): Lorebook | null {
  if (!isObject(raw)) return null;
  const entries = Array.isArray(raw.entries) ? raw.entries : [];
  const normalized: LoreEntry[] = entries
    .filter(isObject)
    .map((e) => ({
      id: uuid(),
      keys: Array.isArray(e.keys) ? e.keys.map((k) => asString(k)).filter(Boolean) : [],
      content: asString(e.content),
      name: asString(e.name, ''),
      enabled: asBoolean(e.enabled, true),
      insertion_order: asNumber(e.insertion_order, 0),
      case_sensitive: asBoolean(e.case_sensitive, false),
      priority: asNumber(e.priority, 100),
      selective: asBoolean(e.selective, false),
      secondary_keys: Array.isArray(e.secondary_keys)
        ? e.secondary_keys.map((k) => asString(k)).filter(Boolean)
        : [],
      constant: asBoolean(e.constant, false),
      comment: asString(e.comment, ''),
      position: e.position === 'after_char' ? 'after_char' : 'before_char',
    }));
  const bookName = asString(raw.name, `${charName}'s lorebook`);
  const description = asString(raw.description, '');
  return {
    id: uuid(),
    name: bookName,
    description,
    scan_depth: asNumber(raw.scan_depth, 1000),
    token_budget: asNumber(raw.token_budget, 500),
    recursive_scanning: asBoolean(raw.recursive_scanning, false),
    extensions: isObject(raw.extensions) ? raw.extensions : {},
    entries: normalized,
    created: '',
    updated: '',
  };
}

/** Rebuilds a spec v2 card object from character + scenario refs for export. */
export function buildCardObject(args: {
  name: string;
  description: string;
  personality: string;
  system_prompt: string;
  post_history_instructions: string;
  mes_example: string;
  tags: string[];
  first_mes?: string;
  scenario?: string;
  alternate_greetings?: string[];
  avatarDataUrl?: string;
}): Record<string, unknown> {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    name: args.name,
    description: args.description,
    personality: args.personality,
    system_prompt: args.system_prompt,
    post_history_instructions: args.post_history_instructions,
    mes_example: args.mes_example,
    tags: args.tags ?? [],
    scenario: args.scenario ?? '',
    first_mes: args.first_mes ?? '',
    alternate_greetings: args.alternate_greetings ?? [],
    avatar: args.avatarDataUrl ?? '',
    creator_notes: 'Exported from zd-rps',
    extensions: {},
  };
}