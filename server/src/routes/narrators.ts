import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import type { AppContext } from '../context.js';
import type { Narrator } from '../types.js';
import { DIR } from '../paths.js';
import { ApiError, asString, ensureDir } from '../util.js';
import { asyncHandler, idParam, readJsonBody } from './helpers.js';

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

async function writeFile(id: string, filename: string, buffer: Buffer): Promise<void> {
  const dir = path.join(DIR.narrators, id);
  await ensureDir(dir);
  await fs.writeFile(path.join(dir, filename), buffer);
}

export function narratorsRouter(ctx: AppContext): Router {
  const router = Router();
  const { narrators } = ctx.store;

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(narrators.list());
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(narrators.getOrThrow(idParam(req)));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = readJsonBody<Partial<Narrator>>(req);
      const narrator = narrators.create({
        name: asString(body.name, 'Unnamed narrator'),
        avatarPath: null,
        voiceSamplePath: null,
        voiceSampleTranscript: null,
      });
      res.status(201).json(narrator);
    }),
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      narrators.getOrThrow(idParam(req));
      const body = readJsonBody<Partial<Narrator>>(req);
      const updated = narrators.update(idParam(req), {
        name: body.name !== undefined ? asString(body.name) : undefined,
      });
      res.json(updated);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      await fs.rm(path.join(DIR.narrators, id), { recursive: true, force: true });
      narrators.delete(id);
      res.status(204).end();
    }),
  );

  router.post(
    '/:id/avatar',
    asyncHandler(async (req, res) => {
      const narrator = narrators.getOrThrow(idParam(req));
      const file = (req.files as Express.Multer.File[] | undefined)?.[0] ?? (req.file as Express.Multer.File | undefined);
      if (!file) throw new ApiError('Expected an avatar file field', 400);
      const ext = MIME_EXT[file.mimetype.toLowerCase()] ?? 'png';
      const dir = path.join(DIR.narrators, narrator.id);
      await ensureDir(dir);
      const entries = await fs.readdir(dir).catch(() => []);
      for (const entry of entries) {
        if (entry.startsWith('avatar.')) await fs.rm(path.join(dir, entry), { force: true });
      }
      await writeFile(narrator.id, `avatar.${ext}`, file.buffer);
      res.json(
        narrators.update(narrator.id, { avatarPath: `/media/narrators/${narrator.id}/avatar.${ext}` }),
      );
    }),
  );

  router.delete(
    '/:id/avatar',
    asyncHandler(async (req, res) => {
      const narrator = narrators.getOrThrow(idParam(req));
      const dir = path.join(DIR.narrators, narrator.id);
      const entries = await fs.readdir(dir).catch(() => []);
      for (const entry of entries) {
        if (entry.startsWith('avatar.')) {
          await fs.rm(path.join(dir, entry), { force: true });
        }
      }
      res.json(narrators.update(narrator.id, { avatarPath: null }));
    }),
  );

  router.post(
    '/:id/voice',
    asyncHandler(async (req, res) => {
      const narrator = narrators.getOrThrow(idParam(req));
      const file = (req.files as Express.Multer.File[] | undefined)?.[0] ?? (req.file as Express.Multer.File | undefined);
      if (!file) throw new ApiError('Expected a voice sample file field', 400);
      await writeFile(narrator.id, 'voice-sample.wav', file.buffer);
      ctx.voiceCache.invalidate(narrator.id);
      const transcript = req.body && typeof req.body.transcript === 'string' ? req.body.transcript : '';
      res.json(
        narrators.update(narrator.id, {
          voiceSamplePath: `/media/narrators/${narrator.id}/voice-sample.wav`,
          voiceSampleTranscript: transcript || null,
        }),
      );
    }),
  );

  router.delete(
    '/:id/voice',
    asyncHandler(async (req, res) => {
      const narrator = narrators.getOrThrow(idParam(req));
      await fs.rm(path.join(DIR.narrators, narrator.id, 'voice-sample.wav'), { force: true });
      ctx.voiceCache.invalidate(narrator.id);
      res.json(
        narrators.update(narrator.id, { voiceSamplePath: null, voiceSampleTranscript: null }),
      );
    }),
  );

  return router;
}