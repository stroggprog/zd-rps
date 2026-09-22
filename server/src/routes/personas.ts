import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
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
      const file = (req.files as Express.Multer.File[] | undefined)?.[0] ?? (req.file as Express.Multer.File | undefined);
      if (!file) throw new ApiError('Expected an avatar file field', 400);
      const ext = MIME_EXT[file.mimetype.toLowerCase()] ?? 'png';
      const dir = path.join(DIR.personas, persona.id);
      await ensureDir(dir);
      const entries = await fs.readdir(dir).catch(() => []);
      for (const entry of entries) {
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
      const entries = await fs.readdir(dir).catch(() => []);
      for (const entry of entries) {
        if (entry.startsWith('avatar.')) {
          await fs.rm(path.join(dir, entry), { force: true });
        }
      }
      res.json(personas.update(persona.id, { avatarPath: null }));
    }),
  );

  return router;
}
