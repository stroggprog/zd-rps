import { useRef, useState } from 'react'
import { useApp } from '../store'
import { api } from '../lib/api'
import type { Lorebook, LoreEntry } from '../lib/types'

function newEntry(): LoreEntry {
  return {
    id: '',
    keys: [],
    content: '',
    name: '',
    enabled: true,
    insertion_order: 0,
    case_sensitive: false,
    priority: 100,
    selective: false,
    secondary_keys: [],
    constant: false,
    comment: '',
    position: 'before_char',
  }
}

type Draft = Lorebook

export function LorebookEditor() {
  const { lorebooks, closeOverlay, refreshAll, setError } = useApp()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)

  const setBook = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d))
  const setEntry = (index: number, patch: Partial<LoreEntry>) =>
    setBook({ entries: draft!.entries.map((e, i) => (i === index ? { ...e, ...patch } : e)) })

  const save = async () => {
    if (!draft || !draft.name.trim()) {
      setError('Lorebook name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      setDraft(
        draft.id
          ? await api.lorebooks.update(draft.id, { ...draft, entries: sanitizeDraftEntries(draft.entries) })
          : await api.lorebooks.create({ ...draft, entries: sanitizeDraftEntries(draft.entries) }),
      )
      await refreshAll()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete lorebook "${name}"?`)) return
    await api.lorebooks.remove(id)
    if (draft?.id === id) setDraft(null)
    await refreshAll()
  }

  const importFile = async (file: File) => {
    setError(null)
    try {
      const imported = await api.lorebooks.importFile(file)
      setDraft(imported)
      await refreshAll()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="overlay-wrap">
      <div className="overlay-head">
        <h2>Lorebooks</h2>
        <button onClick={closeOverlay}>✕ Close</button>
      </div>
      <div className="overlay-body">
        <div className="list-grid">
          <div>
            <div className="row" style={{ marginBottom: 8 }}>
              <button
                className="primary"
                onClick={() =>
                  setDraft({
                    id: '',
                    created: '',
                    updated: '',
                    name: '',
                    description: '',
                    scan_depth: 1000,
                    token_budget: 500,
                    recursive_scanning: false,
                    extensions: {},
                    entries: [],
                  })
                }
              >
                ＋ New lorebook
              </button>
              <button onClick={() => importInput.current?.click()}>Import file (JSON)</button>
              <input
                ref={importInput}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void importFile(f)
                  e.target.value = ''
                }}
              />
            </div>
            <div className="pick-list">
              {lorebooks.map((book) => (
                <div key={book.id} className={`pick-item${draft?.id === book.id ? ' selected' : ''}`} onClick={() => setDraft(book)}>
                  <span className="grow">{book.name}</span>
                  <span className="tag">{book.entries.length} entries</span>
                  <a
                    className="pick-export"
                    href={`/api/lorebooks/${book.id}/export`}
                    download={`${book.name.replace(/[^\w.-]+/g, '_')}.json`}
                    title="Export as JSON"
                    onClick={(e) => e.stopPropagation()}
                  >
                    ⤓
                  </a>
                </div>
              ))}
              {lorebooks.length === 0 && <div className="hint">No lorebooks yet.</div>}
            </div>
          </div>

          <div>
            {!draft && <div className="hint">Select a lorebook or create a new one.</div>}
            {draft && (
              <div className="form-grid">
                <div className="field">
                  <label>Name</label>
                  <input value={draft.name} onChange={(e) => setBook({ name: e.target.value })} />
                </div>
                <div className="field">
                  <label>Scan depth (characters)</label>
                  <input type="number" min={1} value={draft.scan_depth} onChange={(e) => setBook({ scan_depth: Number(e.target.value) })} />
                </div>
                <div className="field">
                  <label>Token budget</label>
                  <input type="number" min={1} value={draft.token_budget} onChange={(e) => setBook({ token_budget: Number(e.target.value) })} />
                </div>
                <div className="field">
                  <label>Recursive scanning</label>
                  <select value={draft.recursive_scanning ? '1' : '0'} onChange={(e) => setBook({ recursive_scanning: e.target.value === '1' })}>
                    <option value="0">Off</option>
                    <option value="1">On</option>
                  </select>
                </div>
                <div className="field full">
                  <label>Description</label>
                  <textarea rows={2} value={draft.description} onChange={(e) => setBook({ description: e.target.value })} />
                </div>

                <div className="full">
                  <div className="row">
                    <h4 style={{ margin: 0 }}>Entries ({draft.entries.length})</h4>
                    <button onClick={() => setBook({ entries: [...draft.entries, newEntry()] })}>＋ Add entry</button>
                  </div>
                  {draft.entries.map((entry, index) => (
                    <EntryForm
                      key={entry.id || `new-${index}`}
                      entry={entry}
                      onChange={(patch) => setEntry(index, patch)}
                      onRemove={() => setBook({ entries: draft.entries.filter((_, i) => i !== index) })}
                    />
                  ))}
                  {draft.entries.length === 0 && <div className="hint">No entries yet. Entries are injected into the prompt when their keys appear in recent chat history.</div>}
                </div>

                <div className="row full">
                  <button className="primary" disabled={saving} onClick={() => void save()}>
                    {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create lorebook'}
                  </button>
                  {draft.id && <button className="danger" onClick={() => void remove(draft.id as string, draft.name)}>Delete</button>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function sanitizeDraftEntries(entries: LoreEntry[]): LoreEntry[] {
  return entries.map((e) => ({ ...e, keys: e.keys.filter((k) => k.trim()), secondary_keys: e.secondary_keys.filter((k) => k.trim()) }))
}

function EntryForm({ entry, onChange, onRemove }: { entry: LoreEntry; onChange: (patch: Partial<LoreEntry>) => void; onRemove: () => void }) {
  return (
    <div className="entry-card">
      <div className="row">
        <span className="grow"><strong>{entry.name || '(unnamed entry)'}</strong></span>
        <label className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={entry.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
          enabled
        </label>
        <label className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={entry.constant} onChange={(e) => onChange({ constant: e.target.checked })} />
          constant
        </label>
        <button className="icon" title="Delete entry" onClick={onRemove}>✕</button>
      </div>
      <div className="field">
        <label>Name</label>
        <input value={entry.name} onChange={(e) => onChange({ name: e.target.value })} />
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Keys (comma-separated)</label>
          <input value={entry.keys.join(', ')} onChange={(e) => onChange({ keys: e.target.value.split(',').map((k) => k.trim()) })} />
        </div>
        <div className="field">
          <label>Secondary keys</label>
          <input value={entry.secondary_keys.join(', ')} onChange={(e) => onChange({ secondary_keys: e.target.value.split(',').map((k) => k.trim()) })} />
        </div>
        <div className="field">
          <label>Insertion order</label>
          <input type="number" value={entry.insertion_order} onChange={(e) => onChange({ insertion_order: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label>Priority</label>
          <input type="number" value={entry.priority} onChange={(e) => onChange({ priority: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label>Position</label>
          <select value={entry.position} onChange={(e) => onChange({ position: e.target.value as 'before_char' | 'after_char' })}>
            <option value="before_char">Before character</option>
            <option value="after_char">After character</option>
          </select>
        </div>
        <div className="field">
          <label>Selective (needs secondary keys)</label>
          <select value={entry.selective ? '1' : '0'} onChange={(e) => onChange({ selective: e.target.value === '1' })}>
            <option value="0">Off</option>
            <option value="1">On</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>Case sensitive</label>
        <select value={entry.case_sensitive ? '1' : '0'} onChange={(e) => onChange({ case_sensitive: e.target.value === '1' })}>
          <option value="0">No</option>
          <option value="1">Yes</option>
        </select>
      </div>
      <div className="field">
        <label>Content</label>
        <textarea rows={4} value={entry.content} onChange={(e) => onChange({ content: e.target.value })} />
      </div>
      <div className="field">
        <label>Comment</label>
        <input value={entry.comment} onChange={(e) => onChange({ comment: e.target.value })} />
      </div>
    </div>
  )
}