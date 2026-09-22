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
  Narrator,
  SpeakerSnapshot,
} from '../types.js';
import { DIR } from '../paths.js';
import { getConfig } from '../config.js';
import { buildLlmMessages, streamLlm, USER_NAME } from '../pipeline.js';
import { chatPersona } from '../store.js';
import { synthesizeCharacterSpeech, audioExt } from '../ttsService.js';
import { SentenceStream } from '../streaming.js';
import { QuotationTracker } from '../speech.js';
import { SpeechFormatter } from '../formatting.js';
import { OrderedAudio, type AudioResult } from '../orderedAudio.js';
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
        scenario: chat.scenarioId ? ctx.store.scenarios.get(chat.scenarioId) ?? null : null,
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
        narratorId?: Id | null;
        personaId?: Id | null;
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
        narratorId,
        personaId: persona?.id ?? null,
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
        if (character && !participantIds.includes(add)) participantIds.push(add);
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

  router.post(
    '/:id/messages',
    asyncHandler(async (req, res) => {
      const chat = chats.getOrThrow(idParam(req));
      const body = readJsonBody<{ content?: string; audioEnabled?: boolean }>(req);
      const text = asString(body.content).trim();
      if (!text) throw new ApiError('Message content is empty', 400);
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

      const activeChars = chatWithUser.participantIds
        .map((pid) => ctx.store.characters.get(pid))
        .filter((c): c is Character => c !== undefined);
      const narratorChar = chatWithUser.narratorId ? ctx.store.narrators.get(chatWithUser.narratorId) ?? null : null;
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
          persona: chatPersona(ctx.store, chatWithUser),
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
      let speaker: SpeakerSnapshot | null = null;
      let speakerChar: Character | null = null;
      let emitted = 0;
      const audioQueue = new OrderedAudio();
      const quotation = new QuotationTracker();
      const formatter = new SpeechFormatter();

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
        const speakerName = stream.speaker;
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
        blockId = uuid();
        blockSpeaker = snap;
        orderedBlocks.push(blockId);
        blockSpecs.set(blockId, { speaker: snap, content: '', clips: [] });
        send('speaker', { messageId: blockId, name: snap.name, characterId: snap.characterId, avatarPath: snap.avatarPath });
      };

      let blockSpeechState: boolean | null = null;

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
        // Multi-character replies: "Name: " prefixes mid-reply hand the reply
        // over to another participant. Strip the prefix from what gets spoken;
        // the block's speaker snapshot carries the attribution instead.
        const pm = /^([A-Za-z0-9 _.'-]{1,60}):\s*/.exec(trimmed);
        if (pm) {
          const cand = pm[1].trim();
          const match = activeChars.find((c) => c.name.toLowerCase() === cand.toLowerCase());
          if (match && (!blockSpeaker || blockSpeaker.name !== match.name)) {
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
        const isSpeech = quotation.isSpeech(trimmed);
        const voiceChar = isSpeech ? speakerChar : narratorChar ?? speakerChar;
        const idx = audioQueue.submit();
        sentenceOwner.set(idx, blockId);
        emitted += 1;
        const spec = blockSpecs.get(blockId);
        const sep = blockSpeechState === null ? '' : isSpeech === blockSpeechState ? ' ' : '\n\n';
        blockSpeechState = isSpeech;
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

      const stream = new SentenceStream({
        activeNames,
        onSentence: handleSentence,
      });

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
          { onDelta: (delta) => stream.push(formatter.push(delta)), ctrl },
        );
      } catch (err) {
        streamError = err as Error;
      }
      stream.finish();
      if (emitted === 0) {
        const message = streamError
          ? streamError.message
          : 'The LLM returned no content. Try again or raise "Max tokens" in the chat settings.';
        send('error', { message });
        res.end();
        return;
      }
      await audioQueue.waitIdle();

      formatter.finish();
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
      send('done', { chat: updated ?? chats.getOrThrow(chatWithUser.id) });
      res.end();
    }),
  );

  return router;
}