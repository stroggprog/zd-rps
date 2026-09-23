import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { api } from '../lib/api'
import { comboFromEvent, getSttHotkey } from '../lib/hotkey'

interface RecorderState {
  recording: boolean
  chunks: Blob[]
  media: MediaRecorder | null
}

function useRecorder() {
  const [state, setState] = useState<RecorderState>({ recording: false, chunks: [], media: null })

  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const media = new MediaRecorder(stream)
    const chunks: Blob[] = []
    media.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    media.start()
    setState({ recording: true, chunks, media })
  }

  const stop = (): Promise<Blob | null> => {
    const media = state.media
    if (!media) return Promise.resolve(null)
    return new Promise((resolve) => {
      media.onstop = () => {
        media.stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(state.chunks, { type: media.mimeType })
        setState({ recording: false, chunks: [], media: null })
        resolve(blob.size > 0 ? blob : null)
      }
      media.stop()
    })
  }

  return { recording: state.recording, start, stop }
}

export function BottomBar() {
  const { selectedChatId, connections, sending, sendMessage, openOverlay, deleteChat, selectChat, setError } = useApp()
  const [menuOpen, setMenuOpen] = useState(false)
  const [text, setText] = useState('')
  const [transcribing, setTranscribing] = useState(false)
  const recorder = useRecorder()

  const sttConfigured = connections.some((c) => c.kind === 'stt')

  const submit = async () => {
    const value = text.trim()
    if (!value) return
    setText('')
    await sendMessage(value)
  }

  const flushMic = async () => {
    if (!recorder.recording) return
    const blob = await recorder.stop()
    if (!blob) return
    setTranscribing(true)
    try {
      const file = new File([blob], 'recording.webm', { type: blob.type })
      const { text: transcript } = await api.audio.stt(file)
      if (transcript.trim()) await sendMessage(transcript)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setTranscribing(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        return
      }
      if (e.repeat) return
      // Toggle push-to-talk with the configurable STT hotkey (default Ctrl+M).
      if (e.ctrlKey || e.altKey || e.metaKey) {
        const active = comboFromEvent(e)
        if (active && active === getSttHotkey() && sttConfigured && !transcribing) {
          e.preventDefault()
          if (recorder.recording) void flushMic()
          else void recorder.start().catch((err) => setError((err as Error).message))
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const startNewChat = () => {
    setMenuOpen(false)
    openOverlay('new-chat')
  }

  const closeCurrent = () => {
    setMenuOpen(false)
    void selectChat(null)
  }

  const deleteCurrent = async () => {
    setMenuOpen(false)
    if (!selectedChatId) return
    if (!window.confirm('Delete the current chat?')) return
    await deleteChat(selectedChatId)
  }

  return (
    <footer className="bottombar">
      {menuOpen && (
        <div className="menu-pop">
          <button onClick={startNewChat}>Start New Chat</button>
          <button onClick={closeCurrent} disabled={!selectedChatId}>
            Close Current Chat
          </button>
          <button onClick={deleteCurrent} disabled={!selectedChatId} className="danger">
            Delete Current Chat
          </button>
        </div>
      )}
      <button aria-label="Menu" onClick={() => setMenuOpen((m) => !m)}>
        ☰
      </button>
      <button
        aria-label="Toggle microphone"
        className={recorder.recording ? 'primary' : 'icon'}
        disabled={!sttConfigured}
        title={sttConfigured ? (recorder.recording ? 'Stop and transcribe' : 'Start microphone') : 'No STT engine configured'}
        onClick={() => {
          if (recorder.recording) void flushMic()
          else void recorder.start().catch((e) => setError((e as Error).message))
        }}
      >
        {recorder.recording ? <span className="mic-live">●</span> : '🎙'}
      </button>
      {recorder.recording && <span className="hint">Recording… stop to transcribe and send</span>}
      {transcribing && <span className="spinner">Transcribing…</span>}
      <input
        className="chat-input"
        placeholder={
          !sttConfigured
            ? 'Connect an STT engine in Configuration to enable the microphone'
            : selectedChatId
              ? 'Type a message…'
              : 'Select a chat to start messaging'
        }
        value={text}
        disabled={!selectedChatId}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
        }}
      />
      <button className="primary" disabled={!selectedChatId || sending || !text.trim()} onClick={() => void submit()}>
        {sending ? '…' : 'Send'}
      </button>
    </footer>
  )
}