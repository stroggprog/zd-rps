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

  return (
    <aside className="column left">
      <h3>Images</h3>
      {image && (
        <div className="image-viewer">
          <img className="main" src={image} alt="Clicked image" />
          {viewerImages.length > 1 && (
            <div className="row">
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
      {!image && <div className="hint">Click any image inside a chat message to view it here.</div>}
      <h3 style={{ marginTop: 24 }}>Chats</h3>
      <div className="pick-list">
        {chats.map((c) => (
          <div
            key={c.id}
            className={`pick-item${c.id === selectedChatId ? ' selected' : ''}`}
            onClick={() => void selectChat(c.id)}
          >
            {c.avatarPaths[0] ? <img src={c.avatarPaths[0]} alt="" /> : <div className="avatar" />}
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
    </aside>
  )
}