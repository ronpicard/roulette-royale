import test from 'node:test'
import assert from 'node:assert/strict'
import { BET_LIMITS, betById, totalStaked } from './bets.ts'
import { attractBets } from './autoplay.ts'

const BANKROLL = 1000

test('attractBets only stakes valid bet ids', () => {
  const bets = attractBets(1, BANKROLL)
  for (const betId of Object.keys(bets)) {
    assert.notEqual(betById(betId), null, `unknown bet id: ${betId}`)
  }
})

test('attractBets keeps every stake within its bet kind limit', () => {
  for (let seed = 0; seed < 50; seed++) {
    const bets = attractBets(seed, BANKROLL)
    for (const [betId, amount] of Object.entries(bets)) {
      const bet = betById(betId)!
      assert.ok(amount > 0, `stake on ${betId} must be positive`)
      assert.ok(amount <= BET_LIMITS[bet.kind], `stake on ${betId} (${amount}) exceeds its limit (${BET_LIMITS[bet.kind]})`)
    }
  }
})

test('attractBets never stakes more than the bankroll', () => {
  for (let seed = 0; seed < 50; seed++) {
    for (const bankroll of [0, 1, 10, 100, BANKROLL, 5000]) {
      const bets = attractBets(seed, bankroll)
      assert.ok(totalStaked(bets) <= bankroll, `seed ${seed} bankroll ${bankroll}: staked ${totalStaked(bets)}`)
    }
  }
})

test('attractBets draws 3 to 7 bets when the bankroll comfortably allows it', () => {
  for (let seed = 0; seed < 50; seed++) {
    const bets = attractBets(seed, BANKROLL)
    const count = Object.keys(bets).length
    assert.ok(count >= 3 && count <= 7, `seed ${seed} drew ${count} bets`)
  }
})

test('attractBets is deterministic for the same seed and bankroll', () => {
  for (let seed = 0; seed < 10; seed++) {
    assert.deepEqual(attractBets(seed, BANKROLL), attractBets(seed, BANKROLL))
  }
})

test('attractBets varies across seeds', () => {
  const results = new Set<string>()
  for (let seed = 0; seed < 20; seed++) {
    results.add(JSON.stringify(attractBets(seed, BANKROLL)))
  }
  assert.ok(results.size > 1, 'attractBets produced the same bets for every seed')
})

test('attractBets places nothing with zero bankroll', () => {
  assert.deepEqual(attractBets(1, 0), {})
})
