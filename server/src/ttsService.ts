import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Character, Connection } from './types.js';
import { DATA_DIR } from './paths.js';
import { getTtsProvider } from './providers/factory.js';
import type { VoiceCache } from './voices.js';
import { ApiError } from './util.js';

/** Resolves an app media URL (/media/...) to an on-disk path under DATA_DIR. */
export function fileForMediaUrl(url: string | null): string | null {
  if (!url) return null;
  const stripped = url.replace(/^\/media\//, '');
  const resolved = path.resolve(DATA_DIR, stripped);
  if (!resolved.startsWith(DATA_DIR)) return null;
  return resolved;
}

async function readSample(char: Character): Promise<Buffer> {
  const file = fileForMediaUrl(char.voiceSamplePath);
  if (!file) throw new ApiError(`Character "${char.name}" has no voice sample`, 400);
  try {
    return await readFile(file);
  } catch {
    throw new ApiError(`Voice sample for "${char.name}" is missing on disk`, 500);
  }
}

/**
 * Resolves the voice id for a character on a TTS connection. If the character
 * has a voice sample and the provider can clone, it clones once and caches the
 * result per (connection, character). Per-request cloning providers (dots.tts)
 * get the sample passed through as reference audio instead.
 */
export function audioExt(buffer: Buffer): string {
  return buffer.length > 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' ? 'wav' : 'mp3';
}

export async function synthesizeCharacterSpeech(
  conn: Connection,
  char: Character,
  text: string,
  voiceCache: VoiceCache,
): Promise<Buffer> {
  const provider = getTtsProvider(conn);
  let voiceId = conn.modelOrVoice;
  let referenceAudio: Buffer | undefined;
  let referenceText: string | undefined;

  if (char.voiceSamplePath) {
    const sample = await readSample(char);
    if (provider.cloneVoice) {
      const cached = voiceCache.get(conn.id, char.id);
      if (cached && cached.provider === conn.provider) {
        voiceId = cached.voiceId;
      } else {
        voiceId = await provider.cloneVoice(
          conn,
          sample,
          char.name,
          char.voiceSampleTranscript ?? undefined,
        );
        voiceCache.set(conn.id, char.id, { voiceId, provider: conn.provider });
      }
    } else {
      referenceAudio = sample;
      referenceText = char.voiceSampleTranscript ?? undefined;
    }
  }

  return provider.synthesize(conn, text, {
    voiceId,
    referenceAudio,
    referenceText,
  });
}