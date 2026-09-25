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
  CharacterGroup,
  Persona,
  ProviderInfo,
  Scenario,
  Story,
  TestResult,
} from './types'
import { rebuildMessageAudioSse } from './sseRebuild'

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
    getSystemPrompt: () =>
      http<{ override: string | null }>('/api/connections/config/system-prompt'),
    saveSystemPrompt: (override: string | null) =>
      http<{ override: string | null }>(
        '/api/connections/config/system-prompt',
        jsonInit('PUT', { override }),
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

  personas: {
    list: () => http<Persona[]>('/api/personas'),
    create: (p: Partial<Persona>) => http<Persona>('/api/personas', jsonInit('POST', p)),
    update: (id: string, p: Partial<Persona>) =>
      http<Persona>(`/api/personas/${id}`, jsonInit('PUT', p)),
    remove: (id: string) => http<void>(`/api/personas/${id}`, { method: 'DELETE' }),
    uploadAvatar: (id: string, file: File) => {
      const form = new FormData()
      form.append('avatar', file)
      return http<Persona>(`/api/personas/${id}/avatar`, { method: 'POST', body: form })
    },
    removeAvatar: (id: string) => http<Persona>(`/api/personas/${id}/avatar`, { method: 'DELETE' }),
  },

  stories: {
    list: () => http<Story[]>('/api/stories'),
    create: (st: Partial<Story>) => http<Story>('/api/stories', jsonInit('POST', st)),
    update: (id: string, st: Partial<Story>) =>
      http<Story>(`/api/stories/${id}`, jsonInit('PUT', st)),
    remove: (id: string) => http<void>(`/api/stories/${id}`, { method: 'DELETE' }),
  },

  groups: {
    list: () => http<CharacterGroup[]>('/api/groups'),
    create: (g: Partial<CharacterGroup>) => http<CharacterGroup>('/api/groups', jsonInit('POST', g)),
    update: (id: string, g: Partial<CharacterGroup>) =>
      http<CharacterGroup>(`/api/groups/${id}`, jsonInit('PUT', g)),
    remove: (id: string) => http<void>(`/api/groups/${id}`, { method: 'DELETE' }),
    uploadAvatar: (id: string, file: File) => {
      const form = new FormData()
      form.append('avatar', file)
      return http<CharacterGroup>(`/api/groups/${id}/avatar`, { method: 'POST', body: form })
    },
    removeAvatar: (id: string) => http<CharacterGroup>(`/api/groups/${id}/avatar`, { method: 'DELETE' }),
  },

  lorebooks: {
    list: () => http<Lorebook[]>('/api/lorebooks'),
    create: (l: Partial<Lorebook>) => http<Lorebook>('/api/lorebooks', jsonInit('POST', l)),
    update: (id: string, l: Partial<Lorebook>) =>
      http<Lorebook>(`/api/lorebooks/${id}`, jsonInit('PUT', l)),
    remove: (id: string) => http<void>(`/api/lorebooks/${id}`, { method: 'DELETE' }),
    importFile: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return http<Lorebook>('/api/lorebooks/import', { method: 'POST', body: form })
    },
  },

  scenarios: {
    list: () => http<Scenario[]>('/api/scenarios'),
    create: (s: Partial<Scenario>) => http<Scenario>('/api/scenarios', jsonInit('POST', s)),
    update: (id: string, s: Partial<Scenario>) =>
      http<Scenario>(`/api/scenarios/${id}`, jsonInit('PUT', s)),
    remove: (id: string) => http<void>(`/api/scenarios/${id}`, { method: 'DELETE' }),
    importFile: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return http<Scenario>('/api/scenarios/import', { method: 'POST', body: form })
    },
  },

  chats: {
    list: () => http<ChatSummary[]>('/api/chats'),
    get: (id: string) => http<ChatDetail>(`/api/chats/${id}`),
    create: (payload: {
      title?: string
      participantIds: string[]
      lorebookIds: string[]
      scenarioId: string | null
      scenarioInline?: { name?: string; scenario: string; first_mes: string } | null
      narratorId?: string | null
      personaId?: string | null
      storyId?: string | null
    }) => http<Chat>('/api/chats', jsonInit('POST', payload)),
    remove: (id: string) => http<void>(`/api/chats/${id}`, { method: 'DELETE' }),
    patch: (id: string, payload: Partial<Chat>) =>
      http<Chat>(`/api/chats/${id}`, jsonInit('PATCH', payload)),
    participants: (id: string, payload: { add?: string[]; remove?: string[] }) =>
      http<Chat>(`/api/chats/${id}/participants`, jsonInit('POST', payload)),
    updateMessage: (id: string, messageId: string, content: string) =>
      http<Chat>(`/api/chats/${id}/messages/${messageId}`, jsonInit('PATCH', { content })),
    removeMessage: (id: string, messageId: string) =>
      http<Chat>(`/api/chats/${id}/messages/${messageId}`, { method: 'DELETE' }),
    saveStory: (id: string, payload: { name?: string; storyId?: string | null }) =>
      http<{ story: Story }>(
        `/api/chats/${id}/save-story`,
        jsonInit('POST', payload),
      ),
    rebuildMessageAudio: (id: string, messageId: string, handlers: { onAudio?: (messageId: string | null, clip: MessageAudio) => void; onDone?: (chat: Chat) => void }) =>
      rebuildMessageAudioSse(id, messageId, handlers),
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
  onSpeaker?: (
    messageId: string | null,
    name: string,
    characterId: string | null,
    avatarPath: string | null,
  ) => void
  onSentence?: (messageId: string | null, sentence: string, isSpeech: boolean) => void
  onAudio?: (messageId: string | null, clip: MessageAudio) => void
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
            const d = data as { messageId?: string | null; name?: string; characterId?: string | null; avatarPath?: string | null }
            if (d.name) handlers.onSpeaker?.(d.messageId ?? null, d.name, d.characterId ?? null, d.avatarPath ?? null)
            return null
          }
          case 'sentence': {
            const d = data as { messageId?: string | null; text?: string; isSpeech?: boolean }
            if (d.text) handlers.onSentence?.(d.messageId ?? null, d.text, d.isSpeech ?? false)
            return null
          }
          case 'audio': {
            const d = data as MessageAudio & { messageId?: string | null }
            if (d && d.path) handlers.onAudio?.(d.messageId ?? null, d)
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