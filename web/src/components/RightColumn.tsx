import { useState } from 'react'
import type { ReactNode } from 'react'
import { useApp } from '../store'

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section className="section">
      <h3>
        <button
          className="section-toggle"
          aria-expanded={open}
          onClick={onToggle}
        >
          {title}
          <span className="chevron" aria-hidden>{open ? '▾' : '▸'}</span>
        </button>
      </h3>
      {open && <div className="section-body">{children}</div>}
    </section>
  )
}

export function RightColumn() {
  const { chat, characters, connections, addParticipants, removeParticipant, setNarrator, patchRuntime, busy, openOverlay } = useApp()
  const [showPicker, setShowPicker] = useState(false)
  const [showNarratorPicker, setShowNarratorPicker] = useState(false)
  const [open, setOpen] = useState({ runtime: true, scenario: false, lorebooks: false })
  const toggle = (key: keyof typeof open) => setOpen((s) => ({ ...s, [key]: !s[key] }))

  if (!chat) {
    return (
      <aside className="column right">
        <div className="hint">Open a chat to adjust runtime options and participants.</div>
      </aside>
    )
  }

  const { chat: c, characters: active, lorebooks, scenario, narrator } = chat
  const llmConnections = connections.filter((x) => x.kind === 'llm')
  const ttsConnections = connections.filter((x) => x.kind === 'tts')
  const narrators = characters.filter((ch) => ch.kind === 'narrator')
  const inactive = characters.filter((ch) => !c.participantIds.includes(ch.id) && ch.kind === 'character')

  return (
    <aside className="column right">
      <Section title="Runtime" open={open.runtime} onToggle={() => toggle('runtime')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label>
            LLM connection
            <select
              value={c.runtime.llmConnectionId ?? ''}
              onChange={(e) => void patchRuntime({ llmConnectionId: e.target.value || null })}
            >
              <option value="">Use default</option>
              {llmConnections.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            TTS connection
            <select
              value={c.runtime.ttsConnectionId ?? ''}
              onChange={(e) => void patchRuntime({ ttsConnectionId: e.target.value || null })}
            >
              <option value="">Use default</option>
              {ttsConnections.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Instant replies (no thinking)
            <select
              value={c.runtime.disableThinking ? '1' : '0'}
              onChange={(e) => void patchRuntime({ disableThinking: e.target.value === '1' })}
            >
              <option value="1">On (fast)</option>
              <option value="0">Off</option>
            </select>
          </label>
          <label>
            Temperature: {c.runtime.temperature.toFixed(2)}
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={c.runtime.temperature}
              onChange={(e) => void patchRuntime({ temperature: Number(e.target.value) })}
            />
          </label>
          <label>
            Top P: {c.runtime.topP.toFixed(2)}
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={c.runtime.topP}
              onChange={(e) => void patchRuntime({ topP: Number(e.target.value) })}
            />
          </label>
          <label>
            Max tokens
            <input
              type="number"
              min={1}
              step={64}
              value={c.runtime.maxTokens}
              onChange={(e) => void patchRuntime({ maxTokens: Number(e.target.value) })}
            />
          </label>
        </div>
      </Section>

      <Section title="Scenario" open={open.scenario} onToggle={() => toggle('scenario')}>
        {scenario ? (
          <div className="card">
            <div className="card-head">
              <h4>{scenario.name}</h4>
            </div>
            <div className="desc">{scenario.description || scenario.scenario || scenario.first_mes}</div>
          </div>
        ) : (
          <div className="hint">No scenario attached.</div>
        )}
      </Section>

      <Section title="Lorebooks" open={open.lorebooks} onToggle={() => toggle('lorebooks')}>
        {lorebooks.length === 0 && <div className="hint">None attached.</div>}
        {lorebooks.map((b) => (
          <div key={b.id} className="tag" style={{ display: 'inline-block', margin: '0 4px 6px 0' }}>
            {b.name}
          </div>
        ))}
      </Section>

      <h3>Narrator</h3>
      {narrator ? (
        <div className="participant">
          {narrator.avatarPath ? <img src={narrator.avatarPath} alt="" /> : <div className="avatar" />}
          <span className="grow">{narrator.name}</span>
          <button
            className="icon"
            title="Remove narrator"
            disabled={busy}
            onClick={() => void setNarrator(null)}
          >
            ✕
          </button>
          {narrator.voiceSamplePath && (
            <audio src={narrator.voiceSamplePath} controls style={{ width: 40, height: 28, marginLeft: 6 }} />
          )}
        </div>
      ) : (
        <div className="hint">No narrator selected.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
        <button onClick={() => setShowNarratorPicker((s) => !s)}>
          {narrator ? 'Change narrator' : '＋ Choose narrator'}
        </button>
        {showNarratorPicker && (
          <div className="participant-pick">
            {narrators.map((n) => (
              <div
                key={n.id}
                className={`pick-item${c.narratorId === n.id ? ' selected' : ''}`}
                onClick={() => {
                  void setNarrator(n.id)
                  setShowNarratorPicker(false)
                }}
              >
                {n.avatarPath ? <img src={n.avatarPath} alt="" /> : <div className="avatar" />}
                <span className="grow">{n.name}</span>
                {n.voiceSamplePath && <span className="tag">🎤</span>}
              </div>
            ))}
            {narrators.length === 0 && (
              <div className="hint">
                No narrators yet.{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); setShowNarratorPicker(false); openOverlay('characters') }}>
                  Create one under Characters.
                </a>
              </div>
            )}
          </div>
        )}
      </div>

      <h3 style={{ marginTop: 20 }}>Participants</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {active.map((character) => (
          <div key={character.id} className="participant">
            {character.avatarPath ? <img src={character.avatarPath} alt="" /> : <div className="avatar" />}
            <span className="grow">{character.name}</span>
            <button
              className="icon"
              title="Remove from chat"
              disabled={busy}
              onClick={() => void removeParticipant(character.id)}
            >
              ✕
            </button>
          </div>
        ))}
        {c.removedParticipants.map((r) => (
          <div key={r.characterId} className="participant hidden">
            {r.avatarPath ? <img src={r.avatarPath} alt="" /> : <div className="avatar" />}
            <span className="grow">{r.name}</span>
            <span className="tag">removed</span>
          </div>
        ))}
        <button onClick={() => setShowPicker((s) => !s)}>＋ Add character</button>
      </div>

      {showPicker && (
        <div className="participant-pick" style={{ marginTop: 10 }}>
          {inactive.map((character) => (
            <div
              key={character.id}
              className="pick-item"
              onClick={() => {
                void addParticipants([character.id])
                setShowPicker(false)
              }}
            >
              {character.avatarPath ? <img src={character.avatarPath} alt="" /> : <div className="avatar" />}
              <span className="grow">{character.name}</span>
            </div>
          ))}
          {inactive.length === 0 && <div className="hint">All characters are already in this chat.</div>}
        </div>
      )}
    </aside>
  )
}