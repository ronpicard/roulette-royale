import test from 'node:test'
import assert from 'node:assert/strict'
import type { SpinResult } from './types.ts'
import { BIG_LOSS_STAKE, PARTIAL_LOSS_STRENGTH, crowdReaction } from './crowd.ts'

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

test('a total loss draws a groan that grows with the stake', () => {
  const small = crowdReaction(result(5, 0))
  const big = crowdReaction(result(BIG_LOSS_STAKE, 0))
  const huge = crowdReaction(result(BIG_LOSS_STAKE * 4, 0))
  assert.equal(small?.kind, 'groan')
  assert.ok(small!.strength >= 0.5 && small!.strength < big!.strength)
  assert.equal(big!.strength, 1)
  assert.equal(huge!.strength, 1)
})

test('a partial loss draws a soft groan', () => {
  assert.deepEqual(crowdReaction(result(20, 10)), { kind: 'groan', strength: PARTIAL_LOSS_STRENGTH })
})
