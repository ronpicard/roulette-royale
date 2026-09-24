import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRng, spinParamsFromSeed } from './rng.ts'

test('createRng is deterministic for a given seed', () => {
  const a = createRng(42)
  const b = createRng(42)
  const seqA = Array.from({ length: 20 }, () => a())
  const seqB = Array.from({ length: 20 }, () => b())
  assert.deepEqual(seqA, seqB)
})

test('createRng returns numbers in [0, 1)', () => {
  const rng = createRng(1)
  for (let i = 0; i < 10000; i++) {
    const v = rng()
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`)
  }
})

test('createRng varies with the seed and across calls', () => {
  const a = createRng(1)
  const b = createRng(2)
  assert.notEqual(a(), b())
  const rng = createRng(7)
  const v1 = rng()
  const v2 = rng()
  assert.notEqual(v1, v2)
})

test('spinParamsFromSeed is deterministic', () => {
  const p1 = spinParamsFromSeed(123456)
  const p2 = spinParamsFromSeed(123456)
  assert.deepEqual(p1, p2)
})

test('spinParamsFromSeed produces values in the documented ranges', () => {
  for (let i = 0; i < 500; i++) {
    const seed = i * 104729
    const p = spinParamsFromSeed(seed)
    assert.ok(p.ballAngle >= 0 && p.ballAngle < 2 * Math.PI, `ballAngle out of range: ${p.ballAngle}`)
    assert.ok(Math.abs(p.ballSpeed) >= 190 && Math.abs(p.ballSpeed) < 260, `ballSpeed magnitude out of range: ${p.ballSpeed}`)
    assert.ok(Math.abs(p.rotorSpeed) >= 1.6 && Math.abs(p.rotorSpeed) < 2.8, `rotorSpeed magnitude out of range: ${p.rotorSpeed}`)
    // Rotor spins opposite the ball.
    assert.equal(Math.sign(p.ballSpeed), -Math.sign(p.rotorSpeed))
  }
})

test('spinParamsFromSeed varies across seeds', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 50; i++) {
    const p = spinParamsFromSeed(1000 + i * 7919)
    seen.add(`${p.ballAngle.toFixed(6)}:${p.ballSpeed.toFixed(6)}:${p.rotorSpeed.toFixed(6)}`)
  }
  assert.ok(seen.size > 40, `expected varied spins, got ${seen.size} unique out of 50`)
})

test('both directions occur', () => {
  let positive = 0
  let negative = 0
  for (let i = 0; i < 200; i++) {
    const p = spinParamsFromSeed(2000 + i * 6151)
    if (p.ballSpeed > 0) positive++
    else negative++
  }
  assert.ok(positive > 50, `expected a good mix, got ${positive} positive`)
  assert.ok(negative > 50, `expected a good mix, got ${negative} negative`)
})
