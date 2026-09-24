/**
 * Session rules: the pure state machine behind a play session (bankroll, bets on the table, undo,
 * history and stats). Every transition takes a `Session` and returns a new `Transition` (a new
 * `Session` plus the `Command`s the engine should run); nothing here mutates its input, touches
 * the DOM, or calls `Math.random`/`Date`.
 */

import type {
  BetMap,
  Command,
  Session,
  SessionSave,
  SessionStats,
  SpinResult,
  Transition,
} from './types.ts'
import { BET_LIMITS, betById, settleBets, totalStaked } from './bets.ts'
import { numberColor } from './wheel.ts'

export const STARTING_BANKROLL = 1000
/** Most winning numbers kept in `Session.history`. `toSave` caps further, at 50. */
export const HISTORY_LENGTH = 200
/** A net win at least this big, or at least 20x the stake, plays the `bigWin` sound. */
export const BIG_WIN_NET = 500

const SAVE_HISTORY_LENGTH = 50
const NO_MORE_BETS_SECONDS = 1.8
const RESULT_MESSAGE_SECONDS = 3

/** Whether a spin's net win is big enough for the `bigWin` sound and the crowd's loudest cheer. */
export function isBigWin(staked: number, net: number): boolean {
  return net >= BIG_WIN_NET || (staked > 0 && net >= staked * 20)
}

