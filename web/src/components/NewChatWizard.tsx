import { useState } from 'react'
import { useApp } from '../store'

const STEPS = ['Characters', 'Lorebooks', 'Scenario']

export function NewChatWizard() {
  const { characters, lorebooks, scenarios, closeOverlay, createChat, sending } = useApp()
  const [step, setStep] = useState(0)
  const [participantIds, setParticipantIds] = useState<string[]>([])
  const [lorebookIds, setLorebookIds] = useState<string[]>([])
  const [scenarioId, setScenarioId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)

  const toggle = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  const finish = async () => {
    setCreating(true)
    try {
      await createChat({ title, participantIds, lorebookIds, scenarioId })
    } finally {
      setCreating(false)
    }
  }

  const canNext =
    step === 0
      ? participantIds.length > 0
      : step === 1
        ? true
        : true

  return (
    <div className="overlay-wrap">
      <div className="overlay-head">
        <h2>Start New Chat</h2>
        <button onClick={closeOverlay}>✕ Close</button>
      </div>
      <div className="overlay-body">
        <div className="wizard-steps">
          {STEPS.map((label, i) => (
            <span key={label} className={`wizard-step${i === step ? ' active' : ''}`}>
              {i + 1}. {label}
            </span>
          ))}
        </div>

        {step === 0 && (
          <div className="participant-pick">
            {characters.filter((c) => c.kind === 'character').map((character) => (
              <div
                key={character.id}
                className={`pick-item${participantIds.includes(character.id) ? ' selected' : ''}`}
                onClick={() => toggle(participantIds, setParticipantIds, character.id)}
              >
                {character.avatarPath ? <img src={character.avatarPath} alt="" /> : <div className="avatar" />}
                <span className="grow">{character.name}</span>
                {participantIds.includes(character.id) && <span className="tag">✓</span>}
              </div>
            ))}
            {characters.filter((c) => c.kind === 'character').length === 0 && (
              <div className="hint">
                No characters yet — create them under the Characters menu, or import a SillyTavern card there.
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="participant-pick">
            {lorebooks.map((book) => (
              <div
                key={book.id}
                className={`pick-item${lorebookIds.includes(book.id) ? ' selected' : ''}`}
                onClick={() => toggle(lorebookIds, setLorebookIds, book.id)}
              >
                <span className="grow">{book.name}</span>
                <span className="tag">{book.entries.length} entries</span>
                {lorebookIds.includes(book.id) && <span className="tag">✓</span>}
              </div>
            ))}
            {lorebooks.length === 0 && <div className="hint">No lorebooks yet — you can add them later.</div>}
          </div>
        )}

        {step === 2 && (
          <div>
            <label>
              Chat title (optional)
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Leave empty to auto-name" />
            </label>
            <div className="pick-list" style={{ marginTop: 12 }}>
              {scenarios.map((scenario) => (
                <div
                  key={scenario.id}
                  className={`pick-item${scenarioId === scenario.id ? ' selected' : ''}`}
                  onClick={() => setScenarioId(scenario.id)}
                >
                  <span className="grow">{scenario.name}</span>
                  {scenario.first_mes && <span className="tag">opening included</span>}
                </div>
              ))}
              <div
                className={`pick-item${scenarioId === null ? ' selected' : ''}`}
                onClick={() => setScenarioId(null)}
              >
                <span className="grow">No scenario</span>
              </div>
              {scenarios.length === 0 && <div className="hint">No scenarios yet — you can add them later.</div>}
            </div>
          </div>
        )}
      </div>
      <div className="overlay-head" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
        <button disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          Back
        </button>
        <div style={{ flex: 1 }} />
        {step < 2 ? (
          <button className="primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
            Next
          </button>
        ) : (
          <button className="primary" disabled={creating || sending} onClick={() => void finish()}>
            {creating ? 'Creating…' : 'Create chat'}
          </button>
        )}
      </div>
    </div>
  )
}