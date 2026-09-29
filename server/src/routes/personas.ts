import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Router, type Request } from 'express';
import type { AppContext } from '../context.js';
import type { Persona, PersonaGender } from '../types.js';
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

  return router;
}
