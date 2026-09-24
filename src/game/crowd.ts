/**
 * How the spectators around the table react to a spin. Pure functions of a `SpinResult`, so the
 * engine, the crowd view and the audio all agree.
 */

import type { SpinResult } from './types.ts'
import { isBigWin } from './session.ts'

export type CrowdReactionKind = 'cheer' | 'groan'

export interface CrowdReaction {
  kind: CrowdReactionKind
  /** 0 to 1: how many spectators join in and how loudly. */
  strength: number
}

/** Losing this much or more on one spin draws the loudest groan. */
export const BIG_LOSS_STAKE = 500
/** A spin that returns some but not all of the stake draws this soft groan. */
export const PARTIAL_LOSS_STRENGTH = 0.3
const MIN_CHEER_STRENGTH = 0.35
const MIN_GROAN_STRENGTH = 0.5
/** The best ordinary payout ratio (a straight-up win nets 35x the stake). */
const TOP_PAYOUT_RATIO = 35

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * The crowd cheers a net win and groans at a loss. There is no reaction when nothing was staked or
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
  if (returned > 0) return { kind: 'groan', strength: PARTIAL_LOSS_STRENGTH }
  return { kind: 'groan', strength: MIN_GROAN_STRENGTH + (1 - MIN_GROAN_STRENGTH) * clamp01(staked / BIG_LOSS_STAKE) }
}
