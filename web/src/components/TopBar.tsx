import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useApp } from '../store'
import type { VersionCheck } from '../lib/api'

export function TopBar() {
  const [version, setVersion] = useState<VersionCheck | null>(null)

  useEffect(() => {
    void api.version?.().then((v) => {
      if (v.updateAvailable) setVersion(v)
    })
  }, [])
  const { openOverlay, chat, chats, audioEnabled, setAudioEnabled } = useApp()
  return (
    <header className="topbar">
      <span className="title">zd-rps</span>
      {version?.updateAvailable && (
        <a
          href="https://nas3:3000/phil/zd-rps"
          target="_blank"
          rel="noreferrer"
          className="tag"
          title={`Update available: ${version.latest?.slice(0, 7)}`}
        >
          ⟳ Update available
        </a>
      )}
      <span className="chat-title">
        {chat ? chat.chat.title : chats.length > 0 ? 'Pick a chat' : 'No chat yet'}
      </span>
      <div className="grow" />
      <button
        className={audioEnabled ? 'toggle on' : 'toggle'}
        title={audioEnabled ? 'Audio on: replies are spoken aloud' : 'Audio off: click 🔊 under a message to speak it'}
        onClick={() => setAudioEnabled(!audioEnabled)}
      >
        Audio {audioEnabled ? 'On' : 'Off'}
      </button>
      <button onClick={() => openOverlay('config')}>Configuration</button>
      <button onClick={() => openOverlay('characters')}>Characters</button>
      <button onClick={() => openOverlay('narrators')}>Narrators</button>
      <button onClick={() => openOverlay('personas')}>Personas</button>
      <button onClick={() => openOverlay('groups')}>Groups</button>
      <button onClick={() => openOverlay('stories')}>Stories</button>
      <button onClick={() => openOverlay('lorebooks')}>Lorebooks</button>
      <button onClick={() => openOverlay('scenarios')}>Scenarios</button>
      <button onClick={() => openOverlay('print')}>Print</button>
    </header>
  )
}