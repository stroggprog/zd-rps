import { useState } from 'react'
import { useApp } from '../store'

const STEPS = ['Characters', 'Persona', 'Narrator (optional)', 'Lorebooks', 'Scenario']

export function NewChatWizard() {
  const { characters: people, personas, narrators, lorebooks, scenarios, closeOverlay, createChat, sending } = useApp()
  const [step, setStep] = useState(0)
  const [participantIds, setParticipantIds] = useState<string[]>([])
  const [personaId, setPersonaId] = useState<string | null>(null)
  const [narratorId, setNarratorId] = useState<string | null>(null)
  const [lorebookIds, setLorebookIds] = useState<string[]>([])
  const [scenarioId, setScenarioId] = useState<string | null>(null)
  const [adhoc, setAdhoc] = useState(false)
  const [adhocScenario, setAdhocScenario] = useState('')
  const [adhocOpening, setAdhocOpening] = useState('')
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)

  const toggle = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  const finish = async () => {
    setCreating(true)
    try {
      await createChat({
        title,
        participantIds,
        personaId,
        narratorId,
        lorebookIds,
        scenarioId,
        scenarioInline:
          adhoc && adhocScenario.trim()
            ? { scenario: adhocScenario, first_mes: adhocOpening }
            : null,
      })
    } finally {
      setCreating(false)
    }
  }

  const canNext =
    step === 0
      ? participantIds.length > 0
      : true

  return (
    <div className="overlay-wrap">
      <div className="overlay-head">
        <h2>Start New Chat</h2>
        <button onClick={closeOverlay}>✕ Close</button>
      </div>
      <div className="overlay-body">
        <div className="wizard-steps" style={{ alignItems: 'center' }}>
          <button disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            ← Back
          </button>
          <button className="primary" disabled={!canNext || step >= STEPS.length - 1} onClick={() => setStep((s) => s + 1)}>
            Next →
          </button>
          {STEPS.map((label, i) => (
            <span key={label} className={`wizard-step${i === step ? ' active' : ''}`}>
              {i + 1}. {label}
            </span>
          ))}
          <div style={{ flex: 1 }} />
        </div>

        {step === 0 && (
          <div className="participant-pick">
            {people.map((person) => (
              <div
                key={person.id}
                className={`pick-item${participantIds.includes(person.id) ? ' selected' : ''}`}
                onClick={() => toggle(participantIds, setParticipantIds, person.id)}
              >
                {person.avatarPath ? <img src={person.avatarPath} alt="" /> : <div className="avatar" />}
                <span className="grow">{person.name}</span>
                {participantIds.includes(person.id) && <span className="tag">✓</span>}
              </div>
            ))}
            {people.length === 0 && (
              <div className="hint">No characters yet — create them under the Characters menu, or import a SillyTavern card there.</div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="participant-pick">
            {personas.map((persona) => (
              <div
                key={persona.id}
                className={`pick-item${personaId === persona.id ? ' selected' : ''}`}
                onClick={() => setPersonaId(persona.id)}
              >
                {persona.avatarPath ? <img src={persona.avatarPath} alt="" /> : <div className="avatar" />}
                <span className="grow">{persona.name}</span>
                {persona.description ? <span className="tag">{persona.gender}</span> : null}
                {personaId === persona.id && <span className="tag">✓</span>}
              </div>
            ))}
            {personas.length === 0 && (
              <div className="hint">No personas yet — create one under the Personas menu.</div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="participant-pick">
            {narrators.map((narrator) => (
              <div
                key={narrator.id}
                className={`pick-item${narratorId === narrator.id ? ' selected' : ''}`}
                onClick={() => setNarratorId(narratorId === narrator.id ? null : narrator.id)}
              >
                {narrator.avatarPath ? <img src={narrator.avatarPath} alt="" /> : <div className="avatar" />}
                <span className="grow">{narrator.name}</span>
                {narrator.voiceSamplePath && <span className="tag">🎤</span>}
                {narratorId === narrator.id && <span className="tag">✓</span>}
              </div>
            ))}
            <div
              className={`pick-item${narratorId === null ? ' selected' : ''}`}
              onClick={() => setNarratorId(null)}
            >
              <span className="grow">No narrator — I'll narrate it myself</span>
            </div>
            {narrators.length === 0 && (
              <div className="hint">No narrators yet — one is optional, you can add one later.</div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="pick-list">
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

        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
            <div className="field">
              <label style={{ marginBottom: 0 }}>
                Scenario (optional)
              </label>
              <select
                value={scenarioId ?? ''}
                onChange={(e) => {
                  setScenarioId(e.target.value || null)
                  if (e.target.value) setAdhoc(false)
                }}
              >
                <option value="">None</option>
                {scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </select>
            </div>
            {!scenarioId && (
              <div>
                <div className="row" style={{ marginBottom: 6 }}>
                  <button
                    className={adhoc ? 'toggle on' : 'toggle'}
                    onClick={() => setAdhoc(!adhoc)}
                  >
                    {adhoc ? '✓ Ad-hoc scenario' : '＋ Write an ad-hoc scenario'}
                  </button>
                </div>
                {adhoc && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div className="field">
                      <label style={{ marginBottom: 0 }}>
                        Scenario text
                      </label>
                      <textarea
                        rows={4}
                        value={adhocScenario}
                        placeholder="Scene setup the LLM should know about…"
                        onChange={(e) => setAdhocScenario(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label style={{ marginBottom: 0 }}>
                        Opening message (optional)
                      </label>
                      <textarea
                        rows={3}
                        value={adhocOpening}
                        placeholder="First message in the chat, spoken by the first participant"
                        onChange={(e) => setAdhocOpening(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="field">
              <label style={{ marginBottom: 0 }}>
                Chat title (optional)
              </label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Leave empty to auto-name" />
            </div>
          </div>
        )}
      </div>
      {step === STEPS.length - 1 && (
        <div className="overlay-foot" style={{ justifyContent: 'flex-end', borderBottom: 'none' }}>
          <button className="primary" disabled={creating || sending} onClick={() => void finish()}>
            {creating ? 'Creating…' : 'Create chat'}
          </button>
        </div>
      )}
    </div>
  )
}
