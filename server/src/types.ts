export type Id = string;

export interface Stamped {
  id: Id;
  created: string;
  updated: string;
}

export type CharacterKind = 'character' | 'narrator';

export interface Character extends Stamped {
  kind: CharacterKind;
  name: string;
  description: string;
  personality: string;
  system_prompt: string;
  post_history_instructions: string;
  mes_example: string;
  tags: string[];
  avatarPath: string | null;
  voiceSamplePath: string | null;
  voiceSampleTranscript: string | null;
}

export interface LoreEntry {
  id: Id;
  keys: string[];
  content: string;
  name: string;
  enabled: boolean;
  insertion_order: number;
  case_sensitive: boolean;
  priority: number;
  selective: boolean;
  secondary_keys: string[];
  constant: boolean;
  comment: string;
  position: 'before_char' | 'after_char';
}

export interface Lorebook extends Stamped {
  name: string;
  description: string;
  scan_depth: number;
  token_budget: number;
  recursive_scanning: boolean;
  extensions: Record<string, unknown>;
  entries: LoreEntry[];
}

export interface Scenario extends Stamped {
  name: string;
  description: string;
  first_mes: string;
  scenario: string;
  alternate_greetings: string[];
}

export type Role = 'system' | 'user' | 'assistant';

export interface SpeakerSnapshot {
  characterId: string | null;
  name: string;
  avatarPath: string | null;
  voiceSamplePath: string | null;
}

export interface ChatMessage {
  id: Id;
  role: Role;
  speaker: SpeakerSnapshot;
  content: string;
  audioPath: string | null;
  audio: MessageAudio[];
  images: string[];
  ts: string;
}

export interface MessageAudio {
  id: Id;
  text: string;
  path: string;
  ts: string;
}

export interface RemovedParticipant {
  characterId: Id;
  name: string;
  avatarPath: string | null;
  removedAt: string;
}

export interface ChatRuntime {
  temperature: number;
  topP: number;
  maxTokens: number;
  autoTts: boolean;
  disableThinking: boolean;
  llmConnectionId: Id | null;
  ttsConnectionId: Id | null;
}

export interface Chat extends Stamped {
  title: string;
  participantIds: Id[];
  removedParticipants: RemovedParticipant[];
  lorebookIds: Id[];
  scenarioId: Id | null;
  narratorId: Id | null;
  messages: ChatMessage[];
  runtime: ChatRuntime;
}

export type ConnectionKind = 'llm' | 'stt' | 'tts';

export type LlmProvider = 'openai-compatible' | 'ollama';
export type SttProvider = 'openai-whisper' | 'whispercpp';
export type TtsProvider = 'elevenlabs' | 'cartesia' | 'omnivoice' | 'dots';
export type Provider = LlmProvider | SttProvider | TtsProvider;

export interface Connection {
  id: Id;
  name: string;
  kind: ConnectionKind;
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  modelOrVoice: string;
  providerOptions: Record<string, unknown>;
}

export interface AppConfig {
  connections: Connection[];
  defaultLlm: Id | null;
  defaultStt: Id | null;
  defaultTts: Id | null;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmOptions {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  disableThinking?: boolean;
}

export interface ModelInfo {
  id: string;
  name?: string;
}

export interface VoiceInfo {
  id: string;
  name?: string;
}

export interface ProviderOptionDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select';
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  help?: string;
}

export interface ProviderCapabilities {
  supportsModelList: boolean;
  supportsVoiceList: boolean;
  supportsVoiceCloning: boolean;
  supportsStreaming: boolean;
  options: ProviderOptionDef[];
  notes: string[];
}

export interface ProviderInfo {
  id: Provider;
  kind: ConnectionKind;
  label: string;
  capabilities: ProviderCapabilities;
}

export interface ImportSuggestion {
  kind: 'lorebook' | 'scenario';
  accepted: boolean;
  entityId: Id | null;
  name: string;
}