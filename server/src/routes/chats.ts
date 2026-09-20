import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import type { AppContext } from '../context.js';
import type {
  Character,
  Chat,
  ChatMessage,
  Connection,
  Id,
  MessageAudio,
  SpeakerSnapshot,
} from '../types.js';
import { DIR } from '../paths.js';
import { getConfig } from '../config.js';
import { buildLlmMessages, streamLlm, USER_NAME } from '../pipeline.js';
import { synthesizeCharacterSpeech, audioExt } from '../ttsService.js';
import { ApiError, asString, ensureDir, now, uuid } from '../util.js';
import { asyncHandler, idParam, readJsonBody } from './helpers.js';

function resolveKindConnection(kind: 'llm' | 'stt' | 'tts', runtimeValue: Id | null): Connection {
  const config = getConfig();
  const defaultKey = kind === 'llm' ? 'defaultLlm' : kind === 'stt' ? 'defaultStt' : 'defaultTts';
  const id = runtimeValue ?? config[defaultKey];
  const conn = id ? config.connections.find((c) => c.id === id && c.kind === kind) : undefined;
  if (!conn) throw new ApiError(`No ${kind.toUpperCase()} connection selected. Configure one and set it as default.`, 400);
  return conn;
}

/** Splits at the first sentence boundary (. … ! ?) followed by whitespace or end of buffer. */
const SENT_SPLIT = /^.*?(?:[.?!…]{1,3})(?=\s|$)/s;

function listSummary(chat: Chat) {
  return {
    id: chat.id,
    title: chat.title,
    updated: chat.updated,
    created: chat.created,
    messageCount: chat.messages.length,
    participantCount: chat.participantIds.length,
    avatarPaths: chat.participantIds
      .map((pid) => chat.messages.find((m) => m.speaker.characterId === pid)?.speaker.avatarPath ?? null)
      .slice(0, 4),
  };
}

