# AGENTS.md

## Working rules
- Keep responses concise unless the user asks otherwise.
- Always keep `AGENTS.md` and `README.md` up to date as the app evolves; update, then commit+push right after a feature lands.
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
- Server entry `server/src/index.ts`: static `web/dist` + `/media`, multer memory storage on `/api`, `express.json({ limit: '5mb' })`. Entity media (`/media/characters|narrators|personas`) is served with `Cache-Control: no-cache` — avatars/voice samples are replaced in place at the same URL.

## Data & config (gitignored, auto-created)
- `config.json`: connections (kind llm|stt|tts, provider, baseUrl, apiKey, modelOrVoice, providerOptions) + defaults. `data/`: characters, narrators, personas, lorebooks, scenarios, chats, media, voices.json cache. A default persona named "You" (gender male) is auto-seeded on first load and cannot be deleted.
- Paths/port are env-overridable: `ZD_RPS_ROOT`, `ZD_RPS_CONFIG`, `ZD_RPS_DATA`, `PORT` (`server/src/paths.ts`, `index.ts`). Use this for isolated smoke tests: `ZD_RPS_DATA=/tmp/... PORT=<free> node dist/index.js`, hit the real config's connections (Ollama/STT/TTS are live LAN hosts), then kill it.
- `store.ts`: every entity loads through a normalizer (`normalizeChat` etc.). When adding fields to stored entities, add defaults there, or old files crash on load.

