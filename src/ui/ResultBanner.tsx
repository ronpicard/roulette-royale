import { useEffect, useRef, useState } from 'react'
import { formatCredits } from './Hud.tsx'
import type { HudSnapshot } from '../render/engineApi.ts'

interface ResultBannerProps {
  hud: HudSnapshot | null
  /** The croupier's call-out line, e.g. `No more bets` or `17 Red`, already timed by `App`. */
  message: string | null
}

const RESULT_VISIBLE_MS = 3500

/**
 * Two transient lines above the felt: a small elegant call-out (`message`, from the engine's
 * `onMessage`) and, when a spin just settled, a large coloured disc with the winning number and
 * the win/no-win line. The disc fades out on its own timer after about 3.5s; the call-out's
 * timing is owned by `App` (it already knows the duration from `onMessage`).
 */
export default function ResultBanner({ hud, message }: ResultBannerProps) {
  const [visible, setVisible] = useState(false)
  const prevSpinsRef = useRef<number | null>(null)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!hud) return
    const prevSpins = prevSpinsRef.current
    prevSpinsRef.current = hud.spins
    if (prevSpins !== null && hud.spins !== prevSpins && hud.lastResult) {
      setVisible(true)
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setVisible(false), RESULT_VISIBLE_MS)
    }
  }, [hud])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const result = hud?.lastResult ?? null
  const win = result !== null && result.net > 0

  return (
    <>
      {message && (
        <div className="callout-banner" role="status" aria-live="polite">
          {message}
        </div>
      )}

      {result && (
        <div
          className={`result-banner hud-color-${result.color}${visible ? ' result-banner-visible' : ''}`}
          aria-hidden={!visible}
        >
          <span className="result-disc">{result.number}</span>
          <span className="result-color-label">{result.color.toUpperCase()}</span>
          {win ? (
            <span className="result-win-line">YOU WIN {formatCredits(result.net)}</span>
          ) : result.returned > 0 ? (
            // Some bets won but no more than was staked: show what came back, not "no win".
            <span className="result-nowin-line">PAID {formatCredits(result.returned)}</span>
          ) : (
            <span className="result-nowin-line">NO WIN</span>
          )}
        </div>
      )}
    </>
  )
}
