# AGENTS.md

## Working rules
- Keep responses concise unless the user asks otherwise.
- In planning mode: ask clarifying questions; never assume design, tech stack, or features.
- The user runs `npm run dev` themselves. Do not start/stop their dev server; use separate ports + temp data for smoke tests (below).
- Do not modify `data/` or `config.json` during testing — they are the user's live state.

## Commands (run from repo root)
- Dev (both): `npm run dev` (concurrently: server :3000 via tsx watch, web :5173 via vite)
- Server typecheck: `npm run typecheck -w server`
- Server build: `npm run build -w server` → `node dist/index.js` (workspace must be `-w server` from root; running it inside `server/` fails)
- Web build: `npm run build -w @zd-rps/web` (tsc -b && vite build)
- Web lint: `npm run lint -w @zd-rps/web` (oxlint)
- There is **no test suite**. Verification = typecheck + build + lint + curl/SSE smoke tests.

## Layout
- npm workspaces `server/` (Express, ESM — imports end in `.js`) and `web/` (React+Vite, extensionless imports). No shared package: `web/src/lib/types.ts` mirrors `server/src/types.ts` by hand — keep them in sync.
- `PLAN.md` is the design doc but is partially stale (e.g. it predates SSE streaming, `audio` chips, `disableThinking`, `/api/connections/defaults`). Trust the code over PLAN.md.
- Server entry `server/src/index.ts`: static `web/dist` + `/media`, multer memory storage on `/api`, `express.json({ limit: '5mb' })`.

## Data & config (gitignored, auto-created)
- `config.json`: connections (kind llm|stt|tts, provider, baseUrl, apiKey, modelOrVoice, providerOptions) + defaults. `data/`: characters, lorebooks, scenarios, chats, media, voices.json cache.
- Paths/port are env-overridable: `ZD_RPS_ROOT`, `ZD_RPS_CONFIG`, `ZD_RPS_DATA`, `PORT` (`server/src/paths.ts`, `index.ts`). Use this for isolated smoke tests: `ZD_RPS_DATA=/tmp/... PORT=<free> node dist/index.js`, hit the real config's connections (Ollama/STT/TTS are live LAN hosts), then kill it.
- `store.ts`: every entity loads through a normalizer (`normalizeChat` etc.). When adding fields to stored entities, add defaults there, or old files crash on load.

## Message pipeline quirks (high-value)
- `POST /api/chats/:id/messages` is **SSE**, not JSON. Events: `speaker`, `sentence`, `audio`, `done`, `error`; body `{ content, audioEnabled }`. Client side: `api.chats.messageStream` in `web/src/lib/api.ts`.
- All validation (chat exists, text non-empty, resolve LLM connection) must happen BEFORE SSE headers are set — after that you cannot return an error status; emit an `error` event instead (`asyncHandler` can't help after headers).
- Sentence splitting + speaker-prefix strip + ordered per-sentence TTS queue live in `server/src/routes/chats.ts`. Audio events must emit in index order (emitted via `flushAudio`/`nextEmit`, and the stream only closes after pending TTS resolves). Do not resean the `ttsResults` map after `flushAudio` deletes entries — keep `emittedClips`.
- `ChatRuntime.disableThinking` (default true) sends `think: false` to Ollama. Reasoning models (user's `gemma4:26b`) otherwise burn `num_predict` on the CoT `thinking` block and return empty content.
- No context-window management: `buildLlmMessages(ctx, historyTail)` is always called with `historyTail = 0` — the full history is sent every turn; `maxTokens` is the generation budget only.
- Voice cloning (TTS) is cached in-memory per (connection × character) in `voices.ts`; cloning is slow — the first sentence of a streamed reply triggers it. LLM inference + TTS against the user's services are slow; allow generous timeouts in smoke tests.
- Manual per-message speak: `POST /api/audio/tts` (`{ text, characterId?, connectionId? }`) → `{ audioPath }`, autoplays in browser; it is separate from the streamed chip playback (which uses a sequential `enqueueAudio` queue in `web/src/store.tsx`).

## Web conventions
- TopBar "Audio" toggle: global `audioEnabled` persisted in localStorage key `zd-audio-enabled` (default on). When off, streaming requests skip TTS but the 🔊 under a message still does whole-message TTS.
- Browser autoplay of streamed audio requires a prior user gesture (sending a message counts).
- RightColumn's "Instant replies (no thinking)" maps to `runtime.disableThinking`.