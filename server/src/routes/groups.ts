import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import type { AppContext } from '../context.js';
import type { CharacterGroup, Id } from '../types.js';
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

export function groupsRouter(ctx: AppContext): Router {
  const router = Router();
  const { groups, characters } = ctx.store;

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(groups.list());
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(groups.getOrThrow(idParam(req)));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = readJsonBody<Partial<CharacterGroup>>(req);
      const memberIds = (Array.isArray(body.memberIds) ? body.memberIds : []).filter((id) =>
        characters.exists(id as Id),
      );
      const group = groups.create({
        name: asString(body.name, 'Unnamed group'),
        description: typeof body.description === 'string' ? body.description : '',
        avatarPath: null,
        memberIds,
      });
      res.status(201).json(group);
    }),
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const group = groups.getOrThrow(idParam(req));
      const body = readJsonBody<Partial<CharacterGroup>>(req);
      const updated = groups.update(group.id, {
        name: body.name !== undefined ? asString(body.name) : undefined,
        description: body.description !== undefined ? asString(body.description) : undefined,
        memberIds:
          Array.isArray(body.memberIds) &&
          body.memberIds.every((id) => typeof id === 'string' && characters.exists(id as Id))
            ? [...new Set(body.memberIds as Id[])]
            : undefined,
      });
      res.json(updated);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      await fs.rm(path.join(DIR.groups, id), { recursive: true, force: true });
      groups.delete(id);
      res.status(204).end();
    }),
  );

  router.post(
    '/:id/avatar',
    asyncHandler(async (req, res) => {
      const group = groups.getOrThrow(idParam(req));
      const file = (req.files as Express.Multer.File[] | undefined)?.[0] ?? (req.file as Express.Multer.File | undefined);
      if (!file) throw new ApiError('Expected an avatar file field', 400);
      const ext = MIME_EXT[file.mimetype.toLowerCase()] ?? 'png';
      const dir = path.join(DIR.groups, group.id);
      await ensureDir(dir);
      for (const entry of await fs.readdir(dir).catch(() => [])) {
        if (entry.startsWith('avatar.')) await fs.rm(path.join(dir, entry), { force: true });
      }
      await fs.writeFile(path.join(dir, `avatar.${ext}`), file.buffer);
      res.json(groups.update(group.id, { avatarPath: `/media/groups/${group.id}/avatar.${ext}` }));
    }),
  );

  router.delete(
    '/:id/avatar',
    asyncHandler(async (req, res) => {
      const group = groups.getOrThrow(idParam(req));
      const dir = path.join(DIR.groups, group.id);
      for (const entry of await fs.readdir(dir).catch(() => [])) {
        if (entry.startsWith('avatar.')) await fs.rm(path.join(dir, entry), { force: true });
      }
      res.json(groups.update(group.id, { avatarPath: null }));
    }),
  );

  return router;
}
