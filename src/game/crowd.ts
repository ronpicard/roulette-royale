/**
 * How the spectators around the table react to a spin, and what the croupier calls out. Pure
 * functions of a `SpinResult`, so the engine, the crowd view and the audio all agree.
 */

import type { SpinResult } from './types.ts'
import { isBigWin } from './session.ts'

export type CrowdReactionKind = 'cheer' | 'boo'

export interface CrowdReaction {
  kind: CrowdReactionKind
  /** 0 to 1: how many spectators join in and how loudly. */
  strength: number
}

/** Losing this much or more on one spin draws the loudest boo. */
export const BIG_LOSS_STAKE = 500
/** A spin that returns some but not all of the stake draws this soft boo. */
export const PARTIAL_LOSS_STRENGTH = 0.3
const MIN_CHEER_STRENGTH = 0.35
const MIN_BOO_STRENGTH = 0.5
/** The best ordinary payout ratio (a straight-up win nets 35x the stake). */
const TOP_PAYOUT_RATIO = 35

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * The crowd cheers a net win and boos a loss. There is no reaction when nothing was staked or
 * when the spin exactly broke even.
 */
export function crowdReaction(result: SpinResult | null): CrowdReaction | null {
  if (!result || result.staked <= 0) return null
  const { staked, returned, net } = result
  if (isBigWin(staked, net)) return { kind: 'cheer', strength: 1 }
  if (net > 0) {
    const share = Math.log(1 + net / staked) / Math.log(1 + TOP_PAYOUT_RATIO)
    return { kind: 'cheer', strength: MIN_CHEER_STRENGTH + (1 - MIN_CHEER_STRENGTH) * clamp01(share) }
  }
  if (net === 0) return null
  if (returned > 0) return { kind: 'boo', strength: PARTIAL_LOSS_STRENGTH }
  return { kind: 'boo', strength: MIN_BOO_STRENGTH + (1 - MIN_BOO_STRENGTH) * clamp01(staked / BIG_LOSS_STAKE) }
}

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty']

/** Spells a pocket number, 0 to 36, in words. */
export function numberWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 36) throw new RangeError(`not a roulette number: ${n}`)
  if (n < 20) return ONES[n]!
  const ones = n % 10
  return ones === 0 ? TENS[Math.floor(n / 10)]! : `${TENS[Math.floor(n / 10)]}-${ONES[ones]}`
}

/** What the croupier says when the ball settles, e.g. "Seventeen, black." or "Zero." */
export function resultCallout(n: number, color: SpinResult['color']): string {
  const words = numberWords(n)
  const spoken = `${words[0]!.toUpperCase()}${words.slice(1)}`
  return color === 'green' ? `${spoken}.` : `${spoken}, ${color}.`
}

/** What the croupier says as the ball leaves the rim. */
export const NO_MORE_BETS_CALLOUT = 'No more bets.'
