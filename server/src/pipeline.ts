import type {
  Character,
  Chat,
  Connection,
  LlmMessage,
  Lorebook,
  Persona,
  PersonaGender,
  RemovedParticipant,
  Scenario,
} from './types.js';
import { getLlmProvider } from './providers/factory.js';
import { getConfig } from './config.js';
import { scanLore } from './lore.js';

export const USER_NAME = 'User';

export interface ChatContext {
  chat: Chat;
  activeCharacters: Character[];
  removed: RemovedParticipant[];
  lorebooks: Lorebook[];
  scenario: Scenario | null;
  persona: Persona | null;
  story: { name: string; summary: string } | null;
  /** Groups with at least one active member, for team-aware behavior. */
  groups: import('./types.js').CharacterGroup[];
}

export interface Reply {
  name: string | null;
  content: string;
}

/** The user's display name for the chat: their persona's name, falling back to "User". */
export function userNameFor(persona: Persona | null): string {
  return persona && persona.name.trim() ? persona.name.trim() : USER_NAME;
}

const GENDER_LABEL: Record<PersonaGender, string> = {
  male: 'male',
  female: 'female',
  other: 'of another gender identity',
};

function personaBlock(persona: Persona): string {
  const name = userNameFor(persona);
  const lines: string[] = [`[The user: ${name}]`];
  lines.push(`${name} is ${GENDER_LABEL[persona.gender] ?? 'of another gender identity'} and controls this side of the conversation.`);
  if (persona.description.trim()) lines.push(`About ${name}: ${persona.description.trim()}`);
  return lines.join('\n');
}

function substitute(text: string, character: Character, userName: string): string {
  return text
    .replace(/\{\{char\}\}/g, character.name)
    .replace(/\{\{user\}\}/g, userName);
}

function characterBlock(character: Character, userName: string): string {
  const lines: string[] = [`[Character: ${character.name}]`];
  if (character.tags.length > 0) lines.push(`Tags: ${character.tags.join(', ')}`);
  if (character.description) lines.push(`Description: ${substitute(character.description, character, userName)}`);
  if (character.personality) lines.push(`Personality: ${substitute(character.personality, character, userName)}`);
  if (character.system_prompt) lines.push(`System: ${substitute(character.system_prompt, character, userName)}`);
  if (character.post_history_instructions) {
    lines.push(`Post-history instructions: ${substitute(character.post_history_instructions, character, userName)}`);
  }
  if (character.mes_example) lines.push(`Example messages:\n${substitute(character.mes_example, character, userName)}`);
  return lines.join('\n');
}

export interface BuildOptions {
  /** When set, the call writes that character's turn ONLY (sequential-turns mode). */
  replyAs?: Character;
}

