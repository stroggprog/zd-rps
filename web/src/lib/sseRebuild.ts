import type { Chat, MessageAudio } from './types'

/** Reads an SSE stream; `dispatch(raw)` returns an Error to abort. */
async function readSse(res: Response, dispatch: (raw: string) => Error | null): Promise<Error | null> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const err = dispatch(buf.slice(0, idx))
        buf = buf.slice(idx + 2)
        if (err) return err
      }
    }
    if (buf.trim()) return dispatch(buf)
  } catch (e) {
    return e as Error
  } finally {
    reader.cancel().catch(() => {})
  }
  return null
}

function parseEvent(
  raw: string,
): { event: string; data: unknown } | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (dataLines.length === 0) return null
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) }
  } catch {
    return null
  }
}

export interface RebuildHandlers {
  onAudio?: (messageId: string | null, clip: MessageAudio) => void
  onDone?: (chat: Chat) => void
}

/** Rebuild a message's audio clips (SSE: an `audio` event per finished clip, then `done`). */
export async function rebuildMessageAudioSse(
  id: string,
  messageId: string,
  handlers: RebuildHandlers,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    void (async () => {
      let res: Response
      try {
        res = await fetch(`/api/chats/${id}/messages/${messageId}/rebuild-audio`, { method: 'POST' })
      } catch (e) {
        reject(e as Error)
        return
      }
      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => '')
        let message = body
        try {
          message = (JSON.parse(body) as { error?: string }).error ?? body
        } catch {
          /* keep raw body */
        }
        reject(new Error(message || `HTTP ${res.status}`))
        return
      }
      const err = await readSse(res, (raw) => {
        const ev = parseEvent(raw)
        if (!ev) return null
        if (ev.event === 'audio') {
          const d = ev.data as MessageAudio & { messageId?: string | null }
          if (d && d.path) handlers.onAudio?.(d.messageId ?? null, d)
          return null
        }
        if (ev.event === 'done') {
          const d = ev.data as { chat?: Chat }
          if (d.chat) handlers.onDone?.(d.chat)
          return null
        }
        if (ev.event === 'error') {
          const d = ev.data as { message?: string }
          return new Error(d.message || 'Rebuild failed')
        }
        return null
      })
      if (err) reject(err)
      else resolve()
    })()
  })
}
