import type {
  Character,
  Chat,
  Connection,
  LlmMessage,
  Lorebook,
  RemovedParticipant,
  Scenario,
} from './types.js';
import { getLlmProvider } from './providers/factory.js';
import { scanLore } from './lore.js';

export const USER_NAME = 'User';

export interface ChatContext {
  chat: Chat;
  activeCharacters: Character[];
  removed: RemovedParticipant[];
  lorebooks: Lorebook[];
  scenario: Scenario | null;
}

export interface Reply {
  name: string | null;
  content: string;
}

function substitute(text: string, character: Character): string {
  return text
    .replace(/\{\{char\}\}/g, character.name)
    .replace(/\{\{user\}\}/g, USER_NAME);
}

function characterBlock(character: Character): string {
  const lines: string[] = [`[Character: ${character.name}]`];
  if (character.description) lines.push(`Description: ${substitute(character.description, character)}`);
  if (character.personality) lines.push(`Personality: ${substitute(character.personality, character)}`);
  if (character.system_prompt) lines.push(`System: ${substitute(character.system_prompt, character)}`);
  if (character.post_history_instructions) {
    lines.push(`Post-history instructions: ${substitute(character.post_history_instructions, character)}`);
  }
  if (character.mes_example) lines.push(`Example messages:\n${substitute(character.mes_example, character)}`);
  return lines.join('\n');
}

export function buildLlmMessages(ctx: ChatContext, historyTail: number): LlmMessage[] {
  const { chat, activeCharacters, removed, lorebooks, scenario } = ctx;
  const names = activeCharacters.map((c) => c.name);

  const systemParts: string[] = [];
  systemParts.push(
    `You are running a roleplay chat between multiple characters and the user. ` +
      `The active characters are: ${names.join(', ') || '(none yet)'}. ` +
      `Active characters may each respond. Speak only as one of the active characters; never speak for ${USER_NAME}.`,
  );
  if (activeCharacters.length > 1) {
    systemParts.push(`When you reply, start with the speaking character's name followed by a colon, e.g. "${names[0]}: ...".`);
  }
  systemParts.push(
    `Formatting (required): ` +
      `Write all speech in double quotes, e.g. "Spoken like a leader." ` +
      `Separate speech from narration, and narration from speech, with a blank line (a paragraph break). ` +
      `Never put line breaks inside speech. ` +
      `Use single quotes only for quotations or borrowed terms, never for speech. ` +
      `Mark emphasis with _underscores_, bold with **asterisks**, and bullet points as "* item" with one per line.`,
  );
  for (const character of activeCharacters) {
    systemParts.push(`${characterBlock(character)}\n`);
  }
  if (removed.length > 0) {
    systemParts.push(
      `The following characters are present in conversation history but are no longer active participants: ` +
        `${removed.map((r) => r.name).join(', ')}. You may reference them when relevant, but they must not speak.`,
    );
  }
  if (scenario) {
    const parts = ['Scenario:'];
    if (scenario.scenario) parts.push(scenario.scenario);
    if (scenario.first_mes) parts.push(`Opening message: ${scenario.first_mes}`);
    systemParts.push(parts.join('\n'));
  }

  const system: LlmMessage = {
    role: 'system',
    content: systemParts.join('\n\n'),
  };

  const roleplayText = chat.messages
    .map((m) => {
      const name = m.speaker.characterId === null ? USER_NAME : m.speaker.name;
      return `${name}: ${m.content}`;
    })
    .join('\n');

  const lore = scanLore(lorebooks, roleplayText);
  if (lore.before.length > 0) {
    system.content += `\n\nWorld knowledge (relevant lore):\n${lore.before.join('\n\n')}`;
  }

  const messages: LlmMessage[] = [system];
  const tail = historyTail > 0 ? chat.messages.slice(-historyTail) : chat.messages;
  for (const m of tail) {
    const isUser = m.speaker.characterId === null;
    messages.push({
      role: isUser ? 'user' : 'assistant',
      content: `${isUser ? USER_NAME : m.speaker.name}: ${m.content}`,
    });
  }
  return messages;
}

const NAME_PREFIX = /^([A-Za-z0-9 _.'-]{1,60}):\s*(.+)$/s;

export function attributeReply(reply: string, activeNames: string[]): Reply {
  const match = NAME_PREFIX.exec(reply.trim());
  if (match) {
    const candidate = match[1].trim();
    for (const name of activeNames) {
      if (candidate.toLowerCase() === name.toLowerCase()) {
        return { name, content: match[2].trim() };
      }
    }
  }
  return { name: null, content: reply.trim() };
}

export interface GenerateOptions {
  temperature: number;
  topP: number;
  maxTokens: number;
  disableThinking?: boolean;
}

export interface StreamCallbacks {
  onDelta: (delta: string) => void;
  ctrl: { aborted: boolean };
}

export async function callLlm(
  conn: Connection,
  messages: LlmMessage[],
  opts: GenerateOptions,
): Promise<string> {
  const provider = getLlmProvider(conn);
  return provider.complete(conn, messages, {
    temperature: opts.temperature,
    topP: opts.topP,
    maxTokens: opts.maxTokens,
    disableThinking: opts.disableThinking,
  });
}

export async function streamLlm(
  conn: Connection,
  messages: LlmMessage[],
  opts: GenerateOptions,
  cb: StreamCallbacks,
): Promise<void> {
  const provider = getLlmProvider(conn);
  if (typeof provider.stream !== 'function') {
    const text = await provider.complete(conn, messages, {
      temperature: opts.temperature,
      topP: opts.topP,
      maxTokens: opts.maxTokens,
      disableThinking: opts.disableThinking,
    });
    if (text && !cb.ctrl.aborted) cb.onDelta(text);
    return;
  }
  await provider.stream(
    conn,
    messages,
    {
      temperature: opts.temperature,
      topP: opts.topP,
      maxTokens: opts.maxTokens,
      disableThinking: opts.disableThinking,
    },
    cb.onDelta,
    cb.ctrl,
  );
}