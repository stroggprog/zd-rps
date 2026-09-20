import type {
  Connection,
  LlmMessage,
  LlmOptions,
  ModelInfo,
  ProviderInfo,
  VoiceInfo,
} from '../types.js';

export interface StreamControl {
  aborted: boolean;
}

export interface LlmProvider {
  info: ProviderInfo;
  test(conn: Connection): Promise<void>;
  listModels(conn: Connection): Promise<ModelInfo[]>;
  complete(conn: Connection, messages: LlmMessage[], opts: LlmOptions): Promise<string>;
  stream?(
    conn: Connection,
    messages: LlmMessage[],
    opts: LlmOptions,
    onDelta: (delta: string) => void,
    ctrl: StreamControl,
  ): Promise<void>;
}

export interface SttProvider {
  info: ProviderInfo;
  test(conn: Connection): Promise<void>;
  transcribe(conn: Connection, audio: Buffer, mime: string): Promise<string>;
}

export interface SynthesizeContext {
  voiceId: string;
  referenceAudio?: Buffer;
  referenceText?: string;
}

export interface TtsProvider {
  info: ProviderInfo;
  test(conn: Connection): Promise<void>;
  listVoices(conn: Connection): Promise<VoiceInfo[]>;
  listModels?(conn: Connection): Promise<ModelInfo[]>;
  synthesize(conn: Connection, text: string, ctx: SynthesizeContext): Promise<Buffer>;
  cloneVoice?(
    conn: Connection,
    sample: Buffer,
    name: string,
    transcript?: string,
  ): Promise<string>;
}