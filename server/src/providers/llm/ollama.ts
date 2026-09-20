import type { Connection, LlmOptions, LlmMessage, ModelInfo, ProviderInfo } from '../../types.js';
import { jsonPost, readBodyLines, readJson, request } from '../http.js';
import type { LlmProvider, StreamControl } from '../types.js';

const info: ProviderInfo = {
  id: 'ollama',
  kind: 'llm',
  label: 'Ollama',
  capabilities: {
    supportsModelList: true,
    supportsVoiceList: false,
    supportsVoiceCloning: false,
    supportsStreaming: true,
    options: [],
    notes: ['Model list is fetched from /api/tags. Base URL is e.g. http://localhost:11434.'],
  },
};

function baseOf(conn: Connection): string {
  return conn.baseUrl.replace(/\/+$/, '');
}

export const ollama: LlmProvider = {
  info,

  async test(conn: Connection): Promise<void> {
    await request(`${baseOf(conn)}/api/tags`);
  },

  async listModels(conn: Connection): Promise<ModelInfo[]> {
    const data = await readJson<{ models?: { name?: string }[] }>(
      await request(`${baseOf(conn)}/api/tags`),
    );
    return (data.models ?? []).map((m) => ({ id: m.name ?? '' })).filter((m) => m.id);
  },

  async complete(conn: Connection, messages: LlmMessage[], opts: LlmOptions): Promise<string> {
    const body: Record<string, unknown> = {
      model: conn.modelOrVoice,
      messages,
      stream: false,
      options: {
        temperature: opts.temperature,
        top_p: opts.topP,
        num_predict: opts.maxTokens,
      },
    };
    if (opts.disableThinking) body.think = false;
    const data = await readJson<{ message?: { content?: string } }>(
      await jsonPost(`${baseOf(conn)}/api/chat`, body),
    );
    return data.message?.content ?? '';
  },

  async stream(
    conn: Connection,
    messages: LlmMessage[],
    opts: LlmOptions,
    onDelta: (delta: string) => void,
    ctrl: StreamControl,
  ): Promise<void> {
    const body: Record<string, unknown> = {
      model: conn.modelOrVoice,
      messages,
      stream: true,
      options: {
        temperature: opts.temperature,
        top_p: opts.topP,
        num_predict: opts.maxTokens,
      },
    };
    if (opts.disableThinking) body.think = false;
    const res = await jsonPost(`${baseOf(conn)}/api/chat`, body);
    for await (const line of readBodyLines(res)) {
      if (ctrl.aborted) return;
      let data: { message?: { content?: string } };
      try {
        data = JSON.parse(line) as { message?: { content?: string } };
      } catch {
        continue;
      }
      const delta = data.message?.content;
      if (typeof delta === 'string' && delta) onDelta(delta);
    }
  },
};