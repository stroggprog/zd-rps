import { useEffect, useRef } from 'react'
import { useApp, enqueueAudio } from '../store'
import { api } from '../lib/api'
import type { ChatMessage } from '../lib/types'

async function speakViaApi(message: ChatMessage) {
  const { audioPath } = await api.audio.ttsText(
    message.content,
    message.speaker.characterId ?? undefined,
  )
  enqueueAudio(audioPath)
}

export function CenterColumn() {
  const { chat, sending, setViewer } = useApp()
  const scrollRef = useRef<HTMLDivElement>(null)

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

  return (
    <main className="column center">
      <div className="messages" ref={scrollRef}>
        {messages.map((message) => {
          const isUser = message.speaker.characterId === null
          return (
            <div key={message.id} className={`message${isUser ? ' user' : ''}`}>
              {message.speaker.avatarPath ? (
                <img className="avatar" src={message.speaker.avatarPath} alt={message.speaker.name} />
              ) : (
                <div className="avatar">{isUser ? 'You' : message.speaker.name.slice(0, 1)}</div>
              )}
              <div>
                <div className="meta">{message.speaker.name}{isUser && ' · you'}</div>
                <div className="bubble">
                  {message.content}
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
                {!isUser && message.audio.length > 0 && (
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
                {!isUser && (
                  <div className="actions">
                    <button className="icon" title={message.audioPath ? 'Play audio' : 'Speak'} onClick={() => play(message)}>
                      {message.audioPath ? '▶' : '🔊'}
                    </button>
                  </div>
                )}
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