/** Formats a whole number of credits with thousands separators, e.g. `1,250`. */
function formatCredits(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

function freshStats(): SessionStats {
  return { spins: 0, wagered: 0, returned: 0, biggestWin: 0, bestBankroll: STARTING_BANKROLL, counts: new Array(37).fill(0) }
}

function noChange(session: Session): Transition {
  return { session, commands: [] }
}

function denied(session: Session, text: string): Transition {
  return { session, commands: [{ type: 'sound', name: 'denied' }, { type: 'message', text, seconds: NO_MORE_BETS_SECONDS }] }
}

/** Opens betting again after a result, keeping `lastResult` so the HUD still shows it. */
function toBetting(session: Session): Session {
  return session.phase === 'result' ? { ...session, phase: 'betting' } : session
}

/** Creates a fresh session, or restores one from a validated save. */
export function createSession(save: SessionSave | null): Session {
  return {
    phase: 'betting',
    bankroll: save ? save.bankroll : STARTING_BANKROLL,
    bets: {},
    undo: [],
    lastBets: null,
    history: save ? save.history.slice(0, HISTORY_LENGTH) : [],
    lastResult: null,
    stats: save ? { ...save.stats, counts: [...save.stats.counts] } : freshStats(),
  }
}

/** Stakes `amount` (clamped to the bankroll and the bet's limit) on `betId`. */
export function placeChip(s: Session, betId: string, amount: number): Transition {
  const bet = betById(betId)
  if (bet === null) return noChange(s)
  if (s.phase !== 'betting' && s.phase !== 'result') return noChange(s)

  const session = toBetting(s)
  const current = session.bets[betId] ?? 0
  const limit = BET_LIMITS[bet.kind]
  const room = limit - current
  const stake = Math.max(0, Math.min(amount, session.bankroll, room))

  if (stake <= 0) {
    if (room <= 0) return denied(session, `Limit ${formatCredits(limit)} on ${bet.label}`)
    return denied(session, 'Not enough credits')
  }

  const bets: BetMap = { ...session.bets, [betId]: current + stake }
  const undo = [...session.undo, { [betId]: stake }]
  return {
    session: { ...session, bankroll: session.bankroll - stake, bets, undo },
    commands: [{ type: 'sound', name: 'chip' }],
  }
}

/** Returns the whole stake on `betId` to the bankroll and clears the undo stack. */
export function removeBet(s: Session, betId: string): Transition {
  if (s.phase === 'spinning') return noChange(s)
  const amount = s.bets[betId]
  if (amount === undefined) return noChange(s)

  const session = toBetting(s)
  const bets = { ...session.bets }
  delete bets[betId]
  return {
    session: { ...session, bankroll: session.bankroll + amount, bets, undo: [] },
    commands: [{ type: 'sound', name: 'chipRemove' }],
  }
}

/** Pops the last placement delta and returns those credits to the bankroll. */
export function undo(s: Session): Transition {
  if (s.phase === 'spinning' || s.undo.length === 0) return noChange(s)
  const session = toBetting(s)
  const delta = session.undo[session.undo.length - 1]!
  const bets = { ...session.bets }
  let refund = 0
  for (const [betId, amount] of Object.entries(delta)) {
    refund += amount
    const remaining = (bets[betId] ?? 0) - amount
    if (remaining > 0) bets[betId] = remaining
    else delete bets[betId]
  }
  return {
    session: { ...session, bankroll: session.bankroll + refund, bets, undo: session.undo.slice(0, -1) },
    commands: [{ type: 'sound', name: 'chipRemove' }],
  }
}

/** Returns every bet on the table to the bankroll. */
export function clearBets(s: Session): Transition {
  if (s.phase === 'spinning') return noChange(s)
  const session = toBetting(s)
  const refund = totalStaked(session.bets)
  return {
    session: { ...session, bankroll: session.bankroll + refund, bets: {}, undo: [] },
    commands: [{ type: 'sound', name: 'clear' }],
  }
}

/** Stakes `lastBets` again, only when nothing is currently on the table. */
export function rebet(s: Session): Transition {
  if (s.phase === 'spinning' || Object.keys(s.bets).length > 0 || s.lastBets === null) return noChange(s)
  const session = toBetting(s)
  const total = totalStaked(session.lastBets!)
  if (total > session.bankroll) return denied(session, 'Not enough credits')
  return {
    session: { ...session, bankroll: session.bankroll - total, bets: { ...session.lastBets! }, undo: [{ ...session.lastBets! }] },
    commands: [{ type: 'sound', name: 'chip' }],
  }
}

/** Doubles every bet on the table, each capped at its own limit, as one undo step. */
export function double(s: Session): Transition {
  if (s.phase === 'spinning') return noChange(s)
  const session = toBetting(s)
  const betIds = Object.keys(session.bets)
  if (betIds.length === 0) return noChange(session)

  const added: BetMap = {}
  let cost = 0
  for (const betId of betIds) {
    const bet = betById(betId)
    if (bet === null) continue
    const current = session.bets[betId]!
    const room = BET_LIMITS[bet.kind] - current
    const extra = Math.min(current, room)
    if (extra > 0) {
      added[betId] = extra
      cost += extra
    }
  }

  if (cost === 0) return denied(session, 'Not enough credits')
  if (cost > session.bankroll) return denied(session, 'Not enough credits')

  const bets = { ...session.bets }
  for (const [betId, extra] of Object.entries(added)) bets[betId] = (bets[betId] ?? 0) + extra
  return {
    session: { ...session, bankroll: session.bankroll - cost, bets, undo: [...session.undo, added] },
    commands: [{ type: 'sound', name: 'chip' }],
  }
}

/** Starts the spin, locking in the bets on the table. */
export function beginSpin(s: Session): Transition {
  if (s.phase !== 'betting' && s.phase !== 'result') return noChange(s)
  const staked = totalStaked(s.bets)
  if (staked <= 0) return denied(s, 'Place your bets')

  return {
    session: {
      ...s,
      phase: 'spinning',
      lastBets: s.bets,
      lastResult: null,
      undo: [],
      stats: { ...s.stats, wagered: s.stats.wagered + staked },
    },
    commands: [
      { type: 'sound', name: 'noMoreBets' },
      { type: 'message', text: 'No more bets', seconds: NO_MORE_BETS_SECONDS },
      { type: 'save' },
    ],
  }
}

/** Settles the spin on `number`, paying out winners and recording history and stats. */
export function settleSpin(s: Session, number: number): Transition {
  if (s.phase !== 'spinning') return noChange(s)

  const { outcomes, staked, returned } = settleBets(s.bets, number)
  const net = returned - staked
  const result: SpinResult = { number, color: numberColor(number), outcomes, staked, returned, net }

  const bankroll = s.bankroll + returned
  const counts = [...s.stats.counts]
  counts[number] = (counts[number] ?? 0) + 1
  const stats: SessionStats = {
    ...s.stats,
    spins: s.stats.spins + 1,
    returned: s.stats.returned + returned,
    biggestWin: Math.max(s.stats.biggestWin, net),
    bestBankroll: Math.max(s.stats.bestBankroll, bankroll),
    counts,
  }
  const history = [number, ...s.history].slice(0, HISTORY_LENGTH)

  const commands: Command[] = [
    { type: 'message', text: `${number} ${result.color[0]!.toUpperCase()}${result.color.slice(1)}`, seconds: RESULT_MESSAGE_SECONDS },
  ]
  if (isBigWin(staked, net)) commands.push({ type: 'sound', name: 'bigWin' })
  else if (returned > 0) commands.push({ type: 'sound', name: 'win' })
  else if (staked > 0) commands.push({ type: 'sound', name: 'lose' })
  commands.push({ type: 'save' })

  return {
    session: { ...s, phase: 'result', bankroll, bets: {}, lastResult: result, history, stats },
    commands,
  }
}

/** Restores the starting bankroll once the player is broke. */
export function refill(s: Session): Transition {
  if (!isBroke(s)) return noChange(s)
  return {
    session: { ...s, bankroll: STARTING_BANKROLL },
    commands: [{ type: 'sound', name: 'refill' }, { type: 'save' }],
  }
}

/** True when the player has nothing left to bet with and is not mid-spin. */
export function isBroke(s: Session): boolean {
  return s.phase !== 'spinning' && s.bankroll + totalStaked(s.bets) === 0
}

/** UI-enabled flags derived from the session, matching the rules the transitions enforce. */
export function sessionFlags(s: Session): { canSpin: boolean; canUndo: boolean; canClear: boolean; canRebet: boolean; canDouble: boolean } {
  const canBetNow = s.phase === 'betting' || s.phase === 'result'
  const staked = totalStaked(s.bets)

  let canDouble = false
  if (canBetNow) {
    for (const [betId, amount] of Object.entries(s.bets)) {
      const bet = betById(betId)
      if (bet === null) continue
      const extra = Math.min(amount, BET_LIMITS[bet.kind] - amount)
      if (extra > 0 && extra <= s.bankroll) {
        canDouble = true
        break
      }
    }
  }

  return {
    canSpin: canBetNow && staked > 0,
    canUndo: canBetNow && s.undo.length > 0,
    canClear: canBetNow && (Object.keys(s.bets).length > 0 || s.undo.length > 0),
    canRebet: canBetNow && Object.keys(s.bets).length === 0 && s.lastBets !== null && totalStaked(s.lastBets) <= s.bankroll,
    canDouble,
  }
}

/** What gets written to localStorage: the bankroll counts chips still on the table unless spinning. */
export function toSave(s: Session): SessionSave {
  const bankroll = s.phase === 'spinning' ? s.bankroll : s.bankroll + totalStaked(s.bets)
  return {
    version: 1,
    bankroll,
    history: s.history.slice(0, SAVE_HISTORY_LENGTH),
    stats: { ...s.stats, counts: [...s.stats.counts] },
  }
}

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0
}

