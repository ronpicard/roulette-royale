import test from 'node:test'
import assert from 'node:assert/strict'
import type { Session, SessionSave } from './types.ts'
import { ALL_BETS, BET_LIMITS, CHIP_VALUES, betById, totalStaked } from './bets.ts'
import {
  BIG_WIN_NET,
  STARTING_BANKROLL,
  beginSpin,
  clearBets,
  createSession,
  double,
  isBroke,
  parseSessionSave,
  placeChip,
  rebet,
  refill,
  removeBet,
  sessionFlags,
  settleSpin,
  toSave,
  undo,
} from './session.ts'

/** A small deterministic PRNG so the "random sequence" test is reproducible. */
function makeLcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function freshSession(): Session {
  return createSession(null)
}

test('placeChip stakes credits and clamps to the bet limit', () => {
  const s0 = freshSession()
  const t1 = placeChip(s0, 'straight:17', 100)
  assert.equal(t1.session.bankroll, STARTING_BANKROLL - 100)
  assert.equal(t1.session.bets['straight:17'], 100)
  assert.deepEqual(t1.commands, [{ type: 'sound', name: 'chip' }])

  // 'straight' has a limit of 250, well under the 1000 bankroll; push past it and the stake
  // clamps to the remaining room rather than the bankroll.
  const t2 = placeChip(t1.session, 'straight:17', 1000)
  assert.equal(t2.session.bets['straight:17'], BET_LIMITS.straight)
  assert.equal(t2.session.bankroll, STARTING_BANKROLL - BET_LIMITS.straight)

  // Now at the limit: a further chip is denied, not clamped to 0.
  const t3 = placeChip(t2.session, 'straight:17', 5)
  assert.deepEqual(t3.session, t2.session)
  assert.equal(t3.commands[0]?.type, 'sound')
  assert.equal((t3.commands[0] as { name: string }).name, 'denied')
  assert.equal(t3.commands[1]?.type, 'message')
  assert.match((t3.commands[1] as { text: string }).text, /^Limit /)
})

test('placeChip clamps to the bankroll and denies at zero bankroll', () => {
  const s0 = freshSession()
  const t1 = placeChip(s0, 'straight:17', STARTING_BANKROLL + 500)
  // straight has a limit of 250, tighter than the bankroll here.
  assert.equal(t1.session.bets['straight:17'], BET_LIMITS.straight)
  assert.equal(t1.session.bankroll, STARTING_BANKROLL - BET_LIMITS.straight)

  const brokeSession: Session = { ...s0, bankroll: 0 }
  const t2 = placeChip(brokeSession, 'red', 5)
  assert.deepEqual(t2.session, brokeSession)
  assert.equal((t2.commands[1] as { text: string }).text, 'Not enough credits')
})

test('placeChip ignores unknown bet ids', () => {
  const s0 = freshSession()
  const t = placeChip(s0, 'not-a-bet', 5)
  assert.deepEqual(t.session, s0)
  assert.deepEqual(t.commands, [])
})

test('placeChip is a no-op while spinning, and reopens betting from result', () => {
  const staked = placeChip(freshSession(), 'red', 5).session
  const spinning = beginSpin(staked).session
  assert.equal(spinning.phase, 'spinning')

  const duringSpin = placeChip(spinning, 'black', 5)
  assert.deepEqual(duringSpin.session, spinning)

  const settled = settleSpin(spinning, 1).session // resolves the spin; the exact outcome doesn't matter here
  assert.equal(settled.phase, 'result')

  const afterResult = placeChip(settled, 'black', 5)
  assert.equal(afterResult.session.phase, 'betting')
  assert.equal(afterResult.session.lastResult, settled.lastResult)
  assert.equal(afterResult.session.bets.black, 5)
})

test('removeBet refunds the stake and clears undo; no-op when absent or spinning', () => {
  const s1 = placeChip(freshSession(), 'red', 20).session
  const s2 = placeChip(s1, 'black', 30).session
  const t = removeBet(s2, 'red')
  assert.equal(t.session.bets.red, undefined)
  assert.equal(t.session.bankroll, STARTING_BANKROLL - 30)
  assert.deepEqual(t.session.undo, [])

  const noop = removeBet(s2, 'green-nope')
  assert.deepEqual(noop.session, s2)

  const spinning = beginSpin(s2).session
  const duringSpin = removeBet(spinning, 'black')
  assert.deepEqual(duringSpin.session, spinning)
})

