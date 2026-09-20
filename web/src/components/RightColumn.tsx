import { useState } from 'react'
import { useApp } from '../store'

export function RightColumn() {
  const { chat, characters, connections, addParticipants, removeParticipant, patchRuntime, busy } = useApp()
  const [showPicker, setShowPicker] = useState(false)

  if (!chat) {
    return (
      <aside className="column right">
        <div className="hint">Open a chat to adjust runtime options and participants.</div>
      </aside>
    )
  }

  const { chat: c, characters: active, lorebooks, scenario } = chat
  const llmConnections = connections.filter((x) => x.kind === 'llm')
  const ttsConnections = connections.filter((x) => x.kind === 'tts')
  const inactive = characters.filter((ch) => !c.participantIds.includes(ch.id))

  return (
    <aside className="column right">
      <h3>Runtime</h3>
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

      <h3 style={{ marginTop: 20 }}>Scenario</h3>
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

      <h3 style={{ marginTop: 20 }}>Lorebooks</h3>
      {lorebooks.length === 0 && <div className="hint">None attached.</div>}
      {lorebooks.map((b) => (
        <div key={b.id} className="tag" style={{ display: 'inline-block', margin: '0 4px 6px 0' }}>
          {b.name}
        </div>
      ))}

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