export function buildLlmMessages(ctx: ChatContext, historyTail: number, options: BuildOptions = {}): LlmMessage[] {
  const { chat, activeCharacters, removed, lorebooks, scenario, story, groups } = ctx;
  const userName = userNameFor(ctx.persona);
  const names = activeCharacters.map((c) => c.name);

  let lastSystemRule: string | null = null;
  const systemParts: string[] = [];
  const target = options.replyAs ?? null;
  // A user-defined framing (optional) replaces the built-in one wholesale;
  // placeholders {{user}} and {{characters}} are substituted if present.
  const override = getConfig().systemPromptOverride;

  if (override !== null && override !== undefined && override.trim() !== '') {
    // Custom framing: substitute placeholders, then paste everything else.
    systemParts.push(
      override
        .replace(/\{\{user\}\}/g, userName)
        .replace(/\{\{characters\}\}/g, names.join(', ')),
    );
  } else if (target) {
    // Sequential-turns mode: this call owns exactly one character. The framing
    // must leave no room for the model to script the whole ensemble (it will
    // otherwise, happily, write everyone's lines).
    systemParts.push(
      `Roleplay turn. You are ${target.name}'s agent: the ONLY character you may write for is ${target.name}. ` +
        `Other participants exist in the transcript (their turns were written by separate agents before you), ` +
        `but they receive their own prompts — never write their speech, narration, or dialogue. ` +
        `Never speak for ${userName} either. ` +
        `Your turn: ${target.name}'s speech in double quotes first, then ${target.name}'s narration; ` +
        `do not add any name label. ` +
        `Structure your turn as SEPARATE paragraphs: one paragraph of speech (in double quotes), ` +
        `then a paragraph of narration about ${target.name}'s actions — never merge speech and narration ` +
        `into one paragraph, and repeat that pattern if you speak more than once. ` +
        `If you cannot add anything meaningful as ${target.name}, reply with a single short paragraph (still only ${target.name}).`,
    );
  } else {
    systemParts.push(
      `You are running a roleplay chat between multiple characters and the user. ` +
        `The active characters are: ${names.join(', ') || '(none yet)'}. ` +
        `Active characters may each respond. Speak only as one of the active characters; never speak for ${userName}.`,
    );
  }
  if (story && story.summary.trim()) {
    systemParts.push(
      `Story so far (${story.name}):\n${story.summary}\n` +
        `Continue the roleplay with this accumulated story context in mind; ` +
        `it summarizes everything before the visible transcript.`,
    );
  }
  const personaName = userNameFor(ctx.persona);
  if (ctx.persona && (ctx.persona.description.trim() || (personaName !== USER_NAME && personaName !== 'You'))) {
    systemParts.push(personaBlock(ctx.persona));
  }
  if (override === null || override.trim() === '') {
    if (!target && activeCharacters.length > 1) {
      systemParts.push(`When you reply, start with the speaking character's name followed by a colon, e.g. "${names[0]}: ...".`);
    }
  }
  systemParts.push(
    `Formatting (required): ` +
      `Write all speech in double quotes, e.g. "Spoken like a leader." ` +
      `A speech paragraph must START with its double quote; a paragraph ending in a closing quote ` +
      `without an opening one is an error. ` +
      `Separate speech from narration, and narration from speech, with a blank line (a paragraph break). ` +
      `Never put line breaks inside speech. ` +
      `Use single quotes only for quotations or borrowed terms, never for speech. ` +
      `Mark emphasis with _underscores_, bold with **asterisks**, and bullet points as "* item" with one per line.`,
  );
  if (override !== null && override.trim() !== '') {
    // Custom framing supersedes the built-in narration/handover rules.
  } else {
    if (chat.runtime.dialogueOnly) {
      const dialogueRule =
        `Dialogue ONLY (ABSOLUTE RULE): write ONLY spoken lines in double quotes. ` +
          `NO narration whatsoever - do not describe actions, expressions, scenes, gestures or images. ` +
          `Each character's speech is its own quoted paragraph: EVERY paragraph begins with the speaking ` +
          `character's \`Name:\` label immediately followed by their quoted speech. When another ` +
          `character's turn begins, start a NEW paragraph with THEIR label. Never put two characters' ` +
          `speech into the same paragraph, and never write another character's label inside your own ` +
          `speech. Older transcript paragraphs containing narration or unlabeled speech demonstrate ` +
          `OUTDATED formatting - never copy it.\n\n` +
          `CORRECT output shape for a two-character reply (and nothing else):\n` +
          `Sam: "Right! I'm in position. Talk to me, Zen!"\n` +
          `Rin: "Copy that. Radio silence from here on."\n\n` +
          `WRONG (never do this):\n` +
          `"Right! I'm in position. Talk to me, Zen!" "Copy that, Sam."\n\n` +
          `This rule includes the name labels and overrides every other instruction about writing prose.`;
      systemParts.push(dialogueRule);
      lastSystemRule = dialogueRule;
    } else {
      systemParts.push(
        `Narration (required): each character's turn must include narration — description of actions, ` +
          `expressions and small details — not just dialogue. Narration is never shortened or omitted because ` +
          `of any character's instructions. Instructions labelled "Private instruction" apply exclusively to ` +
          `that one character's own speech; they must not change the length, tone, or narration of any other ` +
          `character or of the prose itself.`,
      );
    }
  }
  if (!override && !target) {
    const allNames = activeCharacters.map((c) => c.name).join(', ');
    systemParts.push(
      `Reply framing (required, no exceptions): EVERY reply — even in single-character scenes — ` +
        `BEGINS with a name label on its own line, exactly \`Name: "speech"\`, naming the character ` +
        `who speaks first. Never open a reply without the label. A reply that starts with dialogue, ` +
        `narration, a quotation mark, or any other text before the label violates this rule.`,
    );
    if (activeCharacters.length > 1) {
      systemParts.push(
        `Turn handovers (required): when another character speaks after you, end your paragraph and start ` +
          `a NEW paragraph that BEGINS with their name label, exactly \`Name: "speech"\`, followed by their ` +
          `narration paragraphs. A paragraph may contain only one character's content — never merge ` +
          `characters or put another character's narration into your own paragraph. ` +
          `When everyone appropriate has spoken for this reply, simply stop — never continue writing ` +
          `for characters beyond the one named.`,
      );
      systemParts.push(
        `ALL PARTICIPANTS RESPOND (mandatory): every participant in this scene — ${allNames} — MUST ` +
          `contribute at least one paragraph in every reply. Every paragraph a participant contributes ` +
          `must begin with their \`Name:\` label. A reply that contains fewer labeled paragraphs than ` +
          `there are participants is INCOMPLETE and violates this rule. This applies even to short ` +
          `exchanges like check-ins or acknowledgements: one labeled line per participant is still required.`,
      );
    }
  }
  for (const character of target ? [target] : activeCharacters) {
    systemParts.push(`${characterBlock(character, userName)}\n`);
  }
  if (target) {
    systemParts.push(
      `Reminder: there are no other characters to write for. Produce ${target.name}'s turn only.`,
    );
  }
  for (const group of groups ?? []) {
    const lines = [`[Group: ${group.name}]`];
    if (group.description.trim()) lines.push(`Description: ${group.description.trim()}`);
    const members = group.memberIds
      .map((id) => (activeCharacters.find((c) => c.id === id) ?? removed.find((r) => r.characterId === id))?.name)
      .filter(Boolean);
    lines.push(`Members (your teammates): ${members.join(', ')}`);
    lines.push(
      `You belong to this group: binding for all members, with EVERY member obeying the description. ` +
        `If the description specifies how members address anyone, follow it exactly, even if older ` +
        `transcript lines show different usage.`,
    );
    systemParts.push(lines.join('\n'));
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
      const name = m.speaker.characterId === null ? userName : m.speaker.name;
      return `${name}: ${m.content}`;
    })
    .join('\n');

  const lore = scanLore(lorebooks, roleplayText);
  if (lore.before.length > 0) {
    system.content += `\n\nWorld knowledge (relevant lore):\n${lore.before.join('\n\n')}`;
  }

  if (lastSystemRule) {
    system.content += `\n\nSTRICT REMINDER: ${lastSystemRule}`;
  }

  const messages: LlmMessage[] = [system];
  const tail = historyTail > 0 ? chat.messages.slice(-historyTail) : chat.messages;
  if (historyTail > 0 && historyTail < chat.messages.length) {
    system.content +=
      `\n\nNote: the transcript has been trimmed to fit the context window; ` +
      `the earliest exchanges (about ${chat.messages.length - historyTail} messages) are omitted. ` +
      `You may still reference them generically, but rely on what you can see.`;
  }
  for (const m of tail) {
    const isUser = m.speaker.characterId === null;
    messages.push({
      role: isUser ? 'user' : 'assistant',
      content: `${isUser ? userName : m.speaker.name}: ${m.content}`,
    });
  }
  return messages;
}

/** Conservative token estimate; ~3.2 chars per token keeps numeric headroom. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.2);
}

/**
 * How many trailing history messages fit the context window:
 * budget = contextTokens - generation budget, walking history backwards,
 * always keeping at least the last 2 messages.
 */
export function historyTailFor(chat: Chat, contextTokens: number, maxTokens: number): number {
  const budget = contextTokens - maxTokens;
  if (budget <= 0) return Math.min(2, chat.messages.length);
  let used = 0;
  let tail = 0;
  for (let i = chat.messages.length - 1; i >= 0; i -= 1) {
    const m = chat.messages[i];
    used += estimateTokens(`${m.speaker.name}: ${m.content}`);
    if (used > budget) break;
    tail += 1;
  }
  return Math.min(Math.max(tail, 2), chat.messages.length);
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