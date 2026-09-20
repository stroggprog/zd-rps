import type { Connection, ProviderInfo } from '../../types.js';
import { multipartPost, readJson, request } from '../http.js';
import { asString, asBoolean } from '../../util.js';
import type { SttProvider } from '../types.js';

const info: ProviderInfo = {
  id: 'whispercpp',
  kind: 'stt',
  label: 'whisper.cpp (local server)',
  capabilities: {
    supportsModelList: false,
    supportsVoiceList: false,
    supportsVoiceCloning: false,
    supportsStreaming: false,
    options: [
      {
        key: 'openaiCompat',
        label: 'Use OpenAI-compatible endpoint (/v1/audio/transcriptions)',
        type: 'boolean',
        help: 'For whisper.cpp servers built with OpenAI compatibility. Off = native /inference endpoint.',
      },
    ],
    notes: [
      'Base URL is e.g. http://localhost:8080. Connection is tested against the /health endpoint; the model is chosen at server start.',
    ],
  },
};

export const whispercpp: SttProvider = {
  info,

  async test(conn: Connection): Promise<void> {
    const base = conn.baseUrl.replace(/\/+$/, '');
    await request(`${base}/health`, { method: 'GET' });
  },

  async transcribe(conn: Connection, audio: Buffer, mime: string): Promise<string> {
    const base = conn.baseUrl.replace(/\/+$/, '');
    const useOpenAi = asBoolean((conn.providerOptions as Record<string, unknown>).openaiCompat);
    const form = new FormData();
    const blob = new Blob([audio], { type: mime });
    form.append('file', blob, `recording.${mimeExt(mime)}`);
    if (!useOpenAi) {
      form.append('response_format', 'json');
      form.append('temperature', asString((conn.providerOptions as Record<string, unknown>).temperature || '0.2'));
      const data = await readJson<{ text?: string }>(
        await multipartPost(`${base}/inference`, form),
      );
      return data.text ?? '';
    }
    form.append('model', conn.modelOrVoice || 'whisper-1');
    const data = await readJson<{ text?: string }>(
      await multipartPost(`${base}/v1/audio/transcriptions`, form),
    );
    return data.text ?? '';
  },
};

function mimeExt(mime: string): string {
  if (mime.toLowerCase().includes('ogg')) return 'ogg';
  if (mime.toLowerCase().includes('mp3')) return 'mp3';
  if (mime.toLowerCase().includes('m4a')) return 'm4a';
  if (mime.toLowerCase().includes('aac')) return 'aac';
  return 'webm';
}