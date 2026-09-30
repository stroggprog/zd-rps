# zd-rps

Single-user, localhost roleplay-chat app: a Node/Express middleware that wires LLM, speech-to-text, and text-to-speech backends behind a React/Vite chat UI. Everything is stored as JSON files on disk — no database, no accounts.

## Concept

Multiple characters can be used in each chat, and characters can be added/removed on the fly. Character descriptions and personality are separated from Scenario and Lorebooks, so when starting a chat you can select any characters, any lorebooks (multiple) and any scenario. New lorebooks and Scenarios can be created independantly ready for future use. Ad-hoc scenarios can be created on the fly.

## Features

- **Chats with characters** — add/remove characters mid-chat (removed ones get dimmed with a "removed" label and a ＋ button to bring them back), per-chat runtime settings (temperature, top-p, max tokens, LLM/TTS connection, instant-reply mode, plus an optional one-reply-per-participant sequential-turns mode that stops speaker leakage between bubbles). Any message bubble can be edited or deleted (✎/🗑 under the bubble), which rewrites the LLM context so you can steer the conversation.
- **Editable system prompt** — the Configuration screen can view and override the LLM framing prompt (per app install, stored in config.json; placeholders `{{user}}`/`{{characters}}` supported; character sheets, world knowledge and the formatting/narration rules are always appended).
- **Character groups** — groups of characters (name, description, image) that can be handed out in one click when creating a chat; membership is editable from both the Groups editor and the Character editor.
- **Personas** — you are a persona of your own (name, optional image/description, gender) injected into the LLM prompt so characters see who you are; default persona "You" is created automatically, each chat pins a persona at creation.
- **Character tags** — tags on a character (comma-separated, also round-tripped with SillyTavern cards) filter the wizard's character list, show as chips in the character editor, and are injected into the LLM's character blocks as keywords.
- **SillyTavern compatibility** — import `.png` character cards (extracts character, and offers to import the embedded lorebook and scenario), export a card back out with its attached lorebook/scenario. When exporting a card you can optionally embed one of your lorebooks and/or a scenario (select them in the export panel), so the character round-trips into SillyTavern with its assets. An "Export as .zdc file" option in the same panel zips the card together with the character's voice sample (voice-sample.wav) and its transcript (transcript.txt). The Cards UI **Import card** accepts `.zdc` files back Narrators have the same flow: **Export as .zdn file** in the Narrator editor and an **Import file (.zdn)** button in its list. Personas likewise export **.zdp** files (both voice and thought samples, with their transcripts) via the Persona editor.: the character, embedded lorebook, voice sample and transcript are all restored.
- **Lorebooks** — SillyTavern-style keyword-scanning world knowledge, injected into the LLM prompt when relevant. Lorebooks can be exported as JSON files and imported back from files (our export format or SillyTavern lorebook JSON), in addition to importing them embedded in character cards.
- **Scenarios** — reusable opening scenes: system setup + first message + alternate greetings; chats can also carry an ad-hoc scenario written in the new-chat wizard (scenario text required, opening message optional). Scenarios can be exported as JSON files and imported from files.
- **Context-window trimming** — LLM connections get an optional context-window budget (tokens) in Configuration; when the transcript outgrows it, the oldest history is dropped to fit (generation tokens reserved, a note added to the prompt) instead of erroring out.
- **Reply modes** — before sending you can pick: all characters respond, selected characters only (checkbox list with ✓ marks), or let the LLM decide per message from context (talk to Kiara → only Kiara; a rules question → both Kiara and Li Mei; shipwide diagnostic → Yumiko, Rusty and Sam). Lives in the right panel's Replies section (works with or without Sequential turns — narrowing the roster implies per-character rounds for that message).
- **Streaming replies** — the LLM reply streams in sentence-sized chunks; each sentence is sent to TTS and played back in order when ready, with replay chips left under the message. When a multi-character reply hands over mid-stream (`Amy: ...`), the reply splits into separate per-speaker bubbles with their own avatars and audio.
- **Speech vs narration** — dialogue (in double quotes) is spoken by the speaking character's voice, narration by the chat's narrator voice. Paragraph breaks between narration and speech are enforced server-side even when the model ignores the formatting contract, and the live bubble shows the transition as the reply streams.
- **Narrators** — narrators are their own entity type (managed in the dedicated Narrators editor, separate from characters). Each chat picks one via `narratorId`, and narration is voiced by it (falling back to the character's voice when none is set).
- **Stories** — configurable at Configuration/editable from the Stories button. Current chats can be summarised into a story (the LLM writes the summary folding in the story's existing summary), so the story evolves over several chats. New chats can pick a story; its summary is injected ahead of the transcript, which keeps context sizes small.
- **Speech input** — record and transcribe via STT into the input box (push-to-talk hotkey, default Ctrl+M, configurable in Configuration).
- **Per-character LLM connections** — a character can have its own LLM connection (used in Sequential turns mode); there's no limit on connection count, each just needs its own base URL (e.g. multiple Ollama instances).
- **Voice testing** — a configurable test text (default "This is a test. Counting, one, two, three. Beware the Jabberwock, my son!") in the Configuration screen; the Character editor's Test button plays the uploaded voice sample speaking it.
- **Voice cloning** — TTS can clone a character's or narrator's uploaded voice sample; clones are cached per connection.
- **Print / Audio book** — a Print button lists chats (searchable); pick one and choose Transcript (print to PDF) and/or Audio book. The audio book synthesizes every segment with the right voice (persona speech/thought clips for user content, character voices for dialogue, narrator for the rest), writes `playlist.m3u` + a `<chat title>.mp3` via sox, and shows the generated files.
- **Print/PDF** — a Print button lists chats (searchable); picking one opens a printable transcript window (title, metadata, speaker-name paragraphs) with the browser's print dialog for saving as PDF.


## Architecture

```
server/     Express + TypeScript (ESM). API, JSON-file store, provider adapters, LLM pipeline.
web/        React + Vite + TypeScript (SPA). Three-column chat UI, config/import editors.
config.json Connections + default LLM/STT/TTS. Auto-created on first run.
data/       characters/, narrators/, personas/, lorebooks/, scenarios/, chats/, media/, voices.json. Auto-created.
```

The server serves the built web app (`web/dist`) plus uploaded media under `/media/*`. It uses Express 5 with a history fallback for the SPA (non-`/api` GETs).

## HTTPS

Direct TLS is supported via environment variables — set both in the service
file (systemd `Environment=` lines, pm2, etc.):

| Env var | Value |
| --- | --- |
| `ZD_RPS_CERT` | path to the certificate file (PEM, fullchain) |
| `ZD_RPS_KEY` | path to the private key file (PEM) |

When both are set the server speaks HTTPS (`https://…:${PORT}`); otherwise
plain HTTP.

A reverse proxy on the same or fronting machine works equally well:



- **Caddy** (simplest, auto-certificates):
  ```
  rps.yourdomain.tld {
      reverse_proxy localhost:3000
  }
  ```
- **nginx**:
  ```
  server {
      listen 443 ssl;
      ssl_certificate     /path/fullchain.pem;
      ssl_certificate_key /path/to/privkey.key;
      location / {
          proxy_pass http://localhost:3000;
          proxy_set_header Host $host;
      }
  }
  ```

Then browse `https://ai300-96/…` instead of `http://…`. This also fixes
mixed-content failures on browsers that block the application's HTTP assets.

## Production

Vite is only needed at build time. To run the app in a production environment:

1. Install dependencies (including dev tools — both `tsc` and `vite` are
   devDependencies and the build needs them):
   ```sh
   npm install
   ```
   (Run plain `npm install`; do **not** set `NODE_ENV=production` or use
   `--omit=dev` here, or `tsc`/`vite` will be missing.)
2. Build both workspaces:
   ```sh
   npm run build        # or per workspace:
   npm run build -w @zd-rps/web
   npm run build -w server
   ```
3. The server embeds the built SPA: `node server/dist/index.js` serves
   `web/dist` on its port (default 3000) — that is the whole app; there is
   nothing else to serve and the browser talks only to this port.
4. Run the server:
   ```sh
   npm start -w server      # = node server/dist/index.js
   ```
   (from the repo root; or `npm start` inside `server/`)
5. Keep the process alive with your normal tooling (systemd, pm2, a docker
   container …). `config.json` and `data/` live next to it (or wherever
   `ZD_RPS_CONFIG`/`ZD_RPS_DATA` point).

Tip: `npm run dev` stays the tool for development — it recompiles on save and
proxies to the running server; production only ever consumes the artifacts
produced by the two build commands above.

### Systemd
To create a systemd service file:
```sh
# use xed or nano
sudo xed /etc/systemd/system/zd-rps.service
```
 Enter these details, replacing 'USER' with the proper value and amend any paths as necessary:
```sh
[Unit]
Description=zd-rps Node.js Application Managed by NVM with HTTPS
After=network.target

[Service]
Type=simple
User=USER
# set your working directory here (the root of the repo)
WorkingDirectory=/home/USER/Software/zd-rps

# If using Option 1 (Wrapper Script):
# ExecStart=/home/youruser/myapp/start.sh
# If using Option 2 (Direct Path):
ExecStart=/home/USER/.nvm/versions/node/v22.23.3/bin/npm start -w server
Restart=on-failure

# HTTPS Environment Variables
Environment=NODE_ENV=production
Environment=ZD_RPS_ROOT=/home/USER/Software/zd-rps
# certificates needed to allow the use of a microphone across a network
# when accessing the server via localhost, certs not needed
Environment=ZD_RPS_CERT=/home/USER/.security/localhost+3.pem
Environment=ZD_RPS_KEY=/home/USER/.security/localhost+3-key.pem

[Install]
WantedBy=multi-user.target
```

If you have set the production server up with a service file using systemd, you can create a batch file to automate an update process:
```sh
#!/bin/bash
sudo systemctl stop zd-rps
# change to the correct path!
cd "$HOME/Software/zd-rps"
git pull
npm use 22 # if using nvm
npm install
npm run build
sudo systemctl start zd-rps
sudo systemctl status zd-rps
```

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
- The chat's **Dialogue only** runtime toggle is remembered globally: it persists to `config.json` (`dialogueOnly`) and every new chat starts with the last chosen value.

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
