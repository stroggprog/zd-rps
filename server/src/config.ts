import { readFile } from 'node:fs/promises';
import type { AppConfig, Provider } from './types.js';
import { CONFIG_PATH } from './paths.js';
import { atomicWrite, ensureDir, isObject, asString } from './util.js';

const DEFAULTS: AppConfig = {
  connections: [],
  defaultLlm: null,
  defaultStt: null,
  defaultTts: null,
  debug: true,
  systemPromptOverride: null,
};

let config: AppConfig = structuredClone(DEFAULTS);

export function getConfig(): AppConfig {
  return config;
}

function sanitizeConnection(raw: unknown): AppConfig['connections'][number] | null {
  if (!isObject(raw)) return null;
  const contextTokens = Number(raw.contextTokens);
  return {
    id: asString(raw.id),
    name: asString(raw.name),
    kind: raw.kind === 'stt' || raw.kind === 'tts' ? raw.kind : 'llm',
    provider: asString(raw.provider) as Provider,
    baseUrl: asString(raw.baseUrl),
    apiKey: asString(raw.apiKey),
    modelOrVoice: asString(raw.modelOrVoice),
    providerOptions: isObject(raw.providerOptions) ? raw.providerOptions : {},
    // Optional per-connection context window (tokens) for history trimming.
    contextTokens: Number.isFinite(contextTokens) && contextTokens > 0 ? Math.floor(contextTokens) : null,
  };
}

export async function loadConfig(): Promise<void> {
  try {
    const raw = JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as unknown;
    if (!isObject(raw)) {
      config = structuredClone(DEFAULTS);
      return;
    }
    const connections = Array.isArray(raw.connections)
      ? raw.connections.map(sanitizeConnection).filter((c): c is NonNullable<typeof c> => c !== null)
      : [];
    config = {
      connections,
      defaultLlm: asString(raw.defaultLlm, '') || null,
      defaultStt: asString(raw.defaultStt, '') || null,
      defaultTts: asString(raw.defaultTts, '') || null,
      debug: raw.debug === false ? false : true,
      systemPromptOverride:
        typeof raw.systemPromptOverride === 'string' && raw.systemPromptOverride.trim()
          ? raw.systemPromptOverride
          : null,
    };
  } catch {
    config = structuredClone(DEFAULTS);
    await saveConfig();
  }
}

export async function saveConfig(): Promise<void> {
  await ensureDir(CONFIG_PATH.replace(/[^/]+$/, ''));
  await atomicWrite(CONFIG_PATH, JSON.stringify(config, null, 2));
}