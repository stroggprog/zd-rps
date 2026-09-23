const STT_HOTKEY_KEY = 'zd-hotkey-stt'
const DEFAULT_STT_HOTKEY = 'Ctrl+M'

function normalizeCombo(combo: string): string {
  return combo
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('+')
}

export function getSttHotkey(): string {
  try {
    const v = window.localStorage.getItem(STT_HOTKEY_KEY)
    return v ? normalizeCombo(v) : DEFAULT_STT_HOTKEY
  } catch {
    return DEFAULT_STT_HOTKEY
  }
}

export function setSttHotkey(combo: string): void {
  try {
    window.localStorage.setItem(STT_HOTKEY_KEY, normalizeCombo(combo))
  } catch {
    /* private mode etc. */
  }
}

const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

/** Turns a keyboard event into "Ctrl+Shift+K"-style combo string, or null while modifiers are held alone. */
export function comboFromEvent(e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; key: string }): string | null {
  if (MODIFIERS.has(e.key)) return null
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Meta')
  parts.push(key)
  return parts.join('+')
}
