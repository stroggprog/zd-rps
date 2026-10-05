import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useApp, enqueueAudio } from '../store'
import { bustAvatar } from '../lib/api'
import { api } from '../lib/api'
import type { ChatMessage } from '../lib/types'

function renderPersonaContent(content: string): ReactNode[] {
  // Persona bubbles: *inner dialogue* renders as emphasis, asterisks stripped.
  const parts = content.split(/(\*[^*\n]+\*)/g)
  return parts.map((part, i) => {
    const m = /^\*([^*\n]+)\*$/.exec(part)
    if (m) return <em key={i}>{m[1]}</em>
    return <span key={i}>{part}</span>
  })
}

async function speakViaApi(message: ChatMessage) {
  const { audioPath } = await api.audio.ttsText(
    message.content,
    message.speaker.characterId ?? undefined,
  )
  enqueueAudio(audioPath)
}

export function CenterColumn() {
  const { chat, sending, setViewer, updateMessage, removeMessage, rebuildMessageAudio, refreshChat, setError } = useApp()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat?.chat.messages.length])

  if (!chat) {
    return (
      <main className="column center">
        <div className="hint">
          Select a chat from the left column, or press ☰ → Start New Chat to begin.
        </div>
      </main>
    )
  }

  const messages = chat.chat.messages

  const play = (message: ChatMessage) => {
    if (message.audio.length > 0) {
      for (const clip of message.audio) enqueueAudio(clip.path)
    } else if (message.audioPath) {
      enqueueAudio(message.audioPath)
    } else {
      void speakViaApi(message)
    }
  }

  const downloadBubbleAudio = async (message: ChatMessage) => {
    try {
      const { blob, filename } = await api.chats.bubbleAudioDownload(chat!.chat.id, message.id)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const deleteMessage = async (id: string) => {
    if (!window.confirm('Delete this message? It will be removed from the LLM context as well.')) return
    await removeMessage(id)
  }

  const saveEdit = async (id: string) => {
    const content = editDraft.trim()
    setEditingId(null)
    if (content && content !== messages.find((m) => m.id === id)?.content) {
      await updateMessage(id, content)
    } else {
      await refreshChat()
    }
  }

  return (
    <main className="column center">
      <div className="messages" ref={scrollRef}>
        {messages.map((message) => {
          const isUser = message.role === 'user'
          return (
            <div key={message.id} className={`message${isUser ? ' user' : ''}`}>
              {message.speaker.avatarPath ? (
                <img
                  className="avatar"
                  src={bustAvatar(message.speaker.avatarPath) ?? undefined}
                  alt={message.speaker.name}
                  title="View avatar"
                  style={{ cursor: 'zoom-in' }}
                  onClick={() => setViewer([message.speaker.avatarPath as string], 0)}
                />
              ) : (
                <div className="avatar">{isUser ? 'You' : message.speaker.name.slice(0, 1)}</div>
              )}
              <div>
                <div className="meta">{message.speaker.name}{isUser && ' · you'}</div>
                {editingId === message.id ? (
                  <div className="bubble">
                    <textarea
                      rows={6}
                      style={{ width: '100%', background: 'transparent', color: 'inherit', border: '1px solid var(--border)' }}
                      value={editDraft}
                      autoFocus
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void saveEdit(message.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                    />
                    <div className="row" style={{ marginTop: 6 }}>
                      <button className="primary" onClick={() => void saveEdit(message.id)}>Save</button>
                      <button onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="bubble">
                    {renderPersonaContent(message.content)}
                    {message.images.map((src) => (
                      <img
                        key={src}
                        className="msg-image"
                        src={src}
                        alt="Attachment"
                        onClick={() => setViewer(message.images, message.images.indexOf(src))}
                      />
                    ))}
                  </div>
                )}
                {message.audio.length > 0 && (
                  <div className="chips">
                    {message.audio.map((clip, i) => (
                      <button
                        key={clip.id}
                        className="chip"
                        title={clip.text}
                        aria-label={`Play audio clip ${i + 1}`}
                        onClick={() => enqueueAudio(clip.path)}
                      >
                        <span className="chip-icon" aria-hidden>🔊</span>
                        <span>{i + 1}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="actions">
                  <button className="icon" title="Edit message" onClick={() => { setEditingId(message.id); setEditDraft(message.content) }}>
                    ✎
                  </button>
                  <button className="icon" title="Delete message" onClick={() => void deleteMessage(message.id)}>
                    🗑
                  </button>
                  <button className="icon" title="Rebuild audio for this message" onClick={() => void rebuildMessageAudio(message.id)}>
                    ♻
                  </button>
                  {!isUser && (
                    <button className="icon" title={message.audioPath ? 'Play audio' : 'Speak'} onClick={() => play(message)}>
                      {message.audioPath ? '▶' : '🔊'}
                    </button>
                  )}
                  {message.audio.length > 0 && (
                    <button
                      className="icon"
                      title="Download this message's audio as one file"
                      onClick={() => void downloadBubbleAudio(message)}
                    >
                      🎧
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
        {messages.length === 0 && (
          <div className="hint">
            No messages yet. Send the opening line below, or pick a scenario on the right.
          </div>
        )}
        {sending && <div className="spinner">Thinking…</div>}
      </div>
    </main>
  )
}