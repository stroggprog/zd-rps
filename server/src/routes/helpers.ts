import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../util.js';
import type { Id } from '../types.js';

export type Handler = (req: Request, res: Response) => Promise<void> | void;

export function asyncHandler(fn: Handler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error('[error]', err);
  res.status(500).json({ error: message });
}

export function idParam(req: Request): Id {
  return req.params.id as Id;
}

export function readJsonBody<T>(req: Request): T {
  if (typeof req.body !== 'object' || req.body === null) {
    throw new ApiError('Expected a JSON body', 400);
  }
  return req.body as T;
}