import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ReplyMode } from '../lib/types'
import { useApp } from '../store'
import { api, bustAvatar } from '../lib/api'

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
  const { chat, characters, connections, narrators, stories, replyMode, replySelectedIds, setReplyMode, setReplySelectedIds, refreshChat, setError, addParticipants, removeParticipant, setNarrator, patchRuntime, busy, openOverlay } = useApp()
  const [showPicker, setShowPicker] = useState(false)
  const [showNarratorPicker, setShowNarratorPicker] = useState(false)
  const [showStorySave, setShowStorySave] = useState(false)
  const [savingStory, setSavingStory] = useState(false)
  const [saveStoryTarget, setSaveStoryTarget] = useState('__new__')
  const [newStoryName, setNewStoryName] = useState('')
  const [open, setOpen] = useState({ runtime: false, scenario: false, lorebooks: false, story: false, replies: false })
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
  const inactive = characters.filter((ch) => !c.participantIds.includes(ch.id))

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
            Dialogue only (no narrative)
            <select
              value={c.runtime.dialogueOnly ? '1' : '0'}
              onChange={(e) => void patchRuntime({ dialogueOnly: e.target.value === '1' })}
            >
              <option value="0">Off (speech + narrative)</option>
              <option value="1">On (spoken lines only)</option>
            </select>
          </label>
          <label>
            Sequential turns (one reply per character)
            <select
              value={c.runtime.sequentialTurns ? '1' : '0'}
              onChange={(e) => void patchRuntime({ sequentialTurns: e.target.value === '1' })}
            >
              <option value="1">On</option>
              <option value="0">Off</option>
            </select>
            <span className="hint" style={{ padding: 0 }}>
              Ask the LLM once per participant so labels never bleed between speakers.
            </span>
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
            Max tokens (returned)
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

      <Section title="Replies" open={open.replies ?? false} onToggle={() => toggle('replies')}>
        <label>
          Who responds
          <select value={replyMode} onChange={(e) => setReplyMode(e.target.value as ReplyMode)}>
            <option value="all">All characters respond</option>
            <option value="selected">Selected characters respond</option>
            <option value="llm">LLM decides (per message)</option>
          </select>
        </label>
        {replyMode === 'selected' && (
          <div className="participant-pick" style={{ marginTop: 8 }}>
            {(chat?.characters ?? []).map((character) => (
              <div
                key={character.id}
                className={`pick-item${replySelectedIds.includes(character.id) ? ' selected' : ''}`}
                onClick={() =>
                  setReplySelectedIds(
                    replySelectedIds.includes(character.id)
                      ? replySelectedIds.filter((id) => id !== character.id)
                      : [...replySelectedIds, character.id],
                  )
                }
              >
                {character.avatarPath ? <img src={bustAvatar(character.avatarPath, character.updated) ?? ''} alt="" /> : <div className="avatar" />}
                <span className="grow">{character.name}</span>
                {replySelectedIds.includes(character.id) && <span className="tag">✓</span>}
              </div>
            ))}
            {(chat?.characters ?? []).length === 0 && <div className="hint">Select a chat first.</div>}
            {replySelectedIds.length === 0 && (chat?.characters ?? []).length > 0 && (
              <div className="hint">No characters selected — all would reply.</div>
            )}
          </div>
        )}
        {replyMode === 'llm' && (
          <span className="hint" style={{ padding: 0 }}>
            One quick call to the LLM picks which character(s) reply to each message.
          </span>
        )}
      </Section>

      <Section title="Story" open={open.scenario === undefined ? false : open.story ?? false} onToggle={() => toggle('story')}>
        {(() => {
          const story = chat?.persona ?? null;
          void story;
          return null;
        })()}
        <div className="row">
          <button className="primary" disabled={busy || !chat} onClick={() => setShowStorySave((v) => !v)}>
            💾 Save story
          </button>
          {chat.chat.storyId && (
            <span className="tag">
              {stories.find((st) => st.id === chat.chat.storyId)?.name ?? 'Story saved'}
            </span>
          )}
        </div>
        {showStorySave && (
          <div className="field">
            <label>Save into</label>
            <select value={saveStoryTarget} onChange={(e) => setSaveStoryTarget(e.target.value)}>
              {stories.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name} (evolve)
                </option>
              ))}
              <option value="__new__">New story…</option>
            </select>
            {saveStoryTarget === '__new__' && (
              <input
                style={{ marginTop: 6 }}
                value={newStoryName}
                placeholder={`Name (default: ${chat.chat.title})`}
                onChange={(e) => setNewStoryName(e.target.value)}
              />
            )}
            <button
              className="primary"
              style={{ marginTop: 6 }}
              disabled={busy || savingStory}
              onClick={() => {
                const isExisting = saveStoryTarget !== '__new__'
                void (async () => {
                  setSavingStory(true)
                  try {
                    await api.chats.saveStory(chat.chat.id, {
                      storyId: isExisting ? saveStoryTarget : null,
                      name: isExisting ? undefined : newStoryName || undefined,
                    })
                    setShowStorySave(false)
                    await refreshChat()
                    setError(null)
                  } catch (err) {
                    setError((err as Error).message)
                  } finally {
                    setSavingStory(false)
                  }
                })()
              }}
            >
              {savingStory ? 'Saving…' : 'Generate summary & save'}
            </button>
          </div>
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
          {narrator.avatarPath ? <img src={bustAvatar(narrator.avatarPath, narrator.updated) ?? ''} alt="" /> : <div className="avatar" />}
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
            <audio src={`${narrator.voiceSamplePath}?v=${narrator.updated}`} controls style={{ width: 40, height: 28, marginLeft: 6 }} />
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
                {n.avatarPath ? <img src={bustAvatar(n.avatarPath, n.updated) ?? ''} alt="" /> : <div className="avatar" />}
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
            {character.avatarPath ? <img src={bustAvatar(character.avatarPath, character.updated) ?? ''} alt="" /> : <div className="avatar" />}
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
            <button
              className="icon"
              title="Return to chat"
              disabled={busy}
              onClick={() => void addParticipants([r.characterId])}
            >
              ＋
            </button>
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
              {character.avatarPath ? <img src={bustAvatar(character.avatarPath, character.updated) ?? ''} alt="" /> : <div className="avatar" />}
              <span className="grow">{character.name}</span>
            </div>
          ))}
          {inactive.length === 0 && <div className="hint">All characters are already in this chat.</div>}
        </div>
      )}
    </aside>
  )
}