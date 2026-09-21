import { useApp } from '../store'

export function TopBar() {
  const { openOverlay, chat, chats, audioEnabled, setAudioEnabled } = useApp()
  return (
    <header className="topbar">
      <span className="title">zd-rps</span>
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
      <button onClick={() => openOverlay('lorebooks')}>Lorebooks</button>
      <button onClick={() => openOverlay('scenarios')}>Scenarios</button>
    </header>
  )
}