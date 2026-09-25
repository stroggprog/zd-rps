import { useRef, useState } from 'react'
import { useApp } from '../store'
import { api } from '../lib/api'
import type { CharacterGroup } from '../lib/types'

interface Draft {
  id: string | null
  name: string
  description: string
  memberIds: string[]
}

function emptyDraft(): Draft {
  return { id: null, name: '', description: '', memberIds: [] }
}

function toDraft(g: CharacterGroup): Draft {
  return { id: g.id, name: g.name, description: g.description, memberIds: g.memberIds }
}

export function GroupEditor() {
  const { groups, characters, closeOverlay, refreshAll, setError } = useApp()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const avatarInput = useRef<HTMLInputElement>(null)

  const activeGroup = draft?.id ? groups.find((g) => g.id === draft.id) : null

  const toggleMember = (id: string) => {
    if (!draft) return
    setDraft({
      ...draft,
      memberIds: draft.memberIds.includes(id)
        ? draft.memberIds.filter((m) => m !== id)
        : [...draft.memberIds, id],
    })
  }
  const save = async (): Promise<CharacterGroup | null> => {
    if (!draft || !draft.name.trim()) {
      setError('Group name is required')
      return null
    }
    setSaving(true)
    setError(null)
    try {
      const payload = { name: draft.name, description: draft.description, memberIds: draft.memberIds }
      const saved = draft.id
        ? await api.groups.update(draft.id, payload)
        : await api.groups.create(payload)
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
    if (!window.confirm(`Delete group "${name}"?`)) return
    try {
      await api.groups.remove(id)
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
        ? activeGroup
        : await save()
      if (!target) return
      const saved = await api.groups.uploadAvatar(target.id, file)
      setDraft(toDraft(saved))
      await refreshAll()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="overlay-wrap">
      <div className="overlay-head">
        <h2>Groups</h2>
        <button onClick={closeOverlay}>✕ Close</button>
      </div>
      <div className="overlay-body">
        <div className="list-grid">
          <div>
            <button
              className="primary"
              style={{ marginBottom: 8 }}
              onClick={() => setDraft(emptyDraft())}
            >
              ＋ New group
            </button>
            <div className="pick-list">
              {groups.map((g) => (
                <div
                  key={g.id}
                  className={`pick-item${draft?.id === g.id ? ' selected' : ''}`}
                  onClick={() => setDraft(toDraft(g))}
                >
                  {g.avatarPath ? <img src={g.avatarPath} alt="" /> : <div className="avatar" />}
                  <span className="grow">{g.name}</span>
                  <span className="tag">{g.memberIds.length} members</span>
                </div>
              ))}
              {groups.length === 0 && <div className="hint">No groups yet.</div>}
            </div>
          </div>

          <div>
            {!draft && <div className="hint">Select a group or create a new one.</div>}
            {draft && (
              <div className="form-grid">
                <div className="field">
                  <label>Name (required)</label>
                  <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div className="field full">
                  <label>Description</label>
                  <textarea
                    rows={2}
                    value={draft.description}
                    placeholder="Who belongs to this group?"
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </div>
                <div className="field full">
                  <label>Group image (shown in the chat selector)</label>
                  {activeGroup?.avatarPath && <img src={activeGroup.avatarPath} className="avatar-big" alt="" />}
                  <div className="row">
                    <button onClick={() => avatarInput.current?.click()}>Upload</button>
                    {activeGroup?.avatarPath && (
                      <button
                        className="danger"
                        onClick={() =>
                          void api.groups
                            .removeAvatar(activeGroup.id)
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
                <div className="field full">
                  <label>Members ({draft.memberIds.length})</label>
                  <div className="participant-pick" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                    {characters.map((c) => (
                      <div
                        key={c.id}
                        className={`pick-item${draft.memberIds.includes(c.id) ? ' selected' : ''}`}
                        onClick={() => toggleMember(c.id)}
                      >
                        {c.avatarPath ? <img src={c.avatarPath} alt="" /> : <div className="avatar" />}
                        <span className="grow">{c.name}</span>
                        {draft.memberIds.includes(c.id) && <span className="tag">✓</span>}
                      </div>
                    ))}
                    {characters.length === 0 && <div className="hint">No characters exist yet — create them first.</div>}
                  </div>
                </div>
                <div className="row full">
                  <button className="primary" disabled={saving} onClick={() => void save()}>
                    {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create group'}
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
