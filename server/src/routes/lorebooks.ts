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

  // Import a lorebook from an uploaded JSON file. Accepts our own export format
  // and SillyTavern-style books (entries as a map or array).
  router.post(
    '/import',
    asyncHandler(async (req, res) => {
      const file = (req.files as Express.Multer.File[] | undefined)?.[0] ?? (req.file as Express.Multer.File | undefined);
      if (!file) throw new ApiError('Expected a lorebook JSON file', 400);
      let raw: unknown;
      try {
        raw = JSON.parse(file.buffer.toString('utf8'));
      } catch {
        throw new ApiError('The file is not valid JSON', 400);
      }
      if (!isObject(raw)) throw new ApiError('Unexpected lorebook file format', 400);
      const obj = raw as Record<string, unknown>;

      let rawEntries: unknown[] = [];
      const stEntries = isObject(obj.entries)
        ? Object.values(obj.entries)
        : Array.isArray(obj.entries)
          ? obj.entries
          : null;
      if (stEntries && stEntries.length > 0 && isObject(stEntries[0]) && (stEntries[0] as Record<string, unknown>).key !== undefined) {
        // SillyTavern shape: key/keysecondary arrays, comment = entry name, etc.
        rawEntries = stEntries.map((e) => {
          const src = e as Record<string, unknown>;
          return {
            ...src,
            name: asString(src.comment, asString(src.name, '')),
            keys: Array.isArray(src.keys) ? src.keys : Array.isArray(src.key) ? src.key : [],
            content: asString(src.content, ''),
            enabled: src.enabled !== undefined ? src.enabled === true : src.disable === undefined ? true : src.disable !== true,
            insertion_order: asNumber(src.insertion_order, asNumber(src.order, 0)),
            case_sensitive: asBoolean(src.case_sensitive, src.caseSensitive === true),
            secondary_keys: Array.isArray(src.secondary_keys)
              ? src.secondary_keys
              : Array.isArray(src.keysecondary)
                ? src.keysecondary
                : [],
            constant: asBoolean(src.constant, false),
            position: asString(src.position, 'before_char') === 'after_char' ? 'after_char' : 'before_char',
          };
        });
      } else if (Array.isArray(obj.entries)) {
        rawEntries = obj.entries;
      }

      const entries = rawEntries
        .map(sanitizeEntry)
        .filter((e): e is Lorebook['entries'][number] => e !== null);
      const importedName = asString(obj.name, '') || asString(obj.bookName, '');
      const name =
        importedName ||
        asString(file.originalname ?? '', '').replace(/\.json$/i, '') ||
        'Imported lorebook';

      const book = lorebooks.create({
        name,
        description: asString(obj.description, ''),
        scan_depth: asNumber(obj.scan_depth ?? obj.scanDepth, 3),
        token_budget: asNumber(obj.token_budget ?? obj.tokenBudget, 2048),
        recursive_scanning: asBoolean(obj.recursive_scanning ?? obj.recursiveScanning, false),
        extensions: {},
        entries,
      });
      res.status(201).json(book);
    }),
  );

  return router;
}