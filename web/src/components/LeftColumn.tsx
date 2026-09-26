import { useEffect, useState } from 'react'
import { bustAvatar } from '../lib/api'
import { useApp } from '../store'

export function LeftColumn() {
  const { viewerImages, viewerIndex, setViewer, chats, selectedChatId, selectChat, deleteChat, setError } = useApp()

  const removeChat = async (id: string) => {
    if (!window.confirm('Delete this chat?')) return
    try {
      await deleteChat(id)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const image = viewerIndex >= 0 ? viewerImages[viewerIndex] : null

  const [chatsOpen, setChatsOpen] = useState(true)
  // A chat starting/resuming collapses the list to free space.
  useEffect(() => {
    if (selectedChatId) setChatsOpen(false)
  }, [selectedChatId])

  return (
    <aside className="column left">
      <h3
        style={{ cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center' }}
        onClick={() => setChatsOpen((o) => !o)}
        title={chatsOpen ? 'Roll chats up' : 'Show chats'}
      >
        {chatsOpen ? '▾' : '▸'} Chats
      </h3>
      {chatsOpen && (
      <div className="pick-list">
        {chats.map((c) => (
          <div
            key={c.id}
            className={`pick-item${c.id === selectedChatId ? ' selected' : ''}`}
            onClick={() => void selectChat(c.id)}
          >
            {c.avatarPaths[0] ? <img src={bustAvatar(c.avatarPaths[0], c.updated) ?? ''} alt="" /> : <div className="avatar" />}
            <div className="grow">
              <div>{c.title}</div>
              <div className="hint" style={{ padding: 0 }}>
                {c.messageCount} msg · {c.participantCount} participant{c.participantCount === 1 ? '' : 's'}
              </div>
            </div>
            <button
              className="danger chat-delete"
              title="Delete chat"
              onClick={(e) => {
                e.stopPropagation()
                void removeChat(c.id)
              }}
            >
              ✕
            </button>
          </div>
        ))}
        {chats.length === 0 && <div className="hint">No chats yet. Use the ☰ menu to start one.</div>}
      </div>
      )}
      <div className="images-block">
        <h3>Images</h3>
      {image && (
        <div className="image-viewer">
          <img
            className="main"
            src={image}
            alt="Clicked image"
            title="Click to open at full size in a new window"
            style={{ cursor: 'zoom-in' }}
            onClick={() => {
              const win = window.open(image, '_blank')
              if (!win) setError('The browser blocked the pop-up window. Allow pop-ups and try again.')
            }}
          />
          {viewerImages.length > 1 && (
            <div className="row">
              <button
                title="Open at full size (in a new window)"
                onClick={() => {
                  const win = window.open(image, '_blank')
                  if (!win) setError('The browser blocked the pop-up window. Allow pop-ups and try again.')
                }}
              >
                ⤢
              </button>
              <button
                disabled={viewerIndex <= 0}
                onClick={() => setViewer(viewerImages, viewerIndex - 1)}
              >
                ◀
              </button>
              <span className="hint">
                {viewerIndex + 1} / {viewerImages.length}
              </span>
              <button
                disabled={viewerIndex >= viewerImages.length - 1}
                onClick={() => setViewer(viewerImages, viewerIndex + 1)}
              >
                ▶
              </button>
            </div>
          )}
          {viewerImages.length > 1 && (
            <div className="image-thumbs">
              {viewerImages.map((src, i) => (
                <img key={src + i} src={src} onClick={() => setViewer(viewerImages, i)} alt="" />
              ))}
            </div>
          )}
        </div>
      )}
      {!image && <div className="hint">Click any image or character avatar in a chat message to view it here.</div>}
      </div>
    </aside>
  )
}