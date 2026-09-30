import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { Router } from 'express';
import type { AppContext } from '../context.js';
import type { Character, ImportSuggestion } from '../types.js';
import { DIR } from '../paths.js';
import { bookToCharacterBook, buildCardObject, buildImportResult, parseCard, writePngText } from '../cards.js';
import { ApiError, asBoolean, asString, ensureDir, uuid } from '../util.js';
import { asyncHandler, idParam, readJsonBody } from './helpers.js';

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

function avatarExt(mime: string): string {
  return MIME_EXT[mime.toLowerCase()] ?? 'png';
}

interface PendingImport {
  payload: ReturnType<typeof buildImportResult>;
  expires: number;
}

const pendingImports = new Map<string, PendingImport>();
const TTL_MS = 30 * 60 * 1000;

function takePending(id: string): PendingImport {
  const pending = pendingImports.get(id);
  if (!pending || pending.expires < Date.now()) {
    pendingImports.delete(id);
    throw new ApiError('Import session expired or not found', 400);
  }
  pendingImports.delete(id);
  return pending;
}

async function writeCharacterFile(id: string, filename: string, buffer: Buffer): Promise<void> {
  const dir = path.join(DIR.characters, id);
  await ensureDir(dir);
  await fs.writeFile(path.join(dir, filename), buffer);
}

async function readCharacterFile(id: string, filename: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(DIR.characters, id, filename));
  } catch {
    return null;
  }
}

async function saveAvatar(id: string, buffer: Buffer, mime: string): Promise<string> {
  const ext = avatarExt(mime);
  const entries = await fs.readdir(path.join(DIR.characters, id)).catch(() => []);
  for (const entry of entries) {
    if (entry.startsWith('avatar.')) await fs.rm(path.join(DIR.characters, id, entry), { force: true });
  }
  await writeCharacterFile(id, `avatar.${ext}`, buffer);
  return `/media/characters/${id}/avatar.${ext}`;
}

