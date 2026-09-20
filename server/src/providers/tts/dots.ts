import type { Connection, ModelInfo, ProviderInfo, VoiceInfo } from '../../types.js';
import { appendV1, jsonPost, readJson, request } from '../http.js';
import { asString } from '../../util.js';
import type { SynthesizeContext, TtsProvider } from '../types.js';

const info: ProviderInfo = {
  id: 'dots',
  kind: 'tts',
  label: 'dots.tts (SGLang Omni server)',
  capabilities: {
    supportsModelList: true,
    supportsVoiceList: false,
    supportsVoiceCloning: true,
    supportsStreaming: false,
    options: [
      {
        key: 'referenceText',
        label: 'Reference transcript for cloning',
        type: 'text',
        help: 'Exact transcript of the character voice sample. Used to clone the voice; higher fidelity than the auto-detected one.',
      },
      {
        key: 'language',
        label: 'Language tag',
        type: 'text',
        placeholder: 'auto_detect',
        help: 'e.g. EN, ZH, Cantonese, or auto_detect.',
      },
      {
        key: 'response_format',
        label: 'Output format',
        type: 'select',
        options: [
          { value: 'wav', label: 'WAV' },
          { value: 'mp3', label: 'MP3' },
          { value: 'flac', label: 'FLAC' },
        ],
      },
    ],
    notes: [
      'Connect to an SGLang Omni server serving a dots.tts checkpoint, e.g. http://localhost:8000.',
      'Voice cloning is per-request: each synthesis carries the character\x27s reference audio. The character\x27s voice sample (WAV) plus its transcript drive the clone; no persistent voice ids exist.',
    ],
  },
};

export const dots: TtsProvider = {
  info,

  async test(conn: Connection): Promise<void> {
    await request(`${appendV1(conn.baseUrl)}/models`, { method: 'GET' });
  },

  async listModels(conn: Connection): Promise<ModelInfo[]> {
    const data = await readJson<{ data?: { id?: string }[] }>(await request(`${appendV1(conn.baseUrl)}/models`, { method: 'GET' }));
    return (data.data ?? []).map((m) => ({ id: m.id ?? '' })).filter((m) => m.id);
  },

  async listVoices(): Promise<VoiceInfo[]> {
    return [];
  },

  async synthesize(conn: Connection, text: string, ctx: SynthesizeContext): Promise<Buffer> {
    const opt = conn.providerOptions as Record<string, unknown>;
    if (!ctx.referenceAudio) {
      throw new Error('dots.tts requires a character voice sample for cloning; set one on the character.');
    }
    const audioPath = `data:audio/wav;base64,${ctx.referenceAudio.toString('base64')}`;
    const body: Record<string, unknown> = {
      model: conn.modelOrVoice,
      input: text,
      response_format: asString(opt.response_format, 'wav'),
      references: [
        {
          audio_path: audioPath,
          text: ctx.referenceText ?? asString(opt.referenceText, 'Reference sample of the speaker voice.'),
        },
      ],
    };
    const language = asString(opt.language);
    if (language) body.language = language;
    const res = await jsonPost(`${appendV1(conn.baseUrl)}/audio/speech`, body);
    return Buffer.from(await res.arrayBuffer());
  },
};