test('undo pops only the last placement, and is a no-op when empty', () => {
  const s0 = freshSession()
  const noop = undo(s0)
  assert.deepEqual(noop.session, s0)

  const s1 = placeChip(s0, 'red', 10).session
  const s2 = placeChip(s1, 'black', 20).session
  const u1 = undo(s2)
  assert.equal(u1.session.bets.black, undefined)
  assert.equal(u1.session.bets.red, 10)
  assert.equal(u1.session.bankroll, STARTING_BANKROLL - 10)

  const u2 = undo(u1.session)
  assert.equal(u2.session.bets.red, undefined)
  assert.equal(u2.session.bankroll, STARTING_BANKROLL)
  assert.deepEqual(u2.session.undo, [])
})

test('undo reverses a rebet and a double as single steps', () => {
  const placed = placeChip(freshSession(), 'red', 10).session
  const spun = beginSpin(placed).session
  const afterResult = settleSpin(spun, 1).session // resolves the spin; lastBets is what matters here

  const rebetT = rebet(afterResult)
  assert.equal(rebetT.session.bets.red, 10)
  const undoRebet = undo(rebetT.session)
  assert.equal(undoRebet.session.bets.red, undefined)
  assert.equal(undoRebet.session.bankroll, rebetT.session.bankroll + 10)

  const doubled = double(rebetT.session)
  assert.equal(doubled.session.bets.red, 20)
  const undoDouble = undo(doubled.session)
  assert.equal(undoDouble.session.bets.red, 10)
})

test('clearBets refunds everything and empties the undo stack', () => {
  const s1 = placeChip(freshSession(), 'red', 10).session
  const s2 = placeChip(s1, 'black', 15).session
  const t = clearBets(s2)
  assert.deepEqual(t.session.bets, {})
  assert.deepEqual(t.session.undo, [])
  assert.equal(t.session.bankroll, STARTING_BANKROLL)
})

test('rebet denies without lastBets or with bets already on the table, and denies on insufficient bankroll', () => {
  const s0 = freshSession()
  const noLast = rebet(s0)
  assert.deepEqual(noLast.session, s0)

  const placed = placeChip(s0, 'red', 10).session
  const spun = beginSpin(placed).session
  const afterResult = settleSpin(spun, 1).session

  const withBetsOnTable = placeChip(afterResult, 'black', 5).session
  const blocked = rebet(withBetsOnTable)
  assert.deepEqual(blocked.session, withBetsOnTable)

  const poor: Session = { ...afterResult, bankroll: 0 }
  const denied = rebet(poor)
  assert.deepEqual(denied.session.bets, {})
  assert.equal(denied.commands[0] && (denied.commands[0] as { name: string }).name, 'denied')

  const ok = rebet(afterResult)
  assert.equal(ok.session.bets.red, 10)
  assert.equal(ok.session.bankroll, afterResult.bankroll - 10)
})

test('double denies when nothing would change or the bankroll cannot cover it', () => {
  const s0 = freshSession()
  const emptyTable = double(s0)
  assert.deepEqual(emptyTable.session, s0)

  const atLimit = placeChip(s0, 'straight:17', BET_LIMITS.straight).session
  const cantGrow = double(atLimit)
  assert.deepEqual(cantGrow.session.bets, atLimit.bets)
  assert.equal((cantGrow.commands[0] as { name: string }).name, 'denied')

  const s1 = placeChip(s0, 'red', 10).session
  const poor: Session = { ...s1, bankroll: 5 }
  const tooPoor = double(poor)
  assert.deepEqual(tooPoor.session.bets, poor.bets)
  assert.equal((tooPoor.commands[0] as { name: string }).name, 'denied')

  const t = double(s1)
  assert.equal(t.session.bets.red, 20)
  assert.equal(t.session.bankroll, s1.bankroll - 10)
})

test('beginSpin requires at least one credit staked and locks the bets in', () => {
  const s0 = freshSession()
  const empty = beginSpin(s0)
  assert.equal(empty.session.phase, 'betting')
  assert.equal((empty.commands[1] as { text: string }).text, 'Place your bets')

  const staked = placeChip(s0, 'red', 10).session
  const t = beginSpin(staked)
  assert.equal(t.session.phase, 'spinning')
  assert.deepEqual(t.session.lastBets, { red: 10 })
  assert.equal(t.session.lastResult, null)
  assert.deepEqual(t.session.undo, [])
  assert.equal(t.session.stats.wagered, 10)
  assert.ok(t.commands.some((c) => c.type === 'save'))
})

