import type { Bet, BetKind, BetMap, BetOutcome, ChipValue } from './types.ts'

/**
 * Every bet on a European single-zero layout, with its payout and limit. Bet ids are made here
 * and nowhere else.
 */

/** Winnings per credit staked, paid on top of the returned stake. */
export const PAYOUTS: Readonly<Record<BetKind, number>> = {
  straight: 35,
  split: 17,
  street: 11,
  trio: 11,
  corner: 8,
  firstFour: 8,
  sixLine: 5,
  column: 2,
  dozen: 2,
  red: 1,
  black: 1,
  odd: 1,
  even: 1,
  low: 1,
  high: 1,
}

/** Most that may be staked on one bet of each kind. */
export const BET_LIMITS: Readonly<Record<BetKind, number>> = {
  straight: 250,
  split: 500,
  street: 750,
  trio: 750,
  corner: 1000,
  firstFour: 1000,
  sixLine: 1500,
  column: 2500,
  dozen: 2500,
  red: 5000,
  black: 5000,
  odd: 5000,
  even: 5000,
  low: 5000,
  high: 5000,
}

/** Chip denominations in the rack, smallest first. */
export const CHIP_VALUES: readonly ChipValue[] = [1, 5, 25, 100, 500]

const RED: readonly number[] = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]

function range(from: number, to: number, step = 1): number[] {
  const out: number[] = []
  for (let n = from; n <= to; n += step) out.push(n)
  return out
}

function inside(kind: BetKind, numbers: number[], label: string): Bet {
  const sorted = [...numbers].sort((a, b) => a - b)
  return { id: `${kind}:${sorted.join('-')}`, kind, numbers: sorted, label }
}

function buildBets(): Bet[] {
  const bets: Bet[] = []
  for (let n = 0; n <= 36; n++) bets.push(inside('straight', [n], String(n)))

  // Splits: up the column (n, n + 1), across columns (n, n + 3), and the zero splits.
  for (let n = 1; n <= 35; n++) {
    if (n % 3 !== 0) bets.push(inside('split', [n, n + 1], `Split ${n}/${n + 1}`))
  }
  for (let n = 1; n <= 33; n++) bets.push(inside('split', [n, n + 3], `Split ${n}/${n + 3}`))
  for (const n of [1, 2, 3]) bets.push(inside('split', [0, n], `Split 0/${n}`))

  for (let n = 1; n <= 34; n += 3) bets.push(inside('street', [n, n + 1, n + 2], `Street ${n}–${n + 2}`))
  bets.push(inside('trio', [0, 1, 2], 'Trio 0/1/2'))
  bets.push(inside('trio', [0, 2, 3], 'Trio 0/2/3'))

  for (let n = 1; n <= 32; n++) {
    if (n % 3 !== 0) {
      bets.push(inside('corner', [n, n + 1, n + 3, n + 4], `Corner ${n}/${n + 1}/${n + 3}/${n + 4}`))
    }
  }
  bets.push(inside('firstFour', [0, 1, 2, 3], 'First four'))
  for (let n = 1; n <= 31; n += 3) bets.push(inside('sixLine', range(n, n + 5), `Six line ${n}–${n + 5}`))

  const ordinals = ['1st', '2nd', '3rd']
  for (let c = 1; c <= 3; c++) {
    bets.push({ id: `column:${c}`, kind: 'column', numbers: range(c, 36, 3), label: `${ordinals[c - 1]} column` })
  }
  for (let d = 1; d <= 3; d++) {
    bets.push({ id: `dozen:${d}`, kind: 'dozen', numbers: range(d * 12 - 11, d * 12), label: `${ordinals[d - 1]} 12` })
  }
  const all = range(1, 36)
  bets.push({ id: 'red', kind: 'red', numbers: [...RED], label: 'Red' })
  bets.push({ id: 'black', kind: 'black', numbers: all.filter((n) => !RED.includes(n)), label: 'Black' })
  bets.push({ id: 'odd', kind: 'odd', numbers: all.filter((n) => n % 2 === 1), label: 'Odd' })
  bets.push({ id: 'even', kind: 'even', numbers: all.filter((n) => n % 2 === 0), label: 'Even' })
  bets.push({ id: 'low', kind: 'low', numbers: range(1, 18), label: '1 to 18' })
  bets.push({ id: 'high', kind: 'high', numbers: range(19, 36), label: '19 to 36' })
  return bets
}

/** All 157 bets on the layout. */
export const ALL_BETS: readonly Bet[] = buildBets()

const BY_ID: ReadonlyMap<string, Bet> = new Map(ALL_BETS.map((bet) => [bet.id, bet]))

/** The bet with id `id`, or `null` for an unknown id. */
export function betById(id: string): Bet | null {
  return BY_ID.get(id) ?? null
}

/** Id of the inside bet of `kind` covering exactly `numbers`, or `null` if there is no such bet. */
export function insideBetId(kind: BetKind, numbers: readonly number[]): string | null {
  const id = `${kind}:${[...numbers].sort((a, b) => a - b).join('-')}`
  return BY_ID.has(id) ? id : null
}

/** Total staked across a bet map. */
export function totalStaked(bets: BetMap): number {
  let total = 0
  for (const amount of Object.values(bets)) total += amount
  return total
}

/** What each bet returns when `number` comes up. Unknown bet ids return nothing. */
export function settleBets(bets: BetMap, number: number): { outcomes: BetOutcome[]; staked: number; returned: number } {
  const outcomes: BetOutcome[] = []
  let staked = 0
  let returned = 0
  for (const [betId, amount] of Object.entries(bets)) {
    const bet = BY_ID.get(betId)
    const wins = bet !== undefined && bet.numbers.includes(number)
    const back = wins ? amount * (PAYOUTS[bet.kind] + 1) : 0
    outcomes.push({ betId, amount, returned: back })
    staked += amount
    returned += back
  }
  return { outcomes, staked, returned }
}

/** The chips that make up `amount`, largest first, using as few chips as possible. */
export function chipBreakdown(amount: number): ChipValue[] {
  const chips: ChipValue[] = []
  let left = Math.max(0, Math.floor(amount))
  for (let i = CHIP_VALUES.length - 1; i >= 0; i--) {
    const value = CHIP_VALUES[i]!
    while (left >= value) {
      chips.push(value)
      left -= value
    }
  }
  return chips
}
