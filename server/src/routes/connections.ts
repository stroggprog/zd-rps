import { Router } from 'express';
import type { AppContext } from '../context.js';
import type { AppConfig, Connection, ConnectionKind, Provider } from '../types.js';
import { getConfig, saveConfig } from '../config.js';
import { getProvider, getLlmProvider, getSttProvider, getTtsProvider, catalog } from '../providers/factory.js';
import { asString, uuid, ApiError, isObject } from '../util.js';
import { asyncHandler, idParam, readJsonBody } from './helpers.js';

const KINDS: ConnectionKind[] = ['llm', 'stt', 'tts'];

function kindOf(raw: unknown): ConnectionKind {
  return KINDS.includes(raw as ConnectionKind) ? (raw as ConnectionKind) : 'llm';
}

function sanitize(input: unknown, existing?: Connection): Connection | null {
  if (!isObject(input)) return null;
  const kind = kindOf(input.kind);
  const provider = asString(input.provider, existing?.provider ?? '') as Provider;
  if (kind === 'llm' && !['openai-compatible', 'ollama'].includes(provider)) return null;
  if (kind === 'stt' && !['openai-whisper', 'whispercpp'].includes(provider)) return null;
  if (kind === 'tts' && !['elevenlabs', 'cartesia', 'omnivoice', 'dots'].includes(provider)) return null;
  const rawContext = Number(input.contextTokens);
  return {
    id: existing?.id ?? uuid(),
    name: asString(input.name, existing?.name ?? 'Unnamed connection'),
    kind,
    provider,
    baseUrl: asString(input.baseUrl, existing?.baseUrl ?? ''),
    apiKey: asString(input.apiKey, existing?.apiKey ?? ''),
    modelOrVoice: asString(input.modelOrVoice, existing?.modelOrVoice ?? ''),
    providerOptions: isObject(input.providerOptions)
      ? input.providerOptions
      : (existing?.providerOptions ?? {}),
    contextTokens:
      Number.isFinite(rawContext) && rawContext > 0 ? Math.floor(rawContext) : (existing?.contextTokens ?? null),
  };
}

export function connectionsRouter(_ctx: AppContext): Router {
  const router = Router();

  router.get(
    '/providers',
    asyncHandler(async (_req, res) => {
      res.json(catalog);
    }),
  );

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(getConfig().connections);
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const config = getConfig();
      const conn = sanitize(req.body);
      if (!conn) throw new ApiError('Invalid connection payload or unknown provider', 400);
      config.connections.push(conn);
      await saveConfig();
      res.status(201).json(conn);
    }),
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const config = getConfig();
      const index = config.connections.findIndex((c) => c.id === idParam(req));
      if (index < 0) throw new ApiError('Connection not found', 404);
      const updated = sanitize(req.body, config.connections[index]);
      if (!updated) throw new ApiError('Invalid connection payload or unknown provider', 400);
      config.connections[index] = updated;
      await saveConfig();
      res.json(updated);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const config = getConfig();
      const id = idParam(req);
      config.connections = config.connections.filter((c) => c.id !== id);
      const defaults = ['defaultLlm', 'defaultStt', 'defaultTts'] as const;
      for (const key of defaults) {
        if (config[key] === id) config[key] = null;
      }
      await saveConfig();
      res.status(204).end();
    }),
  );

  router.post(
    '/:id/test',
    asyncHandler(async (req, res) => {
      const conn = getConfig().connections.find((c) => c.id === idParam(req));
      if (!conn) throw new ApiError('Connection not found', 404);
      try {
        const info = getProvider(conn.kind, conn.provider);
        const result: Record<string, unknown> = {
          ok: true,
          kind: conn.kind,
          provider: conn.provider,
          capabilities: info.capabilities,
          models: [],
          voices: [],
        };
        if (conn.kind === 'llm') {
          const llm = getLlmProvider(conn);
          await llm.test(conn);
          if (info.capabilities.supportsModelList) result.models = await llm.listModels(conn);
        } else if (conn.kind === 'tts') {
          const tts = getTtsProvider(conn);
          await tts.test(conn);
          if (info.capabilities.supportsVoiceList) result.voices = await tts.listVoices(conn);
        } else {
          await getSttProvider(conn).test(conn);
        }
        res.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(502).json({ ok: false, error: message });
      }
    }),
  );

  router.get(
    '/defaults',
    asyncHandler(async (_req, res) => {
      const c = getConfig();
      res.json({ defaultLlm: c.defaultLlm, defaultStt: c.defaultStt, defaultTts: c.defaultTts });
    }),
  );

  router.post(
    '/defaults',
    asyncHandler(async (req, res) => {
      const body = readJsonBody<{ kind?: string; connectionId?: string | null }>(req);
      const config = getConfig();
      const kind = kindOf(body.kind);
      const key = kind === 'llm' ? 'defaultLlm' : kind === 'stt' ? 'defaultStt' : 'defaultTts';
      const connectionId = body.connectionId ?? null;
      if (connectionId && !config.connections.some((c) => c.id === connectionId && c.kind === kind)) {
        throw new ApiError('No matching connection for that kind', 400);
      }
      config[key] = connectionId;
      await saveConfig();
      res.json({ [key]: connectionId });
    }),
  );

  return router;
}