/** Validates a value read from localStorage. Anything malformed becomes `null`. */
export function parseSessionSave(raw: unknown): SessionSave | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  if (value.version !== 1) return null

  const bankroll = value.bankroll
  if (!isFiniteNonNegative(bankroll) || !Number.isInteger(bankroll) || bankroll > 1e9) return null

  const historyRaw = value.history
  if (!Array.isArray(historyRaw) || historyRaw.length > HISTORY_LENGTH) return null
  const history: number[] = []
  for (const n of historyRaw) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 36) return null
    history.push(n)
  }

  const statsRaw = value.stats
  if (typeof statsRaw !== 'object' || statsRaw === null) return null
  const stats = statsRaw as Record<string, unknown>
  const { spins, wagered, returned, biggestWin, bestBankroll, counts } = stats
  if (!isFiniteNonNegative(spins) || !isFiniteNonNegative(wagered) || !isFiniteNonNegative(returned)) return null
  if (typeof biggestWin !== 'number' || !Number.isFinite(biggestWin)) return null
  if (!isFiniteNonNegative(bestBankroll)) return null
  if (!Array.isArray(counts) || counts.length !== 37) return null
  const parsedCounts: number[] = []
  for (const c of counts) {
    if (!isFiniteNonNegative(c)) return null
    parsedCounts.push(c)
  }

  return {
    version: 1,
    bankroll,
    history: history.slice(0, SAVE_HISTORY_LENGTH),
    stats: { spins, wagered, returned, biggestWin, bestBankroll, counts: parsedCounts },
  }
}
