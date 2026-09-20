import type { Connection, ProviderInfo, VoiceInfo } from '../../types.js';
import { authHeaders, jsonPost, multipartPost, readJson, request } from '../http.js';
import { asNumber, asString, isObject } from '../../util.js';
import type { SynthesizeContext, TtsProvider } from '../types.js';

const DEFAULT_BASE = 'https://api.cartesia.ai';

const info: ProviderInfo = {
  id: 'cartesia',
  kind: 'tts',
  label: 'Cartesia Sonic',
  capabilities: {
    supportsModelList: false,
    supportsVoiceList: true,
    supportsVoiceCloning: true,
    supportsStreaming: true,
    options: [
      {
        key: 'model_id',
        label: 'Model',
        type: 'select',
        options: [
          { value: 'sonic-2025-04-16', label: 'Sonic 2025-04-16' },
          { value: 'sonic-2', label: 'Sonic 2' },
          { value: 'sonic-3', label: 'Sonic 3' },
        ],
      },
      {
        key: 'language',
        label: 'Language',
        type: 'select',
        options: [
          { value: 'en', label: 'English' },
          { value: 'de', label: 'German' },
          { value: 'es', label: 'Spanish' },
          { value: 'fr', label: 'French' },
          { value: 'ja', label: 'Japanese' },
          { value: 'zh', label: 'Chinese' },
          { value: 'pt', label: 'Portuguese' },
          { value: 'it', label: 'Italian' },
        ],
      },
      {
        key: 'emotion',
        label: 'Emotion',
        type: 'select',
        options: [
          { value: '', label: 'None' },
          { value: 'A:chuckles', label: 'Chuckling' },
          { value: 'A:excited', label: 'Excited' },
          { value: 'A:whispers', label: 'Whispering' },
          { value: 'A:angry', label: 'Angry' },
          { value: 'A:seductive', label: 'Seductive' },
          { value: 'A:sneering', label: 'Sneering' },
        ],
      },
      {
        key: 'output_format',
        label: 'Output format',
        type: 'select',
        options: [
          { value: 'wav', label: 'WAV (pcm_s16le @ 44.1kHz)' },
          { value: 'mp3', label: 'MP3 (128kbps)' },
        ],
      },
    ],
    notes: ['Requires an API key. Supports voice cloning and streaming.'],
  },
};

export const cartesia: TtsProvider = {
  info,

  async test(conn: Connection): Promise<void> {
    await request(`${base(conn)}/v1/voices`, { headers: authHeaders(conn) });
  },

  async listVoices(conn: Connection): Promise<VoiceInfo[]> {
    const data = await readJson<unknown>(await request(`${base(conn)}/v1/voices`, { headers: authHeaders(conn) }));
    const raw = Array.isArray(data)
      ? data
      : isObject(data) && Array.isArray(data.voices)
        ? data.voices
        : [];
    return raw
      .filter(isObject)
      .map((v) => ({ id: asString(v.id, asString(v.voice_id)), name: asString(v.name) || asString(v.id) }))
      .filter((v) => v.id);
  },

  async synthesize(conn: Connection, text: string, ctx: SynthesizeContext): Promise<Buffer> {
    const opt = conn.providerOptions as Record<string, unknown>;
    const format = asString(opt.output_format, 'wav');
    const outputFormat =
      format === 'mp3'
        ? { container: 'mp3', bit_rate: 192000 }
        : { container: 'wav', encoding: 'pcm_s16le', sample_rate: 44100 };
    const body: Record<string, unknown> = {
      model_id: asString(opt.model_id, 'sonic-2025-04-16'),
      transcript: text,
      voice: { mode: 'id', id: ctx.voiceId },
      output_format: outputFormat,
    };
    const language = asString((conn.providerOptions as Record<string, unknown>).language);
    if (language) body.language = language;
    const emotion = asString((conn.providerOptions as Record<string, unknown>).emotion);
    if (emotion) body.emotion = [emotion];

    const res = await jsonPost(`${base(conn)}/v1/tts`, body, authHeaders(conn));
    return Buffer.from(await res.arrayBuffer());
  },

  async cloneVoice(conn: Connection, sample: Buffer, name: string, transcript?: string): Promise<string> {
    const form = new FormData();
    form.append('audio', new Blob([sample], { type: 'audio/wav' }), 'sample.wav');
    form.append('label', name);
    form.append('language', asString((conn.providerOptions as Record<string, unknown>).language, 'en'));
    form.append('text', transcript ?? 'This is a sample of the voice to be cloned.');
    const data = await readJson<{ id?: string }>(
      await multipartPost(`${base(conn)}/v1/voices/clone`, form, authHeaders(conn)),
    );
    if (!data.id) throw new Error('Cartesia clone returned no id');
    return data.id;
  },
};

function base(conn: Connection): string {
  return asString(conn.baseUrl, DEFAULT_BASE).replace(/\/+$/, '');
}