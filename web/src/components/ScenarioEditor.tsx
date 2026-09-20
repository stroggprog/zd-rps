import { useState } from 'react'
import { useApp } from '../store'
import { api } from '../lib/api'
import type { Scenario } from '../lib/types'

type Draft = Scenario

function emptyDraft(): Draft {
  return {
    id: '',
    created: '',
    updated: '',
    name: '',
    description: '',
    first_mes: '',
    scenario: '',
    alternate_greetings: [],
  }
}

export function ScenarioEditor() {
  const { scenarios, closeOverlay, refreshAll, setError } = useApp()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [greetings, setGreetings] = useState('')

  const beginEdit = (s: Scenario) => {
    setDraft({ ...s })
    setGreetings(s.alternate_greetings.join('\n'))
  }

  const beginCreate = () => {
    setDraft(emptyDraft())
    setGreetings('')
  }

  const setBook = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  const save = async () => {
    if (!draft || !draft.name.trim()) {
      setError('Scenario name is required')
      return
    }
    const payload = {
      ...draft,
      alternate_greetings: greetings.split('\n').map((g) => g.trim()).filter(Boolean),
    }
    setSaving(true)
    setError(null)
    try {
      setDraft(
        draft.id ? await api.scenarios.update(draft.id, payload) : await api.scenarios.create(payload),
      )
      await refreshAll()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete scenario "${name}"?`)) return
    await api.scenarios.remove(id)
    if (draft?.id === id) setDraft(null)
    await refreshAll()
  }

  const copyGreeting = () => {
    if (draft?.first_mes) setGreetings((g) => (g ? `${g}\n${draft.first_mes}` : draft.first_mes))
  }

  return (
    <div className="overlay-wrap">
      <div className="overlay-head">
        <h2>Scenarios</h2>
        <button onClick={closeOverlay}>✕ Close</button>
      </div>
      <div className="overlay-body">
        <div className="list-grid">
          <div>
            <button className="primary" style={{ marginBottom: 8 }} onClick={beginCreate}>
              ＋ New scenario
            </button>
            <div className="pick-list">
              {scenarios.map((s) => (
                <div key={s.id} className={`pick-item${draft?.id === s.id ? ' selected' : ''}`} onClick={() => beginEdit(s)}>
                  <span className="grow">{s.name}</span>
                  <span className="tag">{s.alternate_greetings.length} greetings</span>
                </div>
              ))}
              {scenarios.length === 0 && <div className="hint">No scenarios yet.</div>}
            </div>
          </div>

          <div>
            {!draft && <div className="hint">Select a scenario or create a new one.</div>}
            {draft && (
              <div className="form-grid">
                <div className="field full">
                  <label>Name</label>
                  <input value={draft.name} onChange={(e) => setBook({ name: e.target.value })} />
                </div>
                <div className="field full">
                  <label>Description</label>
                  <textarea rows={3} value={draft.description} onChange={(e) => setBook({ description: e.target.value })} />
                </div>
                <div className="field full">
                  <label>Scenario text</label>
                  <textarea rows={5} value={draft.scenario} onChange={(e) => setBook({ scenario: e.target.value })} />
                </div>
                <div className="field full">
                  <label>Opening message</label>
                  <textarea rows={6} value={draft.first_mes} onChange={(e) => setBook({ first_mes: e.target.value })} />
                </div>
                <div className="field full">
                  <label>
                    Alternate greetings (one per line)
                    <button style={{ marginLeft: 8 }} onClick={copyGreeting}>Copy opening message</button>
                  </label>
                  <textarea rows={4} value={greetings} onChange={(e) => setGreetings(e.target.value)} />
                </div>
                <div className="row full">
                  <button className="primary" disabled={saving} onClick={() => void save()}>
                    {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create scenario'}
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