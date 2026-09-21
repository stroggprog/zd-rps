import type {
  Character,
  Chat,
  ChatDetail,
  ChatSummary,
  Connection,
  ImportDraft,
  Lorebook,
  MessageAudio,
  Narrator,
  ProviderInfo,
  Scenario,
  TestResult,
} from './types'

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let message = body
    try {
      message = JSON.parse(body).error ?? body
    } catch {
      /* keep raw body */
    }
    throw new Error(message || `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export const api = {
  providers: () => http<ProviderInfo[]>('/api/providers'),

  connections: {
    list: () => http<Connection[]>('/api/connections'),
    create: (c: Partial<Connection>) =>
      http<Connection>('/api/connections', jsonInit('POST', c)),
    update: (id: string, c: Partial<Connection>) =>
      http<Connection>(`/api/connections/${id}`, jsonInit('PUT', c)),
    remove: (id: string) => http<void>(`/api/connections/${id}`, { method: 'DELETE' }),
    test: (id: string) =>
      http<TestResult>(`/api/connections/${id}/test`, { method: 'POST' }),
    defaults: () =>
      http<{ defaultLlm: string | null; defaultStt: string | null; defaultTts: string | null }>(
        '/api/connections/defaults',
      ),
    setDefault: (kind: 'llm' | 'stt' | 'tts', connectionId: string | null) =>
      http<Record<string, string | null>>(
        '/api/connections/defaults',
        jsonInit('POST', { kind, connectionId }),
      ),
  },

  characters: {
    list: () => http<Character[]>('/api/characters'),
    create: (c: Partial<Character>) => http<Character>('/api/characters', jsonInit('POST', c)),
    update: (id: string, c: Partial<Character>) =>
      http<Character>(`/api/characters/${id}`, jsonInit('PUT', c)),
    remove: (id: string) => http<void>(`/api/characters/${id}`, { method: 'DELETE' }),
    import: (file: File) => {
      const form = new FormData()
      form.append('card', file)
      return http<ImportDraft>('/api/characters/import', { method: 'POST', body: form })
    },
    finalize: (payload: {
      importId: string
      name: string
      acceptLorebook: boolean
      acceptScenario: boolean
    }) => http<{ character: Character }>(`/api/characters/finalize`, jsonInit('POST', payload)),
    uploadAvatar: (id: string, file: File) => {
      const form = new FormData()
      form.append('avatar', file)
      return http<Character>(`/api/characters/${id}/avatar`, { method: 'POST', body: form })
    },
    uploadVoice: (id: string, file: File, transcript: string) => {
      const form = new FormData()
      form.append('sample', file)
      form.append('transcript', transcript)
      return http<Character>(`/api/characters/${id}/voice`, { method: 'POST', body: form })
    },
    removeVoice: (id: string) =>
      http<Character>(`/api/characters/${id}/voice`, { method: 'DELETE' }),
    exportUrl: (id: string) => `/api/characters/${id}/export`,
  },

  narrators: {
    list: () => http<Narrator[]>('/api/narrators'),
    create: (n: Partial<Narrator>) => http<Narrator>('/api/narrators', jsonInit('POST', n)),
    update: (id: string, n: Partial<Narrator>) =>
      http<Narrator>(`/api/narrators/${id}`, jsonInit('PUT', n)),
    remove: (id: string) => http<void>(`/api/narrators/${id}`, { method: 'DELETE' }),
    uploadAvatar: (id: string, file: File) => {
      const form = new FormData()
      form.append('avatar', file)
      return http<Narrator>(`/api/narrators/${id}/avatar`, { method: 'POST', body: form })
    },
    removeAvatar: (id: string) => http<Narrator>(`/api/narrators/${id}/avatar`, { method: 'DELETE' }),
    uploadVoice: (id: string, file: File, transcript: string) => {
      const form = new FormData()
      form.append('sample', file)
      form.append('transcript', transcript)
      return http<Narrator>(`/api/narrators/${id}/voice`, { method: 'POST', body: form })
    },
    removeVoice: (id: string) => http<Narrator>(`/api/narrators/${id}/voice`, { method: 'DELETE' }),
  },

  lorebooks: {
    list: () => http<Lorebook[]>('/api/lorebooks'),
    create: (l: Partial<Lorebook>) => http<Lorebook>('/api/lorebooks', jsonInit('POST', l)),
    update: (id: string, l: Partial<Lorebook>) =>
      http<Lorebook>(`/api/lorebooks/${id}`, jsonInit('PUT', l)),
    remove: (id: string) => http<void>(`/api/lorebooks/${id}`, { method: 'DELETE' }),
  },

  scenarios: {
    list: () => http<Scenario[]>('/api/scenarios'),
    create: (s: Partial<Scenario>) => http<Scenario>('/api/scenarios', jsonInit('POST', s)),
    update: (id: string, s: Partial<Scenario>) =>
      http<Scenario>(`/api/scenarios/${id}`, jsonInit('PUT', s)),
    remove: (id: string) => http<void>(`/api/scenarios/${id}`, { method: 'DELETE' }),
  },

  chats: {
    list: () => http<ChatSummary[]>('/api/chats'),
    get: (id: string) => http<ChatDetail>(`/api/chats/${id}`),
    create: (payload: {
      title?: string
      participantIds: string[]
      lorebookIds: string[]
      scenarioId: string | null
      narratorId?: string | null
    }) => http<Chat>('/api/chats', jsonInit('POST', payload)),
    remove: (id: string) => http<void>(`/api/chats/${id}`, { method: 'DELETE' }),
    patch: (id: string, payload: Partial<Chat>) =>
      http<Chat>(`/api/chats/${id}`, jsonInit('PATCH', payload)),
    participants: (id: string, payload: { add?: string[]; remove?: string[] }) =>
      http<Chat>(`/api/chats/${id}/participants`, jsonInit('POST', payload)),
    messageStream: (id: string, content: string, audioEnabled: boolean, handlers: MessageStreamHandlers) =>
      sseMessage(id, content, audioEnabled, handlers),
  },

  audio: {
    stt: (file: File) => {
      const form = new FormData()
      form.append('audio', file)
      return http<{ text: string }>('/api/audio/stt', { method: 'POST', body: form })
    },
    ttsText: (text: string, characterId?: string, connectionId?: string) =>
      http<{ audioPath: string }>(
        '/api/audio/tts',
        jsonInit('POST', { text, characterId, connectionId }),
      ),
  },
}

export interface MessageStreamHandlers {
  onSpeaker?: (name: string, characterId: string | null) => void
  onSentence?: (sentence: string, isSpeech: boolean) => void
  onAudio?: (clip: MessageAudio) => void
  onDone?: (chat: Chat) => void
}

function sseMessage(
  id: string,
  content: string,
  audioEnabled: boolean,
  handlers: MessageStreamHandlers,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    void (async () => {
      let res: Response
      try {
        res = await fetch(`/api/chats/${id}/messages`, jsonInit('POST', { content, audioEnabled }))
      } catch (e) {
        reject(e as Error)
        return
      }
      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => '')
        let message = body
        try {
          message = JSON.parse(body).error ?? body
        } catch {
          /* keep raw body */
        }
        reject(new Error(message || `HTTP ${res.status}`))
        return
      }

      const handleEvent = (raw: string): Error | null => {
        let event = 'message'
        const dataLines: string[] = []
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
        }
        if (dataLines.length === 0) return null
        let data: unknown
        try {
          data = JSON.parse(dataLines.join('\n'))
        } catch {
          return null
        }
        switch (event) {
          case 'speaker': {
            const d = data as { name?: string; characterId?: string | null }
            if (d.name) handlers.onSpeaker?.(d.name, d.characterId ?? null)
            return null
          }
          case 'sentence': {
            const d = data as { text?: string; isSpeech?: boolean }
            if (d.text) handlers.onSentence?.(d.text, d.isSpeech ?? false)
            return null
          }
          case 'audio': {
            const clip = data as MessageAudio
            if (clip && clip.path) handlers.onAudio?.(clip)
            return null
          }
          case 'done': {
            const d = data as { chat?: Chat }
            if (d.chat) handlers.onDone?.(d.chat)
            return null
          }
          case 'error': {
            const d = data as { message?: string }
            return new Error(d.message || 'Message failed')
          }
          default:
            return null
        }
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let remoteError: Error | null = null
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let idx: number
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const err = handleEvent(buf.slice(0, idx))
            buf = buf.slice(idx + 2)
            if (err) {
              remoteError = err
              break
            }
          }
          if (remoteError) break
        }
        if (!remoteError && buf.trim()) remoteError = handleEvent(buf)
      } catch (e) {
        reject(e as Error)
        return
      } finally {
        reader.cancel().catch(() => {})
      }
      if (remoteError) reject(remoteError)
      else resolve()
    })()
  })
}