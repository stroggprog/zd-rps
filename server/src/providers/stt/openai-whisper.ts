import type { Connection, ProviderInfo } from '../../types.js';
import { appendV1, authHeaders, multipartPost, readJson, request } from '../http.js';
import { asString } from '../../util.js';
import type { SttProvider } from '../types.js';

const info: ProviderInfo = {
  id: 'openai-whisper',
  kind: 'stt',
  label: 'OpenAI Whisper API',
  capabilities: {
    supportsModelList: false,
    supportsVoiceList: false,
    supportsVoiceCloning: false,
    supportsStreaming: false,
    options: [
      {
        key: 'language',
        label: 'Language hint (ISO-639-1)',
        type: 'text',
        placeholder: 'en',
      },
    ],
    notes: ['Base URL is the API root, e.g. https://api.openai.com. /v1 is appended automatically.'],
  },
};

export const openaiWhisper: SttProvider = {
  info,

  async test(conn: Connection): Promise<void> {
    await request(`${appendV1(conn.baseUrl)}/models`, { headers: authHeaders(conn) });
  },

  async transcribe(conn: Connection, audio: Buffer, mime: string): Promise<string> {
    const base = appendV1(conn.baseUrl);
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mime }), `recording.${mimeExt(mime)}`);
    form.append('model', conn.modelOrVoice || 'whisper-1');
    const language = asString((conn.providerOptions as Record<string, unknown>).language);
    if (language) form.append('language', language);

    const data = await readJson<{ text?: string }>(
      await multipartPost(`${base}/audio/transcriptions`, form, authHeaders(conn)),
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