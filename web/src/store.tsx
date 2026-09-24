import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './lib/api'
import type {
  Character,
  Chat,
  ChatDetail,
  ChatMessage,
  ChatSummary,
  Connection,
  Lorebook,
  Narrator,
  Persona,
  ProviderInfo,
  Scenario,
} from './lib/types'

export type Overlay = 'none' | 'config' | 'characters' | 'narrators' | 'personas' | 'lorebooks' | 'scenarios' | 'new-chat' | 'print'

export interface ConnectionDefaults {
  defaultLlm: string | null
  defaultStt: string | null
  defaultTts: string | null
}

export interface AppState {
  providers: ProviderInfo[]
  connections: Connection[]
  characters: Character[]
  narrators: Narrator[]
  personas: Persona[]
  lorebooks: Lorebook[]
  scenarios: Scenario[]
  chats: ChatSummary[]
  defaults: ConnectionDefaults
  selectedChatId: string | null
  chat: ChatDetail | null
  overlay: Overlay
  overlayPayload: unknown
  viewerImages: string[]
  viewerIndex: number
  sending: boolean
  busy: boolean
  error: string | null
  audioEnabled: boolean

  refreshAll: () => Promise<void>
  selectChat: (id: string | null) => Promise<void>
  openOverlay: (o: Overlay, payload?: unknown) => void
  closeOverlay: () => void
  setError: (e: string | null) => void
  setViewer: (images: string[], index?: number) => void
  setAudioEnabled: (v: boolean) => void

  createChat: (payload: {
    title?: string
    participantIds: string[]
    lorebookIds: string[]
    scenarioId: string | null
    scenarioInline?: { name?: string; scenario: string; first_mes: string } | null
    narratorId?: string | null
    personaId?: string | null
  }) => Promise<Chat>
  deleteChat: (id: string) => Promise<void>
  sendMessage: (content: string, opts?: { audio?: boolean }) => Promise<void>
  addParticipants: (ids: string[]) => Promise<void>
  removeParticipant: (characterId: string) => Promise<void>
  setNarrator: (narratorId: string | null) => Promise<void>
  patchRuntime: (patch: Partial<Chat['runtime']>) => Promise<void>
  setConnectionDefault: (kind: 'llm' | 'stt' | 'tts', connectionId: string | null) => Promise<void>
  refreshChat: () => Promise<void>
  updateMessage: (messageId: string, content: string) => Promise<void>
  removeMessage: (messageId: string) => Promise<void>
  rebuildMessageAudio: (messageId: string) => Promise<void>
}

const Ctx = createContext<AppState | null>(null)

const AUDIO_KEY = 'zd-audio-enabled'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

let playChain: Promise<void> = Promise.resolve()

