import { useState } from 'react'
import { useApp } from '../store'
import { api } from '../lib/api'

type Draft = { id: string | null; name: string; summary: string }

export function StoryEditor() {
  const { stories, closeOverlay, refreshAll, setError } = useApp()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!draft || !draft.name.trim()) {
      setError('Story name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (draft.id) {
        const updated = await api.stories.update(draft.id, { name: draft.name, summary: draft.summary })
        setDraft({ id: updated.id, name: updated.name, summary: updated.summary })
      } else {
        const created = await api.stories.create({ name: draft.name, summary: draft.summary })
        setDraft({ id: created.id, name: created.name, summary: created.summary })
      }
      await refreshAll()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete story "${name}"?`)) return
    await api.stories.remove(id)
    if (draft?.id === id) setDraft(null)
    await refreshAll()
  }

  return (
    <div className="overlay-wrap">
      <div className="overlay-head">
        <h2>Stories</h2>
        <button onClick={closeOverlay}>✕ Close</button>
      </div>
      <div className="overlay-body">
        <div className="list-grid">
          <div>
            <button className="primary" style={{ marginBottom: 8 }} onClick={() => setDraft({ id: null, name: '', summary: '' })}>
              ＋ New story
            </button>
            <div className="pick-list">
              {stories.map((s) => (
                <div key={s.id} className={`pick-item${draft?.id === s.id ? ' selected' : ''}`} onClick={() => setDraft({ id: s.id, name: s.name, summary: s.summary })}>
                  <span className="grow">{s.name}</span>
                  <span className="tag">{s.updated ? s.updated.slice(0, 10) : ""}</span>
                </div>
              ))}
              {stories.length === 0 && <div className="hint">No stories yet.</div>}
            </div>
          </div>

          <div>
            {!draft && <div className="hint">Select a story or create a new one.</div>}
            {draft && (
              <div className="form-grid">
                <div className="field full">
                  <label>Name (required)</label>
                  <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div className="field full">
                  <label>Summary</label>
                  <textarea
                    rows={12}
                    value={draft.summary}
                    placeholder="The story evolves each time a chat is saved into this story."
                    onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                  />
                </div>
                <div className="row full">
                  <button className="primary" disabled={saving} onClick={() => void save()}>
                    {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create story'}
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
