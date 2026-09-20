import type { Connection, LlmOptions, LlmMessage, ModelInfo, ProviderInfo } from '../../types.js';
import { appendV1, authHeaders, jsonPost, readBodyLines, readJson, request } from '../http.js';
import { asString } from '../../util.js';
import type { LlmProvider, StreamControl } from '../types.js';

const info: ProviderInfo = {
  id: 'openai-compatible',
  kind: 'llm',
  label: 'OpenAI-compatible (OpenAI, llama.cpp, OpenRouter…)',
  capabilities: {
    supportsModelList: true,
    supportsVoiceList: false,
    supportsVoiceCloning: false,
    supportsStreaming: true,
    options: [
      {
        key: 'orgId',
        label: 'Organization ID (optional)',
        type: 'text',
        help: 'Passed as the OpenAI-Organization header. Leave empty for llama.cpp/Ollama-compatible servers.',
      },
      {
        key: 'extraHeaders',
        label: 'Extra headers (JSON object)',
        type: 'text',
        placeholder: '{"X-Some-Header":"value"}',
      },
    ],
    notes: [
      'Base URL is the server root, e.g. http://localhost:8080 or https://api.openai.com. /v1 is appended automatically.',
      'Model list is fetched from the /v1/models endpoint.',
    ],
  },
};

export const openaiCompatible: LlmProvider = {
  info,

  async test(conn: Connection): Promise<void> {
    await request(`${appendV1(conn.baseUrl)}/models`, { headers: authHeaders(conn) });
  },

  async listModels(conn: Connection): Promise<ModelInfo[]> {
    const base = appendV1(conn.baseUrl);
    const data = await readJson<{ data?: { id: string }[] }>(await request(`${base}/models`, { headers: authHeaders(conn) }));
    return (data.data ?? []).map((m) => ({ id: m.id }));
  },

  async complete(conn: Connection, messages: LlmMessage[], opts: LlmOptions): Promise<string> {
    const base = appendV1(conn.baseUrl);
    const headers: Record<string, string> = authHeaders(conn);
    const org = asString((conn.providerOptions as Record<string, unknown>).orgId);
    if (org) headers['OpenAI-Organization'] = org;

    const body: Record<string, unknown> = {
      model: conn.modelOrVoice || 'gpt-4o-mini',
      messages,
      stream: false,
    };
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.topP !== undefined) body.top_p = opts.topP;
    if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;

    const data = await readJson<{ choices?: { message?: { content?: string } }[] }>(
      await jsonPost(`${base}/chat/completions`, body, headers),
    );
    return data.choices?.[0]?.message?.content ?? '';
  },

  async stream(
    conn: Connection,
    messages: LlmMessage[],
    opts: LlmOptions,
    onDelta: (delta: string) => void,
    ctrl: StreamControl,
  ): Promise<void> {
    const base = appendV1(conn.baseUrl);
    const headers: Record<string, string> = authHeaders(conn);
    const org = asString((conn.providerOptions as Record<string, unknown>).orgId);
    if (org) headers['OpenAI-Organization'] = org;

    const body: Record<string, unknown> = {
      model: conn.modelOrVoice || 'gpt-4o-mini',
      messages,
      stream: true,
    };
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.topP !== undefined) body.top_p = opts.topP;
    if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;

    const res = await jsonPost(`${base}/chat/completions`, body, headers);
    for await (const line of readBodyLines(res)) {
      if (ctrl.aborted) return;
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      let data: { choices?: { delta?: { content?: string } }[] };
      try {
        data = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
      } catch {
        continue;
      }
      const delta = data.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) onDelta(delta);
    }
  },
};