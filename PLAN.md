# zd-rps — Plan

Chat-bot program: Node.js (Express) middleware + AI backends (LLM, STT, TTS). Single-user localhost app, all data stored as JSON files on disk. Frontend is React + Vite. TypeScript throughout.

## Repo layout

```
config.json                 connections + app settings
data/characters/<id>/character.json, avatar.png, voice-sample.wav
data/lorebooks/<id>.json
data/scenarios/<id>.json
data/chats/<id>.json
data/media/                 TTS output, user images
server/                     Express + TS
  index.ts                  bootstrap, static serve of web/dist + data/media
  store.ts                  JSON-file data layer
  cards.ts                  SillyTavern PNG/JSON import/export
  lore.ts                   lorebook scanning/matching engine
  pipeline.ts               message → context → LLM → attributed reply → (TTS)
  providers/
    llm/  openai-compatible.ts, ollama.ts
    stt/  openai-whisper.ts, whispercpp.ts
    tts/  elevenlabs.ts, cartesia.ts, omnivoice.ts, dots.ts, factory.ts
  routes/ ...
web/                        React + Vite, TS
```

## Entities

- **Character**: `name, description, personality, system_prompt, post_history_instructions, mes_example, tags, avatarPath, voiceSamplePath, created/updated`
  - `voiceSamplePath` → WAV upload (`data/characters/<id>/voice-sample.wav`) used by TTS cloning adapters.
- **Lorebook**: SillyTavern-compatible: `name, description, scan_depth, token_budget, recursive_scanning, entries[]` keeping `keys/content/priority/insertion_order/case_sensitive/selective/secondary_keys/constant`.
- **Scenario**: `name, description, first_mes, scenario, alternate_greetings`.
- **Chat**: `title, participantIds[], removedParticipants[]{characterId,name,avatarPath,removedAt}, lorebookIds[], scenarioId, messages[{id, role, speaker?, content, audioPath?, images[], ts}], runtime{}`.
  - Removing a character moves them from `participantIds` to `removedParticipants`; their messages remain.
  - On resume, context builder adds a system note that removed participants exist in history but are inactive.
- **Connection** (in `config.json`): `{id, name, kind: llm|stt|tts, provider, baseUrl, apiKey, modelOrVoice, providerOptions{…}}`.

## SillyTavern cards

- Import: parse PNG `tEXt` chunk keyed `chara` (base64 JSON, V1/V2) via pngjs. Avatar = embedded `avatar` or the PNG image.
- Splits card into three suggestions:
  - character → own profile in characters/
  - `character_book` → lorebook **suggestion** (accept → write lorebooks/ named after the book)
  - `scenario` + `first_mes` (+ `alternate_greetings`) → scenario **suggestion** (accept → write scenarios/)
- Export: merge character + attached scenario/lorebook refs back into spec-compatible PNG (pngjs writes `chara` tEXt onto the avatar).

## Providers

Uniform `test()` + `listModels()`/`listVoices()`; UI "Test & fetch" runs both → connected + dropdown populated.
- LLM: OpenAI-compatible family (`GET /v1/models`; OpenAI, llama.cpp, OpenRouter…), Ollama (`GET /api/tags`).
- STT: OpenAI Whisper API (`POST /v1/audio/transcriptions`), whisper.cpp (local; ping only, no model list).
- TTS: ElevenLabs (voices via `/v1/voices`, clone via `/v1/voices/add`), Cartesia Sonic (`/v1/voices`, REST + WS), OmniVoice (`/v1/voices` + clone), dots.tts (npm lib). Each exports `capabilities` so the config form renders provider-specific fields.
- Voice cloning uses the character's `voiceSamplePath`; cloned voice ids are cached per (character × connection).

## API

- CRUD: connections, characters, lorebooks, scenarios, chats
- `POST /connections/:id/test` (test + fetch models/voices)
- `POST /characters/import`, `GET /characters/:id/export`
- `POST /chats/:id/participants` (add/remove), `POST /chats/:id/messages`
- `POST /tts` (text → audio url), `POST /stt` (multipart audio → text)

## UX

- New-chat wizard: characters → lorebooks (multi) → scenario.
- Add/remove characters mid-chat from right column participant list.
- Top bar: Configuration · Characters · Lorebooks · Scenarios.
- Bottom bar: hamburger (Start New Chat / Delete Current Chat), mic toggle (disabled without STT; off → flush recording to STT), text input.
- Three columns: left image viewer / centre chat with speaker icons + TTS play buttons / right runtime options + participant list.

## Pipeline (message → reply)

1. Snapshot speaker metadata; persist user message.
2. Build context: scenario + system prompts + one block per active character + removed-participants note + lorebook matches (multi-book scan: match keys, respect case_sensitive/priority/scan_depth/insertion_order) + history.
3. LLM reply attributed to speaking character; persist.
4. Optional auto-TTS via character's cloned voice.

## Build order

1. Scaffold workspaces
2. cards import/export + entity CRUD
3. connections + test&fetch + dynamic forms
4. chats wizard + pipeline + lore engine
5. three-column UI + top/bottom bars
6. STT/TTS + voice cloning