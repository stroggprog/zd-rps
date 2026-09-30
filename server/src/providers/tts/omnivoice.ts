import type { Connection, ProviderInfo, VoiceInfo } from '../../types.js';
import { jsonPost, multipartPost, readJson, request } from '../http.js';
import { asNumber, asString, isObject } from '../../util.js';
import type { SynthesizeContext, TtsProvider } from '../types.js';

const DEFAULT_BASE = 'http://localhost:8880';

const info: ProviderInfo = {
  id: 'omnivoice',
  kind: 'tts',
  label: 'OmniVoice (local server)',
  capabilities: {
    supportsModelList: false,
    supportsVoiceList: true,
    supportsVoiceCloning: true,
    supportsStreaming: true,
    options: [
      { key: 'speed', label: 'Speed (0.25 – 4.0)', type: 'number', min: 0.25, max: 4, step: 0.05 },
      { key: 'num_step', label: 'Inference steps (optional)', type: 'number', min: 1, max: 64, step: 1 },
      {
        key: 'response_format',
        label: 'Output format',
        type: 'select',
        options: [
          { value: 'wav', label: 'WAV' },
          { value: 'pcm', label: 'Raw PCM' },
        ],
      },
    ],
    notes: [
      'Point base URL at an omnivoice-server (OpenAI-compatible), e.g. http://localhost:8880.',
      'Voice modes: auto, design:<attributes>, clone:<profile>. Cloning creates a server-side voice profile from the character sample.',
    ],
  },
};

export const omnivoice: TtsProvider = {
  info,

  async test(conn: Connection): Promise<void> {
    await request(`${base(conn)}/v1/voices`, { method: 'GET' });
  },

  async listVoices(conn: Connection): Promise<VoiceInfo[]> {
    const data = await readJson<{ voices?: unknown[] }>(
      await request(`${base(conn)}/v1/voices`, { method: 'GET' }),
    );
    return (data.voices ?? [])
      .filter(isObject)
      .map((v) => ({
        id: asString(v.id),
        name: asString(v.description) || asString(v.name) || asString(v.id),
      }))
      .filter((v) => v.id && v.id !== 'auto');
  },

  async synthesize(conn: Connection, text: string, ctx: SynthesizeContext): Promise<Buffer> {
    const opt = conn.providerOptions as Record<string, unknown>;
    const body: Record<string, unknown> = {
      model: 'omnivoice',
      input: text,
      voice: ctx.voiceId || 'auto',
      response_format: asString(opt.response_format, 'wav'),
      speed: asNumber(opt.speed, 1),
      stream: false,
    };
    const steps = opt.num_step;
    if (steps !== undefined && steps !== null && steps !== '') {
      body.num_step = Number(steps);
    }
    const res = await jsonPost(`${base(conn)}/v1/audio/speech`, body);
    return Buffer.from(await res.arrayBuffer());
  },

  async cloneVoice(conn: Connection, sample: Buffer, name: string, transcript?: string, subjectId?: string): Promise<string> {
    // Subject-scoped profile id: two identically-named domains (e.g. test
    // instances with the same character names) must not share one profile.
    const cleaned = name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const slug = subjectId ? `${cleaned}-${subjectId.slice(0, 8)}` : cleaned;
    console.log(`[cloneVoice] creating profile ${slug} (${name})`);
    const form = new FormData();
    form.append('profile_id', slug);
    form.append('overwrite', 'true');
    form.append('ref_audio', new Blob([sample], { type: 'audio/wav' }), 'sample.wav');
    if (transcript) form.append('ref_text', transcript);
    await multipartPost(`${base(conn)}/v1/voices/profiles`, form);
    return `clone:${slug}`;
  },
};

function base(conn: Connection): string {
  return asString(conn.baseUrl, DEFAULT_BASE).replace(/\/+$/, '');
}