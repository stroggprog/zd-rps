import { useRef, useState } from 'react'
import { useApp } from '../store'
import { api } from '../lib/api'
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
  }
}

function toDraft(c: Character): Draft {
  return { ...c, id: c.id, tags: c.tags.join(', ') }
}

export function CharacterEditor() {
  const { characters, closeOverlay, refreshAll, setError } = useApp()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [imported, setImported] = useState<ImportDraft | null>(null)
  const [importName, setImportName] = useState('')
  const [acceptLorebook, setAcceptLorebook] = useState(true)
  const [acceptScenario, setAcceptScenario] = useState(true)
  const [saving, setSaving] = useState(false)
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
                  {c.avatarPath ? <img src={c.avatarPath} alt="" /> : <div className="avatar" />}
                  <span className="grow">{c.name}</span>
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
                    <label>Description</label>
                    <textarea rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
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
                      {activeCharacter?.avatarPath && <img src={activeCharacter.avatarPath} className="avatar-big" alt="" />}
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
                      <a className="button-link" href={api.characters.exportUrl(draft.id)} target="_blank" rel="noreferrer">
                        Export card
                      </a>
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