import { Router } from 'express';
import type { AppContext } from '../context.js';
import type { Scenario } from '../types.js';
import { ApiError, asString } from '../util.js';
import { asyncHandler, idParam, readJsonBody } from './helpers.js';

export function scenariosRouter(ctx: AppContext): Router {
  const router = Router();
  const { scenarios } = ctx.store;

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(scenarios.list());
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(scenarios.getOrThrow(idParam(req)));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = readJsonBody<Partial<Scenario>>(req);
      const scenario = scenarios.create({
        name: asString(body.name, 'Unnamed scenario'),
        description: asString(body.description),
        first_mes: asString(body.first_mes),
        scenario: asString(body.scenario),
        alternate_greetings: Array.isArray(body.alternate_greetings)
          ? body.alternate_greetings.map((a) => asString(a)).filter(Boolean)
          : [],
      });
      res.status(201).json(scenario);
    }),
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      scenarios.getOrThrow(idParam(req));
      const body = readJsonBody<Partial<Scenario>>(req);
      const updated = scenarios.update(idParam(req), {
        name: body.name !== undefined ? asString(body.name) : undefined,
        description: body.description !== undefined ? asString(body.description) : undefined,
        first_mes: body.first_mes !== undefined ? asString(body.first_mes) : undefined,
        scenario: body.scenario !== undefined ? asString(body.scenario) : undefined,
        alternate_greetings:
          body.alternate_greetings !== undefined
            ? body.alternate_greetings.map((a) => asString(a)).filter(Boolean)
            : undefined,
      });
      res.json(updated);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      if (!scenarios.delete(idParam(req))) throw new ApiError('Scenario not found', 404);
      res.status(204).end();
    }),
  );

  router.get(
    '/:id/export',
    asyncHandler(async (req, res) => {
      const scenario = scenarios.getOrThrow(idParam(req));
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${scenario.name.replace(/[^\w.-]+/g, '_')}.json"`);
      res.send(JSON.stringify(scenario, null, 2));
    }),
  );

  // Import a scenario from an uploaded JSON file (our own export format).
  router.post(
    '/import',
    asyncHandler(async (req, res) => {
      const file = (req.files as Express.Multer.File[] | undefined)?.[0] ?? (req.file as Express.Multer.File | undefined);
      if (!file) throw new ApiError('Expected a scenario JSON file', 400);
      let raw: unknown;
      try {
        raw = JSON.parse(file.buffer.toString('utf8'));
      } catch {
        throw new ApiError('The file is not valid JSON', 400);
      }
      if (typeof raw !== 'object' || raw === null) throw new ApiError('Unexpected scenario file format', 400);
      const obj = raw as Record<string, unknown>;
      const scenario = scenarios.create({
        name: asString(obj.name, '') || (file.originalname ?? '').replace(/\.json$/i, '') || 'Imported scenario',
        description: asString(obj.description, ''),
        first_mes: asString(obj.first_mes, ''),
        scenario: asString(obj.scenario, ''),
        alternate_greetings: Array.isArray(obj.alternate_greetings)
          ? (obj.alternate_greetings as unknown[]).map((g) => asString(g)).filter(Boolean)
          : [],
      });
      res.status(201).json(scenario);
    }),
  );

  return router;}
