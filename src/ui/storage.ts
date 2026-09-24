import { parseSessionSave } from '../game/session.ts'
import type { SessionSave } from '../game/types.ts'
import type { CameraView } from '../render/engineApi.ts'

/**
 * localStorage access for the React shell: the persisted session, the mute/quick-spin toggles
 * and the last chosen camera view. Every access is wrapped in try/catch (private mode, quota
 * errors and disabled storage all throw) so the rest of the app never has to guard a call.
 */

const SESSION_KEY = 'roulette-royale.session'
const MUTED_KEY = 'roulette-royale.muted'
const QUICK_SPIN_KEY = 'roulette-royale.quickSpin'
const CAMERA_KEY = 'roulette-royale.camera'

const CAMERA_VIEWS: readonly CameraView[] = ['auto', 'table', 'wheel', 'overhead']

/** Probes localStorage once and hands back either the real Storage or null. */
export function safeLocalStorage(): Storage | null {
  try {
    const probeKey = '__roulette_royale_probe__'
    window.localStorage.setItem(probeKey, '1')
    window.localStorage.removeItem(probeKey)
    return window.localStorage
  } catch {
    return null
  }
}

export function loadSession(storage: Storage | null): SessionSave | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(SESSION_KEY)
    if (raw === null) return null
    return parseSessionSave(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveSession(storage: Storage | null, save: SessionSave): void {
  if (!storage) return
  try {
    storage.setItem(SESSION_KEY, JSON.stringify(save))
  } catch {
    // Quota exceeded or storage disabled mid-session: the session just won't persist.
  }
}

export function clearSession(storage: Storage | null): void {
  if (!storage) return
  try {
    storage.removeItem(SESSION_KEY)
  } catch {
    // Ignore: nothing to clear if storage already refuses writes.
  }
}

export function loadMuted(storage: Storage | null): boolean {
  if (!storage) return false
  try {
    return storage.getItem(MUTED_KEY) === '1'
  } catch {
    return false
  }
}

export function saveMuted(storage: Storage | null, muted: boolean): void {
  if (!storage) return
  try {
    storage.setItem(MUTED_KEY, muted ? '1' : '0')
  } catch {
    // Quota exceeded or storage disabled mid-session: the mute preference just won't persist.
  }
}

export function loadQuickSpin(storage: Storage | null): boolean {
  if (!storage) return false
  try {
    return storage.getItem(QUICK_SPIN_KEY) === '1'
  } catch {
    return false
  }
}

export function saveQuickSpin(storage: Storage | null, quickSpin: boolean): void {
  if (!storage) return
  try {
    storage.setItem(QUICK_SPIN_KEY, quickSpin ? '1' : '0')
  } catch {
    // Quota exceeded or storage disabled mid-session: the quick-spin preference just won't persist.
  }
}

export function loadCamera(storage: Storage | null): CameraView {
  if (!storage) return 'auto'
  try {
    const raw = storage.getItem(CAMERA_KEY)
    return (CAMERA_VIEWS as readonly string[]).includes(raw ?? '') ? (raw as CameraView) : 'auto'
  } catch {
    return 'auto'
  }
}

export function saveCamera(storage: Storage | null, view: CameraView): void {
  if (!storage) return
  try {
    storage.setItem(CAMERA_KEY, view)
  } catch {
    // Quota exceeded or storage disabled mid-session: the camera preference just won't persist.
  }
}
