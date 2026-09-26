export type Id = string;

export interface Stamped {
  id: Id;
  created: string;
  updated: string;
}

export interface Character extends Stamped {
  name: string;
  description: string;
  personality: string;
  system_prompt: string;
  post_history_instructions: string;
  mes_example: string;
  tags: string[];
  creator_notes: string | null;
  avatarPath: string | null;
  voiceSamplePath: string | null;
  voiceSampleTranscript: string | null;
  /** Optional per-character LLM connection override (sequential turns). */
  llmConnectionId: string | null;
}

export interface CharacterGroup extends Stamped {
  name: string;
  description: string;
  avatarPath: string | null;
  memberIds: Id[];
}

export interface Story extends Stamped {
  name: string;
  summary: string;
}

export interface Narrator extends Stamped {
  name: string;
  avatarPath: string | null;
  voiceSamplePath: string | null;
  voiceSampleTranscript: string | null;
}

export type PersonaGender = 'male' | 'female' | 'other';

export interface Persona extends Stamped {
  name: string;
  avatarPath: string | null;
  description: string;
  gender: PersonaGender;
}

/** Minimal shape both characters and narrators expose for TTS synthesis. */
export interface VoiceSubject {
  id: string;
  name: string;
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
  /** One LLM call per participant per turn, instead of relying on labeled handovers. */
  sequentialTurns: boolean;
  llmConnectionId: Id | null;
  ttsConnectionId: Id | null;
}

/** Ad-hoc scenario attached directly to a chat instead of the shared library. */
export interface InlineScenario {
  name: string;
  scenario: string;
  first_mes: string;
}

export interface Chat extends Stamped {
  title: string;
  participantIds: Id[];
  removedParticipants: RemovedParticipant[];
  lorebookIds: Id[];
  scenarioId: Id | null;
  scenarioInline: InlineScenario | null;
  storyId: Id | null;
  narratorId: Id | null;
  personaId: Id | null;
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
  /** Context window budget in tokens for LLM connections; history is trimmed to fit. */
  contextTokens: number | null;
}

export interface AppConfig {
  connections: Connection[];
  defaultLlm: Id | null;
  defaultStt: Id | null;
  defaultTts: Id | null;
  /** Custom TTS test text (falls back to the built-in default). */
  testText: string | null;
  /** Write per-reply debug dumps into debug-rounds/ when true (default). */
  debug: boolean;
  /** Optional replacement for the framing portion of the LLM system prompt. */
  systemPromptOverride: string | null;
}

/** Non-dynamic core of the built-in framing instructions (the parts users may edit). */
export const BUILTIN_FRAMING = {
  classic:
    `You are running a roleplay chat between multiple characters and the user. ` +
    `The active characters are: {{characters}}. ` +
    `Active characters may each respond. Speak only as one of the active characters; never speak for {{user}}.`,
  formatting:
    `Formatting (required): ` +
    `Write all speech in double quotes, e.g. "Spoken like a leader." ` +
    `A speech paragraph must START with its double quote; a paragraph ending in a closing quote ` +
    `without an opening one is an error. ` +
    `Separate speech from narration, and narration from speech, with a blank line (a paragraph break). ` +
    `Never put line breaks inside speech. ` +
    `Use single quotes only for quotations or borrowed terms, never for speech. ` +
    `Mark emphasis with _underscores_, bold with **asterisks**, and bullet points as "* item" with one per line.`,
};

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