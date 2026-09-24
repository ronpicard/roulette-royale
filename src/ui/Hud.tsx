import { useEffect, useState } from 'react'
import { CHIP_VALUES } from '../game/bets.ts'
import { numberColor } from '../game/wheel.ts'
import type { ChipValue } from '../game/types.ts'
import type { CameraView, HudSnapshot } from '../render/engineApi.ts'

interface HudProps {
  /** Null until the engine's first snapshot arrives after `startSession()`. */
  hud: HudSnapshot | null
  selectedChip: ChipValue
  cameraView: CameraView
  quickSpin: boolean
  muted: boolean
  onSelectChip: (value: ChipValue) => void
  onSpin: () => void
  onUndo: () => void
  onClearBets: () => void
  onRebet: () => void
  onDouble: () => void
  onRefill: () => void
  onCycleCamera: () => void
  onToggleQuickSpin: () => void
  onToggleMute: () => void
  onOpenMenu: () => void
}

const CAMERA_LABEL: Record<CameraView, string> = { auto: 'Auto', table: 'Table', wheel: 'Wheel', overhead: 'Overhead' }

/** Formats credits with thousands separators, e.g. `1,250`. */
export function formatCredits(amount: number): string {
  return Math.round(amount).toLocaleString('en-US')
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="13.5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function QuickSpinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M5 5v14l9-7Z" fill="currentColor" />
      <path d="M13 5v14l9-7Z" fill="currentColor" opacity="0.6" />
    </svg>
  )
}

function MuteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path d="m16 9 5 6M21 9l-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function UnmuteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path
        d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

/** Chip face colours, matching the felt chips (`chipTextures.ts`) and a real casino rack. */
const CHIP_COLOR: Record<ChipValue, string> = {
  1: 'chip-white',
  5: 'chip-red',
  25: 'chip-green',
  100: 'chip-black',
  500: 'chip-purple',
}

/**
 * The in-play chrome: credits/bet pills, the last result, the history strip, the chip rack,
 * betting action buttons and the spin button, a hover tip over the felt, and the broke overlay.
 * Stays clear of the table's centre and respects safe-area insets; `App` measures this bar's own
 * footprint with `ResizeObserver` to report `setViewInsets` back to the engine.
 */
export default function Hud({
  hud,
  selectedChip,
  cameraView,
  quickSpin,
  muted,
  onSelectChip,
  onSpin,
  onUndo,
  onClearBets,
  onRebet,
  onDouble,
  onRefill,
  onCycleCamera,
  onToggleQuickSpin,
  onToggleMute,
  onOpenMenu,
}: HudProps) {
  // The touch hint below the chip rack shows only until the player has placed their first chip,
  // ever — a returning player (one with spin history already) never sees it.
  const [everPlacedChip, setEverPlacedChip] = useState(() => (hud?.history.length ?? 0) > 0)
  useEffect(() => {
    if (hud && (hud.totalBet > 0 || hud.canUndo)) setEverPlacedChip(true)
  }, [hud])

  // Track whether we are mid-spin purely for the "NO MORE BETS" label.
  const spinning = hud?.phase === 'spinning'

  const history = hud?.history.slice(0, 12) ?? []
  const lastResult = hud?.lastResult ?? null

  const hoverTip = (() => {
    const hover = hud?.hover
    if (!hover) return null
    const onIt = hover.amount > 0 ? ` · ${formatCredits(hover.amount)} on it` : ''
    return `${hover.label} · pays ${hover.payout} to 1${onIt} · limit ${formatCredits(hover.limit)}`
  })()

  return (
    <>
      <div className="hud-top-bar felt-panel">
        <div className="hud-pill-row">
          <div className="hud-pill">
            <span className="hud-pill-label">Credits</span>
            <span className="hud-pill-value">{formatCredits(hud?.bankroll ?? 0)}</span>
          </div>
          <div className="hud-pill">
            <span className="hud-pill-label">Bet</span>
            <span className="hud-pill-value">{formatCredits(hud?.totalBet ?? 0)}</span>
          </div>
          {lastResult && (
            <div className={`hud-pill hud-last-result hud-color-${lastResult.color}`}>
              <span className="hud-pill-label">Last</span>
              <span className="hud-pill-value">
                {lastResult.net > 0 ? (
                  <span className="hud-last-win">WIN +{formatCredits(lastResult.net)}</span>
                ) : (
                  lastResult.number
                )}
              </span>
            </div>
          )}
        </div>

        <div className="hud-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={`Camera view: ${CAMERA_LABEL[cameraView]}. Change view`}
            onClick={onCycleCamera}
          >
            <CameraIcon />
            <span className="icon-button-caption">{CAMERA_LABEL[cameraView]}</span>
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Quick spin"
            aria-pressed={quickSpin}
            onClick={onToggleQuickSpin}
          >
            <QuickSpinIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={muted ? 'Unmute' : 'Mute'}
            onClick={onToggleMute}
          >
            {muted ? <MuteIcon /> : <UnmuteIcon />}
          </button>
          <button type="button" className="icon-button" aria-label="Menu" onClick={onOpenMenu}>
            <MenuIcon />
          </button>
        </div>
      </div>

      {history.length > 0 && (
        <div className="hud-history-strip" aria-label="Recent numbers">
          {history.map((n, i) => (
            <span
              key={`${i}-${n}`}
              className={`hud-history-disc hud-color-${numberColor(n)}${i === 0 ? ' hud-history-disc-newest' : ''}`}
            >
              {n}
            </span>
          ))}
        </div>
      )}

      <div className="hud-bottom-bar felt-panel">
        {hoverTip && <div className="hud-hover-tip">{hoverTip}</div>}
        {!hoverTip && !everPlacedChip && (
          <div className="hud-hover-tip touch-only">Tap the felt to bet · hold a stack to remove it</div>
        )}

        <div className="hud-bottom-row">
          <div className="hud-chip-rack" role="radiogroup" aria-label="Chip value">
            {CHIP_VALUES.map((value) => (
              <button
                key={value}
                type="button"
                className={`chip ${CHIP_COLOR[value]}${value === selectedChip ? ' chip-selected' : ''}`}
                role="radio"
                aria-checked={value === selectedChip}
                aria-label={`${value} credit chip`}
                onClick={() => onSelectChip(value)}
              >
                <span className="chip-face">
                  <span className="chip-value">{value}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="hud-action-buttons">
            <button type="button" className="secondary-button" disabled={!hud?.canUndo} onClick={onUndo}>
              Undo
            </button>
            <button type="button" className="secondary-button" disabled={!hud?.canClear} onClick={onClearBets}>
              Clear
            </button>
            <button type="button" className="secondary-button" disabled={!hud?.canRebet} onClick={onRebet}>
              Rebet
            </button>
            <button type="button" className="secondary-button" disabled={!hud?.canDouble} onClick={onDouble}>
              &times;2
            </button>
            <button
              type="button"
              className="spin-button"
              disabled={!hud?.canSpin}
              onClick={onSpin}
            >
              {spinning ? 'No more bets' : 'Spin'}
            </button>
          </div>
        </div>
      </div>

      {hud?.broke && (
        <div className="modal-backdrop">
          <div className="broke-card felt-panel" role="dialog" aria-modal="true" aria-label="Out of credits">
            <h2 className="broke-title">Out of credits</h2>
            <button type="button" className="primary-button" onClick={onRefill}>
              Refill 1,000 credits
            </button>
          </div>
        </div>
      )}
    </>
  )
}