test('settleSpin pays a winning straight at 35:1 and a losing outside bet returns nothing', () => {
  const withBets = placeChip(placeChip(freshSession(), 'straight:17', 10).session, 'red', 20).session
  const spun = beginSpin(withBets).session
  const t = settleSpin(spun, 17) // 17 is black, so the red bet also loses

  assert.equal(t.session.phase, 'result')
  assert.deepEqual(t.session.bets, {})
  const result = t.session.lastResult!
  assert.equal(result.number, 17)
  assert.equal(result.color, 'black')
  assert.equal(result.staked, 30)
  // straight pays 35:1 -> 10 * 36 = 360 back; red bet returns 0.
  assert.equal(result.returned, 360)
  assert.equal(result.net, 330)
  // The stake was already deducted from the bankroll when the chips were placed; settling adds
  // only what comes back.
  assert.equal(t.session.bankroll, withBets.bankroll + 360)
  assert.equal(t.session.stats.spins, 1)
  assert.equal(t.session.stats.returned, 360)
  assert.equal(t.session.stats.counts[17], 1)
  assert.equal(t.session.history[0], 17)

  const straightOutcome = result.outcomes.find((o) => o.betId === 'straight:17')!
  assert.equal(straightOutcome.returned, 360)
  const redOutcome = result.outcomes.find((o) => o.betId === 'red')!
  assert.equal(redOutcome.returned, 0)
})

test('settleSpin is a no-op outside the spinning phase', () => {
  const s0 = freshSession()
  const t = settleSpin(s0, 5)
  assert.deepEqual(t.session, s0)
})

test('a big win (>= BIG_WIN_NET, or >= 20x stake) plays bigWin', () => {
  const spun = beginSpin(placeChip(freshSession(), 'straight:17', 20).session).session
  const t = settleSpin(spun, 17) // 20 * 36 = 720 returned, net 700 >= BIG_WIN_NET
  assert.ok(t.session.lastResult!.net >= BIG_WIN_NET)
  assert.ok(t.commands.some((c) => c.type === 'sound' && c.name === 'bigWin'))
})

test('a plain win plays win, a loss plays lose', () => {
  const smallWin = beginSpin(placeChip(freshSession(), 'red', 5).session).session
  const winT = settleSpin(smallWin, 1) // 1 is red
  assert.ok(winT.commands.some((c) => c.type === 'sound' && c.name === 'win'))

  const loser = beginSpin(placeChip(freshSession(), 'red', 5).session).session
  const loseT = settleSpin(loser, 2) // 2 is black
  assert.ok(loseT.commands.some((c) => c.type === 'sound' && c.name === 'lose'))
})

test('isBroke and refill', () => {
  const s0 = freshSession()
  assert.equal(isBroke(s0), false)

  const broke: Session = { ...s0, bankroll: 0, bets: {} }
  assert.equal(isBroke(broke), true)

  const notBroke = refill(s0)
  assert.deepEqual(notBroke.session, s0)

  const refilled = refill(broke)
  assert.equal(refilled.session.bankroll, STARTING_BANKROLL)
  assert.ok(refilled.commands.some((c) => c.type === 'sound' && c.name === 'refill'))
  assert.ok(refilled.commands.some((c) => c.type === 'save'))

  // Staked chips still count as not broke.
  const stakedOnly: Session = { ...s0, bankroll: 0, bets: { red: 5 } }
  assert.equal(isBroke(stakedOnly), false)

  // Never broke mid-spin.
  const spinning: Session = { ...s0, phase: 'spinning', bankroll: 0, bets: {} }
  assert.equal(isBroke(spinning), false)
})

test('sessionFlags reflects the rules', () => {
  const s0 = freshSession()
  assert.deepEqual(sessionFlags(s0), { canSpin: false, canUndo: false, canClear: false, canRebet: false, canDouble: false })

  const staked = placeChip(s0, 'red', 10).session
  assert.deepEqual(sessionFlags(staked), { canSpin: true, canUndo: true, canClear: true, canRebet: false, canDouble: true })

  const spinning = beginSpin(staked).session
  assert.deepEqual(sessionFlags(spinning), { canSpin: false, canUndo: false, canClear: false, canRebet: false, canDouble: false })

  const afterResult = settleSpin(spinning, 2).session
  assert.equal(sessionFlags(afterResult).canRebet, true)
})

test('toSave and parseSessionSave round-trip', () => {
  const staked = placeChip(freshSession(), 'red', 10).session
  const spun = beginSpin(staked).session
  const afterResult = settleSpin(spun, 1).session
  const withExtraBets = placeChip(afterResult, 'black', 25).session

  const save = toSave(withExtraBets)
  // Betting-phase bankroll folds chips on the table back in.
  assert.equal(save.bankroll, withExtraBets.bankroll + 25)
  assert.equal(save.version, 1)

  const parsed = parseSessionSave(save)
  assert.deepEqual(parsed, save)

  const restored = createSession(parsed)
  assert.equal(restored.bankroll, save.bankroll)
  assert.deepEqual(restored.history, save.history)
  assert.deepEqual(restored.stats, save.stats)
})