/** Plays an audio URL in strict sequence after any previously queued clip. */
export function enqueueAudio(path: string): void {
  playChain = playChain.then(
    () =>
      new Promise<void>((resolve) => {
        const audio = new Audio(path)
        audio.onended = () => resolve()
        audio.onerror = () => resolve()
        void audio.play().catch(() => resolve())
      }),
  )
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [defaults, setDefaults] = useState<ConnectionDefaults>({
    defaultLlm: null,
    defaultStt: null,
    defaultTts: null,
  })
  const [characters, setCharacters] = useState<Character[]>([])
  const [narrators, setNarrators] = useState<Narrator[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [lorebooks, setLorebooks] = useState<Lorebook[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [chat, setChat] = useState<ChatDetail | null>(null)
  const [overlay, setOverlay] = useState<Overlay>('none')
  const [overlayPayload, setOverlayPayload] = useState<unknown>(null)
  const [viewerImages, setViewerImages] = useState<string[]>([])
  const [viewerIndex, setViewerIndex] = useState(-1)
  const [sending, setSending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [audioEnabled, setAudioEnabled] = useState<boolean>(() => {
    const stored = window.localStorage.getItem(AUDIO_KEY)
    return stored === null ? true : stored === '1'
  })

  const toggleAudio = useCallback((v: boolean) => {
    setAudioEnabled(v)
    window.localStorage.setItem(AUDIO_KEY, v ? '1' : '0')
  }, [])

  const refreshAll = useCallback(async () => {
    try {
      const [p, c, ch, n, ps, l, s, cs, d] = await Promise.all([
        api.providers(),
        api.connections.list(),
        api.characters.list(),
        api.narrators.list(),
        api.personas.list(),
        api.lorebooks.list(),
        api.scenarios.list(),
        api.chats.list(),
        api.connections.defaults(),
      ])
      setProviders(p)
      setConnections(c)
      setCharacters(ch)
      setNarrators(n)
      setPersonas(ps)
      setLorebooks(l)
      setScenarios(s)
      setChats(cs)
      setDefaults(d)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  const refreshChat = useCallback(async () => {
    if (!selectedChatId) {
      setChat(null)
      return
    }
    const detail = await api.chats.get(selectedChatId)
    setChat(detail)
    setChats((prev) =>
      prev.map((s) => (s.id === detail.chat.id ? { ...s, updated: detail.chat.updated, messageCount: detail.chat.messages.length, participantCount: detail.chat.participantIds.length } : s)),
    )
  }, [selectedChatId])

  const setViewer = useCallback((images: string[], index = 0) => {
    setViewerImages(images)
    setViewerIndex(images.length > 0 ? index : -1)
  }, [])

  const selectChat = useCallback(
    async (id: string | null) => {
      setSelectedChatId(id)
      setViewer([], -1)
      if (!id) {
        setChat(null)
        return
      }
      try {
        const detail = await api.chats.get(id)
        setChat(detail)
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [setViewer],
  )

  const openOverlay = useCallback((o: Overlay, payload?: unknown) => {
    setOverlayPayload(payload ?? null)
    setOverlay(o)
  }, [])

  const closeOverlay = useCallback(() => {
    setOverlay('none')
    setOverlayPayload(null)
    void refreshAll()
  }, [refreshAll])

  const createChat = useCallback(
    async (payload: {
      title?: string
      participantIds: string[]
      lorebookIds: string[]
      scenarioId: string | null
      scenarioInline?: { name?: string; scenario: string; first_mes: string } | null
      narratorId?: string | null
      personaId?: string | null
    }) => {
      const created = await api.chats.create(payload)
      await refreshAll()
      setOverlay('none')
      await selectChat(created.id)
      const openingAudioPending =
        created.messages.length > 0 && created.messages[0].content !== '' && created.messages[0].audio.length === 0
      if (openingAudioPending) {
        const doAutoPlay = audioEnabled
        const seen = new Set<string>()
        void (async () => {
          let stableCount = 0
          let lastCount = 0
          for (let i = 0; i < 60; i++) {
            await sleep(1000)
            try {
              const detail = await api.chats.get(created.id)
              setChat((prev) => {
                if (!prev || prev.chat.id !== created.id) return prev
                // The user may have started the conversation meanwhile — don't clobber.
                const prevLen = prev.chat.messages.length
                if (prevLen !== detail.chat.messages.length) return prev
                return detail
              })
              const opening = detail.chat.messages[0]
              const count = opening?.audio.length ?? 0
              if (doAutoPlay && opening) {
                for (const clip of opening.audio) {
                  if (!seen.has(clip.id) && clip.path) {
                    seen.add(clip.id)
                    enqueueAudio(clip.path)
                  }
                }
              }
              // Keep polling while clips are still arriving, stop shortly after silence.
              if (count > 0 && count === lastCount) {
                stableCount += 1
              } else {
                stableCount = 0
              }
              lastCount = count
              if (count > 0 && stableCount >= 3) break
            } catch {
              break
            }
          }
        })()
      }
      return created
    },
    [refreshAll, selectChat, audioEnabled],
  )

  const deleteChat = useCallback(
    async (id: string) => {
      await api.chats.remove(id)
      if (selectedChatId === id) await selectChat(null)
      await refreshAll()
    },
    [selectedChatId, refreshAll, selectChat],
  )

  const sendMessage = useCallback(
    async (content: string, opts?: { audio?: boolean }) => {
      const text = content.trim()
      if (!text || !selectedChatId || sending) return
      setSending(true)
      setError(null)

      const optimistic: ChatMessage = {
        id: `local-${Date.now()}`,
        role: 'user',
        speaker: { characterId: null, name: 'User', avatarPath: null, voiceSamplePath: null },
        content: text,
        audioPath: null,
        audio: [],
        images: [],
        ts: new Date().toISOString(),
      }
      const streamId = `stream-${Date.now()}`
      let currentStreamId = streamId

      const placeholderMsg = (id: string): ChatMessage => ({
        id,
        role: 'assistant',
        speaker: { characterId: null, name: 'Assistant', avatarPath: null, voiceSamplePath: null },
        content: '',
        audioPath: null,
        audio: [],
        images: [],
        ts: new Date().toISOString(),
      })

      setChat((prev) =>
        prev
          ? {
              ...prev,
              chat: { ...prev.chat, messages: [...prev.chat.messages, optimistic, placeholderMsg(streamId)] },
            }
          : prev,
      )

      const updateStream = (patch: (m: ChatMessage) => ChatMessage, msgId?: string | null) =>
        setChat((prev) => {
          if (!prev) return prev
          const target = msgId && prev.chat.messages.some((m) => m.id === msgId) ? msgId : currentStreamId
          return {
            ...prev,
            chat: {
              ...prev.chat,
              messages: prev.chat.messages.map((m) => (m.id === target ? patch(m) : m)),
            },
          }
        })

      let lastSpeech: boolean | null = null
      try {
        await api.chats.messageStream(
          selectedChatId,
          text,
          opts?.audio ?? audioEnabled,
          {
            onSpeaker: (messageId, name, characterId, avatarPath) => {
              lastSpeech = null
              if (!messageId) {
                updateStream((m) => ({ ...m, speaker: { ...m.speaker, name, characterId, avatarPath: avatarPath ?? m.speaker.avatarPath } }))
                return
              }
              currentStreamId = messageId
              setChat((prev) => {
                if (!prev) return prev
                if (prev.chat.messages.some((m) => m.id === messageId)) return prev
                const msg: ChatMessage = {
                  id: messageId,
                  role: 'assistant',
                  speaker: { characterId: characterId ?? null, name, avatarPath: avatarPath ?? null, voiceSamplePath: null },
                  content: '',
                  audioPath: null,
                  audio: [],
                  images: [],
                  ts: new Date().toISOString(),
                }
                // If the placeholder bubble is still empty, replace it; otherwise append the new block.
                const emptyPlaceholder = prev.chat.messages.find((m) => m.id === streamId && !m.content && !m.audio.length)
                const messages = emptyPlaceholder
                  ? prev.chat.messages.map((m) => (m.id === streamId ? msg : m))
                  : [...prev.chat.messages, msg]
                return { ...prev, chat: { ...prev.chat, messages } }
              })
            },
            onSentence: (messageId, sentence, isSpeech) => {
              const sep = lastSpeech === null ? '' : isSpeech === lastSpeech ? ' ' : '\n\n'
              lastSpeech = isSpeech
              updateStream((m) => ({
                ...m,
                content: m.content ? `${m.content}${sep}${sentence}` : sentence,
              }), messageId)
            },
            onAudio: (messageId, clip) => {
              if (clip.path) enqueueAudio(clip.path)
              updateStream((m) => ({ ...m, audio: [...m.audio, clip] }), messageId)
            },
            onDone: (chat) => {
              setChat((prev) => (prev ? { ...prev, chat } : prev))
              setChats((prev) =>
                prev.map((s) =>
                  s.id === chat.id
                    ? { ...s, updated: chat.updated, messageCount: chat.messages.length }
                    : s,
                ),
              )
            },
          },
        )
      } catch (e) {
        setError((e as Error).message)
        await refreshChat()
      } finally {
        setSending(false)
      }
    },
    [selectedChatId, sending, audioEnabled, refreshChat],
  )

  const addParticipants = useCallback(
    async (ids: string[]) => {
      if (!selectedChatId || ids.length === 0) return
      setBusy(true)
      try {
        await api.chats.participants(selectedChatId, { add: ids })
        await refreshChat()
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [selectedChatId, refreshChat],
  )

  const removeParticipant = useCallback(
    async (characterId: string) => {
      if (!selectedChatId) return
      setBusy(true)
      try {
        await api.chats.participants(selectedChatId, { remove: [characterId] })
        await refreshChat()
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [selectedChatId, refreshChat],
  )

  const setNarrator = useCallback(
    async (narratorId: string | null) => {
      if (!selectedChatId || !chat) return
      const updated = await api.chats.patch(selectedChatId, { narratorId })
      setChat((prev) => {
        if (!prev) return prev
        const narrator = narratorId ? narrators.find((n) => n.id === narratorId) ?? null : null
        return { ...prev, chat: updated, narrator }
      })
    },
    [selectedChatId, chat, narrators],
  )

  const patchRuntime = useCallback(
    async (patch: Partial<Chat['runtime']>) => {
      if (!selectedChatId || !chat) return
      const updated = await api.chats.patch(selectedChatId, { runtime: { ...chat.chat.runtime, ...patch } })
      setChat((prev) => (prev ? { ...prev, chat: updated } : prev))
    },
    [selectedChatId, chat],
  )

  const updateMessage = useCallback(
    async (messageId: string, content: string) => {
      if (!selectedChatId) return
      setBusy(true)
      try {
        await api.chats.updateMessage(selectedChatId, messageId, content)
        await refreshChat()
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [selectedChatId, refreshChat],
  )

  const removeMessage = useCallback(
    async (messageId: string) => {
      if (!selectedChatId) return
      setBusy(true)
      try {
        await api.chats.removeMessage(selectedChatId, messageId)
        await refreshChat()
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [selectedChatId, refreshChat],
  )

  const rebuildMessageAudio = useCallback(
    async (messageId: string) => {
      if (!selectedChatId) return
      setBusy(true)
      try {
        const updated = await api.chats.rebuildMessageAudio(selectedChatId, messageId)
        setChat((prev) => (prev && prev.chat.id === updated.id ? { ...prev, chat: updated } : prev))
        if (audioEnabled) {
          // Play the fresh clips in order through the shared sequential queue.
          for (const clip of updated.messages.find((m) => m.id === messageId)?.audio ?? []) {
            if (clip.path) enqueueAudio(clip.path)
          }
        }
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [selectedChatId, audioEnabled],
  )

  const setConnectionDefault = useCallback(
    async (kind: 'llm' | 'stt' | 'tts', connectionId: string | null) => {
      await api.connections.setDefault(kind, connectionId)
      await refreshAll()
    },
    [refreshAll],
  )

  const value = useMemo<AppState>(
    () => ({
      providers,
      connections,
      characters,
      narrators,
      personas,
      lorebooks,
      scenarios,
      chats,
      defaults,
      selectedChatId,
      chat,
      overlay,
      overlayPayload,
      viewerImages,
      viewerIndex,
      sending,
      busy,
      error,
      audioEnabled,
      refreshAll,
      selectChat,
      openOverlay,
      closeOverlay,
      setError,
      setViewer,
      setAudioEnabled: toggleAudio,
      createChat,
      deleteChat,
      sendMessage,
      addParticipants,
      removeParticipant,
      setNarrator,
      patchRuntime,
      setConnectionDefault,
      refreshChat,
      updateMessage,
      removeMessage,
      rebuildMessageAudio,
    }),
    [
      providers,
      connections,
      characters,
      narrators,
      personas,
      lorebooks,
      scenarios,
      chats,
      defaults,
      selectedChatId,
      chat,
      overlay,
      overlayPayload,
      viewerImages,
      viewerIndex,
      sending,
      busy,
      error,
      audioEnabled,
      refreshAll,
      selectChat,
      openOverlay,
      closeOverlay,
      setError,
      setViewer,
      toggleAudio,
      createChat,
      deleteChat,
      sendMessage,
      addParticipants,
      removeParticipant,
      setNarrator,
      patchRuntime,
      setConnectionDefault,
      refreshChat,
      updateMessage,
      removeMessage,
      rebuildMessageAudio,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const state = useContext(Ctx)
  if (!state) throw new Error('useApp must be used within AppProvider')
  return state
}