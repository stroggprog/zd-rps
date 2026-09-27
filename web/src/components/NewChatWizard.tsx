import { useState } from 'react'
import { bustAvatar } from '../lib/api'
import { useApp } from '../store'

const STEPS = ['Characters', 'Story (optional)', 'Persona', 'Narrator (optional)', 'Lorebooks', 'Scenario']

export function NewChatWizard() {
  const { characters: people, groups, stories, narrators, personas, lorebooks, scenarios, closeOverlay, createChat, sending } = useApp()
  const [step, setStep] = useState(0)
  const [participantIds, setParticipantIds] = useState<string[]>([])
  const [storyId, setStoryId] = useState<string | null>(null)
  const [personaId, setPersonaId] = useState<string | null>(null)
  const [narratorId, setNarratorId] = useState<string | null>(null)
  const [tagFilters, setTagFilters] = useState<string[]>([])
  const [charTab, setCharTab] = useState<'characters' | 'groups'>('characters')
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
        storyId,
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
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '0 0 140px' }}>
              <button
                className={charTab === 'characters' ? 'toggle on' : 'toggle'}
                onClick={() => setCharTab('characters')}
              >
                Characters
              </button>
              <button
                className={charTab === 'groups' ? 'toggle on' : 'toggle'}
                onClick={() => setCharTab('groups')}
              >
                Groups
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '0 0 170px' }}>
              {charTab === 'characters' &&
                (() => {
                  const allTags = [...new Set(people.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b))
                  if (allTags.length === 0) return <div className="hint">No tags yet.</div>
                  return (
                    <>
                      {allTags.map((tag) => (
                        <button
                          key={tag}
                          className={tagFilters.includes(tag) ? 'toggle on' : 'toggle'}
                          style={{ alignSelf: 'stretch', width: '100%' }}
                          onClick={() =>
                            setTagFilters(
                              tagFilters.includes(tag)
                                ? tagFilters.filter((x) => x !== tag)
                                : [...tagFilters, tag],
                            )
                          }
                        >
                          {tag}
                        </button>
                      ))}
                      {tagFilters.length > 0 && (
                        <button className="icon" onClick={() => setTagFilters([])}>✕ clear</button>
                      )}
                    </>
                  )
                })()}
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {charTab === 'characters' && (
                <>
                  {people
                    .filter((p) => tagFilters.length === 0 || tagFilters.every((t) => p.tags.includes(t)))
                    .map((person) => (
                    <div
                      key={person.id}
                      className={`pick-item${participantIds.includes(person.id) ? ' selected' : ''}`}
                      onClick={() => toggle(participantIds, setParticipantIds, person.id)}
                    >
                      {person.avatarPath ? <img src={bustAvatar(person.avatarPath, person.updated) ?? ''} alt="" /> : <div className="avatar" />}
                      <span className="grow">{person.name}</span>
                      {participantIds.includes(person.id) && <span className="tag">✓</span>}
                    </div>
                  ))}
                  {people.length === 0 && (
                    <div className="hint">No characters yet — create them under the Characters menu, or import a SillyTavern card there.</div>
                  )}
                </>
              )}

              {charTab === 'groups' && (
                <>
                  {groups.map((g) => (
                    <div
                      key={g.id}
                      className="pick-item"
                      onClick={() => {
                        const merged = new Set(participantIds)
                        for (const m of g.memberIds) merged.add(m)
                        setParticipantIds([...merged])
                      }}
                    >
                      {g.avatarPath ? <img src={g.avatarPath} alt="" /> : <div className="avatar" />}
                      <div className="grow">
                        <div>{g.name}</div>
                        <div className="hint" style={{ padding: 0 }}>
                          {g.memberIds.length} member{g.memberIds.length === 1 ? '' : 's'}{g.description ? ` · ${g.description}` : ''}
                        </div>
                      </div>
                      <span className="tag">＋ add {g.memberIds.length}</span>
                    </div>
                  ))}
                  {groups.length === 0 && (
                    <div className="hint">No groups yet — create them under the Groups menu (Characters → Groups).</div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="participant-pick" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              className={`pick-item${storyId === null ? ' selected' : ''}`}
              onClick={() => setStoryId(null)}
            >
              <span className="grow">No story — start from scratch</span>
            </button>
            {stories.map((st) => (
              <button
                key={st.id}
                className={`pick-item${storyId === st.id ? ' selected' : ''}`}
                onClick={() => setStoryId(st.id)}
              >
                <span className="grow">
                  <div>{st.name}</div>
                  <div className="hint" style={{ padding: 0 }}>
                    {st.summary.slice(0, 90) || 'No summary yet.'}
                  </div>
                </span>
                {storyId === st.id && <span className="tag">✓</span>}
              </button>
            ))}
            <div className="hint">
              The selected story's summary is injected at the start of the chat so you can continue a longer
              story across separate chats.
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="participant-pick">
            {personas.map((persona) => (
              <div
                key={persona.id}
                className={`pick-item${personaId === persona.id ? ' selected' : ''}`}
                onClick={() => setPersonaId(persona.id)}
              >
                {persona.avatarPath ? <img src={bustAvatar(persona.avatarPath, persona.updated) ?? ''} alt="" /> : <div className="avatar" />}
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

        {step === 3 && (
          <div className="participant-pick">
            {narrators.map((narrator) => (
              <div
                key={narrator.id}
                className={`pick-item${narratorId === narrator.id ? ' selected' : ''}`}
                onClick={() => setNarratorId(narratorId === narrator.id ? null : narrator.id)}
              >
                {narrator.avatarPath ? <img src={bustAvatar(narrator.avatarPath, narrator.updated) ?? ''} alt="" /> : <div className="avatar" />}
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

        {step === 4 && (
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

        {step === 5 && (
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
