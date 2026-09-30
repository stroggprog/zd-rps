import { useEffect, useRef, useState } from 'react'
import { enqueueAudio, useApp } from '../store'
import { api, bustAvatar } from '../lib/api'
import type { Character, ImportDraft } from '../lib/types'

interface Draft {
  id: string | null
  name: string
  description: string
  personality: string
  system_prompt: string
  post_history_instructions: string
  mes_example: string
  tags: string
  creator_notes: string
  llmConnectionId: string | null
}

function emptyDraft(): Draft {
  return {
    id: null,
    name: '',
    description: '',
    personality: '',
    system_prompt: '',
    post_history_instructions: '',
    mes_example: '',
    tags: '',
    creator_notes: '',
    llmConnectionId: null,
  }
}

function toDraft(c: Character): Draft {
  return {
    ...c,
    id: c.id,
    tags: c.tags.join(', '),
    creator_notes: c.creator_notes ?? '',
    llmConnectionId: c.llmConnectionId ?? null,
  }
}

export function CharacterEditor() {
  const { characters, groups, connections: allConnections, defaults, lorebooks, scenarios, closeOverlay, refreshAll, setError } = useApp()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [imported, setImported] = useState<ImportDraft | null>(null)
  const [importName, setImportName] = useState('')
  const [exportLorebookId, setExportLorebookId] = useState('')
  const [exportScenarioId, setExportScenarioId] = useState('')
  const [acceptLorebook, setAcceptLorebook] = useState(true)
  const [acceptScenario, setAcceptScenario] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testPlaying, setTestPlaying] = useState(false)
  const [testText, setTestText] = useState('')

  useEffect(() => {
    api.connections.getTestText().then((r) => setTestText((r.testText ?? '').trim())).catch(() => {})
  }, [])
  const [importing, setImporting] = useState(false)
  const avatarInput = useRef<HTMLInputElement>(null)
  const voiceInput = useRef<HTMLInputElement>(null)
  const voiceText = useRef<HTMLInputElement>(null)
  const importInput = useRef<HTMLInputElement>(null)

  const pickImport = () => importInput.current?.click()

  const runImport = async (file: File) => {
    setImporting(true)
    setError(null)
    try {
      const draft = await api.characters.import(file)
      setImported(draft)
      setImportName(draft.character.name)
      setDraft(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const finalizeImport = async () => {
    if (!imported || !importName.trim()) return
    setSaving(true)
    setError(null)
    try {
      await api.characters.finalize({
        importId: imported.importId,
        name: importName.trim(),
        acceptLorebook,
        acceptScenario,
      })
      setImported(null)
      await refreshAll()
      setDraft(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const save = async (): Promise<Character | null> => {
    if (!draft || !draft.name.trim()) {
      setError('Character name is required')
      return null
    }
    setSaving(true)
    setError(null)
    try {
      const payload: Partial<Character> = {
        name: draft.name,
        description: draft.description,
        personality: draft.personality,
        system_prompt: draft.system_prompt,
        post_history_instructions: draft.post_history_instructions,
        mes_example: draft.mes_example,
        tags: draft.tags.split(',').map((t) => t.trim()).filter(Boolean),
      }
      const saved = draft.id
        ? await api.characters.update(draft.id, payload)
        : await api.characters.create(payload)
      setDraft(toDraft(saved))
      await refreshAll()
      return saved
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete character "${name}"?`)) return
    await api.characters.remove(id)
    if (draft?.id === id) setDraft(null)
    await refreshAll()
  }

  /** Returns the saved character for the open draft, creating it first if needed (media can attach before first save). */
  const ensureSaved = async (): Promise<Character | null> => {
    if (draft?.id) return characters.find((c) => c.id === draft.id) ?? null
    return save()
  }

  const uploadAvatar = async (file: File) => {
    setError(null)
    try {
      const target = await ensureSaved()
      if (!target) return
      const saved = await api.characters.uploadAvatar(target.id, file)
      setDraft(toDraft(saved))
      await refreshAll()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const uploadVoice = async () => {
    const file = voiceInput.current?.files?.[0]
    if (!file) return
    const transcript = voiceText.current?.value ?? ''
    setError(null)
    try {
      const target = await ensureSaved()
      if (!target) return
      const saved = await api.characters.uploadVoice(target.id, file, transcript)
      setDraft(toDraft(saved))
      await refreshAll()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const activeCharacter = draft?.id ? characters.find((c) => c.id === draft.id) ?? null : null
  const showMedia = !!activeCharacter

  return (
    <div className="overlay-wrap">
      <div className="overlay-head">
        <h2>Characters</h2>
        <button onClick={closeOverlay}>✕ Close</button>
      </div>
      <div className="overlay-body">
        <div className="list-grid">
          <div>
            <div className="row" style={{ marginBottom: 8 }}>
              <button className="primary" onClick={() => { setDraft(emptyDraft()); setImported(null) }}>
                ＋ New character
              </button>
              <button onClick={pickImport} disabled={importing}>
                {importing ? 'Importing…' : 'Import card (PNG/JSON)'}
              </button>
              <input
                ref={importInput}
                type="file"
                accept=".png,.json,image/png,application/json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void runImport(f)
                  e.target.value = ''
                }}
              />
            </div>
            <div className="pick-list">
              {characters.map((c) => (
                <div
                  key={c.id}
                  className={`pick-item${draft?.id === c.id ? ' selected' : ''}`}
                  onClick={() => { setDraft(toDraft(c)); setImported(null) }}
                >
                  {c.avatarPath ? <img src={bustAvatar(c.avatarPath, c.updated) ?? ''} alt="" /> : <div className="avatar" />}
                  <span className="grow">{c.name}</span>
                  {c.tags.slice(0, 3).map((t) => (
                    <span key={t} className="tag">{t}</span>
                  ))}
                  {c.voiceSamplePath && <span className="tag">🎤</span>}
                </div>
              ))}
              {characters.length === 0 && <div className="hint">No characters yet.</div>}
            </div>
          </div>

          <div>
            {draft && (
              <div className="form-grid">
                  <div className="field">
                    <label>Name</label>
                    <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Tags (comma-separated)</label>
                    <input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
                  </div>

                  <div className="field full">
                    <label>Groups (a character can belong to several)</label>
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                      {groups.map((g) => {
                        const selected = g.memberIds.includes(draft.id as string)
                        const toggle = async () => {
                          if (!draft.id) return
                          const nextMembers = selected
                            ? g.memberIds.filter((m) => m !== draft.id)
                            : [...g.memberIds, draft.id]
                          await api.groups.update(g.id, { memberIds: nextMembers })
                          await refreshAll()
                        }
                        return (
                          <button
                            key={g.id}
                            className={selected ? 'toggle on' : 'toggle'}
                            style={selected ? { fontWeight: 700 } : undefined}
                            onClick={() => void toggle()}
                          >
                            {g.name}{selected ? ' ✓' : ''}
                          </button>
                        )
                      })}
                      {groups.length === 0 && (
                        <span className="hint" style={{ padding: 0 }}>
                          No groups yet — create them under the Groups menu.
                        </span>
                      )}
                    </div>
                    <span className="hint" style={{ padding: 0, width: '100%' }} title="Click a group tag above to add or remove this character; the list updates immediately.">
                      {draft.id && groups.length > 0
                        ? `Member of: ${groups.filter((g) => g.memberIds.includes(draft.id as string)).map((g) => g.name).join(', ') || 'no groups'}`
                        : 'Save the character first to assign groups.'}
                    </span>
                  </div>
                  <div className="field">
                    <label>Own LLM connection (sequential turns)</label>
                    <select
                      value={draft.llmConnectionId ?? ''}
                      onChange={(e) => setDraft({ ...draft, llmConnectionId: e.target.value || null })}
                    >
                      <option value="">Chat default</option>
                      {allConnections.filter((cn) => cn.kind === 'llm').map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <span className="hint" style={{ padding: 0 }}>
                      When Sequential turns is on, this character replies through their own connection.
                    </span>
                  </div>
                  <div className="field full">
                    <label>Description</label>
                    <textarea rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                  </div>
                  <div className="field full">
                    <label>Creator notes (written to the exported card)</label>
                    <textarea
                      rows={3}
                      value={draft.creator_notes}
                      placeholder="Saved as-is; exported cards default to 'Exported from zd-rps' when left empty"
                      onChange={(e) => setDraft({ ...draft, creator_notes: e.target.value })}
                    />
                  </div>
                  <div className="field full">
                    <label>Personality</label>
                    <textarea rows={3} value={draft.personality} onChange={(e) => setDraft({ ...draft, personality: e.target.value })} />
                  </div>
                  <div className="field full">
                    <label>System prompt</label>
                    <textarea rows={5} value={draft.system_prompt} onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })} />
                  </div>
                  <div className="field full">
                    <label>Post-history instructions (system note)</label>
                    <textarea rows={3} value={draft.post_history_instructions} onChange={(e) => setDraft({ ...draft, post_history_instructions: e.target.value })} />
                  </div>
                  <div className="field full">
                    <label>Example dialogue (mes_example)</label>
                    <textarea rows={5} value={draft.mes_example} onChange={(e) => setDraft({ ...draft, mes_example: e.target.value })} />
                  </div>

                {showMedia && (
                  <>
                    <div className="field">
                      <label>Avatar</label>
                      {activeCharacter?.avatarPath && <img src={bustAvatar(activeCharacter.avatarPath, activeCharacter.updated) ?? ''} className="avatar-big" alt="" />}
                      <div className="row">
                        <button onClick={() => avatarInput.current?.click()}>Upload</button>
                        <input
                          ref={avatarInput}
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const f = e.target.files?.[0]
                            if (f) void uploadAvatar(f)
                            e.target.value = ''
                          }}
                        />
                      </div>
                    </div>
                    <div className="field">
                      <label>Voice sample (WAV)</label>
                      {activeCharacter?.voiceSamplePath && (
                        <audio src={`${activeCharacter.voiceSamplePath}?v=${activeCharacter.updated}`} controls style={{ width: '100%' }} />
                      )}
                      <div className="row">
                        <input ref={voiceInput} type="file" accept="audio/wav,.wav,audio/*" />
                      </div>
                      <input
                        ref={voiceText}
                        defaultValue={activeCharacter?.voiceSampleTranscript ?? ''}
                        placeholder="Transcript of the sample (recommended)"
                        style={{ marginTop: 6 }}
                      />
                      <div className="row" style={{ marginTop: 6 }}>
                        <button onClick={() => void uploadVoice()}>Save sample</button>
                        {activeCharacter?.voiceSamplePath && (
                          <button
                            disabled={testPlaying}
                            title="Play the uploaded sample through the default TTS voice"
                            onClick={() =>
                              void (async () => {
                                setTestPlaying(true)
                                try {
                                  const { audioPath } = await api.audio.ttsText(
                                    testText || 'This is a test. Counting, one, two, three. Beware the Jabberwock, my son!',
                                    activeCharacter.id,
                                  )
                                  enqueueAudio(audioPath)
                                } catch (e) {
                                  setError((e as Error).message)
                                } finally {
                                  setTestPlaying(false)
                                }
                              })()
                            }
                          >
                            {testPlaying ? 'Playing…' : 'Test'}
                          </button>
                        )}
                        {activeCharacter?.voiceSamplePath && (
                          <span className="hint" style={{ padding: 0, width: '100%' }}>
                            Uses TTS connection:{' '}
                            {(allConnections.find((c) => c.id === (defaults.defaultTts ?? ''))?.name) ?? '(none configured)'}
                            {(() => {
                              const conn = allConnections.find((c) => c.id === (defaults.defaultTts ?? ''))
                              const steps = (conn?.providerOptions as Record<string, unknown>)?.num_step
                              return steps ? ` (inference steps: ${steps})` : ' (inference steps: provider default)'
                            })()}
                          </span>
                        )}
                        {activeCharacter?.voiceSamplePath && (
                          <button className="danger" onClick={() => void api.characters.removeVoice(activeCharacter.id).then(async (s) => { setDraft(toDraft(s)); await refreshAll() })}>
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}

                <div className="row full">
                  <button className="primary" disabled={saving} onClick={() => void save()}>
                    {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create character'}
                  </button>
                  {draft.id && (
                    <>
                      <details style={{ display: 'inline-block' }}>
                        <summary className="button-link" style={{ cursor: 'pointer' }}>
                          Export card (options)
                        </summary>
                        <div className="field" style={{ marginTop: 6 }}>
                          <label>Embed lorebook (optional)</label>
                          <select
                            value={exportLorebookId}
                            onChange={(e) => setExportLorebookId(e.target.value)}
                          >
                            <option value="">None</option>
                            {lorebooks.map((book) => (
                              <option key={book.id} value={book.id}>
                                {book.name} ({book.entries.length} entries)
                              </option>
                            ))}
                          </select>
                          <label style={{ marginTop: 6 }}>Embed scenario (optional)</label>
                          <select
                            value={exportScenarioId}
                            onChange={(e) => setExportScenarioId(e.target.value)}
                          >
                            <option value="">None</option>
                            {scenarios.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                          <a
                            className="button-link"
                            style={{ marginTop: 6, display: 'inline-block' }}
                            href={`${api.characters.exportUrl(draft.id)}?lorebookId=${exportLorebookId}&scenarioId=${exportScenarioId}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Download card
                          </a>
                          <a
                            className="button-link"
                            href={`/api/characters/${draft.id}/export-zd?lorebookId=${exportLorebookId}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Export as zd-file
                          </a>
                        </div>
                      </details>
                      <button className="danger" onClick={() => void remove(draft.id as string, draft.name)}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {imported && (
              <div className="form-grid">
                <div className="field full">
                  <h4>Imported card ({imported.cardKind === 'png' ? 'PNG' : 'JSON'})</h4>
                  {imported.avatarDataUrl && <img src={imported.avatarDataUrl} className="avatar-big" alt="" />}
                  {!imported.avatarDataUrl && !imported.hasAvatar && (
                    <span className="hint">This card has no embedded avatar.</span>
                  )}
                </div>
                <div className="field full">
                  <label>Name</label>
                  <input value={importName} onChange={(e) => setImportName(e.target.value)} />
                </div>
                <div className="field full">
                  <label className="row">
                    <input type="checkbox" checked={acceptLorebook} onChange={(e) => setAcceptLorebook(e.target.checked)} disabled={!imported.lorebook} />
                    Import lorebook{imported.lorebook ? '' : ' (none found)'}
                  </label>
                  {imported.lorebook && (
                    <div className="desc">{imported.lorebook.name} — {imported.lorebook.entries.length} entries</div>
                  )}
                </div>
                <div className="field full">
                  <label className="row">
                    <input type="checkbox" checked={acceptScenario} onChange={(e) => setAcceptScenario(e.target.checked)} disabled={!imported.scenario} />
                    Import scenario{imported.scenario ? '' : ' (none found)'}
                  </label>
                  {imported.scenario && <div className="desc">{imported.scenario.name}</div>}
                </div>
                <div className="field full desc">
                  <strong>Description:</strong> {imported.character.description || '—'}
                </div>
                <div className="field full desc prewrap">
                  <strong>First message:</strong> {imported.scenario?.first_mes || '—'}
                </div>
                <div className="row full">
                  <button className="primary" disabled={saving} onClick={() => void finalizeImport()}>
                    {saving ? 'Importing…' : 'Import character'}
                  </button>
                  <button onClick={() => setImported(null)}>Cancel</button>
                </div>
              </div>
            )}

            {!draft && !imported && <div className="hint">Select a character or create a new one.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}