export type Id = string

export interface Stamped {
  id: Id
  created: string
  updated: string
}

export interface Character extends Stamped {
  name: string
  description: string
  personality: string
  system_prompt: string
  post_history_instructions: string
  mes_example: string
  tags: string[]
  creator_notes: string | null
  avatarPath: string | null
  voiceSamplePath: string | null
  voiceSampleTranscript: string | null
  /** Optional per-character LLM connection override (sequential turns). */
  llmConnectionId: string | null
}

export interface Story extends Stamped {
  name: string
  summary: string
}

export interface Narrator extends Stamped {
  name: string
  avatarPath: string | null
  voiceSamplePath: string | null
  voiceSampleTranscript: string | null
}

export interface CharacterGroup extends Stamped {
  name: string
  description: string
  avatarPath: string | null
  memberIds: Id[]
}

export type ReplyMode = 'all' | 'selected' | 'llm'

export type PersonaGender = 'male' | 'female' | 'other'

export interface Persona extends Stamped {
  name: string
  avatarPath: string | null
  description: string
  gender: PersonaGender
  voiceSamplePath: string | null
  voiceSampleTranscript: string | null
  thoughtSamplePath: string | null
  thoughtSampleTranscript: string | null
}

export interface InlineScenario {
  name: string
  scenario: string
  first_mes: string
}

export interface LoreEntry {
  id: Id
  keys: string[]
  content: string
  name: string
  enabled: boolean
  insertion_order: number
  case_sensitive: boolean
  priority: number
  selective: boolean
  secondary_keys: string[]
  constant: boolean
  comment: string
  position: 'before_char' | 'after_char'
}

export interface Lorebook extends Stamped {
  name: string
  description: string
  scan_depth: number
  token_budget: number
  recursive_scanning: boolean
  extensions: Record<string, unknown>
  entries: LoreEntry[]
}

export interface Scenario extends Stamped {
  name: string
  description: string
  first_mes: string
  scenario: string
  alternate_greetings: string[]
}

export type Role = 'user' | 'assistant'

export interface SpeakerSnapshot {
  characterId: string | null
  name: string
  avatarPath: string | null
  voiceSamplePath: string | null
}

export interface MessageAudio {
  id: Id
  text: string
  path: string
  ts: string
}

export interface ChatMessage {
  id: Id
  role: Role
  speaker: SpeakerSnapshot
  content: string
  audioPath: string | null
  audio: MessageAudio[]
  images: string[]
  ts: string
}

export interface RemovedParticipant {
  characterId: Id
  name: string
  avatarPath: string | null
  removedAt: string
}

export interface ChatRuntime {
  temperature: number
  topP: number
  maxTokens: number
  autoTts: boolean
  disableThinking: boolean
  dialogueOnly: boolean
  sequentialTurns: boolean
  llmConnectionId: Id | null
  ttsConnectionId: Id | null
}

export interface Chat extends Stamped {
  title: string
  participantIds: Id[]
  removedParticipants: RemovedParticipant[]
  lorebookIds: Id[]
  scenarioId: Id | null
  scenarioInline: InlineScenario | null
  storyId: Id | null
  narratorId: Id | null
  personaId: Id | null
  messages: ChatMessage[]
  runtime: ChatRuntime
}

export type ConnectionKind = 'llm' | 'stt' | 'tts'
export type LlmProvider = 'openai-compatible' | 'ollama'
export type SttProvider = 'openai-whisper' | 'whispercpp'
export type TtsProvider = 'elevenlabs' | 'cartesia' | 'omnivoice' | 'dots'
export type Provider = LlmProvider | SttProvider | TtsProvider

export interface Connection {
  id: Id
  name: string
  kind: ConnectionKind
  provider: Provider
  baseUrl: string
  apiKey: string
  modelOrVoice: string
  providerOptions: Record<string, unknown>
  /** Context window budget in tokens for LLM connections; history is trimmed to fit. */
  contextTokens: number | null
}

export interface ProviderOptionDef {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'select'
  placeholder?: string
  min?: number
  max?: number
  step?: number
  options?: { value: string; label: string }[]
  help?: string
}

export interface ProviderCapabilities {
  supportsModelList: boolean
  supportsVoiceList: boolean
  supportsVoiceCloning: boolean
  supportsStreaming: boolean
  options: ProviderOptionDef[]
  notes: string[]
}

export interface ProviderInfo {
  id: Provider
  kind: ConnectionKind
  label: string
  capabilities: ProviderCapabilities
}

export interface TestResult {
  ok: boolean
  kind: ConnectionKind
  provider: Provider
  capabilities: ProviderCapabilities
  models: { id: string; name?: string }[]
  voices: { id: string; name?: string }[]
  error?: string
}

export interface ScenarioDraft {
  name: string
  description: string
  first_mes: string
  scenario: string
  alternate_greetings: string[]
}

export interface ImportDraft {
  importId: Id
  character: Pick<Character, 'name' | 'description' | 'personality' | 'system_prompt' | 'post_history_instructions' | 'mes_example' | 'tags' | 'creator_notes'>
  lorebook: Lorebook | null
  scenario: ScenarioDraft | null
  hasAvatar: boolean
  avatarDataUrl: string | null
  cardKind: 'png' | 'json'
  /** Present in .zdc imports: playable preview of the bundled voice sample. */
  voiceSampleDataUrl?: string | null
  transcript?: string | null
  voiceSample?: boolean
}

/** Preview payload from a .zdn import (audio/image as inline data URLs). */
export interface ZdnImportDraft {
  importId: Id
  narrator: { name: string }
  transcript: string | null
  hasAvatar: boolean
  avatarDataUrl: string | null
  voiceSampleDataUrl: string | null
}

/** Preview payload from a .zdp import (both samples as inline data URLs). */
export interface ZdpImportDraft {
  importId: Id
  persona: { name: string; description: string; gender: PersonaGender }
  voiceTranscript: string | null
  thoughtTranscript: string | null
  hasAvatar: boolean
  avatarDataUrl: string | null
  voiceSampleDataUrl: string | null
  thoughtSampleDataUrl: string | null
}

export interface ChatDetail {
  chat: Chat
  characters: Character[]
  lorebooks: Lorebook[]
  scenario: Scenario | null
  narrator: Narrator | null
  persona: Persona | null
}

export interface ChatSummary {
  id: Id
  title: string
  updated: string
  created: string
  messageCount: number
  participantCount: number
  avatarPaths: (string | null)[]
}