import { promises as fs, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import type { AppContext } from '../context.js';
import type { Request as ERequest, Response as EResponse } from 'express';
import type {
  Character,
  Chat,
  ChatMessage,
  Connection,
  Id,
  MessageAudio,
  Narrator,
  LlmMessage,
  Scenario,
  SpeakerSnapshot,
  VoiceSubject,
} from '../types.js';
import { DATA_DIR, DIR, ROOT } from '../paths.js';
import { getConfig } from '../config.js';
import { buildLlmMessages, callLlm, historyTailFor, streamLlm, userNameFor, USER_NAME } from '../pipeline.js';
import { chatPersona } from '../store.js';
import { synthesizeCharacterSpeech, audioExt } from '../ttsService.js';
import { ParagraphStream, SentenceStream } from '../streaming.js';
import { QuotationTracker } from '../speech.js';
import { SpeechFormatter } from '../formatting.js';
import { OrderedAudio, type AudioResult } from '../orderedAudio.js';
import { ApiError, asString, ensureDir, now, uuid } from '../util.js';
import { asyncHandler, idParam, readJsonBody } from './helpers.js';
import { mkdirSync, writeFileSync } from 'node:fs';

// Audiobook progress registry (chat id → 0..1), shared with the status route.
const audiobookProgress = new Map<string, { done: number; total: number }>();

function resolveKindConnection(kind: 'llm' | 'stt' | 'tts', runtimeValue: Id | null): Connection {
  const config = getConfig();
  const defaultKey = kind === 'llm' ? 'defaultLlm' : kind === 'stt' ? 'defaultStt' : 'defaultTts';
  const id = runtimeValue ?? config[defaultKey];
  const conn = id ? config.connections.find((c) => c.id === id && c.kind === kind) : undefined;
  if (!conn) throw new ApiError(`No ${kind.toUpperCase()} connection selected. Configure one and set it as default.`, 400);
  return conn;
}

/** The chat's scenario: library entity when referenced, otherwise its ad-hoc inline one. */
function scenarioFor(ctx: AppContext, chat: Chat): Scenario | null {
  if (chat.scenarioId) return ctx.store.scenarios.get(chat.scenarioId) ?? null;
  if (chat.scenarioInline) {
    return {
      id: 'inline',
      name: chat.scenarioInline.name || 'Ad-hoc scenario',
      description: '',
      scenario: chat.scenarioInline.scenario,
      first_mes: chat.scenarioInline.first_mes,
      alternate_greetings: [],
      created: chat.created,
      updated: chat.updated,
    };
  }
  return null;
}

function listSummary(ctx: AppContext, chat: Chat) {
  return {
    id: chat.id,
    title: chat.title,
    updated: chat.updated,
    created: chat.created,
    messageCount: chat.messages.length,
    participantCount: chat.participantIds.length,
    avatarPaths: chat.participantIds
      .map((pid) => ctx.store.characters.get(pid)?.avatarPath ?? null)
      .slice(0, 4),
  };
}

export function chatsRouter(ctx: AppContext): Router {
  const router = Router();
  const { chats } = ctx.store;

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json([...chats.list()].sort((a, b) => b.updated.localeCompare(a.updated)).map((c) => listSummary(ctx, c)));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const chat = chats.getOrThrow(idParam(req));
      const narrator = chat.narratorId ? ctx.store.narrators.get(chat.narratorId) ?? null : null;
      res.json({
        chat,
        characters: chat.participantIds
          .map((pid) => ctx.store.characters.get(pid))
          .filter((c): c is Character => c !== undefined),
        lorebooks: chat.lorebookIds
          .map((bid) => ctx.store.lorebooks.get(bid))
          .filter((b) => b !== undefined),
        scenario: scenarioFor(ctx, chat),
        narrator,
        persona: chatPersona(ctx.store, chat),
      });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = readJsonBody<{
        title?: string;
        participantIds?: Id[];
        lorebookIds?: Id[];
        scenarioId?: Id | null;
        scenarioInline?: { name?: string; scenario?: string; first_mes?: string } | null;
        narratorId?: Id | null;
        personaId?: Id | null;
        storyId?: Id | null;
      }>(req);
      const participantIds = Array.isArray(body.participantIds)
        ? [...new Set(body.participantIds.filter((id) => ctx.store.characters.exists(id)))]
        : [];
      const lorebookIds = Array.isArray(body.lorebookIds)
        ? [...new Set(body.lorebookIds.filter((id) => ctx.store.lorebooks.exists(id)))]
        : [];
      const scenarioId = body.scenarioId && ctx.store.scenarios.exists(body.scenarioId) ? body.scenarioId : null;
      const narratorId = body.narratorId && ctx.store.narrators.exists(body.narratorId) ? body.narratorId : null;
      const personaList = ctx.store.personas.list();
      const persona =
        body.personaId && ctx.store.personas.exists(body.personaId)
          ? ctx.store.personas.get(body.personaId) ?? null
          : personaList.find((p) => p.name === 'You') ?? personaList[0] ?? null;
      const scenario = scenarioId ? ctx.store.scenarios.get(scenarioId) ?? null : null;
      const firstChar = participantIds.length > 0 ? ctx.store.characters.get(participantIds[0]) ?? null : null;
      const userName = persona?.name ?? USER_NAME;

      // Ad-hoc scenario: only when no library scenario was chosen.
      const inlineScenario = !scenario && body.scenarioInline && typeof body.scenarioInline.scenario === 'string' && body.scenarioInline.scenario.trim()
        ? {
            name: typeof body.scenarioInline.name === 'string' && body.scenarioInline.name.trim() ? body.scenarioInline.name.trim() : 'Ad-hoc scenario',
            scenario: body.scenarioInline.scenario.trim(),
            first_mes: typeof body.scenarioInline.first_mes === 'string' ? body.scenarioInline.first_mes : '',
          }
        : null;
      const scenarioName = scenario?.name ?? inlineScenario?.name ?? 'Ad-hoc scenario';
      const scenarioText = scenario?.scenario ?? inlineScenario?.scenario ?? '';
      const scenarioOpening = scenario?.first_mes ?? inlineScenario?.first_mes ?? '';

      // Seed the chat with the scenario's opening message, spoken by the first
      // participant so it behaves like a normal LLM message (speaker, avatar).
      const messages: ChatMessage[] = [];
      if (scenarioOpening) {
        const content = scenarioOpening
          .replace(/\{\{char\}\}/g, firstChar?.name ?? 'Assistant')
          .replace(/\{\{user\}\}/g, userNameFor(persona))
          .trim();
        if (content) {
          messages.push({
            id: uuid(),
            role: 'assistant',
            speaker: {
              characterId: firstChar?.id ?? null,
              name: firstChar?.name ?? 'Assistant',
              avatarPath: firstChar?.avatarPath ?? null,
              voiceSamplePath: null,
            },
            content,
            audioPath: null,
            audio: [],
            images: [],
            ts: now(),
          });
        }
      }

      const chat = chats.create({
        title: asString(
          body.title,
          participantIds
            .map((pid) => ctx.store.characters.get(pid)?.name)
            .filter(Boolean)
            .join(', ') || 'New chat',
        ),
        participantIds,
        removedParticipants: [],
        lorebookIds,
        scenarioId,
        scenarioInline: inlineScenario,
        storyId: body.storyId && ctx.store.stories.exists(body.storyId) ? body.storyId : null,
        audioBookDir: null,
        narratorId,
        personaId: persona?.id ?? null,
        messages: messages.length > 0 ? messages : [],
        runtime: {
          temperature: 0.8,
          topP: 0.95,
          maxTokens: 4096,
          autoTts: false,
          disableThinking: true,
          dialogueOnly: false,
          sequentialTurns: false,
          llmConnectionId: null,
          ttsConnectionId: null,
        },
      });

      // Treat the seeded opening message like a streamed LLM reply: split it
      // into sentences, attribute speech vs narration (QuotationTracker), and
      // synthesize with the speaking character's voice / the narrator's voice.
      // Runs in the background so the chat displays immediately.
      if (messages.length > 0) {
        let openingTtsConn: Connection | null = null;
        try {
          openingTtsConn = resolveKindConnection('tts', chat.runtime.ttsConnectionId);
        } catch {
          openingTtsConn = null;
        }
        if (openingTtsConn) {
          const seed = messages[0];
          const ttsConnForOpening = openingTtsConn;
          void (async () => {
            try {
              const narratorChar = narratorId ? ctx.store.narrators.get(narratorId) ?? null : null;
              const parts: { text: string; isSpeech: boolean }[] = [];
              const quotation = new QuotationTracker();
              const splitter = new SentenceStream({
                activeNames: participantIds
                  .map((pid) => ctx.store.characters.get(pid)?.name)
                  .filter((n): n is string => Boolean(n)),
                onSentence: (sentence) => {
                  const s = sentence.trim();
                  if (s) parts.push({ text: s, isSpeech: quotation.isSpeech(s) });
                },
              });
              splitter.push(seed.content);
              splitter.finish();

              const clips: MessageAudio[] = [];
              for (let i = 0; i < parts.length; i += 1) {
                const part = parts[i];
                if (!/[\p{L}\p{N}]/u.test(part.text)) continue;
                const voiceChar = part.isSpeech ? firstChar : narratorChar ?? firstChar;
                if (!voiceChar) continue;
                if (!(voiceChar.voiceSamplePath || ttsConnForOpening.modelOrVoice)) continue;
                try {
                  const audio = await synthesizeCharacterSpeech(ttsConnForOpening, voiceChar, part.text, ctx.voiceCache);
                  await ensureDir(DIR.audio);
                  const filename = `${seed.id}-${i}-${uuid().slice(0, 8)}.${audioExt(audio)}`;
                  await fs.writeFile(path.join(DIR.audio, filename), audio);
                  clips.push({ id: `${seed.id}-${i}`, text: part.text, path: `/media/audio/${filename}`, ts: now() });
                  // Publish each clip immediately so clients pick them up one by one.
                  const current = chats.getOrThrow(chat.id);
                  const updatedMessages = current.messages.map((m) =>
                    m.id === seed.id ? { ...m, audio: [...clips] } : m,
                  );
                  chats.update(chat.id, { messages: updatedMessages });
                } catch (err) {
                  console.warn('[opening-tts]', (err as Error).message);
                }
              }
            } catch (err) {
              console.warn('[opening-tts] background task failed:', (err as Error).message);
            }
          })().catch((err) => console.error('[opening-tts] unhandled:', (err as Error).message));
        }
      }

      res.status(201).json(chat);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      if (!chats.delete(idParam(req))) throw new ApiError('Chat not found', 404);
      res.status(204).end();
    }),
  );

  // Save the chat's transcript to a story: generate a summary with the LLM
  // that folds in (and evolves) the story's existing summary when present.
  router.get(
    '/:id/audiobook-status',
    asyncHandler(async (req, res) => {
      const progress = audiobookProgress.get(idParam(req)) ?? null;
      if (!progress) {
        res.json({ running: false });
        return;
      }
      res.json({ running: true, done: progress.done, total: progress.total });
    }),
  );

  router.post(
    '/:id/save-story',
    asyncHandler(async (req, res) => {
      const chat = chats.getOrThrow(idParam(req));
      const body = readJsonBody<{ name?: string; storyId?: Id | null }>(req);
      const storyId = typeof body.storyId === 'string' && body.storyId ? body.storyId : null;
      const story = storyId ? ctx.store.stories.get(storyId) ?? null : null;
      const title = asString(body.name, chat.title || 'My story');

      const llmConn = resolveKindConnection('llm', chat.runtime.llmConnectionId);
      const persona = chatPersona(ctx.store, chat);
      const userName = persona?.name ?? USER_NAME;

      // Sources: prior story summary + recent transcript history.
      const prior = story?.summary ?? '';
      const transcript = chat.messages
        .map((m) => `${m.speaker.characterId === null ? userName : m.speaker.name}: ${m.content}`)
        .join('\n')
        .slice(-24000);

      const summary = await callLlm(
        llmConn,
        [
          {
            role: 'system',
            content:
              'You are a meticulous roleplay chronicler. Summarize the roleplay transcript into third-person prose: keep character relationships, ongoing plot threads, unresolved mysteries, promises, and the current location/time. Be concrete; do not invent events. 3 to 10 paragraphs max, no headings.',
          },
          {
            role: 'user',
            content:
              (prior ? `Previous story summary (fold this in and evolve it):\n${prior}\n\n` : '') +
              `New transcript to summarize:\n${transcript}\n\nWrite an updated story summary.`,
          },
        ],
        { temperature: 0.3, topP: 1, maxTokens: 1200, disableThinking: true },
      );

      const updated =
        story && storyId
          ? ctx.store.stories.update(storyId, { summary: summary.trim() })!
          : ctx.store.stories.create({ name: title, summary: summary.trim() });
      chats.update(chat.id, { storyId: updated.id });
      res.json({ story: updated });
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const current = chats.getOrThrow(idParam(req));
      const body = readJsonBody<{
        title?: string;
        scenarioId?: Id | null;
        lorebookIds?: Id[];
        runtime?: Partial<Chat['runtime']>;
        narratorId?: Id | null;
      }>(req);
      let scenarioId = current.scenarioId;
      if (body.scenarioId !== undefined) {
        scenarioId = body.scenarioId && ctx.store.scenarios.exists(body.scenarioId) ? body.scenarioId : null;
      }
      let narratorId = current.narratorId;
      if (body.narratorId !== undefined) {
        narratorId = body.narratorId && ctx.store.narrators.exists(body.narratorId) ? body.narratorId : null;
      }
      const updated = chats.update(idParam(req), {
        title: body.title !== undefined ? asString(body.title, current.title) : undefined,
        scenarioId,
        narratorId,
        lorebookIds:
          body.lorebookIds !== undefined
            ? [...new Set(body.lorebookIds.filter((id) => ctx.store.lorebooks.exists(id)))]
            : undefined,
        runtime: body.runtime ? { ...current.runtime, ...body.runtime } : undefined,
      });
      res.json(updated);
    }),
  );

  router.post(
    '/:id/participants',
    asyncHandler(async (req, res) => {
      const chat = chats.getOrThrow(idParam(req));
      const body = readJsonBody<{ add?: Id[]; remove?: Id[] }>(req);
      let participantIds = [...chat.participantIds];
      let removed = [...chat.removedParticipants];

      for (const add of body.add ?? []) {
        const character = ctx.store.characters.get(add);
        if (character && !participantIds.includes(add)) {
          participantIds.push(add);
          // Returning a previously removed participant clears their tombstone.
          removed = removed.filter((r) => r.characterId !== add);
        }
      }

      const removeSet = new Set(body.remove ?? []);
      if (removeSet.size > 0) {
        const stillThere: Id[] = [];
        for (const pid of participantIds) {
          if (removeSet.has(pid)) {
            const character = ctx.store.characters.get(pid);
            const participated = chat.messages.some((m) => m.speaker.characterId === pid);
            if (participated) {
              removed.push({
                characterId: pid,
                name: character?.name ?? 'Unknown',
                avatarPath: character?.avatarPath ?? null,
                removedAt: now(),
              });
            }
          } else {
            stillThere.push(pid);
          }
        }
        participantIds = stillThere;
      }

      const updated = chats.update(idParam(req), { participantIds, removedParticipants: removed });
      res.json(chats.get(updated!.id));
    }),
  );

  router.patch(
    '/:id/messages/:mid',
    asyncHandler(async (req, res) => {
      const chat = chats.getOrThrow(idParam(req));
      const body = readJsonBody<{ content?: string }>(req);
      const content = asString(body.content).trim();
      if (!content) throw new ApiError('Message content is empty', 400);
      const mid = req.params.mid as Id;
      const idx = chat.messages.findIndex((m) => m.id === mid);
      if (idx < 0) throw new ApiError('Message not found', 404);
      const messages = [...chat.messages];
      messages[idx] = { ...messages[idx], content };
      const updated = chats.update(chat.id, { messages });
      res.json(chats.get(updated!.id));
    }),
  );

  router.delete(
    '/:id/messages/:mid',
    asyncHandler(async (req, res) => {
      const chat = chats.getOrThrow(idParam(req));
      const mid = req.params.mid as Id;
      const removed = chat.messages.filter((m) => m.id !== mid);
      if (removed.length === chat.messages.length) throw new ApiError('Message not found', 404);
      const updated = chats.update(chat.id, { messages: removed });
      res.json(chats.get(updated!.id));
    }),
  );

  // Rebuild a message's audio clips: drop the existing files and re-synthesize
  // each sentence with the current voice rules (speech = speaker, narration =
  // narrator fallback). SSE: emits `audio` per finished clip, then `done` with
  // the updated chat. Explicit user action, ignores runtime.autoTts.
  router.post(
    '/:id/messages/:mid/rebuild-audio',
    asyncHandler(async (req, res) => {
      const chat = chats.getOrThrow(idParam(req));
      const mid = req.params.mid as Id;
      const idx = chat.messages.findIndex((m) => m.id === mid);
      if (idx < 0) throw new ApiError('Message not found', 404);
      const message = chat.messages[idx];

      let ttsConn: Connection;
      try {
        ttsConn = resolveKindConnection('tts', chat.runtime.ttsConnectionId);
      } catch (err) {
        throw new ApiError((err as Error).message, 400);
      }

      const send = (event: string, data: unknown) => {
        if (res.writableEnded) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      if (res.writableEnded) return;

      // Remove the old clip files.
      for (const clip of message.audio) {
        await fs.rm(path.join(DIR.audio, path.basename(clip.path)), { force: true });
      }

      const narratorChar = chat.narratorId ? ctx.store.narrators.get(chat.narratorId) ?? null : null;
      const speakerChar = message.speaker.characterId
        ? ctx.store.characters.get(message.speaker.characterId) ?? null
        : chatPersona(ctx.store, chat);
      const parts: { text: string; isSpeech: boolean }[] = [];
      const quotation = new QuotationTracker();
      const splitter = new SentenceStream({
        activeNames: chat.participantIds
          .map((pid) => ctx.store.characters.get(pid)?.name)
          .filter((n): n is string => Boolean(n)),
        onSentence: (sentence) => {
          const s = sentence.trim();
          if (s) parts.push({ text: s, isSpeech: quotation.isSpeech(s) });
        },
      });
      splitter.push(message.content);
      splitter.finish();

      const clips: MessageAudio[] = [];
      for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i];
        if (!/[\p{L}\p{N}]/u.test(part.text)) continue;
        const voiceShare = part.isSpeech ? speakerChar : narratorChar ?? speakerChar;
        const subject: VoiceSubject = voiceShare ?? {
          id: `user-${message.speaker.name}`,
          name: message.speaker.name,
          voiceSamplePath: message.speaker.voiceSamplePath,
          voiceSampleTranscript: null,
        };
        if (!(subject.voiceSamplePath || ttsConn.modelOrVoice)) continue;
        try {
          const audio = await synthesizeCharacterSpeech(ttsConn, subject, part.text, ctx.voiceCache);
          await ensureDir(DIR.audio);
          const filename = `${message.id}-${i}-${uuid().slice(0, 8)}.${audioExt(audio)}`;
          await fs.writeFile(path.join(DIR.audio, filename), audio);
          clips.push({ id: `${message.id}-${i}`, text: part.text, path: `/media/audio/${filename}`, ts: now() });
          // Publish each clip as it lands so clients enqueue/play immediately.
          send('audio', { messageId: message.id, index: i, ...clips[clips.length - 1] });
          const current = chats.getOrThrow(chat.id);
          chats.update(chat.id, {
            messages: current.messages.map((m) => (m.id === mid ? { ...m, audio: [...clips] } : m)),
          });
        } catch (err) {
          console.warn('[rebuild-audio]', (err as Error).message);
        }
      }

      send('done', { chat: chats.getOrThrow(chat.id) });
      res.end();
    }),
  );

  // Slash commands: server-side, ephemeral (never stored in chat history).
  function handleSlashCommand(
    req: ERequest<{ id: string }>,
    res: EResponse,
    text: string,
  ): void {
    const chat = chats.getOrThrow(idParam(req));
    const send = (event: string, data: unknown) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const [cmdRaw, ...rest] = text.slice(1).split(/\s+/);
    const args = rest.join(' ').trim();
    const cmd = cmdRaw.toLowerCase();
    void args;

    const print = (name: string, body: string) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      const blockId = uuid();
      send('speaker', { messageId: blockId, name: `/${name}`, characterId: null, avatarPath: null });
      send('sentence', { messageId: blockId, index: 0, text: body, isLast: true, isSpeech: true });
      send('done', { chat: chats.getOrThrow(idParam(req)) });
      res.end();
    };

    if (cmd === 'help') {
      print(
        'help',
        'Available commands:' +
          '\n• /scenario — print the scenario text and opening message' +
          '\n• /help — list the available slash commands',
      );
      return;
    }

    if (cmd === 'scenario') {
      const scenario = scenarioFor(ctx, chat);
      print(
        'scenario',
        scenario
          ? `Scenario text:\n${scenario.scenario || '(none)'}${scenario.first_mes ? `\n\nOpening message:\n${scenario.first_mes}` : ''}`
          : 'No scenario attached to this chat.',
      );
      return;
    }

    print(cmd, `Unknown command "/${cmd}". No handler is registered for it.`);
  }

  router.post(
    '/:id/messages',
    asyncHandler(async (req, res) => {
      const chat = chats.getOrThrow(idParam(req));
          const body = readJsonBody<{
        content?: string;
        audioEnabled?: boolean;
        replyMode?: 'all' | 'selected' | 'llm';
        replyIds?: Id[];
      }>(req);
      const text = asString(body.content).trim();
      if (!text) throw new ApiError('Message content is empty', 400);

      // Slash commands: begin with '/' and are handled server-side.
      if (text.startsWith('/')) {
        await handleSlashCommand(req as unknown as ERequest<{ id: string }>, res, text);
        return;
      }
      const audioEnabled = body.audioEnabled === true;
      const persona = chatPersona(ctx.store, chat);

      const userSnapshot: SpeakerSnapshot = {
        characterId: null,
        name: persona?.name ?? USER_NAME,
        avatarPath: persona?.avatarPath ?? null,
        voiceSamplePath: null,
      };

      const llmConn = resolveKindConnection('llm', chat.runtime.llmConnectionId);

      let ttsConn: Connection | null = null;
      if (audioEnabled) {
        try {
          ttsConn = resolveKindConnection('tts', chat.runtime.ttsConnectionId);
        } catch {
          ttsConn = null;
        }
      }

      const userMsg: ChatMessage = {
        id: uuid(),
        role: 'user',
        speaker: userSnapshot,
        content: text,
        audioPath: null,
        audio: [],
        images: [],
        ts: now(),
      };
      chats.update(chat.id, { messages: [...chat.messages, userMsg] });
      const chatWithUser = chats.getOrThrow(chat.id);

      const storyOf = () => {
        const sid = chats.getOrThrow(chatWithUser.id).storyId;
        return sid ? ctx.store.stories.get(sid) ?? null : null;
      };
      const activeChars = chatWithUser.participantIds
        .map((pid) => ctx.store.characters.get(pid))
        .filter((c): c is Character => c !== undefined);
      const narratorChar = chatWithUser.narratorId ? ctx.store.narrators.get(chatWithUser.narratorId) ?? null : null;
      const lorebooks = chatWithUser.lorebookIds
        .map((bid) => ctx.store.lorebooks.get(bid))
        .filter((b) => b !== undefined);
      const scenario = scenarioFor(ctx, chatWithUser);
      // Groups that include at least one active participant (team-aware prompts).
      const relevantGroups = ctx.store.groups
        .list()
        .filter((g) => g.memberIds.some((id) => chatWithUser.participantIds.includes(id)));

      // Optional per-connection context window; the history tail is computed
      // where the messages are built.

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      if (res.writableEnded) return;

      const send = (event: string, data: unknown) => {
        if (res.writableEnded) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const ctrl = { aborted: false };
      res.on('close', () => {
        ctrl.aborted = true;
      });

      const activeNames = activeChars.map((c) => c.name);
      const assistantId = uuid();
      let speaker: SpeakerSnapshot | null = null;
      let speakerChar: Character | null = null;
      let emitted = 0;
      const audioQueue = new OrderedAudio();
      const quotation = new QuotationTracker();
      const formatter = new SpeechFormatter(chatWithUser.runtime.dialogueOnly);

      // Per-speaker message blocks: the model may hand over to another active
      // character mid-reply with a "Name: " prefix; every such handover starts a
      // new message block with its own speaker snapshot, content and clips.
      const orderedBlocks: string[] = [];
      const blockSpecs = new Map<string, { speaker: SpeakerSnapshot; content: string; clips: MessageAudio[] }>();
      let blockId = assistantId;
      let blockSpeaker: SpeakerSnapshot | null = null;
      const sentenceOwner = new Map<number, string>();

      const resolveSpeaker = () => {
        if (speaker) return;
        const speakerName = activeStream?.speaker ?? null;
        speakerChar = speakerName
          ? activeChars.find((c) => c.name.toLowerCase() === speakerName.toLowerCase()) ?? null
          : activeChars.length === 1
            ? activeChars[0]
            : null;
        speaker = {
          characterId: speakerChar?.id ?? null,
          name: speakerName ?? speakerChar?.name ?? 'Assistant',
          avatarPath: speakerChar?.avatarPath ?? null,
          voiceSamplePath: speakerChar?.voiceSamplePath ?? null,
        };
      };

      const beginBlock = (snap: SpeakerSnapshot) => {
        blockSpeechState = null;
        // A new speaker starts with clean quote state: an unbalanced quote in
        // the previous block must not glue this speaker's narration.
        activeQuotation?.reset();
        blockId = uuid();
        blockSpeaker = snap;
        orderedBlocks.push(blockId);
        blockSpecs.set(blockId, { speaker: snap, content: '', clips: [] });
        send('speaker', { messageId: blockId, name: snap.name, characterId: snap.characterId, avatarPath: snap.avatarPath });
      };

      let blockSpeechState: boolean | null = null;
      let paraSpeech = false;
      let activeQuotation: QuotationTracker | null = null;
      let sepDebug = '';

      const emitAudio = (index: number, result: AudioResult) => {
        if (res.writableEnded || !result.path) return;
        const clip: MessageAudio = { id: `${assistantId}-${index}`, text: result.text, path: result.path, ts: now() };
        const owner = sentenceOwner.get(index) ?? blockId;
        send('audio', { messageId: owner, index, ...clip });
        blockSpecs.get(owner)?.clips.push(clip);
      };

      const handleSentence = (sentence: string, isLast: boolean) => {
        let trimmed = sentence.trim();
        if (!trimmed) return;
        if (roundAborted) return;
        // Multi-character replies: "Name: " prefixes mid-reply hand the reply
        // over to another participant. The label may be glued after closing
        // quotes/asterisk runs or short junk like `[emoji]"` of the previous
        // speaker's line; anything before the label stays with the previous
        // speaker. Requires the label's name to match an active character and
        // its prefix junk to hold no sentence-ending punctuation.
        const pm = /^([^\n.!?\u2026]{0,40}?)([A-Za-z0-9 _.'-]{1,60}):\s*/.exec(trimmed);
        if (pm) {
          const cand = pm[2].trim();
          const match = activeChars.find((c) => c.name.toLowerCase() === cand.toLowerCase());
          if (match && roundsMode && blockSpeaker && blockSpeaker.name !== match.name) {
            // Sequential rounds: the model ignored the single-character framing
            // and started writing another participant — cut the remainder of
            // this round so the target's block stays theirs only.
            roundAborted = true;
            return;
          }
          if (match && !roundsMode && (!blockSpeaker || blockSpeaker.name !== match.name)) {
            // Anything before the label belongs to the previous speaker's block.
            const prefix = pm[1].trim();
            if (prefix) {
              const isSpeechPrefix = paraSpeech;
              const idx = audioQueue.submit();
              sentenceOwner.set(idx, blockId);
              emitted += 1;
              const sepVoice = blockSpeaker
                ? activeChars.find((c) => c.id === blockSpeaker!.characterId) ?? speakerChar
                : speakerChar;
              const voiceChar = isSpeechPrefix ? sepVoice : narratorChar ?? sepVoice;
              void (async () => {
                try {
                  const audio = await synthesizeCharacterSpeech(ttsConn!, voiceChar!, prefix, ctx.voiceCache);
                  await ensureDir(DIR.audio);
                  const filename = `${assistantId}-${idx}-${uuid().slice(0, 8)}.${audioExt(audio)}`;
                  await fs.writeFile(path.join(DIR.audio, filename), audio);
                  audioQueue.finish(idx, { text: prefix, path: `/media/audio/${filename}` }, emitAudio);
                } catch (err) {
                  console.warn('[sentence-tts]', (err as Error).message);
                  audioQueue.finish(idx, { text: prefix, path: '' }, emitAudio);
                }
              })();
              const specBefore = blockSpecs.get(blockId);
              if (specBefore) specBefore.content = specBefore.content ? `${specBefore.content} ${prefix}` : prefix;
            }
            beginBlock({
              characterId: match.id,
              name: match.name,
              avatarPath: match.avatarPath,
              voiceSamplePath: match.voiceSamplePath,
            });
          }
          if (match) {
            trimmed = trimmed.slice(pm[0].length).trim();
            if (!trimmed) return;
          }
        }
        resolveSpeaker();
        if (blockSpeaker === null) {
          beginBlock(
            speaker ?? { characterId: null, name: 'Assistant', avatarPath: null, voiceSamplePath: null },
          );
        }
        if (blockSpeaker) speakerChar = activeChars.find((c) => c.id === blockSpeaker!.characterId) ?? speakerChar;
        const isSpeech = paraSpeech;
        const voiceChar = isSpeech ? speakerChar : narratorChar ?? speakerChar;
        const idx = audioQueue.submit();
        sentenceOwner.set(idx, blockId);
        emitted += 1;
        const spec = blockSpecs.get(blockId);
        const sep = blockSpeechState === null ? '' : isSpeech === blockSpeechState ? ' ' : '\n\n';
        blockSpeechState = isSpeech;
        sepDebug += `block=${blockId.slice(0, 8)} isSpeech=${isSpeech} blockState=${blockSpeechState} sep=${JSON.stringify(sep)} :: ${trimmed.slice(0, 40).replace(/\n/g, ' ')}\n`;
        if (spec) spec.content = spec.content ? `${spec.content}${sep}${trimmed}` : trimmed;
        send('sentence', { messageId: blockId, index: idx, text: trimmed, isLast, isSpeech });
        const canSpeak =
          audioEnabled &&
          ttsConn &&
          voiceChar &&
          (voiceChar.voiceSamplePath || ttsConn.modelOrVoice) &&
          /[\p{L}\p{N}]/u.test(trimmed);
        if (!canSpeak) {
          audioQueue.finish(idx, { text: trimmed, path: '' }, emitAudio);
          return;
        }
        const blockVoice = voiceChar!;
        void (async () => {
          try {
            const audio = await synthesizeCharacterSpeech(ttsConn!, voiceChar!, trimmed, ctx.voiceCache);
            await ensureDir(DIR.audio);
            const filename = `${assistantId}-${idx}-${uuid().slice(0, 8)}.${audioExt(audio)}`;
            await fs.writeFile(path.join(DIR.audio, filename), audio);
            audioQueue.finish(idx, { text: trimmed, path: `/media/audio/${filename}` }, emitAudio);
          } catch (err) {
            console.warn('[sentence-tts]', (err as Error).message);
            audioQueue.finish(idx, { text: trimmed, path: '' }, emitAudio);
          }
        })();
      };

      // Paragraph classification gate: each paragraph is attributed via
      // QuotationTracker (a paragraph with an orphan closing quote — the model
      // dropping its opening quote — counts as speech for the whole
      // paragraph), then fed to the sentence stream with that attribution.
      let activeStream: SentenceStream | null = null;
      const paragraphs = new ParagraphStream((p) => {
        // The model often hands over by starting a narration paragraph with
        // "<Name>'s ..." (e.g. `Rusty's screen displays...`) without a label.
        // When that name is a different active participant, start their block.
        const pm2 = /^(?:\*{0,3}\s*)?["'\u201C]?\s*([A-Za-z0-9 _.'-]{1,60})'s\s/.exec(p);
        if (pm2) {
          const match = activeChars.find((c) => c.name.toLowerCase() === pm2[1].trim().toLowerCase());
          if (match && (!blockSpeaker || blockSpeaker.name !== match.name)) {
            beginBlock({
              characterId: match.id,
              name: match.name,
              avatarPath: match.avatarPath,
              voiceSamplePath: match.voiceSamplePath,
            });
          }
        }
        paraSpeech = quotation.isSpeech(p);
        activeStream = new SentenceStream({ activeNames, onSentence: handleSentence });
        activeStream.push(p);
        activeStream.finish();
      });

      const streamErrorBox: { err: Error | null } = { err: null };
      const streamError = (): Error | null => streamErrorBox.err;

      // Disabled handover detection while sequential rounds are running: each
      // participant answers at most once, so mid-reply speaker switching is
      // not attempted and every participant gets exactly one call.
      let roundsMode = false;
      let roundAborted = false;

      const contextTail = llmConn.contextTokens
        ? historyTailFor(chatWithUser, llmConn.contextTokens, chatWithUser.runtime.maxTokens)
        : 0;
      const historyTail = contextTail;
      const runReplyPipeline = async (roundMessages: LlmMessage[], roundConn: Connection = llmConn): Promise<void> => {
        // Fresh quotation state per pipeline run so one round's quote state
        // can't poison the next round's speech/narration attribution.
        const roundQuotation = new QuotationTracker();
        activeQuotation = roundQuotation;
        const roundFormatter = new SpeechFormatter(chatWithUser.runtime.dialogueOnly);
        let isFirstParagraph = true;
        // Debug dump: the RAW normalized text of every pipeline run, for inspection.
        let rawText = '';
        let paraDebug = '';
        const paragraphs = new ParagraphStream((p) => {
          rawText += `${p}\n\n`;

          // "<Name>'s ..." (e.g. `Rusty's screen displays...`) without a label.
          // When that name is a different active participant, start their block.
          const lm = /^(?:\*{0,3}\s*)?["'\u201C]?\s*([A-Za-z0-9 _.'-]{1,60})'s\s/.exec(p);
          if (lm) {
            const match = activeChars.find((c) => c.name.toLowerCase() === lm[1].trim().toLowerCase());
            if (match && roundsMode && blockSpeaker && blockSpeaker.name !== match.name) {
            // Sequential rounds: the model ignored the single-character framing
            // and started writing another participant — cut the remainder of
            // this round so the target's block stays theirs only.
            roundAborted = true;
            return;
          }
          if (match && !roundsMode && (!blockSpeaker || blockSpeaker.name !== match.name)) {
              beginBlock({
                characterId: match.id,
                name: match.name,
                avatarPath: match.avatarPath,
                voiceSamplePath: match.voiceSamplePath,
              });
            }
          }
          // Paragraph classification gate: each paragraph is attributed via
          // QuotationTracker (a paragraph with an orphan closing quote — the
          // model dropping its opening quote — counts as speech for the whole
          // paragraph), then fed to the sentence stream with that attribution.
          // Only the reply's FIRST paragraph may lose its leading speaker
          // label: later paragraphs' labels must survive to the handover
          // detector, or they'd be swallowed and no new block would start.
          paraSpeech = roundQuotation.isSpeech(p);
          paraDebug += `speech=${paraSpeech} :: ${p.slice(0, 60).replace(/\n/g, ' ')}\n`;
          activeStream = new SentenceStream({
            activeNames,
            stripLabels: isFirstParagraph,
            onSentence: handleSentence,
          });
          isFirstParagraph = false;
          activeStream.push(p);
          activeStream.finish();
        });
        try {
          await streamLlm(
            roundConn,
            roundMessages,
            {
              temperature: chatWithUser.runtime.temperature,
              topP: chatWithUser.runtime.topP,
              maxTokens: chatWithUser.runtime.maxTokens,
              disableThinking: chatWithUser.runtime.disableThinking,
            },
            { onDelta: (delta) => paragraphs.push(roundFormatter.push(delta)), ctrl },
          );
        } catch (err) {
          if (!streamErrorBox.err) streamErrorBox.err = err as Error;
        }
        paragraphs.finish();
        if (getConfig().debug !== false) {
          mkdirSync(path.join(ROOT, 'debug-rounds'), { recursive: true });
          writeFileSync(path.join(ROOT, 'debug-rounds', 'response.txt'), rawText.trim());
          writeFileSync(path.join(ROOT, 'debug-rounds', 'paragraphs.txt'), paraDebug);
          writeFileSync(path.join(ROOT, 'debug-rounds', 'sep.txt'), sepDebug);
        }

      };

      // Sequential rounds also run when the user narrowed the roster for this
      // message (reply controls make no sense in a single ensemble call).
      const replyNarrowed =
        (body.replyMode === 'selected' || body.replyMode === 'llm') &&
        activeChars.length > 1;
      if ((chatWithUser.runtime.sequentialTurns || replyNarrowed) && activeChars.length > 1) {
        // Which participants reply for this message: the send-time control
        // (all / selected / LLM decides) overrides the full roster.
        let replyTargets = [...activeChars];
        const mode = body.replyMode ?? 'all';
        console.log(`[reply-mode] mode=${mode} ids=${JSON.stringify(body.replyIds ?? null)} narrow=${(body.replyMode ?? 'all') !== 'all'}`);
        if (mode === 'selected' && Array.isArray(body.replyIds)) {
          const picks = new Set(body.replyIds);
          const subset = activeChars.filter((c) => picks.has(c.id));
          if (subset.length > 0) replyTargets = subset;
        } else if (mode === 'llm') {
          try {
            const roster = activeChars.map((c) => `- ${c.name}`).join('\n');
            const recent =
              chatWithUser.messages
                .slice(-3)
                .map((m) => `${m.speaker.name}: ${m.content.slice(0, 400)}`)
                .join('\n');
            const verdict = await callLlm(
              llmConn,
              [
                {
                  role: 'system',
                  content:
                    `You decide which characters speak in a roleplay scene. ` +
                    `Reply with ONLY a comma-separated subset of the names, no commentary.\n${roster}\n` +
                    `Guidance: pick the character the user addressed by name; otherwise the most relevant ` +
                    `one. Use MULTIPLE names ONLY when the message clearly demands several speakers ` +
                    `(a question posed to multiple characters, a ship-wide action).`,
                },
                {
                  role: 'user',
                  content: `Scene so far:\n${recent}\n\nNew user turn: ${text}\n\nWhich character(s) should reply now?`,
                },
              ],
              { temperature: 0, topP: 1, maxTokens: 60, disableThinking: true },
            );
            const guessed = verdict
              .split(',')
              .map((n) => n.trim())
              .filter(Boolean);
            const subset = activeChars.filter((c) =>
              guessed.some((g) => g.toLowerCase() === c.name.toLowerCase()),
            );
            if (subset.length > 0) replyTargets = subset;
            console.log(`[reply-mode] llm picked: ${verdict.trim().slice(0, 120)} → speakers: ${replyTargets.map((c) => c.name).join(', ')}`);
          } catch (err) {
            console.warn('[reply-mode] LLM decision failed, replying as everyone:', (err as Error).message);
          }
        }
        void replyTargets;
        // One LLM call per participant; each round gets its own message block
        // and the transcript is persisted between rounds so each next call
        // can see what the previous participants said.
        const seqCtxBase = {
          chat: chats.getOrThrow(chatWithUser.id),
          activeCharacters: activeChars,
          removed: chatWithUser.removedParticipants,
          lorebooks,
          scenario,
          persona: chatPersona(ctx.store, chatWithUser),
          story: storyOf(),
          groups: relevantGroups,
        };
        const targetMessages = (target: Character): LlmMessage[] =>
          buildLlmMessages(
            { ...seqCtxBase, chat: chats.getOrThrow(chatWithUser.id) },
            historyTail,
            { replyAs: target },
          );

        for (const target of replyTargets) {
          roundAborted = false;
          console.log(`[reply-round] target=${target.name}`);
          // Once the turn starts, finish every round even if the browser
          // disconnected (the dev proxy/SSE can drop on long turns): the
          // transcript still completes and the client's next refresh shows it.
          void ctrl;
          roundsMode = true;
          beginBlock({
            characterId: target.id,
            name: target.name,
            avatarPath: target.avatarPath,
            voiceSamplePath: target.voiceSamplePath,
          });
          const roundConn = target.llmConnectionId
            ? getConfig().connections.find((c) => c.id === target.llmConnectionId && c.kind === 'llm') ?? llmConn
            : llmConn;
          await runReplyPipeline(targetMessages(target), roundConn);
          roundsMode = false;
          if (emitted === 0 && !streamError) {
            continue; // this participant stayed silent; keep going
          }
          // Persist the transcript so later rounds see earlier replies.
          const prior = chats.getOrThrow(chatWithUser.id).messages.filter(
            (m) => !orderedBlocks.includes(m.id),
          );
          const saved = [...prior, ...orderedBlocks
            .filter((id) => blockSpecs.get(id)?.content.trim())
            .map((id) => {
              const spec = blockSpecs.get(id)!;
              return {
                id,
                role: 'assistant' as const,
                speaker: spec.speaker,
                content: spec.content.trim(),
                audioPath: null as string | null,
                audio: spec.clips,
                images: [] as string[],
                ts: now(),
              };
            })];
          chats.update(chatWithUser.id, { messages: saved });
        }
        await audioQueue.waitIdle();
        if (emitted === 0) {
          const message = streamErrorBox.err?.message ??
            'The LLM returned no content. Try again or raise "Max tokens" in the chat settings.';
          send('error', { message });
          res.end();
          return;
        }
        send('done', { chat: chats.getOrThrow(chatWithUser.id) });
        res.end();
        return;
      }

      // Single LLM call for the whole reply (classic mode).
      const messages = buildLlmMessages(
        {
          chat: chatWithUser,
          activeCharacters: activeChars,
          removed: chatWithUser.removedParticipants,
          lorebooks,
          scenario,
          persona: chatPersona(ctx.store, chatWithUser),
          story: storyOf(),
          groups: relevantGroups,
        },
        historyTail,
      );
      await runReplyPipeline(messages);
      if (emitted === 0) {
        const message = streamErrorBox.err?.message ??
          'The LLM returned no content. Try again or raise "Max tokens" in the chat settings.';
        send('error', { message });
        res.end();
        return;
      }
      await audioQueue.waitIdle();

      const finalBlocks: ChatMessage[] = orderedBlocks.map((id) => {
        const spec = blockSpecs.get(id)!;
        return {
          id,
          role: 'assistant',
          speaker: spec.speaker,
          content: spec.content.trim(),
          audioPath: null,
          audio: spec.clips,
          images: [],
          ts: now(),
        };
      });
      const updated = chats.update(chatWithUser.id, {
        messages: [...chatWithUser.messages, ...finalBlocks],
      });
      void (async () => {
// If the model opened with no `Name:` label, the first block falls back
      // to "Assistant". Ask the LLM itself (tiny, num_predict=budget-free)
      // which active character owns that first block and re-attribute it.
      if (orderedBlocks.length > 0 && blockSpecs.get(orderedBlocks[0])!.speaker.characterId === null && activeChars.length > 0) {
        const firstSpec = blockSpecs.get(orderedBlocks[0])!;
        try {
          const namesList = activeChars.map((c) => c.name);
          const attribution = await callLlm(
            llmConn,
            [
              {
                role: 'system',
                content: `You resolve speaker attribution from roleplay text. Answer with EXACTLY one name from the list and nothing else: ${namesList.join(', ')}.`,
              },
              {
                role: 'user',
                content: `Reply text:\n"""\n${firstSpec.content.slice(0, 1500)}\n"""\nWhich of these characters is speaking here? ${namesList.join(', ')}`,
              },
            ],
            { temperature: 0, topP: 1, maxTokens: 16, disableThinking: true },
          );
          const guessed = attribution.trim().split('\n')[0].trim();
          const match = activeChars.find((c) => c.name.toLowerCase() === guessed.toLowerCase());
          if (match) {
            blockSpecs.get(orderedBlocks[0])!.speaker = {
              characterId: match.id,
              name: match.name,
              avatarPath: match.avatarPath,
              voiceSamplePath: match.voiceSamplePath,
            };
            console.log(`[sp-attribution] unlabeled opener attributed to ${match.name}`);
          } else {
            console.log('[sp-attribution] model did not return a matching name:', guessed);
          }
        } catch (err) {
          console.warn('[sp-attribution] attribution call failed:', (err as Error).message);
        }
      }
      })().catch((err) => console.error('[sp-attribution] failed:', (err as Error).message));
      send('done', { chat: updated ?? chats.getOrThrow(chatWithUser.id) });
      res.end();
    }),
  );

  // Audiobook: builds an ordered playlist over the chat's text segments,
  // reusing clips already stored on the messages; only missing audio (mostly
  // the persona's user-side content) is synthesized. New clips get chips in
  // the chat json; then `sox <playlist.m3u> <title>.mp3` merges everything.
  router.post(
    '/:id/audiobook',
    asyncHandler(async (req, res) => {
      const chat = chats.getOrThrow(idParam(req));
      const persona = chatPersona(ctx.store, chat);
      const narrator = chat.narratorId ? ctx.store.narrators.get(chat.narratorId) ?? null : null;
      const ttsConn = resolveKindConnection('tts', chat.runtime.ttsConnectionId);

      type Item = { kind: 'voice' | 'thought' | 'narrative'; text: string; subject: VoiceSubject | null; msgId: string; msgIndex: number };
      const items: Item[] = [];

      const personaVoice: VoiceSubject | null = persona?.voiceSamplePath
        ? {
            id: `persona-voice-${persona.id}`,
            name: `${persona.name} (spoken voice)`,
            voiceSamplePath: persona.voiceSamplePath,
            voiceSampleTranscript: persona.voiceSampleTranscript,
          }
        : null;
      const personaThought: VoiceSubject | null = persona?.thoughtSamplePath
        ? {
            id: `persona-thought-${persona.id}`,
            name: `${persona.name} (thoughts)`,
            voiceSamplePath: persona.thoughtSamplePath,
            voiceSampleTranscript: persona.thoughtSampleTranscript,
          }
        : null;
      const narratorSubject: VoiceSubject | null = narrator?.voiceSamplePath
        ? {
            id: `narrator-${narrator.id}`,
            name: narrator.name,
            voiceSamplePath: narrator.voiceSamplePath,
            voiceSampleTranscript: narrator.voiceSampleTranscript,
          }
        : null;

      chat.messages.forEach((message, msgIndex) => {
        const speakerChar = message.speaker.characterId
          ? ctx.store.characters.get(message.speaker.characterId)
          : null;
        const isPersona = message.speaker.characterId === null;
        const userSubj = speakerChar
          ? {
              id: speakerChar.id,
              name: speakerChar.name,
              voiceSamplePath: speakerChar.voiceSamplePath,
              voiceSampleTranscript: speakerChar.voiceSampleTranscript,
            }
          : null;
        const quotation = new QuotationTracker();
        const splitter = new SentenceStream({ activeNames: [], onSentence: (s) => {
          const trimmed = s.trim();
          if (!trimmed) return;
          const isSpeech = quotation.isSpeech(trimmed);
          const thought = trimmed.endsWith('*');
          if (isPersona) {
            let kind: Item['kind'] = 'narrative';
            let subject: VoiceSubject | null = null;
            if (thought) {
              kind = 'thought';
              subject = personaThought ?? personaVoice;
            } else if (isSpeech) {
              kind = 'voice';
              subject = personaVoice ?? narratorSubject;
            } else {
              kind = 'narrative';
              subject = personaVoice ?? narratorSubject;
            }
            items.push({ kind, text: trimmed, subject, msgId: message.id, msgIndex });
            return;
          }
          const kind: Item['kind'] = thought ? 'thought' : isSpeech ? 'voice' : 'narrative';
          if (kind === 'narrative' && narratorSubject) {
            // Narration always belongs to the narrator, even inside a
            // character's message.
            items.push({ kind, text: trimmed, subject: narratorSubject, msgId: message.id, msgIndex });
            return;
          }
          items.push({ kind, text: trimmed, subject: userSubj, msgId: message.id, msgIndex });
        } });
        splitter.push(message.content);
        splitter.finish();
      });

      console.log(`[audiobook] segments=${items.length}, stored chips=${chat.messages.reduce((a, m) => a + m.audio.length, 0)}`);

      await ensureDir(DIR.audio);

      const playlistLines: string[] = [];
      let totalReached = false;
      const updatedMessages = [...chat.messages];
      let synthesized = 0;

      for (const item of items) {
        totalReached = playlistLines.length >= items.length;
        if (!/[\p{L}\p{N}]/u.test(item.text)) continue;

        let filename: string | null = null;
        // 1) Existing chips: match by clip text prefix for this message. The
        //    referenced clip must actually exist on disk — chips from older
        //    runs may point at deleted/obsolete folders; those re-synthesize.
        const message = updatedMessages[item.msgIndex];
        let existingFile: string | null = null;
        for (const clip of message.audio) {
          if (!clip.path) continue;
          if (clip.text.slice(0, 60) !== item.text.slice(0, 60)) continue;
          const rest = clip.path.replace(/^\/media\//, '');
          const candidates = [
            path.join(DATA_DIR, 'media', rest),
            path.join(DATA_DIR, 'audiobook', path.basename(clip.path)),
            path.join(DIR.audio, path.basename(clip.path)),
          ];
          const found = candidates.find((file) => existsSync(file));
          if (found) {
            existingFile = found;
            break;
          }
        }
        if (existingFile) {
          filename = existingFile;
          totalReached = true;
        }

        // 2) Missing/obsolete clips: synthesize with the dialogue's own voice
        //    (persona user content uses the fallback chain below).
        if (!filename) {
          let subject = item.subject;
          // fall back per spec
          if (!subject?.voiceSamplePath) {
            const chain = item.kind === 'thought'
              ? [personaVoice, narratorSubject]
              : item.kind === 'voice'
                ? [personaVoice, narratorSubject]
                : [narratorSubject, personaVoice];
            subject = chain.find((s) => s?.voiceSamplePath) ?? null;
            item.subject = subject;
          }
          if (!subject) {
            // No persona/narrator clips at all: use the TTS connection's
            // default voice (same as a bare /api/audio/tts call).
            subject = {
              id: `default-${persona?.id ?? 'user'}`,
              name: persona?.name ?? 'User',
              voiceSamplePath: null,
              voiceSampleTranscript: null,
            };
          }
          {
            let audio: Buffer | null = null;
            let synthErr: string | null = null;
            try {
              audio = await synthesizeCharacterSpeech(ttsConn, subject, item.text, ctx.voiceCache);
            } catch (err) {
              synthErr = (err as Error).message;
            }
            if (synthErr && !synthErr.includes('404')) {
              console.error(`[audiobook] persona synth failed: ${synthErr}`);
            }
            if (!synthErr && audio) {
              // Same folder + naming convention as the other chat clips.
              filename = `${message.id}-${uuid().slice(0, 8)}.${audioExt(audio)}`;
              await fs.writeFile(path.join(DIR.audio, filename), audio);
              const clip: MessageAudio = {
                id: uuid(),
                text: item.text,
                path: `/media/audio/${filename}`,
                ts: now(),
              };
              const base = updatedMessages[item.msgIndex];
              updatedMessages[item.msgIndex] = { ...base, audio: [...base.audio, clip] } as ChatMessage;
              synthesized += 1;
              totalReached = true;
              audiobookProgress.set(chat.id, { done: playlistLines.length, total: items.length });
            }
          }
        }

        if (!filename) continue;
        playlistLines.push(filename);
        audiobookProgress.set(chat.id, { done: playlistLines.length, total: items.length });
      }

      function isPersonaItem(item: { msgId: string; msgIndex: number }): boolean {
        const m = updatedMessages[item.msgIndex];
        return m?.speaker.characterId === null;
      }

      let personaCounter = (() => { let n = 0; return () => n++; })();

      function synthCounter(): number {
        return playlistLines.length;
      }
      function sanitizeText(text: string): string {
        return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24);
      }
      const existsSyncDir = async (dir: string): Promise<boolean> => {
        try {
          await fs.stat(path.join(DATA_DIR, 'audiobook', dir));
          return true;
        } catch {
          return false;
        }
      }

      void personaVoice; void narratorSubject;

      audiobookProgress.delete(chat.id);
      const playlistPath = path.join(DIR.audio, 'playlist.m3u');
      await fs.writeFile(playlistPath, playlistLines.join('\n') + '\n', 'utf8');

      const mp3Name = `${(chat.title || 'audiobook').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'audiobook'}.mp3`;
      const mp3Path = path.join(DIR.audio, mp3Name);
      if (playlistLines.length > 0) {
        await new Promise<void>((resolve) => {
          execFile('sox', [playlistPath, mp3Path], { cwd: DIR.audio, timeout: 10 * 60_000 }, (err) => {
            if (err) console.error('[audiobook] sox failed:', (err as Error).message);
            else console.log(`[audiobook] created ${mp3Path} (${synthesized} synthesized, ${playlistLines.length} segments)`);
            resolve();
          });
        });
      }

      chats.update(chat.id, { messages: updatedMessages.filter(Boolean), audioBookDir: playlistPath });
      res.json({
        playlist: `/media/audio/playlist.m3u`,
        audio: `/media/audio/${mp3Name}`,
        synthesized,
        items: playlistLines.length,
      });
    }),
  );

  return router;
}
