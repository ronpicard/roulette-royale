import test from 'node:test'
import assert from 'node:assert/strict'
import type { BetKind } from './types.ts'
import { ALL_BETS, CHIP_VALUES, PAYOUTS, chipBreakdown, settleBets } from './bets.ts'

test('ALL_BETS has 157 unique ids split by kind as expected', () => {
  const ids = ALL_BETS.map((b) => b.id)
  assert.equal(ids.length, 157)
  assert.equal(new Set(ids).size, 157)

  const counts: Record<BetKind, number> = {
    straight: 0,
    split: 0,
    street: 0,
    trio: 0,
    corner: 0,
    firstFour: 0,
    sixLine: 0,
    column: 0,
    dozen: 0,
    red: 0,
    black: 0,
    odd: 0,
    even: 0,
    low: 0,
    high: 0,
  }
  for (const bet of ALL_BETS) counts[bet.kind]++

  assert.equal(counts.straight, 37)
  assert.equal(counts.split, 60)
  assert.equal(counts.street, 12)
  assert.equal(counts.trio, 2)
  assert.equal(counts.corner, 22)
  assert.equal(counts.firstFour, 1)
  assert.equal(counts.sixLine, 11)
  assert.equal(counts.column, 3)
  assert.equal(counts.dozen, 3)
  assert.equal(counts.red + counts.black + counts.odd + counts.even + counts.low + counts.high, 6)
})

test('every number 1-36 belongs to exactly one bet of each even-money/dozen/column family, 0 to none', () => {
  const families: BetKind[][] = [['red', 'black'], ['odd', 'even'], ['low', 'high']]
  for (const family of families) {
    const bets = ALL_BETS.filter((b) => family.includes(b.kind))
    for (let n = 1; n <= 36; n++) {
      const covering = bets.filter((b) => b.numbers.includes(n))
      assert.equal(covering.length, 1, `number ${n} should be in exactly one of ${family.join('/')}`)
    }
    for (const bet of bets) assert.ok(!bet.numbers.includes(0))
  }

  const dozens = ALL_BETS.filter((b) => b.kind === 'dozen')
  const columns = ALL_BETS.filter((b) => b.kind === 'column')
  for (let n = 1; n <= 36; n++) {
    assert.equal(dozens.filter((b) => b.numbers.includes(n)).length, 1)
    assert.equal(columns.filter((b) => b.numbers.includes(n)).length, 1)
  }
  for (const bet of [...dozens, ...columns]) assert.ok(!bet.numbers.includes(0))
})

test('settleBets pays stake * (payout + 1) for winners and 0 for losers', () => {
  const { outcomes, staked, returned } = settleBets({ 'straight:17': 10, red: 20, 'split:1-2': 5 }, 17)
  assert.equal(staked, 35)
  const straight = outcomes.find((o) => o.betId === 'straight:17')!
  assert.equal(straight.returned, 10 * (PAYOUTS.straight + 1))
  const red = outcomes.find((o) => o.betId === 'red')!
  // 17 is black, so 'red' loses.
  assert.equal(red.returned, 0)
  const split = outcomes.find((o) => o.betId === 'split:1-2')!
  // split 1/2 does not cover 17.
  assert.equal(split.returned, 0)
  assert.equal(returned, straight.returned)

  // Unknown bet ids return nothing and do not throw.
  const unknown = settleBets({ 'nope:1': 5 }, 0)
  assert.equal(unknown.outcomes[0]?.returned, 0)
  assert.equal(unknown.returned, 0)
})

test('every bet kind has a house edge of exactly 1/37 (expected return 36/37 per credit)', () => {
  const kinds = new Set(ALL_BETS.map((b) => b.kind))
  for (const kind of kinds) {
    const bet = ALL_BETS.find((b) => b.kind === kind)!
    let expectedReturn = 0
    for (let number = 0; number <= 36; number++) {
      const { returned } = settleBets({ [bet.id]: 1 }, number)
      expectedReturn += returned
    }
    expectedReturn /= 37
    assert.ok(
      Math.abs(expectedReturn - 36 / 37) < 1e-9,
      `${kind} expected return ${expectedReturn} should equal 36/37`,
    )
  }
})

test('chipBreakdown is greedy and always sums back to the amount', () => {
  assert.deepEqual(chipBreakdown(0), [])
  assert.deepEqual(chipBreakdown(1), [1])
  assert.deepEqual(chipBreakdown(6), [5, 1])
  assert.deepEqual(chipBreakdown(631), [500, 100, 25, 5, 1])

  for (const amount of [0, 1, 4, 7, 25, 99, 250, 1000, 1234, 4999]) {
    const chips = chipBreakdown(amount)
    assert.equal(
      chips.reduce((sum, c) => sum + c, 0),
      amount,
    )
    // Greedy: never uses more of a smaller denomination than one fewer of the next size up would allow.
    for (const value of CHIP_VALUES) {
      const count = chips.filter((c) => c === value).length
      const nextIndex = CHIP_VALUES.indexOf(value) + 1
      if (nextIndex < CHIP_VALUES.length) {
        const next = CHIP_VALUES[nextIndex]!
        assert.ok(count * value < next, `should not use ${count} x ${value} when ${next} is available`)
      }
    }
  }
})
