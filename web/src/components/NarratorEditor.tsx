import { useRef, useState } from 'react'
import { useApp } from '../store'
import { api, bustAvatar } from '../lib/api'
import type { Narrator, ZdnImportDraft } from '../lib/types'

interface Draft {
  id: string | null
  name: string
  voiceSampleTranscript: string
}

function emptyDraft(): Draft {
  return { id: null, name: '', voiceSampleTranscript: '' }
}

function toDraft(n: Narrator): Draft {
  return { id: n.id, name: n.name, voiceSampleTranscript: n.voiceSampleTranscript ?? '' }
}

export function NarratorEditor() {
  const { narrators, closeOverlay, refreshAll, setError } = useApp()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [transcript, setTranscript] = useState('')
  const [saving, setSaving] = useState(false)
  const avatarInput = useRef<HTMLInputElement>(null)
  const voiceInput = useRef<HTMLInputElement>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const [importPreview, setImportPreview] = useState<ZdnImportDraft | null>(null)
  const [importName, setImportName] = useState('')

  const activeNarrator = draft?.id ? narrators.find((n) => n.id === draft.id) ?? null : null

  const openDraft = (n: { id: string | null; name: string; transcript?: string }) => {
    setDraft({ id: n.id, name: n.name, voiceSampleTranscript: n.transcript ?? '' })
    setTranscript(n.transcript ?? '')
  }

  const beginCreate = () => openDraft(emptyDraft())

  const beginEdit = (n: Narrator) =>
    openDraft({ id: n.id, name: n.name, transcript: n.voiceSampleTranscript ?? '' })

  const save = async (): Promise<Narrator | null> => {
    if (!draft || !draft.name.trim()) {
      setError('Narrator name is required')
      return null
    }
    setSaving(true)
    setError(null)
    try {
      const payload: Partial<Narrator> = { name: draft.name, voiceSampleTranscript: transcript }
      const saved = draft.id
        ? await api.narrators.update(draft.id, payload)
        : await api.narrators.create(payload)
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
    if (!window.confirm(`Delete narrator "${name}"?`)) return
    await api.narrators.remove(id)
    if (draft?.id === id) setDraft(null)
    await refreshAll()
  }

  const importZdn = async (file: File) => {
    setError(null)
    try {
      const preview = await api.narrators.importZdn(file)
      setImportPreview(preview)
      setImportName(preview.narrator.name)
      setDraft(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const finalizeZdn = async () => {
    if (!importPreview || !importName.trim()) {
      setError('Narrator name is required')
      return
    }
    setError(null)
    try {
      const created = await api.narrators.finalizeZdn(importPreview.importId, importName.trim())
      setImportPreview(null)
      await refreshAll()
      openDraft({ id: created.id, name: created.name, transcript: created.voiceSampleTranscript ?? '' })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  /** Returns the saved narrator for the open draft, creating it first if needed (media can attach before first save). */
  const ensureSaved = async (): Promise<Narrator | null> => {
    if (draft?.id) return activeNarrator
    return save()
  }

  const uploadAvatar = async (file: File) => {
    setError(null)
    try {
      const target = await ensureSaved()
      if (!target) return
      const saved = await api.narrators.uploadAvatar(target.id, file)
      setDraft(toDraft(saved))
      await refreshAll()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const uploadVoice = async () => {
    const file = voiceInput.current?.files?.[0]
    if (!file) return
    setError(null)
    try {
      const target = await ensureSaved()
      if (!target) return
      const saved = await api.narrators.uploadVoice(target.id, file, transcript.trim())
      setDraft(toDraft(saved))
      await refreshAll()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="overlay-wrap">
      <div className="overlay-head">
        <h2>Narrators</h2>
        <button onClick={closeOverlay}>✕ Close</button>
      </div>
      <div className="overlay-body">
        <div className="list-grid">
          <div>
            <button className="primary" style={{ marginBottom: 8 }} onClick={beginCreate}>
              ＋ New narrator
            </button>
            <div className="row" style={{ marginBottom: 8 }}>
              <button onClick={() => importInput.current?.click()}>Import file (.zdn)</button>
              <input
                ref={importInput}
                type="file"
                accept=".zdn,application/zip"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void importZdn(f)
                  e.target.value = ''
                }}
              />
            </div>
            <div className="pick-list">
              {narrators.map((n) => (
                <div
                  key={n.id}
                  className={`pick-item${draft?.id === n.id ? ' selected' : ''}`}
                  onClick={() => beginEdit(n)}
                >
                  {n.avatarPath ? <img src={bustAvatar(n.avatarPath, n.updated) ?? ''} alt="" /> : <div className="avatar" />}
                  <span className="grow">{n.name}</span>
                  {n.voiceSamplePath && <span className="tag">🎤</span>}
                </div>
              ))}
              {narrators.length === 0 && <div className="hint">No narrators yet.</div>}
            </div>
          </div>

          <div>
            {importPreview && (
              <div className="form-grid">
                <div className="field full">
                  <h4>Imported narrator (.zdn)</h4>
                  {importPreview.avatarDataUrl && <img src={importPreview.avatarDataUrl} className="avatar-big" alt="" />}
                  {!importPreview.hasAvatar && <span className="hint">No avatar in this package.</span>}
                  {importPreview.voiceSampleDataUrl && (
                    <div style={{ marginTop: 4 }}>
                      <div className="hint">Voice sample</div>
                      <audio src={importPreview.voiceSampleDataUrl} controls style={{ width: '100%' }} />
                    </div>
                  )}
                </div>
                <div className="field full">
                  <label>Name</label>
                  <input value={importName} onChange={(e) => setImportName(e.target.value)} />
                </div>
                {importPreview.transcript && <div className="field full"><label>Sample transcript</label><div className="desc prewrap">{importPreview.transcript}</div></div>}
                <div className="row full">
                  <button className="primary" onClick={() => void finalizeZdn()}>Import narrator</button>
                  <button onClick={() => setImportPreview(null)}>Cancel</button>
                </div>
              </div>
            )}
            {!draft && !importPreview && <div className="hint">Select a narrator or create a new one.</div>}
            {draft && (
              <div className="form-grid">
                <div className="field full">
                  <label>Name</label>
                  <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>

                <div className="field full">
                  <label>Avatar</label>
                  {activeNarrator?.avatarPath && <img src={bustAvatar(activeNarrator.avatarPath, activeNarrator.updated) ?? ''} className="avatar-big" alt="" />}
                  <div className="row">
                    <button onClick={() => avatarInput.current?.click()}>Upload</button>
                    {activeNarrator?.avatarPath && (
                      <button className="danger" onClick={() => void api.narrators.removeAvatar(activeNarrator.id).then(async (s) => { setDraft(toDraft(s)); await refreshAll() })}>
                        Remove
                      </button>
                    )}
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

                <div className="field full">
                  <label>Voice sample (WAV)</label>
                  {activeNarrator?.voiceSamplePath && (
                    <audio src={`${activeNarrator.voiceSamplePath}?v=${activeNarrator.updated}`} controls style={{ width: '100%' }} />
                  )}
                  <div className="row">
                    <input ref={voiceInput} type="file" accept="audio/wav,.wav,audio/*" />
                  </div>
                  <input
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    placeholder="Transcript of the sample (recommended)"
                    style={{ marginTop: 6 }}
                  />
                  <div className="row" style={{ marginTop: 6 }}>
                    <button onClick={() => void uploadVoice()}>Save sample</button>
                    {activeNarrator?.voiceSamplePath && (
                      <button className="danger" onClick={() => void api.narrators.removeVoice(activeNarrator.id).then(async (s) => { setDraft(toDraft(s)); await refreshAll() })}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div className="row full">
                  <button className="primary" disabled={saving} onClick={() => void save()}>
                    {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create narrator'}
                  </button>
                  {draft.id && (
                    <>
                      <a className="button-link" href={api.narrators.exportZdnUrl(draft.id)} target="_blank" rel="noreferrer">
                        Export as .zdn file
                      </a>
                      <button className="danger" onClick={() => void remove(draft.id as string, draft.name)}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}