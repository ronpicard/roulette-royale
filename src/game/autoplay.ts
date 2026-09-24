/**
 * Attract-mode demo bets: a deterministic, pure function of a seed and the bankroll available, so
 * the same seed always draws the same-looking spread of chips across the felt.
 */

import type { Bet, BetKind, BetMap, ChipValue } from './types.ts'
import { ALL_BETS, BET_LIMITS } from './bets.ts'
import { createRng } from './rng.ts'

const MIN_BET_COUNT = 3
const MAX_BET_COUNT = 7
/** Attempts per slot before giving up on that one bet (a tight bankroll may end with fewer bets). */
const ATTEMPTS_PER_BET = 5
/**
 * Attract mode only ever draws these four denominations (never the 500 chip): a single 500 stake
 * can burn most of the demo bankroll in one draw and starve the remaining bet slots.
 */
const DEMO_CHIP_VALUES: readonly ChipValue[] = [1, 5, 25, 100]

/**
 * Kinds attract mode draws from, weighted toward a realistic-looking table: mostly inside bets
 * (straight, split, corner, street) with a handful of outside bets scattered in.
 */
const KIND_POOL: readonly BetKind[] = [
  'straight',
  'straight',
  'straight',
  'split',
  'split',
  'corner',
  'street',
  'red',
  'black',
  'odd',
  'even',
  'low',
  'high',
  'dozen',
  'column',
]

const BETS_BY_KIND: ReadonlyMap<BetKind, readonly Bet[]> = (() => {
  const map = new Map<BetKind, Bet[]>()
  for (const bet of ALL_BETS) {
    const list = map.get(bet.kind)
    if (list) list.push(bet)
    else map.set(bet.kind, [bet])
  }
  return map
})()

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!
}

/** Deterministic demo chips for attract mode: 3 to 7 bets, realistic amounts, total at most `bankroll`. */
export function attractBets(seed: number, bankroll: number): BetMap {
  const rng = createRng(seed)
  const bets: BetMap = {}
  if (bankroll <= 0) return bets

  const count = MIN_BET_COUNT + Math.floor(rng() * (MAX_BET_COUNT - MIN_BET_COUNT + 1))
  let staked = 0

  for (let i = 0; i < count; i++) {
    for (let tries = 0; tries < ATTEMPTS_PER_BET; tries++) {
      const kind = pick(rng, KIND_POOL)
      const candidates = BETS_BY_KIND.get(kind)
      if (!candidates || candidates.length === 0) continue
      const bet = pick(rng, candidates)
      const chip = pick(rng, DEMO_CHIP_VALUES)

      const current = bets[bet.id] ?? 0
      const room = BET_LIMITS[bet.kind] - current
      const budget = bankroll - staked
      // Prefer the drawn chip; fall back to the smallest denomination so a tight budget still bets.
      const amount = Math.min(chip, room, budget) > 0 ? Math.min(chip, room, budget) : Math.min(DEMO_CHIP_VALUES[0]!, room, budget)
      if (amount <= 0) continue

      bets[bet.id] = current + amount
      staked += amount
      break
    }
  }

  return bets
}