export function charactersRouter(ctx: AppContext): Router {
  const router = Router();
  const { characters } = ctx.store;

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(characters.list());
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(characters.getOrThrow(idParam(req)));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = readJsonBody<Partial<Character>>(req);
      const character = characters.create({
        name: asString(body.name, 'Unnamed'),
        description: asString(body.description),
        personality: asString(body.personality),
        system_prompt: asString(body.system_prompt),
        post_history_instructions: asString(body.post_history_instructions),
        mes_example: asString(body.mes_example),
        tags: Array.isArray(body.tags) ? body.tags.map((t) => asString(t)).filter(Boolean) : [],
        creator_notes:
          typeof body.creator_notes === 'string' && body.creator_notes.trim() !== ''
            ? body.creator_notes
            : null,
        llmConnectionId:
          typeof body.llmConnectionId === 'string' && body.llmConnectionId
            ? body.llmConnectionId
            : null,
        avatarPath: null,
        voiceSamplePath: null,
        voiceSampleTranscript: null,
      });
      res.status(201).json(character);
    }),
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const current = characters.getOrThrow(idParam(req));
      const body = readJsonBody<Partial<Character>>(req);
      const updated = characters.update(idParam(req), {
        name: body.name !== undefined ? asString(body.name, current.name) : undefined,
        description: body.description !== undefined ? asString(body.description) : undefined,
        personality: body.personality !== undefined ? asString(body.personality) : undefined,
        system_prompt: body.system_prompt !== undefined ? asString(body.system_prompt) : undefined,
        post_history_instructions:
          body.post_history_instructions !== undefined
            ? asString(body.post_history_instructions)
            : undefined,
        mes_example: body.mes_example !== undefined ? asString(body.mes_example) : undefined,
        tags: body.tags !== undefined
          ? body.tags.map((t) => asString(t)).filter(Boolean)
          : undefined,
        creator_notes: body.creator_notes !== undefined
          ? typeof body.creator_notes === 'string' && body.creator_notes.trim() !== ''
            ? body.creator_notes
            : null
          : undefined,
        llmConnectionId: body.llmConnectionId !== undefined
          ? typeof body.llmConnectionId === 'string' && body.llmConnectionId
            ? body.llmConnectionId
            : null
          : undefined,
      });
      res.json(updated);
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      await fs.rm(path.join(DIR.characters, idParam(req)), { recursive: true, force: true });
      characters.delete(idParam(req));
      res.status(204).end();
    }),
  );

  router.post(
    '/:id/avatar',
    asyncHandler(async (req, res) => {
      const character = characters.getOrThrow(idParam(req));
      const file = (req.files as Express.Multer.File[] | undefined)?.[0] ?? (req.file as Express.Multer.File | undefined);
      if (!file) throw new ApiError('Expected an avatar file field', 400);
      const avatarPath = await saveAvatar(character.id, file.buffer, file.mimetype || 'image/png');
      res.json(characters.update(character.id, { avatarPath }));
    }),
  );

  router.delete(
    '/:id/avatar',
    asyncHandler(async (req, res) => {
      const character = characters.getOrThrow(idParam(req));
      const entries = await fs.readdir(path.join(DIR.characters, character.id)).catch(() => []);
      for (const entry of entries) {
        if (entry.startsWith('avatar.')) {
          await fs.rm(path.join(DIR.characters, character.id, entry), { force: true });
        }
      }
      res.json(characters.update(character.id, { avatarPath: null }));
    }),
  );

  router.post(
    '/:id/voice',
    asyncHandler(async (req, res) => {
      const character = characters.getOrThrow(idParam(req));
      const file = (req.files as Express.Multer.File[] | undefined)?.[0] ?? (req.file as Express.Multer.File | undefined);
      if (!file) throw new ApiError('Expected a voice sample file field', 400);
      await writeCharacterFile(character.id, 'voice-sample.wav', file.buffer);
      ctx.voiceCache.invalidate(character.id);
      const transcript = req.body && typeof req.body.transcript === 'string' ? req.body.transcript : '';
      res.json(
        characters.update(character.id, {
          voiceSamplePath: `/media/characters/${character.id}/voice-sample.wav`,
          voiceSampleTranscript: transcript || null,
        }),
      );
    }),
  );

  router.delete(
    '/:id/voice',
    asyncHandler(async (req, res) => {
      const character = characters.getOrThrow(idParam(req));
      await fs.rm(path.join(DIR.characters, character.id, 'voice-sample.wav'), { force: true });
      ctx.voiceCache.invalidate(character.id);
      res.json(characters.update(character.id, { voiceSamplePath: null, voiceSampleTranscript: null }));
    }),
  );

  router.post(
    '/import',
    asyncHandler(async (req, res) => {
      const file = (req.files as Express.Multer.File[] | undefined)?.[0] ?? (req.file as Express.Multer.File | undefined);
      if (!file) throw new ApiError('Expected a card file field', 400);
      const parsed = parseCard(file.buffer);
      const payload = buildImportResult(parsed);
      const importId = uuid();
      pendingImports.set(importId, { payload, expires: Date.now() + TTL_MS });
      const avatarDataUrl =
        payload.avatarBuffer && parsed.imageBuffer === null
          ? `data:image/png;base64,${payload.avatarBuffer.toString('base64')}`
          : null;
      res.json({
        importId,
        character: payload.character,
        lorebook: payload.lorebook,
        scenario: payload.scenario,
        hasAvatar: payload.avatarBuffer !== null,
        avatarDataUrl,
        cardKind: parsed.kind,
      });
    }),
  );

  router.post(
    '/finalize',
    asyncHandler(async (req, res) => {
      const body = readJsonBody<{
        importId?: string;
        name?: string;
        acceptLorebook?: boolean;
        acceptScenario?: boolean;
      }>(req);
      const { payload } = takePending(asString(body.importId));
      const name = asString(body.name, payload.character.name);

      const character = characters.create({
        ...payload.character,
        name,
        avatarPath: null,
        voiceSamplePath: null,
        voiceSampleTranscript: null,
        llmConnectionId: null,
      });
      if (payload.avatarBuffer) {
        await saveAvatar(character.id, payload.avatarBuffer, 'image/png');
        characters.update(character.id, { avatarPath: `/media/characters/${character.id}/avatar.png` });
      }

      const suggestions: ImportSuggestion[] = [];
      if (payload.lorebook && asBoolean(body.acceptLorebook, false)) {
        const existing = ctx.store.lorebooks
          .list()
          .find((b) => b.name.toLowerCase() === payload.lorebook!.name.toLowerCase());
        const lorebook =
          existing ?? ctx.store.lorebooks.create(payload.lorebook);
        suggestions.push({ kind: 'lorebook', accepted: true, entityId: lorebook.id, name: lorebook.name });
      } else if (payload.lorebook) {
        suggestions.push({ kind: 'lorebook', accepted: false, entityId: null, name: payload.lorebook.name });
      }
      if (payload.scenario && asBoolean(body.acceptScenario, false)) {
        const scenario = ctx.store.scenarios.create(payload.scenario);
        suggestions.push({ kind: 'scenario', accepted: true, entityId: scenario.id, name: scenario.name });
      } else if (payload.scenario) {
        suggestions.push({ kind: 'scenario', accepted: false, entityId: null, name: payload.scenario.name });
      }

      res.status(201).json({ character: characters.getOrThrow(character.id), suggestions });
    }),
  );

  router.get(
    '/:id/export',
    asyncHandler(async (req, res) => {
      const character = characters.getOrThrow(idParam(req));
      const avatar = await readCharacterFile(character.id, 'avatar.png');
      if (!avatar) {
        throw new ApiError('Cannot export: character has no PNG avatar. Upload a PNG avatar first.', 400);
      }
      // Optional embedded attachments for the round trip into SillyTavern.
      const lorebookId = typeof req.query.lorebookId === 'string' ? req.query.lorebookId : '';
      const scenarioId = typeof req.query.scenarioId === 'string' ? req.query.scenarioId : '';
      const book = lorebookId ? ctx.store.lorebooks.get(lorebookId) ?? null : null;
      const scenario = scenarioId ? ctx.store.scenarios.get(scenarioId) ?? null : null;
      const charaJson = JSON.stringify(
        buildCardObject({
          name: character.name,
          description: character.description,
          personality: character.personality,
          system_prompt: character.system_prompt,
          post_history_instructions: character.post_history_instructions,
          mes_example: character.mes_example,
          tags: character.tags,
          creator_notes: character.creator_notes && character.creator_notes.trim() !== ''
            ? character.creator_notes
            : undefined,
          first_mes: scenario?.first_mes ?? '',
          scenario: scenario?.scenario ?? '',
          alternate_greetings: scenario?.alternate_greetings ?? [],
          character_book: book ? bookToCharacterBook(book, character.name) : null,
        }),
      );
      const png = writePngText(avatar, 'chara', Buffer.from(charaJson, 'utf8').toString('base64'));
      const safeName = character.name.replace(/[^\w.-]+/g, '_') || 'character';
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.png"`);
      res.send(png);
    }),
  );

  // zd-file export: a zip bundling the SillyTavern PNG card (with optional
  // embedded lorebook), the voice sample WAV and its transcript text file.
  router.get(
    '/:id/export-zd',
    asyncHandler(async (req, res) => {
      const character = characters.getOrThrow(idParam(req));
      const avatar = await readCharacterFile(character.id, 'avatar.png');
      if (!avatar) {
        throw new ApiError('Cannot export: character has no PNG avatar. Upload a PNG avatar first.', 400);
      }
      const lorebookId = typeof req.query.lorebookId === 'string' ? req.query.lorebookId : '';
      const book = lorebookId ? ctx.store.lorebooks.get(lorebookId) ?? null : null;
      const charaJson = JSON.stringify(
        buildCardObject({
          name: character.name,
          description: character.description,
          personality: character.personality,
          system_prompt: character.system_prompt,
          post_history_instructions: character.post_history_instructions,
          mes_example: character.mes_example,
          tags: character.tags,
          creator_notes: character.creator_notes && character.creator_notes.trim() !== ''
            ? character.creator_notes
            : undefined,
          character_book: book ? bookToCharacterBook(book, character.name) : null,
        }),
      );
      const png = writePngText(avatar, 'chara', Buffer.from(charaJson, 'utf8').toString('base64'));

      // Stage the export contents, then zip them with the `zip` CLI (files as
      // arguments; deterministic names applied directly to archive entries).
      const staging = path.join(DIR.characters, character.id, 'zdexport');
      await ensureDir(staging);
      for (const entry of await fs.readdir(staging).catch(() => [])) {
        await fs.rm(path.join(staging, entry), { recursive: true, force: true });
      }
      const cardFile = `${(character.name || 'character').replace(/[^\w.-]+/g, '_') || 'character'}.png`;
      await fs.writeFile(path.join(staging, cardFile), png);
      let hasVoice = false;
      try {
        await fs.copyFile(path.join(DIR.characters, character.id, 'voice-sample.wav'), path.join(staging, 'voice-sample.wav'));
        hasVoice = true;
        await fs.writeFile(
          path.join(staging, 'transcript.txt'),
          character.voiceSampleTranscript ?? '',
          'utf8',
        );
      } catch {
        // no voice sample — the zip simply contains the card alone
      }
      const zipName = `${(character.name || 'character').replace(/[^\w.-]+/g, '_') || 'character'}.zd`;
      const zipPath = path.join(staging, zipName);
      const files = cardFile + (hasVoice ? ' voice-sample.wav transcript.txt' : '');
      await new Promise<void>((resolve) => {
        execFile(
          'zip',
          ['-j', zipPath, cardFile, ...(hasVoice ? ['voice-sample.wav', 'transcript.txt'] : [])],
          { cwd: staging, timeout: 60_000 },
          (err) => {
            if (err) console.error('[zdexport] zip failed:', (err as Error).message);
            else console.log(`[zdexport] created ${zipPath} (${files})`);
            resolve();
          },
        );
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
      res.send(await fs.readFile(zipPath));
    }),
  );

  return router;
}