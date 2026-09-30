import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Connection, VoiceSubject } from './types.js';
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

async function readSample(subject: VoiceSubject): Promise<Buffer> {
  const file = fileForMediaUrl(subject.voiceSamplePath);
  if (!file) throw new ApiError(`"${subject.name}" has no voice sample`, 400);
  try {
    return await readFile(file);
  } catch {
    throw new ApiError(`Voice sample for "${subject.name}" is missing on disk`, 500);
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
  subject: VoiceSubject,
  text: string,
  voiceCache: VoiceCache,
): Promise<Buffer> {
  const provider = getTtsProvider(conn);
  let voiceId = conn.modelOrVoice;
  let referenceAudio: Buffer | undefined;
  let referenceText: string | undefined;

  if (subject.voiceSamplePath) {
    const sample = await readSample(subject);
    if (provider.cloneVoice) {
      const cached = voiceCache.get(conn.id, subject.id);
      if (cached && cached.provider === conn.provider) {
        voiceId = cached.voiceId;
      } else {
        voiceId = await provider.cloneVoice(
          conn,
          sample,
          subject.name,
          subject.voiceSampleTranscript ?? undefined,
          subject.id,
        );
        voiceCache.set(conn.id, subject.id, { voiceId, provider: conn.provider });
      }
    } else {
      referenceAudio = sample;
      referenceText = subject.voiceSampleTranscript ?? undefined;
    }
  }

  return provider.synthesize(conn, text, {
    voiceId,
    referenceAudio,
    referenceText,
  });
}