test('toSave keeps the spinning bankroll as-is (the stake is already committed)', () => {
  const staked = placeChip(freshSession(), 'red', 10).session
  const spinning = beginSpin(staked).session
  const save = toSave(spinning)
  assert.equal(save.bankroll, spinning.bankroll)
})

test('parseSessionSave rejects malformed data', () => {
  assert.equal(parseSessionSave(null), null)
  assert.equal(parseSessionSave(undefined), null)
  assert.equal(parseSessionSave('nope'), null)
  assert.equal(parseSessionSave(42), null)
  assert.equal(parseSessionSave({}), null)

  const base: SessionSave = {
    version: 1,
    bankroll: 1000,
    history: [1, 2, 3],
    stats: { spins: 1, wagered: 10, returned: 5, biggestWin: 0, bestBankroll: 1000, counts: new Array(37).fill(0) },
  }
  assert.deepEqual(parseSessionSave(base), base)

  assert.equal(parseSessionSave({ ...base, version: 2 }), null)
  assert.equal(parseSessionSave({ ...base, bankroll: -5 }), null)
  assert.equal(parseSessionSave({ ...base, bankroll: 'lots' }), null)
  assert.equal(parseSessionSave({ ...base, bankroll: 1.5 }), null)
  assert.equal(parseSessionSave({ ...base, history: [1, 2, 37] }), null)
  assert.equal(parseSessionSave({ ...base, history: ['1', '2'] }), null)
  assert.equal(parseSessionSave({ ...base, stats: { ...base.stats, counts: new Array(36).fill(0) } }), null)
  assert.equal(parseSessionSave({ ...base, stats: { ...base.stats, counts: new Array(37).fill('x') } }), null)
  assert.equal(parseSessionSave({ ...base, stats: null }), null)
  assert.equal(parseSessionSave({ ...base, stats: { ...base.stats, spins: -1 } }), null)

  // Oversized history is rejected outright; a valid save's history is truncated to 50 on save,
  // but parsing accepts up to HISTORY_LENGTH (200) and truncates.
  const longHistory = new Array(120).fill(7)
  const parsed = parseSessionSave({ ...base, history: longHistory })
  assert.equal(parsed?.history.length, 50)

  const tooLong = new Array(500).fill(7)
  assert.equal(parseSessionSave({ ...base, history: tooLong }), null)
})

test('bankroll conservation across a random sequence of transitions', () => {
  const rand = makeLcg(0xc0ffee)
  let session = freshSession()
  let expectedCredits = session.bankroll

  const creditsValue = (s: Session) => s.bankroll + totalStaked(s.bets)
  assert.equal(creditsValue(session), expectedCredits)

  for (let i = 0; i < 400; i++) {
    if (isBroke(session)) {
      session = refill(session).session
      expectedCredits = STARTING_BANKROLL
      assert.equal(creditsValue(session), expectedCredits)
      continue
    }

    const roll = rand()
    if (roll < 0.35) {
      const bet = ALL_BETS[Math.floor(rand() * ALL_BETS.length)]!
      const amount = CHIP_VALUES[Math.floor(rand() * CHIP_VALUES.length)]!
      session = placeChip(session, bet.id, amount).session
    } else if (roll < 0.45) {
      const ids = Object.keys(session.bets)
      if (ids.length > 0) session = removeBet(session, ids[Math.floor(rand() * ids.length)]!).session
    } else if (roll < 0.55) {
      session = undo(session).session
    } else if (roll < 0.6) {
      session = clearBets(session).session
    } else if (roll < 0.7) {
      session = rebet(session).session
    } else if (roll < 0.8) {
      session = double(session).session
    } else {
      const spun = beginSpin(session)
      session = spun.session
      if (session.phase === 'spinning') {
        const number = Math.floor(rand() * 37)
        const settled = settleSpin(session, number)
        session = settled.session
        expectedCredits += session.lastResult!.net
      }
    }

    assert.equal(creditsValue(session), expectedCredits, `mismatch at step ${i}`)
  }
})

test('a known bet id from betById survives placeChip and settlement round-trip', () => {
  const bet = betById('dozen:1')!
  const t = placeChip(freshSession(), bet.id, 50).session
  const spun = beginSpin(t).session
  const settled = settleSpin(spun, 5) // 5 is in the 1st dozen
  assert.ok(settled.session.lastResult!.returned > 0)
})
