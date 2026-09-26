import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { api } from '../lib/api'
import { comboFromEvent, getSttHotkey, setSttHotkey } from '../lib/hotkey'
import type {
  Connection,
  ConnectionKind,
  ProviderInfo,
  TestResult,
} from '../lib/types'

const KIND_LABEL: Record<ConnectionKind, string> = {
  llm: 'LLM',
  stt: 'Speech-to-Text',
  tts: 'Text-to-Speech',
}
const KIND_ORDER: ConnectionKind[] = ['llm', 'stt', 'tts']

const DEFAULT_TEST_TEXT = 'This is a test. Counting, one, two, three. Beware the Jabberwock, my son!'

const PROVIDER_DEFAULTS: Record<string, { name: string; baseUrl: string; kind: ConnectionKind }> = {
  'openai-compatible': { name: 'OpenAI', baseUrl: 'https://api.openai.com', kind: 'llm' },
  ollama: { name: 'Ollama', baseUrl: 'http://localhost:11434', kind: 'llm' },
  'openai-whisper': { name: 'OpenAI Whisper', baseUrl: 'https://api.openai.com', kind: 'stt' },
  whispercpp: { name: 'whisper.cpp', baseUrl: 'http://localhost:8080', kind: 'stt' },
  elevenlabs: { name: 'ElevenLabs', baseUrl: 'https://api.elevenlabs.io', kind: 'tts' },
  cartesia: { name: 'Cartesia Sonic', baseUrl: 'https://api.cartesia.ai', kind: 'tts' },
  omnivoice: { name: 'OmniVoice', baseUrl: 'http://localhost:8880', kind: 'tts' },
  dots: { name: 'dots.tts', baseUrl: 'http://localhost:8000', kind: 'tts' },
}

function emptyConnection(): Connection {
  return {
    id: '',
    name: '',
    kind: 'llm',
    provider: 'openai-compatible',
    baseUrl: '',
    apiKey: '',
    modelOrVoice: '',
    providerOptions: {},
    contextTokens: null,
  }
}

