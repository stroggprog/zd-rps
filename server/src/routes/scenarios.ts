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

  return router;
}