import type { ChipValue, PocketColor, SessionPhase, SessionSave, SoundName } from '../game/types.ts'

/** The last spin, as the HUD shows it. */
export interface HudResult {
  number: number
  color: PocketColor
  staked: number
  returned: number
  net: number
}

/** The bet under the pointer, as the HUD shows it. */
export interface HudHover {
  betId: string
  label: string
  /** Winnings per credit, e.g. 35 for a straight-up bet. */
  payout: number
  /** Credits already on it. */
  amount: number
  /** Most that may be staked on it. */
  limit: number
}

/** What the HUD shows. A new object is sent only when one of its fields changes. */
export interface HudSnapshot {
  phase: SessionPhase
  /** Credits not on the table. */
  bankroll: number
  /** Credits on the table this round. */
  totalBet: number
  selectedChip: ChipValue
  /** Set while the result of the last spin is showing, and until the next spin. */
  lastResult: HudResult | null
  /** Winning numbers, newest first, at most 20. */
  history: number[]
  hover: HudHover | null
  canSpin: boolean
  canUndo: boolean
  canClear: boolean
  canRebet: boolean
  canDouble: boolean
  /** No credits left anywhere: the HUD offers a refill. */
  broke: boolean
  /** Number of spins this session, for the stats line. */
  spins: number
}

export type EngineSound = SoundName

/** Callbacks from the 3D engine to the React shell. All are invoked on the main thread. */
export interface EngineEvents {
  onHud(snapshot: HudSnapshot): void
  /** A one-shot sound. `intensity` runs 0 to 1 and scales the volume of knocks. */
  onSound(name: EngineSound, intensity: number): void
  /**
   * The ball's rolling noise. `level` 0 is silent and 1 is a fast ball on the track; `pitch`
   * 0 to 1 follows its speed. Sent at most once a frame, and only when either value moves by
   * more than 0.02, or drops to 0.
   */
  onRolling(level: number, pitch: number): void
  /** A line for the croupier's call-out banner, e.g. `No more bets` or `17 Red`. */
  onMessage(text: string, seconds: number): void
  /** A line for the croupier to say aloud, e.g. `No more bets.` or `Seventeen, black.` Play mode only. */
  onAnnounce(text: string): void
  /** Persist this. Sent when a spin starts, when it settles, and on refill. */
  onSave(save: SessionSave): void
}

/** 'play' takes the player's bets. 'attract' spins the wheel by itself with demo chips and fires no events. */
export type EngineMode = 'play' | 'attract'

/**
 * 'auto' follows the game: the table while betting, the wheel while it spins, a close look at the
 * winning pocket, then back. 'table' is seated at the layout with the wheel to the left, 'wheel'
 * looks down into the wheel, and 'overhead' looks straight down on the whole table.
 */
export type CameraView = 'auto' | 'table' | 'wheel' | 'overhead'

/** Screen space covered by UI, in CSS pixels, measured in from each edge of the canvas. */
export interface ViewInsets {
  left: number
  top: number
  right: number
  bottom: number
}

export interface EngineApi {
  /** Starts taking bets in 'play' mode from a saved session, or a fresh 1,000-credit bankroll for `null`. */
  startSession(save: SessionSave | null): void
  /** Leaves 'play' mode (chips on the table go back to the bankroll first) and runs the attract mode. */
  showAttract(): void
  selectChip(value: ChipValue): void
  /** Places the selected chip on a bet, as a tap on the layout does. For keyboard play. */
  placeChip(betId: string): void
  spin(): void
  undo(): void
  clearBets(): void
  rebet(): void
  double(): void
  /** Resets a broke bankroll to 1,000 credits. */
  refill(): void
  setCameraView(view: CameraView): void
  /** Runs the wheel at double speed. The outcome of a spin does not change. */
  setQuickSpin(on: boolean): void
  /** Keeps the table clear of the part of the canvas the UI covers. */
  setViewInsets(insets: ViewInsets): void
  /** Freezes the physics and the clocks. The scene keeps rendering. */
  setPaused(paused: boolean): void
  /** Re-reads the canvas size. The engine also observes its canvas, so this is rarely needed. */
  resize(): void
  dispose(): void
}