export function ConfigEditor() {
  const { providers, connections, closeOverlay, refreshAll, setError, defaults, setConnectionDefault } = useApp()
  const [draft, setDraft] = useState<Connection | null>(null)
  const [saving, setSaving] = useState(false)
  const [sttHotkey, setSttHotkeyState] = useState<string>(() => getSttHotkey())
  const [promptOverride, setPromptOverride] = useState<string | null>(null)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [ttsTestText, setTtsTestText] = useState('')


  useEffect(() => {
    api.connections.getSystemPrompt().then((r) => {
      setPromptOverride(r.override ?? '')
    }).catch(() => setPromptOverride(''))
    api.connections.getTestText().then((r) => {
      setTtsTestText(r.testText ?? DEFAULT_TEST_TEXT)
    }).catch(() => {})
  }, [])

  const saveSystemPrompt = async (override?: string | null) => {
    if (override === undefined && !promptOverride?.trim()) {
      await api.connections.saveSystemPrompt(null)
      return
    }
    const value = override === undefined ? promptOverride : override
    setSavingPrompt(true)
    try {
      await api.connections.saveSystemPrompt(value && value.trim() ? value : null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSavingPrompt(false)
    }
  }
  const [test, setTest] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)

  const beginCreate = (kind: ConnectionKind) => {
    const providerCandidates = providers.filter((p) => p.kind === kind)
    const provider = providerCandidates[0]?.id ?? 'openai-compatible'
    const d = { ...emptyConnection(), kind }
    const preset = PROVIDER_DEFAULTS[provider]
    if (preset) {
      d.name = preset.name
      d.baseUrl = preset.baseUrl
      d.provider = provider as Connection['provider']
    }
    setDraft(d)
    setTest(null)
  }

  const beginEdit = (conn: Connection) => {
    setDraft({ ...conn, providerOptions: { ...conn.providerOptions }, contextTokens: conn.contextTokens ?? null })
    setTest(null)
  }

  const providerInfo = draft ? providers.find((p) => p.id === draft.provider) : undefined
  const optionDefs = providerInfo?.capabilities.options ?? []

  const save = async (): Promise<Connection | null> => {
    if (!draft || !draft.name.trim()) {
      setError('Connection name is required')
      return null
    }
    setSaving(true)
    let saved: Connection
    try {
      saved =
        draft.id
          ? await api.connections.update(draft.id, draft)
          : await api.connections.create(draft)
      setDraft({ ...saved, providerOptions: { ...saved.providerOptions } })
      await refreshAll()
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally {
      setSaving(false)
    }
    return saved
  }

  const runTest = async () => {
    if (!draft?.id) return
    setTesting(true)
    setError(null)
    try {
      // Save first so the test uses the values currently in the editor,
      // not the previously stored configuration.
      const saved = await save()
      if (!saved) return
      setTest(await api.connections.test(saved.id))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setTesting(false)
    }
  }

  const setDefault = async (kind: ConnectionKind, id: string | null) => {
    await setConnectionDefault(kind, id)
  }

  return (
    <div className="overlay-wrap">
      <div className="overlay-head">
        <h2>Configuration</h2>
        <button onClick={closeOverlay}>✕ Close</button>
      </div>
      <div className="overlay-body">
        <div className="list-grid">
          {KIND_ORDER.map((kind) => (
            <div key={kind}>
              <h4 style={{ margin: '0 0 8px' }}>{KIND_LABEL[kind]}</h4>
              <div className="pick-list">
                {connections
                  .filter((c) => c.kind === kind)
                  .map((conn) => (
                    <div key={conn.id} className="pick-item" onClick={() => beginEdit(conn)}>
                      <span className="grow">{conn.name}</span>
                      <span className="tag">{conn.provider}</span>
                    </div>
                  ))}
                <div className="pick-item" style={{ borderStyle: 'dashed' }} onClick={() => beginCreate(kind)}>
                  <span className="grow">＋ Add {KIND_LABEL[kind]} connection</span>
                </div>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <span className="hint" style={{ padding: 0 }}>
                  Default:
                </span>
                <select
                  className="grow"
                  value={kind === 'llm' ? (defaults.defaultLlm ?? '') : kind === 'stt' ? (defaults.defaultStt ?? '') : (defaults.defaultTts ?? '')}
                  onChange={(e) => void setDefault(kind, e.target.value || null)}
                >
                  <option value="">None</option>
                  {connections
                    .filter((c) => c.kind === kind)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          ))}
        </div>

        <h3 style={{ marginTop: 28 }}>Hotkeys</h3>
        <div className="field" style={{ maxWidth: 320 }}>
          <label>Microphone / STT key</label>
          <div className="row">
            <input
              className="grow"
              readOnly
              value={sttHotkey !== '__capturing__' ? sttHotkey : ''}
              placeholder={sttHotkey === '__capturing__' ? 'Press key combination…' : sttHotkey}
              onKeyDown={(e) => {
                if (sttHotkey !== '__capturing__') return
                e.preventDefault()
                const combo = comboFromEvent(e)
                if (combo) {
                  setSttHotkey(combo)
                  setSttHotkeyState(combo)
                }
              }}
            />
            <button
              onClick={() => setSttHotkeyState(sttHotkey === '__capturing__' ? getSttHotkey() : '__capturing__')}
            >
              {sttHotkey === '__capturing__' ? 'Cancel' : 'Change'}
            </button>
          </div>
          <span className="hint" style={{ padding: 0 }}>
            Default: Ctrl+M. Toggle push-to-talk anywhere; press again to stop and transcribe.
          </span>
        </div>

        <h3 style={{ marginTop: 28 }}>TTS voice test</h3>
        <div className="field" style={{ maxWidth: 560 }}>
          <label>Test text (used by the Test button in the Character editor)</label>
          <textarea
            rows={2}
            value={ttsTestText}
            onChange={(e) => setTtsTestText(e.target.value)}
          />
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="primary"
              onClick={() =>
                void api.connections.saveTestText(ttsTestText.trim() ? ttsTestText : null)
                  .then(() => setError(null))
              }
            >
              Save test text
            </button>
            <button onClick={() => { setTtsTestText(DEFAULT_TEST_TEXT); void api.connections.saveTestText(null) }}>
              Restore default
            </button>
          </div>
          <span className="hint" style={{ padding: 0 }}>
            Leave empty to use the default: {DEFAULT_TEST_TEXT}
          </span>
        </div>

        <h3 style={{ marginTop: 28 }}>System prompt</h3>
        <div className="field full" style={{ maxWidth: 720 }}>
          <label>Framing (replaces the built-in instructions)</label>
          <textarea
            rows={10}
            value={promptOverride ?? ''}
            placeholder={
              'Empty = built-in. Available placeholders:\n{{user}} (the persona\u2019s name; falls back to "User")\n{{characters}} (comma-separated list of speaking characters)'
            }
            onChange={(e) => setPromptOverride(e.target.value)}
          />
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="primary"
              disabled={savingPrompt}
              onClick={() => void saveSystemPrompt()}
            >
              {savingPrompt ? 'Saving…' : 'Save system prompt'}
            </button>
            <button onClick={() => { setPromptOverride(''); void saveSystemPrompt('') }}>
              Restore built-in
            </button>
          </div>
          <span className="hint" style={{ padding: 0 }}>
            Leave empty to use the built-in prompt. The character sheets, world
            knowledge and the formatting/narration rules are always appended;
            this text replaces the behavioral framing only.
          </span>
        </div>

        <h3 style={{ marginTop: 28 }}>Connection editor</h3>
        {!draft && <div className="hint">Select a connection above to edit it.</div>}
        {draft && (
          <div className="form-grid">
            <div className="field">
              <label>Kind</label>
              <select
                value={draft.kind}
                onChange={(e) => {
                  const kind = e.target.value as ConnectionKind
                  beginCreate(kind)
                }}
              >
                {KIND_ORDER.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Provider</label>
              <select
                value={draft.provider}
                onChange={(e) => {
                  const provider = e.target.value as Connection['provider']
                  const preset = PROVIDER_DEFAULTS[provider]
                  const action = isTtsProvider(provider) ? 'tts' : draft.kind
                  setDraft({
                    ...draft,
                    provider,
                    kind: action,
                    baseUrl: preset?.baseUrl ?? draft.baseUrl,
                    name: preset?.name ?? draft.name,
                    providerOptions: {},
                    modelOrVoice: '',
                  })
                }}
              >
                {providers
                  .filter((p) => p.kind === draft.kind)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
              </select>
            </div>
            <div className="field">
              <label>Name</label>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="My server"
              />
            </div>
            <div className="field">
              <label>Base URL</label>
              <input
                value={draft.baseUrl}
                onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                placeholder={PROVIDER_DEFAULTS[draft.provider]?.baseUrl}
              />
            </div>
            <div className="field">
              <label>API key (secret)</label>
              <input
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                placeholder="Leave empty if not required"
              />
            </div>
            <div className="field">
              <label>Model or voice</label>
              <div className="row">
                <input
                  className="grow"
                  value={draft.modelOrVoice}
                  onChange={(e) => setDraft({ ...draft, modelOrVoice: e.target.value })}
                  placeholder={placeholderFor(draft.provider)}
                />
              </div>
              {test?.ok && (
                <select
                  style={{ marginTop: 6, width: '100%' }}
                  value={draft.modelOrVoice}
                  onChange={(e) => setDraft({ ...draft, modelOrVoice: e.target.value })}
                >
                  {(test.models.length > 0 ? test.models : test.voices).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name ?? m.id}
                    </option>
                  ))}
                </select>
              )}
              {test?.ok && test.models.length === 0 && test.voices.length === 0 && (
                <span className="hint">This provider exposes no model/voice list.</span>
              )}
            </div>

            {draft.kind === 'llm' && (
              <div className="field">
                <label>Context window (tokens)</label>
                <input
                  inputMode="numeric"
                  value={draft.contextTokens ?? ''}
                  onChange={(e) => {
                    const v = Number(e.target.value.replace(/[^0-9]/g, ''))
                    setDraft({ ...draft, contextTokens: e.target.value === '' ? null : Math.max(0, Math.floor(v)) })
                  }}
                  placeholder="Leave empty for no trimming"
                />
                <span className="hint">
                  When set, older transcript messages are dropped to fit this budget (e.g. 32768, 131072, 262144).
                </span>
              </div>
            )}

            {optionDefs.map((opt) => (
              <div key={opt.key} className={`field${optionDefs.length % 2 === 1 ? ' full' : ''}`}>
                <label>{opt.label}</label>
                {dynamicField(draft, setDraft, opt)}
                {opt.help && <span className="hint">{opt.help}</span>}
              </div>
            ))}

            {providerInfo?.capabilities.notes.map((note) => (
              <div key={note} className="hint full">
                • {note}
              </div>
            ))}

            <div className="row full">
              {draft.id ? (
                <>
                  <button className="primary" disabled={saving} onClick={() => void save()}>
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                  <button disabled={testing} onClick={() => void runTest()}>
                    {testing ? 'Testing…' : 'Test & Fetch List'}
                  </button>
                  <button className="danger" onClick={() => void api.connections.remove(draft.id).then(() => { setDraft(null); return refreshAll() })}>
                    Delete
                  </button>
                </>
              ) : (
                <button className="primary" disabled={saving} onClick={() => void save()}>
                  {saving ? 'Saving…' : 'Save connection'}
                </button>
              )}
              {draft.id && test?.ok && (
                <span className="hint" style={{ color: 'var(--ok)' }}>
                  ✓ Connection OK
                  {test.models.length > 0 && ` · ${test.models.length} models`}
                  {test.voices.length > 0 && ` · ${test.voices.length} voices`}
                </span>
              )}
              {test && !test.ok && <span className="error">{test.error ?? 'Connection failed'}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function isTtsProvider(provider: Connection['provider']): provider is 'elevenlabs' | 'cartesia' | 'omnivoice' | 'dots' {
  return ['elevenlabs', 'cartesia', 'omnivoice', 'dots'].includes(provider)
}

function placeholderFor(provider: string): string {
  if (provider === 'dots') return 'dots-studio/dots.tts-mf'
  if (provider === 'elevenlabs') return 'e.g. a voice id from the list'
  if (provider === 'whispercpp') return 'Model is set server-side'
  if (provider === 'openai-compatible') return 'gpt-4o-mini (populated by Test & Fetch)'
  return 'Select from the fetched list'
}

function dynamicField(
  draft: Connection,
  setDraft: (c: Connection) => void,
  opt: NonNullable<ProviderInfo['capabilities']['options']>[number],
) {
  const value = draft.providerOptions[opt.key] as string | number | boolean | undefined
  const set = (v: string | number | boolean) =>
    setDraft({ ...draft, providerOptions: { ...draft.providerOptions, [opt.key]: v } })
  if (opt.type === 'boolean') {
    return (
      <select value={value ? '1' : '0'} onChange={(e) => set(e.target.value === '1')}>
        <option value="0">Off</option>
        <option value="1">On</option>
      </select>
    )
  }
  if (opt.type === 'select') {
    return (
      <select
        value={String(value ?? '')}
        onChange={(e) => set(e.target.value)}
      >
        {opt.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }
  if (opt.type === 'number') {
    return (
      <input
        type="number"
        min={opt.min}
        max={opt.max}
        step={opt.step}
        value={typeof value === 'number' ? value : Number(value ?? 0)}
        onChange={(e) => set(Number(e.target.value))}
      />
    )
  }
  return <input type="text" placeholder={opt.placeholder ?? opt.label} value={String(value ?? '')} onChange={(e) => set(e.target.value)} />
}