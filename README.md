# zd-rps

Single-user, localhost roleplay-chat app: a Node/Express middleware that wires LLM, speech-to-text, and text-to-speech backends behind a React/Vite chat UI. Everything is stored as JSON files on disk — no database, no accounts.

## Features

- **Chats with characters** — add/remove characters mid-chat, per-chat runtime settings (temperature, top-p, max tokens, LLM/TTS connection, instant-reply mode).
- **SillyTavern compatibility** — import `.png` character cards (extracts character, and offers to import the embedded lorebook and scenario), export a card back out with its attached lorebook/scenario.
- **Lorebooks** — SillyTavern-style keyword-scanning world knowledge, injected into the LLM prompt when relevant.
- **Scenarios** — reusable opening scenes: system setup + first message + alternate greetings.
- **Streaming replies** — the LLM reply streams in sentence-sized chunks; each sentence is sent to TTS and played back in order when ready, with a replay chip left under the message.
- **Speech input** — record and transcribe via STT into the input box.
- **Voice cloning** — TTS can clone a character's uploaded voice sample; clones are cached per connection.

## Architecture

```
server/     Express + TypeScript (ESM). API, JSON-file store, provider adapters, LLM pipeline.
web/        React + Vite + TypeScript (SPA). Three-column chat UI, config/import editors.
config.json Connections + default LLM/STT/TTS. Auto-created on first run.
data/       characters/, lorebooks/, scenarios/, chats/, media/, voices.json. Auto-created.
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
- `ollama` uses `/api/tags` for models and supports `think: false` (the chat's **Instant replies (no thinking)** toggle) so reasoning models reply without spending their generation budget on a CoT block.
- Voice cloning uses the character's uploaded voice sample; connections without cloning support pass it as reference audio.

## Data storage

- All entities are written as JSON: `data/characters/<id>/character.json` (+ `avatar.png`, `voice-sample.wav`), `data/lorebooks/<id>.json`, `data/scenarios/<id>.json`, `data/chats/<id>.json`.
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

- `CRUD` — `/api/connections`, `/api/characters`, `/api/lorebooks`, `/api/scenarios`, `/api/chats`
- `POST /api/connections/:id/test` — verify + fetch models/voices
- `POST /api/connections/defaults` — set default LLM/STT/TTS
- `POST /api/characters/import`, `GET /api/characters/:id/export` — SillyTavern cards
- `POST /api/chats/:id/messages` — **Server-Sent Events** stream: `speaker`, `sentence`, `audio`, `done`, `error` events (`{ content, audioEnabled }` body)
- `POST /api/audio/stt` (multipart) → transcript; `POST /api/audio/tts` (`{ text, characterId?, connectionId? }`) → `{ audioPath }`

## Development

Verification is unit tests + typecheck + build + lint:

```sh
npm run test -w server           # Vitest: SentenceStream, OrderedAudio, normalizeChat, buildLlmMessages/attributeReply
npm run typecheck -w server
npm run build -w @zd-rps/web    # tsc -b && vite build
npm run lint -w @zd-rps/web     # oxlint
npm run build -w server         # run from repo root
```

`data/` and `config.json` are your live state — for smoke tests run an isolated instance with a copy: `ZD_RPS_DATA=/tmp/x PORT=3199 node server/dist/index.js`. See `AGENTS.md` for details.