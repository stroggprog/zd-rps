import type { Connection, ProviderInfo, VoiceInfo } from '../../types.js';
import { authHeaders, jsonPost, multipartPost, readJson, request } from '../http.js';
import { asNumber, asString, asBoolean } from '../../util.js';
import type { SynthesizeContext, TtsProvider } from '../types.js';

const DEFAULT_BASE = 'https://api.elevenlabs.io';

const info: ProviderInfo = {
  id: 'elevenlabs',
  kind: 'tts',
  label: 'ElevenLabs',
  capabilities: {
    supportsModelList: false,
    supportsVoiceList: true,
    supportsVoiceCloning: true,
    supportsStreaming: false,
    options: [
      {
        key: 'model_id',
        label: 'Model',
        type: 'select',
        options: [
          { value: 'eleven_multilingual_v2', label: 'Eleven Multilingual v2' },
          { value: 'eleven_turbo_v2_5', label: 'Eleven Turbo v2.5' },
          { value: 'eleven_flash_v2_5', label: 'Eleven Flash v2.5' },
        ],
      },
      { key: 'stability', label: 'Stability', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'similarity_boost', label: 'Similarity boost', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'style', label: 'Style', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'use_speaker_boost', label: 'Speaker boost', type: 'boolean' },
    ],
    notes: ['Requires an API key. Voices are fetched from /v1/voices.'],
  },
};

export const elevenlabs: TtsProvider = {
  info,

  async test(conn: Connection): Promise<void> {
    await request(`${base(conn)}/v1/voices`, { headers: authHeaders(conn) });
  },

  async listVoices(conn: Connection): Promise<VoiceInfo[]> {
    const data = await readJson<{ voices?: { voice_id?: string; name?: string }[] }>(
      await request(`${base(conn)}/v1/voices`, { headers: authHeaders(conn) }),
    );
    return (data.voices ?? []).map((v) => ({ id: v.voice_id ?? '', name: v.name ?? v.voice_id })).filter((v) => v.id);
  },

  async synthesize(conn: Connection, text: string, ctx: SynthesizeContext): Promise<Buffer> {
    const opt = conn.providerOptions as Record<string, unknown>;
    const body: Record<string, unknown> = {
      text,
      model_id: asString(opt.model_id, 'eleven_multilingual_v2'),
      voice_settings: {
        stability: asNumber(opt.stability, 0.5),
        similarity_boost: asNumber(opt.similarity_boost, 0.75),
        style: asNumber(opt.style, 0),
        use_speaker_boost: asBoolean(opt.use_speaker_boost, true),
      },
    };
    const res = await jsonPost(
      `${base(conn)}/v1/text-to-speech/${encodeURIComponent(ctx.voiceId)}`,
      body,
      authHeaders(conn),
    );
    return Buffer.from(await res.arrayBuffer());
  },

  async cloneVoice(conn: Connection, sample: Buffer, name: string, transcript?: string): Promise<string> {
    const form = new FormData();
    form.append('files', new Blob([sample], { type: 'audio/wav' }), 'sample.wav');
    form.append('name', name);
    if (transcript) {
      form.append('labels', JSON.stringify({ description: transcript.slice(0, 500) }));
    }
    const data = await readJson<{ voice_id?: string }>(
      await multipartPost(`${base(conn)}/v1/voices`, form, authHeaders(conn)),
    );
    if (!data.voice_id) throw new Error('ElevenLabs clone returned no voice_id');
    return data.voice_id;
  },
};

function base(conn: Connection): string {
  return asString(conn.baseUrl, DEFAULT_BASE).replace(/\/+$/, '');
}