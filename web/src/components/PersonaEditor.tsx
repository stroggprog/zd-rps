import { useRef, useState } from 'react'
import { useApp } from '../store'
import { api, bustAvatar } from '../lib/api'
import type { Persona, PersonaGender } from '../lib/types'

interface Draft {
  id: string | null
  name: string
  description: string
  gender: PersonaGender
  voiceSampleTranscript: string
  thoughtSampleTranscript: string
}

function emptyDraft(): Draft {
  return { id: null, name: '', description: '', gender: 'male', voiceSampleTranscript: '', thoughtSampleTranscript: '' }
}

function toDraft(p: Persona): Draft {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    gender: p.gender,
    voiceSampleTranscript: p.voiceSampleTranscript ?? '',
    thoughtSampleTranscript: p.thoughtSampleTranscript ?? '',
  }
}

const GENDERS: { value: PersonaGender; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
]

export function PersonaEditor() {
  const { personas, closeOverlay, refreshAll, setError } = useApp()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [voiceTranscript, setVoiceTranscript] = useState('')
  const [thoughtTranscript, setThoughtTranscript] = useState('')
  const [saving, setSaving] = useState(false)
  const avatarInput = useRef<HTMLInputElement>(null)
  const voiceInput = useRef<HTMLInputElement>(null)
  const thoughtInput = useRef<HTMLInputElement>(null)
  const importInput = useRef<HTMLInputElement>(null)

  const activePersona = draft?.id ? personas.find((p) => p.id === draft.id) ?? null : null

  const beginCreate = () => setDraft(emptyDraft())

  const beginEdit = (p: Persona) => {
    setDraft(toDraft(p))
    setVoiceTranscript(p.voiceSampleTranscript ?? '')
    setThoughtTranscript(p.thoughtSampleTranscript ?? '')
  }

  const save = async (): Promise<Persona | null> => {
    if (!draft || !draft.name.trim()) {
      setError('Persona name is required')
      return null
    }
    setSaving(true)
    setError(null)
    try {
      const payload: Partial<Persona> = { name: draft.name, description: draft.description, gender: draft.gender, voiceSampleTranscript: voiceTranscript, thoughtSampleTranscript: thoughtTranscript }
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

  const importZdp = async (file: File) => {
    setError(null)
    try {
      const created = await api.personas.importZdp(file)
      await refreshAll()
      beginEdit(created)
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

  // Audiobook samples: voice (spoken lines) + thought (internal thoughts).
  // Requires a saved persona, so it saves one first when needed.
  const uploadSample = async (kind: 'voice' | 'thought', file: File) => {
    setError(null)
    try {
      const target = draft?.id
        ? activePersona
        : await save()
      if (!target) return
      const transcript = (kind === 'voice' ? voiceTranscript : thoughtTranscript).trim()
      const saved =
        kind === 'voice'
          ? await api.personas.uploadVoice(target.id, file, transcript)
          : await api.personas.uploadThought(target.id, file, transcript)
      setDraft(toDraft(saved))
      await refreshAll()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const removeSample = async (kind: 'voice' | 'thought') => {
    try {
      const saved =
        kind === 'voice'
          ? await api.personas.removeVoice(activePersona!.id)
          : await api.personas.removeThought(activePersona!.id)
      setDraft(toDraft(saved))
      if (kind === 'voice') setVoiceTranscript('')
      else setThoughtTranscript('')
      await refreshAll()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const sampleBlock = (
    kind: 'voice' | 'thought',
    label: string,
    samplePath: string | null,
    transcript: string,
    setTranscript: (v: string) => void,
    inputRef: React.RefObject<HTMLInputElement | null>,
  ) => (
    <div className="field full">
      <label>{label}</label>
      {samplePath && (
        <audio
          src={`${samplePath}?v=${activePersona?.updated ?? ''}`}
          controls
          style={{ width: '100%' }}
        />
      )}
      <div className="row" style={{ marginTop: 6 }}>
        <input
          ref={inputRef}
          type="file"
          accept="audio/wav,.wav,audio/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void uploadSample(kind, f)
            e.target.value = ''
          }}
        />
        <button onClick={() => inputRef.current?.click()}>Upload sample</button>
        {samplePath && (
          <button className="danger" onClick={() => void removeSample(kind)}>
            Remove
          </button>
        )}
      </div>
      <input
        style={{ marginTop: 6 }}
        value={transcript}
        placeholder="Transcript of the sample (recommended)"
        onChange={(e) => setTranscript(e.target.value)}
      />
    </div>
  )

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
            <div className="row" style={{ marginBottom: 8 }}>
              <button onClick={() => importInput.current?.click()}>Import file (.zdp)</button>
              <input
                ref={importInput}
                type="file"
                accept=".zdp,application/zip"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void importZdp(f)
                  e.target.value = ''
                }}
              />
            </div>
            <div className="pick-list">
              {personas.map((p) => (
                <div
                  key={p.id}
                  className={`pick-item${draft?.id === p.id ? ' selected' : ''}`}
                  onClick={() => beginEdit(p)}
                >
                  {p.avatarPath ? <img src={bustAvatar(p.avatarPath, p.updated) ?? ''} alt="" /> : <div className="avatar" />}
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
                  {activePersona?.avatarPath && (
                    <img src={bustAvatar(activePersona.avatarPath, activePersona.updated) ?? ''} className="avatar-big" alt="" />
                  )}
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

                {!draft.id && (
                  <span className="hint full" style={{ padding: 0 }}>
                    Save the persona first to attach voice samples.
                  </span>
                )}
                {draft.id && (
                  <>
                    {sampleBlock('voice', 'Persona voice (spoken lines) — audiobook', activePersona?.voiceSamplePath ?? null, voiceTranscript, setVoiceTranscript, voiceInput)}
                    {sampleBlock('thought', 'Persona thoughts (internal monologue) — audiobook', activePersona?.thoughtSamplePath ?? null, thoughtTranscript, setThoughtTranscript, thoughtInput)}
                  </>
                )}

                <div className="row full">
                  <button className="primary" disabled={saving} onClick={() => void save()}>
                    {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create persona'}
                  </button>
                  {draft.id && (
                    <>
                      <a className="button-link" href={api.personas.exportZdpUrl(draft.id)} target="_blank" rel="noreferrer">
                        Export as .zdp file
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

