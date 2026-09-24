import test from 'node:test'
import assert from 'node:assert/strict'
import type { SpinResult } from './types.ts'
import { numberColor } from './wheel.ts'
import {
  BIG_LOSS_STAKE,
  NO_MORE_BETS_CALLOUT,
  PARTIAL_LOSS_STRENGTH,
  crowdReaction,
  numberWords,
  resultCallout,
} from './crowd.ts'

function result(staked: number, returned: number): SpinResult {
  return { number: 7, color: 'red', outcomes: [], staked, returned, net: returned - staked }
}

test('no reaction without a result, a stake, or a net change', () => {
  assert.equal(crowdReaction(null), null)
  assert.equal(crowdReaction(result(0, 0)), null)
  assert.equal(crowdReaction(result(10, 10)), null)
})

test('a net win draws a cheer that grows with the payout', () => {
  const evenMoney = crowdReaction(result(10, 20))
  const dozen = crowdReaction(result(10, 30))
  const split = crowdReaction(result(10, 180))
  assert.equal(evenMoney?.kind, 'cheer')
  assert.equal(dozen?.kind, 'cheer')
  assert.equal(split?.kind, 'cheer')
  assert.ok(evenMoney!.strength > 0 && evenMoney!.strength < dozen!.strength)
  assert.ok(dozen!.strength < split!.strength && split!.strength < 1)
})

test('a big win draws the loudest cheer', () => {
  assert.deepEqual(crowdReaction(result(10, 360)), { kind: 'cheer', strength: 1 })
  assert.deepEqual(crowdReaction(result(500, 1000)), { kind: 'cheer', strength: 1 })
})

test('a total loss draws a boo that grows with the stake', () => {
  const small = crowdReaction(result(5, 0))
  const big = crowdReaction(result(BIG_LOSS_STAKE, 0))
  const huge = crowdReaction(result(BIG_LOSS_STAKE * 4, 0))
  assert.equal(small?.kind, 'boo')
  assert.ok(small!.strength >= 0.5 && small!.strength < big!.strength)
  assert.equal(big!.strength, 1)
  assert.equal(huge!.strength, 1)
})

test('a partial loss draws a soft boo', () => {
  assert.deepEqual(crowdReaction(result(20, 10)), { kind: 'boo', strength: PARTIAL_LOSS_STRENGTH })
})

test('every pocket number is spelled out', () => {
  assert.equal(numberWords(0), 'zero')
  assert.equal(numberWords(13), 'thirteen')
  assert.equal(numberWords(20), 'twenty')
  assert.equal(numberWords(36), 'thirty-six')
  for (let n = 0; n <= 36; n++) assert.match(numberWords(n), /^[a-z]+(-[a-z]+)?$/)
  assert.throws(() => numberWords(37), RangeError)
  assert.throws(() => numberWords(1.5), RangeError)
})

test('the croupier calls the number and its colour', () => {
  assert.equal(resultCallout(17, numberColor(17)), 'Seventeen, black.')
  assert.equal(resultCallout(32, numberColor(32)), 'Thirty-two, red.')
  assert.equal(resultCallout(0, numberColor(0)), 'Zero.')
  assert.equal(NO_MORE_BETS_CALLOUT, 'No more bets.')
})
