import { Router } from 'express';
import type { AppContext } from '../context.js';
import type { Story } from '../types.js';
import { asString } from '../util.js';
import { asyncHandler, idParam, readJsonBody } from './helpers.js';

export function storiesRouter(ctx: AppContext): Router {
  const router = Router();
  const { stories } = ctx.store;

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(stories.list());
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(stories.getOrThrow(idParam(req)));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = readJsonBody<Partial<Story>>(req);
      res.status(201).json(
        stories.create({
          name: asString(body.name, 'Untitled story'),
          summary: typeof body.summary === 'string' ? body.summary : '',
        }),
      );
    }),
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const story = stories.getOrThrow(idParam(req));
      const body = readJsonBody<Partial<Story>>(req);
      res.json(
        stories.update(story.id, {
          name: body.name !== undefined ? asString(body.name) : undefined,
          summary: body.summary !== undefined ? asString(body.summary) : undefined,
        }),
      );
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      if (!stories.delete(id)) res.status(404).json({ error: 'Story not found' });
      // unlink chats that referenced the story
      for (const chat of ctx.store.chats.list()) {
        if (chat.storyId === id) ctx.store.chats.update(chat.id, { storyId: null });
      }
      res.status(204).end();
    }),
  );

  return router;
}
