import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { Router } from 'express';
import type { AppContext } from '../context.js';
import type { Narrator } from '../types.js';
import { parseZdnFile } from '../cards.js';
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
        // Transcript is editable without re-uploading the sample.
        voiceSampleTranscript:
          body.voiceSampleTranscript !== undefined ? asString(body.voiceSampleTranscript) || null : undefined,
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

  // zdn export: a zip bundling narrator.json (our own metadata format), the
  // avatar image, the voice sample WAV and its transcript text file.
  router.get(
    '/:id/export-zdn',
    asyncHandler(async (req, res) => {
      const narrator = narrators.getOrThrow(idParam(req));
      const dir = path.join(DIR.narrators, narrator.id);
      const entries = await fs.readdir(dir).catch(() => []);
      const avatarFile = entries.find((entry) => entry.startsWith('avatar.'));
      if (!avatarFile) {
        throw new ApiError('Cannot export: narrator has no avatar image.', 400);
      }

      const staging = path.join(dir, 'zdnexport');
      await ensureDir(staging);
      for (const entry of await fs.readdir(staging).catch(() => [])) {
        await fs.rm(path.join(staging, entry), { recursive: true, force: true });
      }
      await fs.writeFile(
        path.join(staging, 'narrator.json'),
        JSON.stringify({ name: narrator.name }),
        'utf8',
      );
      await fs.copyFile(path.join(dir, avatarFile), path.join(staging, avatarFile));
      const files = ['narrator.json', avatarFile];
      let hasVoice = false;
      try {
        await fs.copyFile(path.join(dir, 'voice-sample.wav'), path.join(staging, 'voice-sample.wav'));
        files.push('voice-sample.wav', 'transcript.txt');
        await fs.writeFile(path.join(staging, 'transcript.txt'), narrator.voiceSampleTranscript ?? '', 'utf8');
        hasVoice = true;
      } catch {
        // no voice sample — the zip simply contains metadata + avatar
      }
      const zipName = `${(narrator.name || 'narrator').replace(/[^\w.-]+/g, '_') || 'narrator'}.zdn`;
      await new Promise<void>((resolve) => {
        execFile('zip', ['-j', path.join(staging, zipName), ...files], { cwd: staging, timeout: 60_000 }, (err) => {
          if (err) console.error('[zdnexport] zip failed:', (err as Error).message);
          resolve();
        });
      });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
      res.send(await fs.readFile(path.join(staging, zipName)));
      void hasVoice;
    }),
  );

  // zdn import: a single-step restore. Creates the narrator and copies the
  // bundled avatar/voice sample/transcript next to it.
  router.post(
    '/import',
    asyncHandler(async (req, res) => {
      const file = (req.files as Express.Multer.File[] | undefined)?.[0] ?? (req.file as Express.Multer.File | undefined);
      if (!file) throw new ApiError('Expected a .zdn file field', 400);
      const zd = await parseZdnFile(file.buffer);
      const narrator = narrators.create({
        name: zd.meta.name,
        avatarPath: null,
        voiceSamplePath: null,
        voiceSampleTranscript: null,
      });
      if (zd.avatarBuffer) {
        await writeFile(narrator.id, zd.avatarName!, zd.avatarBuffer);
        narrators.update(narrator.id, {
          avatarPath: `/media/narrators/${narrator.id}/${zd.avatarName}`,
        });
      }
      if (zd.voiceSample) {
        await writeFile(narrator.id, 'voice-sample.wav', zd.voiceSample);
        ctx.voiceCache.invalidate(narrator.id);
        narrators.update(narrator.id, {
          voiceSamplePath: `/media/narrators/${narrator.id}/voice-sample.wav`,
          voiceSampleTranscript: zd.transcript,
        });
      }
      res.status(201).json(narrators.getOrThrow(narrator.id));
    }),
  );

  return router;
}