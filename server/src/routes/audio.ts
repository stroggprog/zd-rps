import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import type { AppContext } from '../context.js';
import { DIR } from '../paths.js';
import { getConfig } from '../config.js';
import { getSttProvider, getTtsProvider } from '../providers/factory.js';
import { synthesizeCharacterSpeech, audioExt } from '../ttsService.js';
import { ApiError, asString, ensureDir, now, uuid } from '../util.js';
import { asyncHandler, readJsonBody } from './helpers.js';

function connectionOf(id: string | undefined, kind: 'stt' | 'tts') {
  const config = getConfig();
  const conn = id
    ? config.connections.find((c) => c.id === id && c.kind === kind)
    : config.connections.find((c) => c.id === config[kind === 'stt' ? 'defaultStt' : 'defaultTts']);
  if (!conn) throw new ApiError(`No ${kind.toUpperCase()} connection selected`, 400);
  return conn;
}

export function audioRouter(ctx: AppContext): Router {
  const router = Router();

  router.post(
    '/stt',
    asyncHandler(async (req, res) => {
      const file = (req.files as Express.Multer.File[] | undefined)?.[0] ?? (req.file as Express.Multer.File | undefined);
      if (!file) throw new ApiError('Expected an audio file field', 400);
      const conn = connectionOf(
        req.body && req.body.connectionId ? asString(req.body.connectionId) : undefined,
        'stt',
      );
      const text = await getSttProvider(conn).transcribe(conn, file.buffer, file.mimetype || 'audio/webm');
      res.json({ text });
    }),
  );

  router.post(
    '/tts',
    asyncHandler(async (req, res) => {
      const body = readJsonBody<{ text?: string; connectionId?: string; characterId?: string }>(req);
      const text = asString(body.text).trim();
      if (!text) throw new ApiError('Text is empty', 400);
      const conn = connectionOf(body.connectionId, 'tts');

      if (body.characterId) {
        const character = ctx.store.characters.get(body.characterId);
        if (!character) throw new ApiError('Character not found', 404);
        const audio = await synthesizeCharacterSpeech(conn, character, text, ctx.voiceCache);
        await ensureDir(DIR.audio);
        const filename = `${uuid()}.${audioExt(audio)}`;
        await fs.writeFile(path.join(DIR.audio, filename), audio);
        res.json({ audioPath: `/media/audio/${filename}` });
        return;
      }

      const provider = getTtsProvider(conn);
      const voiceId = conn.modelOrVoice;
      if (!voiceId && !provider.info.capabilities.supportsVoiceCloning) {
        throw new ApiError('Select a voice for this TTS connection first', 400);
      }
      const audio = await provider.synthesize(conn, text, { voiceId, referenceAudio: undefined, referenceText: undefined });
      await ensureDir(DIR.audio);
      const filename = `${now()}${Math.random()}.${audioExt(audio)}`;
      await fs.writeFile(path.join(DIR.audio, filename), audio);
      res.json({ audioPath: `/media/audio/${filename}` });
    }),
  );

  return router;
}