import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { Router, type Request } from 'express';
import type { AppContext } from '../context.js';
import type { Persona, PersonaGender } from '../types.js';
import { parseZdpFile } from '../cards.js';
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

const GENDERS: PersonaGender[] = ['male', 'female', 'other'];

function parseGender(raw: unknown, fallback: PersonaGender): PersonaGender {
  return GENDERS.includes(raw as PersonaGender) ? (raw as PersonaGender) : fallback;
}

function firstFile(req: Request): Express.Multer.File | undefined {
  return (req.files as Express.Multer.File[] | undefined)?.[0] ?? (req.file as Express.Multer.File | undefined);
}

export function personasRouter(ctx: AppContext): Router {
  const router = Router();
  const { personas } = ctx.store;

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(personas.list());
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(personas.getOrThrow(idParam(req)));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = readJsonBody<Partial<Persona>>(req);
      const persona = personas.create({
        name: asString(body.name, 'Unnamed persona'),
        avatarPath: null,
        description: typeof body.description === 'string' ? body.description : '',
        gender: parseGender(body.gender, 'male'),
        voiceSamplePath: null,
        voiceSampleTranscript: null,
        thoughtSamplePath: null,
        thoughtSampleTranscript: null,
      });
      res.status(201).json(persona);
    }),
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const current = personas.getOrThrow(idParam(req));
      const body = readJsonBody<Partial<Persona>>(req);
      const updated = personas.update(idParam(req), {
        name: body.name !== undefined ? asString(body.name) : undefined,
        description: body.description !== undefined ? asString(body.description) : undefined,
        gender: body.gender !== undefined ? parseGender(body.gender, current.gender) : undefined,
      });
      res.json(updated);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const existing = personas.getOrThrow(id);
      if (existing.name === 'You') throw new ApiError('The default persona "You" cannot be deleted', 400);
      await fs.rm(path.join(DIR.personas, id), { recursive: true, force: true });
      personas.delete(id);
      res.status(204).end();
    }),
  );

  router.post(
    '/:id/avatar',
    asyncHandler(async (req, res) => {
      const persona = personas.getOrThrow(idParam(req));
      const file = firstFile(req);
      if (!file) throw new ApiError('Expected an avatar file field', 400);
      const ext = MIME_EXT[file.mimetype.toLowerCase()] ?? 'png';
      const dir = path.join(DIR.personas, persona.id);
      await ensureDir(dir);
      for (const entry of await fs.readdir(dir).catch(() => [])) {
        if (entry.startsWith('avatar.')) await fs.rm(path.join(dir, entry), { force: true });
      }
      await fs.writeFile(path.join(dir, `avatar.${ext}`), file.buffer);
      res.json(
        personas.update(persona.id, { avatarPath: `/media/personas/${persona.id}/avatar.${ext}` }),
      );
    }),
  );

  router.delete(
    '/:id/avatar',
    asyncHandler(async (req, res) => {
      const persona = personas.getOrThrow(idParam(req));
      const dir = path.join(DIR.personas, persona.id);
      for (const entry of await fs.readdir(dir).catch(() => [])) {
        if (entry.startsWith('avatar.')) {
          await fs.rm(path.join(dir, entry), { force: true });
        }
      }
      res.json(personas.update(persona.id, { avatarPath: null }));
    }),
  );

  // Audiobook sample endpoints: persona spoken lines (voice) + internal
  // thoughts (thought), each with a sample file + transcript.
  const SAMPLE_FIELD: Record<string, 'voiceSample' | 'thoughtSample'> = {
    'voice': 'voiceSample',
    'thought': 'thoughtSample',
  };
  const SAMPLE_FILE: Record<string, string> = {
    'voice': 'voice-sample.wav',
    'thought': 'thought-sample.wav',
  };
  const SAMPLE_MEDIA: Record<string, string> = {
    'voice': '/media/personas/${id}/voice-sample.wav',
    'thought': '/media/personas/${id}/thought-sample.wav',
  };

  for (const kind of ['voice', 'thought'] as const) {
    router.post(`/:id/${kind}`, asyncHandler(async (req, res) => {
      const persona = personas.getOrThrow(idParam(req));
      const file = firstFile(req);
      if (!file) throw new ApiError(`Expected a ${kind} sample file field`, 400);
      const transcript = typeof req.body?.transcript === 'string' ? req.body.transcript : '';
      const dir = path.join(DIR.personas, persona.id);
      await ensureDir(dir);
      const filename = SAMPLE_FILE[kind];
      await fs.writeFile(path.join(dir, filename), file.buffer);
      const mediaPath = `/media/personas/${persona.id}/${filename}`;
      const field = SAMPLE_FIELD[kind];
      ctx.voiceCache.invalidate(persona.id);
      res.json(personas.update(persona.id, {
        [`${field}Path`]: mediaPath,
        [`${field}Transcript`]: transcript || null,
      }));
    }));

    router.delete(`/:id/${kind}`, asyncHandler(async (req, res) => {
      const persona = personas.getOrThrow(idParam(req));
      await fs.rm(path.join(DIR.personas, persona.id, SAMPLE_FILE[kind]), { force: true });
      const field = SAMPLE_FIELD[kind];
      ctx.voiceCache.invalidate(persona.id);
      res.json(personas.update(persona.id, {
        [`${field}Path`]: null,
        [`${field}Transcript`]: null,
      }));
    }));
  }
  void SAMPLE_MEDIA;

  // zdp export: a zip bundling persona.json (name/description/gender), the
  // avatar image and both audio samples (voice + thought) with their
  // transcripts.
  router.get(
    '/:id/export-zdp',
    asyncHandler(async (req, res) => {
      const persona = personas.getOrThrow(idParam(req));
      const dir = path.join(DIR.personas, persona.id);
      const entries = await fs.readdir(dir).catch(() => []);
      const avatarFile = entries.find((entry) => entry.startsWith('avatar.'));
      if (!avatarFile) throw new ApiError('Cannot export: persona has no avatar image.', 400);

      const staging = path.join(dir, 'zdpexport');
      await ensureDir(staging);
      for (const entry of await fs.readdir(staging).catch(() => [])) {
        await fs.rm(path.join(staging, entry), { recursive: true, force: true });
      }
      await fs.writeFile(
        path.join(staging, 'persona.json'),
        JSON.stringify({ name: persona.name, description: persona.description, gender: persona.gender }),
        'utf8',
      );
      await fs.copyFile(path.join(dir, avatarFile), path.join(staging, avatarFile));
      const files = ['persona.json', avatarFile];
      for (const kind of ['voice', 'thought'] as const) {
        try {
          await fs.copyFile(path.join(dir, SAMPLE_FILE[kind]), path.join(staging, SAMPLE_FILE[kind]));
          files.push(SAMPLE_FILE[kind], `${kind}-transcript.txt`);
          await fs.writeFile(
            path.join(staging, `${kind}-transcript.txt`),
            (SAMPLE_FIELD[kind] === 'voiceSample' ? persona.voiceSampleTranscript : persona.thoughtSampleTranscript) ?? '',
            'utf8',
          );
        } catch {
          // sample not present — skip it
        }
      }
      const zipName = `${(persona.name || 'persona').replace(/[^\w.-]+/g, '_') || 'persona'}.zdp`;
      await new Promise<void>((resolve) => {
        execFile('zip', ['-j', path.join(staging, zipName), ...files], { cwd: staging, timeout: 60_000 }, (err) => {
          if (err) console.error('[zdpexport] zip failed:', (err as Error).message);
          resolve();
        });
      });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
      res.send(await fs.readFile(path.join(staging, zipName)));
    }),
  );

  // zdp import: one-step restore (creates the persona, copies avatar + both
  // samples and their transcripts).
  router.post(
    '/import',
    asyncHandler(async (req, res) => {
      const file = firstFile(req);
      if (!file) throw new ApiError('Expected a .zdp file field', 400);
      const zd = await parseZdpFile(file.buffer);
      const persona = personas.create({
        name: zd.meta.name,
        avatarPath: null,
        description: zd.meta.description,
        gender: parseGender(zd.meta.gender, 'other'),
        voiceSamplePath: null,
        voiceSampleTranscript: null,
        thoughtSamplePath: null,
        thoughtSampleTranscript: null,
      });
      const dir = path.join(DIR.personas, persona.id);
      await ensureDir(dir);
      if (zd.avatarBuffer && zd.avatarName) {
        await fs.writeFile(path.join(dir, zd.avatarName), zd.avatarBuffer);
        personas.update(persona.id, { avatarPath: `/media/personas/${persona.id}/${zd.avatarName}` });
      }
      if (zd.voiceSample) {
        await fs.writeFile(path.join(dir, 'voice-sample.wav'), zd.voiceSample);
        personas.update(persona.id, {
          voiceSamplePath: `/media/personas/${persona.id}/voice-sample.wav`,
          voiceSampleTranscript: zd.voiceTranscript,
        });
      }
      if (zd.thoughtSample) {
        await fs.writeFile(path.join(dir, 'thought-sample.wav'), zd.thoughtSample);
        personas.update(persona.id, {
          thoughtSamplePath: `/media/personas/${persona.id}/thought-sample.wav`,
          thoughtSampleTranscript: zd.thoughtTranscript,
        });
      }
      ctx.voiceCache.invalidate(persona.id);
      res.status(201).json(personas.getOrThrow(persona.id));
    }),
  );

  return router;
}
