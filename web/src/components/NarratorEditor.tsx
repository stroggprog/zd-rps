import { useRef, useState } from 'react'
import { useApp } from '../store'
import { api } from '../lib/api'
import type { Narrator } from '../lib/types'

interface Draft {
  id: string | null
  name: string
}

function emptyDraft(): Draft {
  return { id: null, name: '' }
}

function toDraft(n: Narrator): Draft {
  return { id: n.id, name: n.name }
}

export function NarratorEditor() {
  const { narrators, closeOverlay, refreshAll, setError } = useApp()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [transcript, setTranscript] = useState('')
  const [saving, setSaving] = useState(false)
  const avatarInput = useRef<HTMLInputElement>(null)
  const voiceInput = useRef<HTMLInputElement>(null)

  const activeNarrator = draft?.id ? narrators.find((n) => n.id === draft.id) ?? null : null

  const openDraft = (n: { id: string | null; name: string; transcript?: string }) => {
    setDraft({ id: n.id, name: n.name })
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
      const payload: Partial<Narrator> = { name: draft.name }
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
            <div className="pick-list">
              {narrators.map((n) => (
                <div
                  key={n.id}
                  className={`pick-item${draft?.id === n.id ? ' selected' : ''}`}
                  onClick={() => beginEdit(n)}
                >
                  {n.avatarPath ? <img src={n.avatarPath} alt="" /> : <div className="avatar" />}
                  <span className="grow">{n.name}</span>
                  {n.voiceSamplePath && <span className="tag">🎤</span>}
                </div>
              ))}
              {narrators.length === 0 && <div className="hint">No narrators yet.</div>}
            </div>
          </div>

          <div>
            {!draft && <div className="hint">Select a narrator or create a new one.</div>}
            {draft && (
              <div className="form-grid">
                <div className="field full">
                  <label>Name</label>
                  <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>

                <div className="field full">
                  <label>Avatar</label>
                  {activeNarrator?.avatarPath && <img src={activeNarrator.avatarPath} className="avatar-big" alt="" />}
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
                    <button className="danger" onClick={() => void remove(draft.id as string, draft.name)}>
                      Delete
                    </button>
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