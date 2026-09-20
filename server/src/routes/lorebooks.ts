import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AppContext } from '../context.js';
import type { Lorebook } from '../types.js';
import { ApiError, asBoolean, asNumber, asString, isObject } from '../util.js';
import { asyncHandler, idParam, readJsonBody } from './helpers.js';

function sanitizeEntry(raw: unknown): Lorebook['entries'][number] | null {
  if (!isObject(raw)) return null;
  return {
    id: asString(raw.id, '') || randomUUID(),
    keys: Array.isArray(raw.keys) ? raw.keys.map((k) => asString(k)).filter(Boolean) : [],
    content: asString(raw.content),
    name: asString(raw.name, ''),
    enabled: asBoolean(raw.enabled, true),
    insertion_order: asNumber(raw.insertion_order, 0),
    case_sensitive: asBoolean(raw.case_sensitive, false),
    priority: asNumber(raw.priority, 100),
    selective: asBoolean(raw.selective, false),
    secondary_keys: Array.isArray(raw.secondary_keys)
      ? raw.secondary_keys.map((k) => asString(k)).filter(Boolean)
      : [],
    constant: asBoolean(raw.constant, false),
    comment: asString(raw.comment, ''),
    position: raw.position === 'after_char' ? 'after_char' : 'before_char',
  };
}

export function lorebooksRouter(ctx: AppContext): Router {
  const router = Router();
  const { lorebooks } = ctx.store;

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(lorebooks.list());
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(lorebooks.getOrThrow(idParam(req)));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = readJsonBody<Partial<Lorebook>>(req);
      const book = lorebooks.create({
        name: asString(body.name, 'Unnamed lorebook'),
        description: asString(body.description),
        scan_depth: asNumber(body.scan_depth, 1000),
        token_budget: asNumber(body.token_budget, 500),
        recursive_scanning: asBoolean(body.recursive_scanning, false),
        extensions: isObject(body.extensions) ? body.extensions : {},
        entries: Array.isArray(body.entries)
          ? body.entries.map(sanitizeEntry).filter((e): e is NonNullable<typeof e> => e !== null)
          : [],
      });
      res.status(201).json(book);
    }),
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      lorebooks.getOrThrow(idParam(req));
      const body = readJsonBody<Partial<Lorebook>>(req);
      const updated = lorebooks.update(idParam(req), {
        name: body.name !== undefined ? asString(body.name) : undefined,
        description: body.description !== undefined ? asString(body.description) : undefined,
        scan_depth: body.scan_depth !== undefined ? asNumber(body.scan_depth, 1000) : undefined,
        token_budget: body.token_budget !== undefined ? asNumber(body.token_budget, 500) : undefined,
        recursive_scanning:
          body.recursive_scanning !== undefined ? asBoolean(body.recursive_scanning, false) : undefined,
        entries: Array.isArray(body.entries)
          ? body.entries.map(sanitizeEntry).filter((e): e is NonNullable<typeof e> => e !== null)
          : undefined,
      });
      res.json(updated);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      if (!lorebooks.delete(idParam(req))) throw new ApiError('Lorebook not found', 404);
      res.status(204).end();
    }),
  );

  router.get(
    '/:id/export',
    asyncHandler(async (req, res) => {
      const book = lorebooks.getOrThrow(idParam(req));
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${book.name.replace(/[^\w.-]+/g, '_')}.json"`);
      res.send(JSON.stringify(book, null, 2));
    }),
  );

  return router;
}