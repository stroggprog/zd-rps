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
- Server unit tests: `npm run test -w server` (Vitest; `server/test/*.test.ts`, run with `vitest run`). No coverage/CI. Test targets are the deterministic modules (`SentenceStream` in `server/src/streaming.ts`, `OrderedAudio` in `server/src/orderedAudio.ts`, `normalizeChat` in `server/src/store.ts`, `buildLlmMessages`/`attributeReply` in `server/src/pipeline.ts`). Verification = typecheck + build + lint + tests + curl/SSE smoke tests.

## Layout
- npm workspaces `server/` (Express, ESM — imports end in `.js`) and `web/` (React+Vite, extensionless imports). No shared package: `web/src/lib/types.ts` mirrors `server/src/types.ts` by hand — keep them in sync.
- `PLAN.md` is gone. `README.md` is the canonical overview; trust the code (and this file) over any design notes.
- Server entry `server/src/index.ts`: static `web/dist` + `/media`, multer memory storage on `/api`, `express.json({ limit: '5mb' })`.

## Data & config (gitignored, auto-created)
- `config.json`: connections (kind llm|stt|tts, provider, baseUrl, apiKey, modelOrVoice, providerOptions) + defaults. `data/`: characters, lorebooks, scenarios, chats, media, voices.json cache.
- Paths/port are env-overridable: `ZD_RPS_ROOT`, `ZD_RPS_CONFIG`, `ZD_RPS_DATA`, `PORT` (`server/src/paths.ts`, `index.ts`). Use this for isolated smoke tests: `ZD_RPS_DATA=/tmp/... PORT=<free> node dist/index.js`, hit the real config's connections (Ollama/STT/TTS are live LAN hosts), then kill it.
- `store.ts`: every entity loads through a normalizer (`normalizeChat` etc.). When adding fields to stored entities, add defaults there, or old files crash on load.

## Message pipeline quirks (high-value)
- `POST /api/chats/:id/messages` is **SSE**, not JSON. Events: `speaker`, `sentence`, `audio`, `done`, `error`; body `{ content, audioEnabled }`. Each `sentence` event carries `{ index, text, isLast, isSpeech }` (isSpeech = dialogue vs narration, from `QuotationTracker`); the web client (web/src/store.tsx `send`) uses transition on `isSpeech` to insert `\n\n` between speech/narration blocks in the live bubble text. Client side: `api.chats.messageStream` in `web/src/lib/api.ts`.
- All validation (chat exists, text non-empty, resolve LLM connection) must happen BEFORE SSE headers are set — after that you cannot return an error status; emit an `error` event instead (`asyncHandler` can't help after headers).
- Sentence splitting + speaker-prefix strip + ordered per-sentence TTS queue. Logic lives in `server/src/streaming.ts` (`SentenceStream`) and `server/src/orderedAudio.ts` (`OrderedAudio`, unit-tested); `server/src/routes/chats.ts` wires them to SSE/TTS. Audio events must emit in index order (the queue only advances past a slot when its `finish` arrives, and `waitIdle` gates stream close). `SentenceStream.onSentence` emits trimmed, prefix-stripped text and guarantees exactly the final sentence has `isLast: true`.
- Per-sentence voice: LLM formatting contract (`pipeline.ts`): speech in double quotes in its own paragraph (blank line separates speech/narration both ways; no line breaks inside speech), single quotes only for quotations, emphasis `_..._`, bold `**...**`, bullets `* item`. `QuotationTracker` (`server/src/speech.ts`, unit-tested): a sentence that *begins* with a double quote opens a speech block that spans line breaks until its matching closing quote (quotes inside the block are treated as emphasis and ignored); a mid-sentence genuine double quote outside a block is an inline dialogue marker; single quotes are inert. Speech sentences TTS with the speaking character's voice; narration uses the chat's narrator voice (`Chat.narratorId`, kind `narrator`), falling back to the character voice when no narrator is set.
- `SpeechFormatter` (`server/src/formatting.ts`, unit-tested) sits between LLM deltas and `SentenceStream`: regardless of model compliance it collapses EOLs inside double-quoted speech to spaces, ensures a blank line between narration and speech blocks (paragraph-level speech only, not inline quotes), and preserves narration line structure. Stored `content` comes from `attributeReply(formatter.finish(), activeNames)` so paragraph breaks survive into the transcript (`.bubble` uses `white-space: pre-wrap`).
- `SentenceStream` splits at `.?!…` followed by whitespace/EOF, one or more trailing close chars (`"'”’»*_)]}`), or a period directly followed by an uppercase letter (handles dropped spaces like `instantly.The`).
- `ChatRuntime.disableThinking` (default true) sends `think: false` to Ollama. Reasoning models (user's `gemma4:26b`) otherwise burn `num_predict` on the CoT `thinking` block and return empty content.
- No context-window management: `buildLlmMessages(ctx, historyTail)` is always called with `historyTail = 0` — the full history is sent every turn; `maxTokens` is the generation budget only.
- Voice cloning (TTS) is cached in-memory per (connection × character) in `voices.ts`; cloning is slow — the first sentence of a streamed reply triggers it. LLM inference + TTS against the user's services are slow; allow generous timeouts in smoke tests.
- Manual per-message speak: `POST /api/audio/tts` (`{ text, characterId?, connectionId? }`) → `{ audioPath }`, autoplays in browser; it is separate from the streamed chip playback (which uses a sequential `enqueueAudio` queue in `web/src/store.tsx`).

## Web conventions
- TopBar "Audio" toggle: global `audioEnabled` persisted in localStorage key `zd-audio-enabled` (default on). When off, streaming requests skip TTS but the 🔊 under a message still does whole-message TTS.
- Browser autoplay of streamed audio requires a prior user gesture (sending a message counts).
- RightColumn's "Instant replies (no thinking)" maps to `runtime.disableThinking`.