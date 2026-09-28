import { useState } from 'react'
import { useApp } from '../store'
import { api } from '../lib/api'

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function chatToHtml(title: string, detail: Awaited<ReturnType<typeof api.chats.get>>): string {
  const { chat, characters, narrator, persona } = detail
  const nameById = new Map(characters.map((c) => [c.id, c.name]))
  const who = (m: { role: string; speaker: { name: string } }) => {
    if (m.role === 'user') return persona?.name ?? 'User'
    return m.speaker.name
  }
  const msgs = chat.messages
    .map(
      (m) =>
        `<div class="msg${m.role === 'user' ? ' user' : ''}"><div class="who">${escapeHtml(who(m))}</div>` +
        `<div class="text">${escapeHtml(m.content)}</div></div>`,
    )
    .join('\n')
  const participants = chat.participantIds
    .map((id) => nameById.get(id) ?? '(removed)')
    .join(', ')
  const meta: string[] = []
  if (participants) meta.push(`Characters: ${escapeHtml(participants)}`)
  if (persona) meta.push(`Persona: ${escapeHtml(persona.name)}`)
  if (narrator) meta.push(`Narrator: ${escapeHtml(narrator.name)}`)
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    html { background: #fff; }
    body { font-family: Georgia, serif; background: #fff; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 32px auto; max-width: 760px; line-height: 1.5; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .meta { color: #555; font-size: 13px; margin-bottom: 24px; }
    .msg { margin: 0 0 20px; break-inside: avoid; }
    .msg.user { }
    .who { font-weight: bold; font-size: 12px; color: #444; margin-bottom: 3px; }
    .text { white-space: pre-wrap; }
    hr { border: none; border-top: 1px solid #ddd; margin: 24px 0; }
  </style></head><body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">${meta.map((m) => `<div>${m}</div>`).join('')}${chat.created ? `<div>${escapeHtml(new Date(chat.created).toLocaleString())}</div>` : ''}</div>
  ${msgs}
  <script>window.onload = () => { window.print() }</script>
  </body></html>`
}

export function PrintChat() {
  const { chats, closeOverlay, setError } = useApp()
  const [wantTranscript, setWantTranscript] = useState(true)
  const [wantAudiobook, setWantAudiobook] = useState(false)
  const [rendering, setRendering] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const selectChatPrint = async (
    id: string,
    title: string,
    doTranscript: boolean,
    doAudiobook: boolean,
  ) => {
    if (doAudiobook) {
      setError(null)
      setRendering(title)
      setProgress({ done: 0, total: 0 })
      const poll = window.setInterval(() => {
        void api.chats.audiobookStatus(id).then((st) => {
          if (st.running && st.done !== undefined && st.total !== undefined) {
            setProgress({ done: st.done, total: st.total })
          }
        })
      }, 1000)
      try {
        const r = await api.chats.audiobook(id)
        setProgress(null)
        window.open(r.audio, '_blank')
        if (doTranscript) await print(id, title)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        window.clearInterval(poll)
        setRendering(null)
        setProgress(null)
      }
      return
    }
    await print(id, title)
  }

  const print = async (id: string, title: string) => {
    setRendering(title)
    setError(null)
    try {
      const detail = await api.chats.get(id)
      const html = chatToHtml(title, detail)
      const win = window.open('', '_blank')
      if (!win) {
        setError('The browser blocked the print window. Allow pop-ups for this site and try again.')
        return
      }
      win.document.open()
      win.document.write(html)
      win.document.close()
      win.focus()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRendering(null)
    }
  }

  const list = chats.filter((c) => c.title.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="overlay-wrap">
      <div className="overlay-head">
        <h2>Print chat</h2>
        <button onClick={closeOverlay}>✕ Close</button>
      </div>
      <div className="overlay-body">
        <div className="field" style={{ maxWidth: 400 }}>
          <label>Search chats</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by title…" />
        </div>
        <div className="row" style={{ marginBottom: 8 }}>
          <label className="row" style={{ gap: 4 }}>
            <input
              type="checkbox"
              checked={wantTranscript}
              onChange={(e) => setWantTranscript(e.target.checked)}
            />
            Transcript (print to PDF)
          </label>
          <label className="row" style={{ gap: 4 }}>
            <input
              type="checkbox"
              checked={wantAudiobook}
              onChange={(e) => setWantAudiobook(e.target.checked)}
            />
            Audio book (m3u + mp3)
          </label>
        </div>
        <div className="pick-list" style={{ marginTop: 12 }}>
          {list.map((c) => (
            <div
              key={c.id}
              className="pick-item"
              onClick={() =>
                void selectChatPrint(c.id, c.title, wantTranscript, wantAudiobook)
              }
            >
              {c.avatarPaths[0] ? <img src={c.avatarPaths[0]} alt="" /> : <div className="avatar" />}
              <span className="grow">
                {c.title}
                {rendering === c.title && progress && progress.total > 0 && (
                  <span className="tag" style={{ marginLeft: 6 }}>
                    {Math.round((progress.done / progress.total) * 100)}%
                  </span>
                )}
              </span>
              {rendering === c.title && progress?.total === 0 && <span className="tag">…</span>}
              {rendering === c.title && !progress && <span className="tag">…</span>}
            </div>
          ))}
          {list.length === 0 && <div className="hint">No chats match.</div>}
        </div>
        <div className="hint" style={{ marginTop: 12 }}>
          The chat opens in a printable window — choose “Save as PDF” in your browser's print dialog.
        </div>
      </div>
    </div>
  )
}