## Message pipeline quirks (high-value)
- `POST /api/chats/:id/messages` is **SSE**, not JSON. Events: `speaker`, `sentence`, `audio`, `done`, `error`; body `{ content, audioEnabled }`. Multi-character replies can contain multiple blocks: every `speaker`/`sentence`/`audio` event carries a `messageId` (a block id) and the web client starts a new bubble per `speaker` event (`web/src/store.tsx send`); late TTS clips attach to their block via `messageId`. Each `sentence` event carries `{ index, text, isLast, isSpeech }` (isSpeech = dialogue vs narration, from `QuotationTracker`); the client uses the transition on `isSpeech` to insert `\n\n` between speech/narration. Client side: `api.chats.messageStream` in `web/src/lib/api.ts`.
- All validation (chat exists, text non-empty, resolve LLM connection) must happen BEFORE SSE headers are set — after that you cannot return an error status; emit an `error` event instead (`asyncHandler` can't help after headers).
- Sentence splitting + speaker-prefix strip + ordered per-sentence TTS queue. Logic lives in `server/src/streaming.ts` (`SentenceStream`) and `server/src/orderedAudio.ts` (`OrderedAudio`, unit-tested); `server/src/routes/chats.ts` wires them to SSE/TTS. Audio events must emit in index order (the queue only advances past a slot when its `finish` arrives, and `waitIdle` gates stream close). `SentenceStream.onSentence` emits trimmed, prefix-stripped text and guarantees exactly the final sentence has `isLast: true`. A `Name:` prefix mid-reply that names another active participant splits the reply into per-speaker blocks (new `speaker` event, fresh bubble); the prefix is stripped from speech/TTS but stays out of the transcript for that block.
- Per-sentence voice: LLM formatting contract (`pipeline.ts`): speech in double quotes in its own paragraph (blank line separates speech/narration both ways; no line breaks inside speech), single quotes only for quotations, emphasis `_..._`, bold `**...**`, bullets `* item`. `QuotationTracker` (`server/src/speech.ts`, unit-tested): a sentence that *begins* with a double quote opens a speech block that spans line breaks until its matching closing quote (quotes inside the block are treated as emphasis and ignored); a mid-sentence genuine double quote outside a block is an inline dialogue marker; single quotes are inert. Speech sentences TTS with the speaking character's voice; narration uses the chat's narrator voice (`Chat.narratorId`), falling back to the character voice when no narrator is set.
- Personas: `Persona` (name, optional avatar/description, gender male|female|other) is its own entity; chats get `personaId` at creation only (the PATCH route ignores it). The persona name replaces `{{user}}`/`User` in prompts and user-message bubbles; `buildLlmMessages` injects a `[The user: X]` block (skipped for the bare default "You"). Character `system_prompt`s are framed as "Private instruction for X only" to stop them leaking into other participants' style/narration.
- Chats with a scenario get its `first_mes` seeded as an assistant message on creation (speaker = first participant, `{{char}}`/`{{user}}` substituted), spoken server-side in the background sentence-by-sentence (character/narrator voices) with clips published incrementally; the client polls and autoplays them through the sequential queue.
- `SpeechFormatter` (`server/src/formatting.ts`, unit-tested) sits between LLM deltas and `SentenceStream`: regardless of model compliance it collapses EOLs inside double-quoted speech to spaces, ensures a blank line between narration and speech blocks (paragraph-level speech only, not inline quotes), and preserves narration line structure. Per-speaker block `content` is re-assembled from sentences with speech-transition separators so paragraph breaks survive into the transcript (`.bubble` uses `white-space: pre-wrap`).
- `SentenceStream` splits at `.?!…` followed by whitespace/EOF, one or more trailing close chars (`"'”’»*_)]}`), or a period directly followed by an uppercase letter (handles dropped spaces like `instantly.The`).
- `ChatRuntime.disableThinking` (default true) sends `think: false` to Ollama. Reasoning models (user's `gemma4:26b`) otherwise burn `num_predict` on the CoT `thinking` block and return empty content.
- Context-window management: `Connection.contextTokens` (optional, LLM connections only, edited in Configuration) drives `historyTailFor()` (pipeline.ts): estimated tokens (~3.2 chars/token) over `contextTokens − maxTokens`, min 2 trailing messages; `buildLlmMessages(ctx, historyTail)` then slices history and appends a trimming note to the system prompt. Unset/null = full history every turn.
- Voice cloning (TTS) is cached in-memory per (connection × voice subject) in `voices.ts` and invalidated when a voice sample is re-uploaded/deleted; cloning is slow — the first sentence of a streamed reply triggers it. LLM inference + TTS against the user's services are slow; allow generous timeouts in smoke tests.
- Ad-hoc scenarios: a chat can carry an inline scenario (`Chat.scenarioInline`) instead of referencing `data/scenarios/`; `scenarioFor(ctx, chat)` returns a synthetic `Scenario` (id `inline`) so prompt building/display treat both the same.
- Manual per-message speak: `POST /api/audio/tts` (`{ text, characterId?, connectionId? }`) → `{ audioPath }`, autoplays in browser; it is separate from the streamed chip playback (which uses a sequential `enqueueAudio` queue in `web/src/store.tsx`).

## Web conventions
- TopBar "Audio" toggle: global `audioEnabled` persisted in localStorage key `zd-audio-enabled` (default on). When off, streaming requests skip TTS but the 🔊 under a message still does whole-message TTS.
- Browser autoplay of streamed audio requires a prior user gesture (sending a message or creating a chat counts).
- RightColumn's "Instant replies (no thinking)" maps to `runtime.disableThinking`.
- STT hotkey: configurable (default Ctrl+M), stored in localStorage key `zd-hotkey-stt`; capture editor lives in the Configuration overlay (`web/src/lib/hotkey.ts`). It toggles push-to-talk like the 🎙 button.
- Chats in the left panel have a hover-reveal ✕ delete button; the hamburger menu also has Start New Chat / Close Current Chat (deselect; chat persists in the list) / Delete Current Chat. Personnel avatars clicked in chat open enlarged in the left-column image viewer (bottom of the column).
- The new-chat wizard is 5 steps (Characters → Persona → Narrator (optional) → Lorebooks → Scenario) with fixed top-left Back/Next; the scenario step supports writing an ad-hoc inline scenario.
- TopBar "Print" opens the `'print'` overlay (`web/src/components/PrintChat.tsx`): searchable chat list → new window with a static print-styled HTML transcript (HTML-escaped, `window.print()` on load). It bypasses the SPA and needs pop-up permission.