export function chatsRouter(ctx: AppContext): Router {
  const router = Router();
  const { chats } = ctx.store;

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json([...chats.list()].sort((a, b) => b.updated.localeCompare(a.updated)).map(listSummary));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const chat = chats.getOrThrow(idParam(req));
      res.json({
        chat,
        characters: chat.participantIds
          .map((pid) => ctx.store.characters.get(pid))
          .filter((c): c is Character => c !== undefined),
        lorebooks: chat.lorebookIds
          .map((bid) => ctx.store.lorebooks.get(bid))
          .filter((b) => b !== undefined),
        scenario: chat.scenarioId ? ctx.store.scenarios.get(chat.scenarioId) ?? null : null,
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
      }>(req);
      const participantIds = Array.isArray(body.participantIds)
        ? [...new Set(body.participantIds.filter((id) => ctx.store.characters.exists(id)))]
        : [];
      const lorebookIds = Array.isArray(body.lorebookIds)
        ? [...new Set(body.lorebookIds.filter((id) => ctx.store.lorebooks.exists(id)))]
        : [];
      const scenarioId = body.scenarioId && ctx.store.scenarios.exists(body.scenarioId) ? body.scenarioId : null;
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
        messages: [],
        runtime: {
          temperature: 0.8,
          topP: 0.95,
          maxTokens: 4096,
          autoTts: false,
          disableThinking: true,
          llmConnectionId: null,
          ttsConnectionId: null,
        },
      });
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

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const current = chats.getOrThrow(idParam(req));
      const body = readJsonBody<{
        title?: string;
        scenarioId?: Id | null;
        lorebookIds?: Id[];
        runtime?: Partial<Chat['runtime']>;
      }>(req);
      let scenarioId = current.scenarioId;
      if (body.scenarioId !== undefined) {
        scenarioId = body.scenarioId && ctx.store.scenarios.exists(body.scenarioId) ? body.scenarioId : null;
      }
      const updated = chats.update(idParam(req), {
        title: body.title !== undefined ? asString(body.title, current.title) : undefined,
        scenarioId,
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
        if (character && !participantIds.includes(add)) participantIds.push(add);
      }

      const removeSet = new Set(body.remove ?? []);
      if (removeSet.size > 0) {
        const stillThere: Id[] = [];
        for (const pid of participantIds) {
          if (removeSet.has(pid)) {
            const character = ctx.store.characters.get(pid);
            removed.push({
              characterId: pid,
              name: character?.name ?? 'Unknown',
              avatarPath: character?.avatarPath ?? null,
              removedAt: now(),
            });
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

  router.post(
    '/:id/messages',
    asyncHandler(async (req, res) => {
      const chat = chats.getOrThrow(idParam(req));
      const body = readJsonBody<{ content?: string; audioEnabled?: boolean }>(req);
      const text = asString(body.content).trim();
      if (!text) throw new ApiError('Message content is empty', 400);
      const audioEnabled = body.audioEnabled === true;

      const userSnapshot: SpeakerSnapshot = {
        characterId: null,
        name: USER_NAME,
        avatarPath: null,
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

      const activeChars = chatWithUser.participantIds
        .map((pid) => ctx.store.characters.get(pid))
        .filter((c): c is Character => c !== undefined);
      const lorebooks = chatWithUser.lorebookIds
        .map((bid) => ctx.store.lorebooks.get(bid))
        .filter((b) => b !== undefined);
      const scenario = chatWithUser.scenarioId ? ctx.store.scenarios.get(chatWithUser.scenarioId) ?? null : null;

      const messages = buildLlmMessages(
        {
          chat: chatWithUser,
          activeCharacters: activeChars,
          removed: chatWithUser.removedParticipants,
          lorebooks,
          scenario,
        },
        0,
      );

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
      const PREFIX = /^\s*([A-Za-z0-9 _.'-]{1,60}):/s;
      let raw = '';
      let stripped = false;
      let speakerName: string | null = null;
      let speaker: SpeakerSnapshot | null = null;
      let speakerChar: Character | null = null;
      const sentences: string[] = [];
      let sentenceIndex = 0;

      const ttsResults = new Map<number, { text: string; path: string }>();
      const emittedClips: MessageAudio[] = [];
      let nextEmit = 0;
      let pendingTts = 0;
      let resolvePending: (() => void) | null = null;

      const waitPending = (): Promise<void> =>
        pendingTts === 0 ? Promise.resolve() : new Promise((r) => { resolvePending = r; });

      const flushAudio = () => {
        while (ttsResults.has(nextEmit)) {
          const r = ttsResults.get(nextEmit)!;
          ttsResults.delete(nextEmit);
          const idx = nextEmit;
          nextEmit++;
          if (res.writableEnded) continue;
          if (r.path) {
            const clip: MessageAudio = { id: `${assistantId}-${idx}`, text: r.text, path: r.path, ts: now() };
            emittedClips.push(clip);
            send('audio', { index: idx, ...clip });
          }
        }
      };

      const resolveSpeaker = () => {
        if (speaker) return;
        speakerChar = speakerName
          ? activeChars.find((c) => c.name.toLowerCase() === speakerName!.toLowerCase()) ?? null
          : activeChars.length === 1
            ? activeChars[0]
            : null;
        speaker = {
          characterId: speakerChar?.id ?? null,
          name: speakerName ?? speakerChar?.name ?? 'Assistant',
          avatarPath: speakerChar?.avatarPath ?? null,
          voiceSamplePath: speakerChar?.voiceSamplePath ?? null,
        };
        send('speaker', { name: speaker.name, characterId: speaker.characterId });
      };

      const handleSentence = (sentence: string, isLast: boolean) => {
        const trimmed = sentence.trim();
        if (!trimmed) return;
        resolveSpeaker();
        const idx = sentenceIndex++;
        sentences.push(trimmed);
        send('sentence', { index: idx, text: trimmed, isLast });
        if (!(audioEnabled && ttsConn && speakerChar && /[\p{L}\p{N}]/u.test(trimmed))) return;
        if (!(speakerChar.voiceSamplePath || ttsConn.modelOrVoice)) return;
        pendingTts++;
        void (async () => {
          try {
            const audio = await synthesizeCharacterSpeech(ttsConn!, speakerChar!, trimmed, ctx.voiceCache);
            await ensureDir(DIR.audio);
            const filename = `${assistantId}-${idx}-${uuid().slice(0, 8)}.${audioExt(audio)}`;
            await fs.writeFile(path.join(DIR.audio, filename), audio);
            ttsResults.set(idx, { text: trimmed, path: `/media/audio/${filename}` });
          } catch (err) {
            console.warn('[sentence-tts]', (err as Error).message);
            ttsResults.set(idx, { text: trimmed, path: '' });
          } finally {
            pendingTts -= 1;
            if (pendingTts === 0 && resolvePending) {
              const r = resolvePending;
              resolvePending = null;
              r();
            }
            flushAudio();
          }
        })();
      };

      const processDelta = (delta: string) => {
        raw += delta;
        if (!stripped) {
          const m = PREFIX.exec(raw);
          if (m && activeNames.some((n) => n.toLowerCase() === m[1].trim().toLowerCase())) {
            speakerName = m[1].trim();
            stripped = true;
            raw = raw.slice(m[0].length);
          } else if (raw.length > 200) {
            stripped = true;
          }
        }
        for (;;) {
          const m = SENT_SPLIT.exec(raw);
          if (!m) break;
          handleSentence(m[0], false);
          raw = raw.slice(m[0].length);
        }
      };

      let streamError: Error | null = null;
      try {
        await streamLlm(
          llmConn,
          messages,
          {
            temperature: chatWithUser.runtime.temperature,
            topP: chatWithUser.runtime.topP,
            maxTokens: chatWithUser.runtime.maxTokens,
            disableThinking: chatWithUser.runtime.disableThinking,
          },
          { onDelta: processDelta, ctrl },
        );
      } catch (err) {
        streamError = err as Error;
      }
      if (raw.trim()) handleSentence(raw, true);
      else if (sentences.length === 0) {
        const message = streamError
          ? streamError.message
          : 'The LLM returned no content. Try again or raise "Max tokens" in the chat settings.';
        send('error', { message });
        res.end();
        return;
      }
      await waitPending();
      flushAudio();
      resolveSpeaker();

      const finalMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        speaker: speaker ?? { characterId: null, name: 'Assistant', avatarPath: null, voiceSamplePath: null },
        content: sentences.join(' '),
        audioPath: null,
        audio: emittedClips,
        images: [],
        ts: now(),
      };
      const updated = chats.update(chatWithUser.id, {
        messages: [...chatWithUser.messages, finalMsg],
      });
      send('done', { chat: updated ?? chats.getOrThrow(chatWithUser.id) });
      res.end();
    }),
  );

  return router;
}