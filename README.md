# zd-rps

Single-user, localhost roleplay-chat app: a Node/Express middleware that wires LLM, speech-to-text, and text-to-speech backends behind a React/Vite chat UI. Everything is stored as JSON files on disk — no database, no accounts.

## Concept

Multiple characters can be used in each chat, and characters can be added/removed on the fly. Character descriptions and personality are separated from Scenario and Lorebooks, so when starting a chat you can select any characters, any lorebooks (multiple) and any scenario. New lorebooks and Scenarios can be created independantly ready for future use. Ad-hoc scenarios can be created on the fly.

## Features

- **Chats with characters** — add/remove characters mid-chat (removed ones get dimmed with a "removed" label and a ＋ button to bring them back), per-chat runtime settings (temperature, top-p, max tokens, LLM/TTS connection, instant-reply mode). Any message bubble can be edited or deleted (✎/🗑 under the bubble), which rewrites the LLM context so you can steer the conversation.
- **Personas** — you are a persona of your own (name, optional image/description, gender) injected into the LLM prompt so characters see who you are; default persona "You" is created automatically, each chat pins a persona at creation.
- **SillyTavern compatibility** — import `.png` character cards (extracts character, and offers to import the embedded lorebook and scenario), export a card back out with its attached lorebook/scenario.
- **Lorebooks** — SillyTavern-style keyword-scanning world knowledge, injected into the LLM prompt when relevant.
- **Scenarios** — reusable opening scenes: system setup + first message + alternate greetings; chats can also carry an ad-hoc scenario written in the new-chat wizard (scenario text required, opening message optional).
- **Context-window trimming** — LLM connections get an optional context-window budget (tokens) in Configuration; when the transcript outgrows it, the oldest history is dropped to fit (generation tokens reserved, a note added to the prompt) instead of erroring out.
- **Streaming replies** — the LLM reply streams in sentence-sized chunks; each sentence is sent to TTS and played back in order when ready, with replay chips left under the message. When a multi-character reply hands over mid-stream (`Amy: ...`), the reply splits into separate per-speaker bubbles with their own avatars and audio.
- **Speech vs narration** — dialogue (in double quotes) is spoken by the speaking character's voice, narration by the chat's narrator voice. Paragraph breaks between narration and speech are enforced server-side even when the model ignores the formatting contract, and the live bubble shows the transition as the reply streams.
- **Narrators** — narrators are their own entity type (managed in the dedicated Narrators editor, separate from characters). Each chat picks one via `narratorId`, and narration is voiced by it (falling back to the character's voice when none is set).
- **Speech input** — record and transcribe via STT into the input box (push-to-talk hotkey, default Ctrl+M, configurable in Configuration).
- **Voice cloning** — TTS can clone a character's or narrator's uploaded voice sample; clones are cached per connection.
- **Print/PDF** — a Print button lists chats (searchable); picking one opens a printable transcript window (title, metadata, speaker-name paragraphs) with the browser's print dialog for saving as PDF.

## Architecture

```
server/     Express + TypeScript (ESM). API, JSON-file store, provider adapters, LLM pipeline.
web/        React + Vite + TypeScript (SPA). Three-column chat UI, config/import editors.
config.json Connections + default LLM/STT/TTS. Auto-created on first run.
data/       characters/, narrators/, personas/, lorebooks/, scenarios/, chats/, media/, voices.json. Auto-created.
```

The server serves the built web app (`web/dist`) plus uploaded media under `/media/*`. It uses Express 5 with a history fallback for the SPA (non-`/api` GETs).

## Quick start

Requires Node 20.19+ or 22.12+ (Vite 8 requirement; uses native `fetch`/web-streams).

```sh
npm install
npm run dev
```

- Server: http://localhost:3000
- Web: http://localhost:5173 (Vite proxies `/api` and `/media` to :3000)

Then open **Configuration** to add connections (see below) and click **Test & fetch** to verify and populate model/voice lists.

## Configuring connections

Connections live in `config.json` and are edited from the web UI. Each connection sets a provider, base URL, optional API key, and a model/voice. Defaults for each kind are used where a chat doesn't override its own connection.

| Kind | Providers |
| --- | --- |
| LLM  | `openai-compatible` (OpenAI, llama.cpp, OpenRouter, …), `ollama` |
| STT  | `openai-whisper`, `whispercpp` |
| TTS  | `elevenlabs`, `cartesia`, `omnivoice`, `dots` |

Notes:

- `openai-compatible` appends `/v1` automatically; model list comes from `/v1/models`.
- LLM connections can optionally limit the context window (**Context window (tokens)**); with it set, older chat history is trimmed to `contextTokens − maxTokens` estimated tokens. Leave empty to send full history every turn.
- `ollama` uses `/api/tags` for models and supports `think: false` (the chat's **Instant replies (no thinking)** toggle) so reasoning models reply without spending their generation budget on a CoT block.
- Voice cloning uses the character's uploaded voice sample; connections without cloning support pass it as reference audio.

## Data storage

- All entities are written as JSON: `data/characters/<id>.json`, `data/narrators/<id>.json`, `data/personas/<id>.json`, `data/lorebooks/<id>.json`, `data/scenarios/<id>.json`, `data/chats/<id>.json`. Avatars and voice samples live next to their entity (`data/<entity>/<id>/avatar.png`, `voice-sample.wav`); the legacy per-entity `character.json` layout is tolerated and migrated on load.
- TTS output and user images go to `data/media/`.
- Generated `voices.json` caches cloned voice IDs.
- Everything uses file-level normalization on load, so stored files from older versions are upgraded smoothly (new fields get defaults).

Paths are overridable for testing or packaging:

| Env var | Default |
| --- | --- |
| `ZD_RPS_ROOT` | repo root |
| `ZD_RPS_DATA` | `<root>/data` |
| `ZD_RPS_CONFIG` | `<root>/config.json` |
| `PORT` | `3000` |

## API overview

- `CRUD` — `/api/connections`, `/api/characters`, `/api/narrators`, `/api/personas`, `/api/lorebooks`, `/api/scenarios`, `/api/chats`
- `POST /api/connections/:id/test` — verify + fetch models/voices
- `POST /api/connections/defaults` — set default LLM/STT/TTS
- `POST /api/characters/import`, `GET /api/characters/:id/export` — SillyTavern cards
- `POST /api/chats/:id/messages` — **Server-Sent Events** stream: `speaker`, `sentence` (`{ index, text, isLast, isSpeech }`), `audio`, `done`, `error` events (`{ content, audioEnabled }` body)
- `POST /api/audio/stt` (multipart) → transcript; `POST /api/audio/tts` (`{ text, characterId?, connectionId? }`) → `{ audioPath }`

## Development

Verification is unit tests + typecheck + build + lint:

```sh
npm run test -w server           # Vitest: SentenceStream, OrderedAudio, QuotationTracker, SpeechFormatter, normalizeChat, buildLlmMessages/attributeReply
npm run typecheck -w server
npm run build -w @zd-rps/web    # tsc -b && vite build
npm run lint -w @zd-rps/web     # oxlint
npm run build -w server         # run from repo root
```

`data/` and `config.json` are your live state — for smoke tests run an isolated instance with a copy: `ZD_RPS_DATA=/tmp/x PORT=3199 node server/dist/index.js`. See `AGENTS.md` for details.
