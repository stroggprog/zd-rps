import type { Connection, ProviderInfo } from '../types.js';
import { ApiError } from '../util.js';
import type { LlmProvider, SttProvider, TtsProvider } from './types.js';
import { openaiCompatible } from './llm/openai-compatible.js';
import { ollama } from './llm/ollama.js';
import { openaiWhisper } from './stt/openai-whisper.js';
import { whispercpp } from './stt/whispercpp.js';
import { elevenlabs } from './tts/elevenlabs.js';
import { cartesia } from './tts/cartesia.js';
import { omnivoice } from './tts/omnivoice.js';
import { dots } from './tts/dots.js';

const LLMS: Record<string, LlmProvider> = {
  'openai-compatible': openaiCompatible,
  ollama,
};

const STTS: Record<string, SttProvider> = {
  'openai-whisper': openaiWhisper,
  whispercpp,
};

const TTSS: Record<string, TtsProvider> = {
  elevenlabs,
  cartesia,
  omnivoice,
  dots,
};

export const catalog: ProviderInfo[] = [
  ...Object.values(LLMS).map((p) => p.info),
  ...Object.values(STTS).map((p) => p.info),
  ...Object.values(TTSS).map((p) => p.info),
];

export function getLlmProvider(conn: Connection): LlmProvider {
  const p = LLMS[conn.provider];
  if (!p) throw new ApiError(`Unknown LLM provider "${conn.provider}"`, 400);
  return p;
}

export function getSttProvider(conn: Connection): SttProvider {
  const p = STTS[conn.provider];
  if (!p) throw new ApiError(`Unknown STT provider "${conn.provider}"`, 400);
  return p;
}

export function getTtsProvider(conn: Connection): TtsProvider {
  const p = TTSS[conn.provider];
  if (!p) throw new ApiError(`Unknown TTS provider "${conn.provider}"`, 400);
  return p;
}

export function getProvider(kind: string, provider: string): ProviderInfo {
  const p = catalog.find((c) => c.kind === kind && c.id === provider);
  if (!p) throw new ApiError(`Unknown ${kind} provider "${provider}"`, 400);
  return p;
}