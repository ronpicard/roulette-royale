import { useState } from 'react'
import { PAYOUTS } from '../game/bets.ts'
import { formatCredits } from './Hud.tsx'
import type { BetKind } from '../game/types.ts'
import type { CameraView } from '../render/engineApi.ts'

interface MenuProps {
  /** A saved session exists (this run or a previous visit); shows "Continue" instead of "Play". */
  hasSave: boolean
  savedBankroll: number
  muted: boolean
  quickSpin: boolean
  voice: boolean
  cameraView: CameraView
  onPlay: () => void
  onToggleMute: () => void
  onToggleQuickSpin: () => void
  onToggleVoice: () => void
  onCycleCamera: () => void
  onResetCredits: () => void
}

const CAMERA_LABEL: Record<CameraView, string> = { auto: 'Auto', table: 'Table', wheel: 'Wheel', overhead: 'Overhead' }

/** One row of the payout table, grouping the outside bets that all pay the same 1 to 1. */
const PAYOUT_ROWS: { kind: BetKind; label: string }[] = [
  { kind: 'straight', label: 'Straight up · one number' },
  { kind: 'split', label: 'Split · two numbers' },
  { kind: 'street', label: 'Street · three numbers' },
  { kind: 'trio', label: 'Trio · 0 and two numbers' },
  { kind: 'corner', label: 'Corner · four numbers' },
  { kind: 'firstFour', label: 'First four · 0, 1, 2, 3' },
  { kind: 'sixLine', label: 'Six line · six numbers' },
  { kind: 'column', label: 'Column · 12 numbers' },
  { kind: 'dozen', label: 'Dozen · 12 numbers' },
  { kind: 'red', label: 'Red, Black, Odd, Even, 1-18, 19-36' },
]

/** One row of the keyboard legend, matching the bindings in `App.tsx`. */
const KEYBOARD_LEGEND: { label: string; keys: string }[] = [
  { label: 'Spin', keys: 'Space / Enter' },
  { label: 'Chip value', keys: '1 – 5' },
  { label: 'Undo', keys: 'Z / Backspace' },
  { label: 'Clear bets', keys: 'X / Delete' },
  { label: 'Rebet', keys: 'R' },
  { label: 'Double', keys: 'D' },
  { label: 'Camera', keys: 'C' },
  { label: 'Quick spin', keys: 'Q' },
  { label: 'Mute', keys: 'M' },
  { label: 'Menu', keys: 'Esc' },
]

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

/**
 * The art-deco title screen: a docked panel on wide screens (so attract mode stays visible on
 * the table behind it) or a bottom sheet on phones. Play/Continue, an expandable how-to-play
 * with the payout table and keyboard legend, settings toggles, a reset-credits control with an
 * inline confirm, and the no-real-money footer.
 */
export default function Menu({
  hasSave,
  savedBankroll,
  muted,
  quickSpin,
  voice,
  cameraView,
  onPlay,
  onToggleMute,
  onToggleQuickSpin,
  onToggleVoice,
  onCycleCamera,
  onResetCredits,
}: MenuProps) {
  const [howToOpen, setHowToOpen] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)

  function handleResetClick() {
    if (confirmingReset) {
      setConfirmingReset(false)
      onResetCredits()
    } else {
      setConfirmingReset(true)
    }
  }

  return (
    <div className="menu-screen">
      <div className="menu-panel felt-panel">
        <div className="menu-top-row">
          <div className="bulb-border">
            <h1 className="menu-title">Roulette Royale</h1>
          </div>
        </div>
        <p className="menu-tagline">European single-zero roulette</p>

        <button type="button" className="primary-button play-button" onClick={onPlay}>
          {hasSave ? `Continue — ${formatCredits(savedBankroll)} credits` : 'Play'}
        </button>

        <section className="panel-section">
          <button
            type="button"
            className="panel-heading panel-heading-toggle"
            aria-expanded={howToOpen}
            onClick={() => setHowToOpen((open) => !open)}
          >
            How to play {howToOpen ? '−' : '+'}
          </button>
          {howToOpen && (
            <div className="how-to-body">
              <p className="how-to-line">
                Place chips by tapping or clicking the felt. Right-click or hold a stack to remove it.
              </p>
              <table className="payout-table">
                <tbody>
                  {PAYOUT_ROWS.map((row) => (
                    <tr key={row.kind}>
                      <td className="payout-label">{row.label}</td>
                      <td className="payout-value">{PAYOUTS[row.kind]} to 1</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="how-to-line">House edge: 2.7%.</p>
              <dl className="legend-list pointer-only">
                {KEYBOARD_LEGEND.map((row) => (
                  <div className="legend-row" key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.keys}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>

        <section className="panel-section" aria-label="Settings">
          <h2 className="panel-heading">Settings</h2>
          <div className="settings-row">
            <span className="settings-label">Quick spin</span>
            <button
              type="button"
              className="toggle-switch"
              role="switch"
              aria-checked={quickSpin}
              aria-label="Quick spin"
              onClick={onToggleQuickSpin}
            >
              <span className="toggle-knob" />
            </button>
          </div>
          <div className="settings-row">
            <span className="settings-label">Sound</span>
            <button
              type="button"
              className="icon-button"
              aria-label={muted ? 'Unmute' : 'Mute'}
              onClick={onToggleMute}
            >
              {muted ? <MuteIcon /> : <UnmuteIcon />}
            </button>
          </div>
          <div className="settings-row">
            <span className="settings-label">Croupier voice</span>
            <button
              type="button"
              className="toggle-switch"
              role="switch"
              aria-checked={voice}
              aria-label="Croupier voice"
              onClick={onToggleVoice}
            >
              <span className="toggle-knob" />
            </button>
          </div>
          <div className="settings-row">
            <span className="settings-label">Camera</span>
            <button type="button" className="secondary-button settings-camera" onClick={onCycleCamera}>
              {CAMERA_LABEL[cameraView]}
            </button>
          </div>
        </section>

        <section className="panel-section">
          {confirmingReset ? (
            <div className="reset-confirm-row">
              <span className="settings-label">Reset to 1,000 credits?</span>
              <button type="button" className="secondary-button" onClick={handleResetClick}>
                Confirm
              </button>
              <button type="button" className="secondary-button" onClick={() => setConfirmingReset(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="secondary-button" onClick={handleResetClick}>
              Reset credits
            </button>
          )}
        </section>

        <p className="menu-footer">Play credits only — no real money, no purchases.</p>
      </div>
    </div>
  )
}
