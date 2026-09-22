import { useRef, useState } from 'react'
import { useApp } from '../store'
import { api } from '../lib/api'
import type { Persona, PersonaGender } from '../lib/types'

interface Draft {
  id: string | null
  name: string
  description: string
  gender: PersonaGender
}

function emptyDraft(): Draft {
  return { id: null, name: '', description: '', gender: 'male' }
}

function toDraft(p: Persona): Draft {
  return { id: p.id, name: p.name, description: p.description, gender: p.gender }
}

const GENDERS: { value: PersonaGender; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
]

export function PersonaEditor() {
  const { personas, closeOverlay, refreshAll, setError } = useApp()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const avatarInput = useRef<HTMLInputElement>(null)

  const activePersona = draft?.id ? personas.find((p) => p.id === draft.id) ?? null : null

  const beginCreate = () => setDraft(emptyDraft())

  const beginEdit = (p: Persona) => setDraft(toDraft(p))

  const save = async (): Promise<Persona | null> => {
    if (!draft || !draft.name.trim()) {
      setError('Persona name is required')
      return null
    }
    setSaving(true)
    setError(null)
    try {
      const payload: Partial<Persona> = { name: draft.name, description: draft.description, gender: draft.gender }
      const saved = draft.id
        ? await api.personas.update(draft.id, payload)
        : await api.personas.create(payload)
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
    if (!window.confirm(`Delete persona "${name}"?`)) return
    try {
      await api.personas.remove(id)
      if (draft?.id === id) setDraft(null)
      await refreshAll()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const uploadAvatar = async (file: File) => {
    setError(null)
    try {
      const target = draft?.id
        ? activePersona
        : await save()
      if (!target) return
      const saved = await api.personas.uploadAvatar(target.id, file)
      setDraft(toDraft(saved))
      await refreshAll()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="overlay-wrap">
      <div className="overlay-head">
        <h2>Personas</h2>
        <button onClick={closeOverlay}>✕ Close</button>
      </div>
      <div className="overlay-body">
        <div className="list-grid">
          <div>
            <button className="primary" style={{ marginBottom: 8 }} onClick={beginCreate}>
              ＋ New persona
            </button>
            <div className="pick-list">
              {personas.map((p) => (
                <div
                  key={p.id}
                  className={`pick-item${draft?.id === p.id ? ' selected' : ''}`}
                  onClick={() => beginEdit(p)}
                >
                  {p.avatarPath ? <img src={p.avatarPath} alt="" /> : <div className="avatar" />}
                  <span className="grow">{p.name}</span>
                  <span className="tag">{GENDERS.find((g) => g.value === p.gender)?.label ?? 'Male'}</span>
                </div>
              ))}
              {personas.length === 0 && <div className="hint">No personas yet.</div>}
            </div>
          </div>

          <div>
            {!draft && <div className="hint">Select a persona or create a new one.</div>}
            {draft && (
              <div className="form-grid">
                <div className="field">
                  <label>Name (required)</label>
                  <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>

                <div className="field">
                  <label>Gender</label>
                  <select
                    value={draft.gender}
                    onChange={(e) => setDraft({ ...draft, gender: e.target.value as PersonaGender })}
                  >
                    {GENDERS.map((g) => (
                      <option key={g.value} value={g.value}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field full">
                  <label>Description (optional)</label>
                  <textarea
                    rows={4}
                    value={draft.description}
                    placeholder="Who is this persona? Appearance, profession, background…"
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </div>

                <div className="field full">
                  <label>Avatar (optional)</label>
                  {activePersona?.avatarPath && <img src={activePersona.avatarPath} className="avatar-big" alt="" />}
                  <div className="row">
                    <button onClick={() => avatarInput.current?.click()}>Upload</button>
                    {activePersona?.avatarPath && (
                      <button
                        className="danger"
                        onClick={() =>
                          void api.personas
                            .removeAvatar(activePersona.id)
                            .then(async (s) => {
                              setDraft(toDraft(s))
                              await refreshAll()
                            })
                        }
                      >
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

                <div className="row full">
                  <button className="primary" disabled={saving} onClick={() => void save()}>
                    {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create persona'}
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
