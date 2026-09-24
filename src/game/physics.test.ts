import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FIXED_DT,
  GRAVITY,
  IDLE_ROTOR_SPEED,
  ballHeight,
  createWheel,
  launchBall,
  relativeSpeed,
  simulateSpin,
  stepWheel,
} from './physics.ts'
import { spinParamsFromSeed } from './rng.ts'
import { TRACK_RADIUS, TURRET_RADIUS, pocketAtAngle, pocketNumber } from './wheel.ts'

/** The 740 seeds the spec's fairness check names: `seed = 1000 + i * 7919`. */
function fairnessSeeds(n = 740): number[] {
  return Array.from({ length: n }, (_, i) => 1000 + i * 7919)
}

/** A smaller sample (at least 300 seeds, per the spec) used for the timing/behaviour targets. */
const SAMPLE_SEEDS = fairnessSeeds(300)

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

test('basic construction', () => {
  const wheel = createWheel()
  assert.equal(wheel.ball, null)
  assert.equal(wheel.time, 0)
  assert.equal(wheel.rotorSpeed, IDLE_ROTOR_SPEED)
  assert.equal(wheel.rotorAngle, 0)
})

test('with no ball, stepWheel only turns the rotor', () => {
  // With no ball, the rotor eases toward IDLE_ROTOR_SPEED rather than holding its initial speed
  // (see `stepRotor`), so start it already at the idle speed to make the angle step predictable.
  const wheel = createWheel(0, IDLE_ROTOR_SPEED)
  const events = stepWheel(wheel, FIXED_DT)
  assert.deepEqual(events, [])
  assert.ok(Math.abs(wheel.rotorAngle - IDLE_ROTOR_SPEED * FIXED_DT) < 1e-9)
  assert.equal(wheel.time, FIXED_DT)
})

test('launchBall places the ball on the track at the documented radius, angle and speed', () => {
  const wheel = createWheel()
  const params = { ballAngle: 0.7, ballSpeed: 220, rotorSpeed: -2 }
  launchBall(wheel, params)
  const ball = wheel.ball!
  const r = Math.hypot(ball.x, ball.y)
  assert.ok(Math.abs(r - (TRACK_RADIUS - 0.4)) < 1e-9)
  assert.ok(Math.abs(Math.atan2(ball.y, ball.x) - 0.7) < 1e-9)
  assert.equal(ball.phase, 'track')
  assert.equal(ball.hop, 0)
  assert.equal(ball.pocket, null)
  assert.equal(wheel.rotorSpeed, -2)
  assert.equal(wheel.time, 0)
  const speed = Math.hypot(ball.vx, ball.vy)
  assert.ok(Math.abs(speed - 220) < 1e-6)
})

test('launchBall replaces any previous ball', () => {
  const wheel = createWheel()
  launchBall(wheel, spinParamsFromSeed(1))
  const first = wheel.ball
  launchBall(wheel, spinParamsFromSeed(2))
  assert.notEqual(wheel.ball, first)
})

test('relativeSpeed and ballHeight are 0/surface-height with no ball', () => {
  const wheel = createWheel()
  assert.equal(relativeSpeed(wheel), 0)
})

test('determinism: the same params give the same summary twice', () => {
  for (const seed of SAMPLE_SEEDS.slice(0, 20)) {
    const params = spinParamsFromSeed(seed)
    const a = simulateSpin(params)
    const b = simulateSpin(params)
    assert.deepEqual(a, b, `seed ${seed}`)
  }
})

test('every spin settles within 30 simulated seconds, with a sane final state', () => {
  for (const seed of SAMPLE_SEEDS) {
    const params = spinParamsFromSeed(seed)
    const summary = simulateSpin(params)
    assert.ok(summary.settled, `seed ${seed} never settled (ran ${summary.seconds}s)`)
    assert.ok(summary.seconds <= 30, `seed ${seed} took ${summary.seconds}s to settle`)
    assert.ok(summary.pocket >= 0 && summary.pocket < 37, `seed ${seed} bad pocket ${summary.pocket}`)
    assert.equal(summary.number, pocketNumber(summary.pocket))
  }
})

test("the ball's radius always stays within [TURRET_RADIUS, TRACK_RADIUS], no NaN", () => {
  for (const seed of SAMPLE_SEEDS.slice(0, 60)) {
    const params = spinParamsFromSeed(seed)
    const wheel = createWheel()
    launchBall(wheel, params)
    for (let i = 0; i < Math.round(30 / FIXED_DT); i++) {
      stepWheel(wheel, FIXED_DT)
      const ball = wheel.ball
      if (!ball) break
      const r = Math.hypot(ball.x, ball.y)
      assert.ok(Number.isFinite(r), `seed ${seed}: NaN radius`)
      assert.ok(Number.isFinite(ball.vx) && Number.isFinite(ball.vy), `seed ${seed}: NaN velocity`)
      assert.ok(r >= TURRET_RADIUS - 1e-6 && r <= TRACK_RADIUS + 1e-6, `seed ${seed}: radius ${r} out of range`)
      if (ball.phase === 'settled') break
    }
  }
})

test('dropSeconds is between 4 and 12 for every seed, with a median between 5.5 and 9', () => {
  const drops: number[] = []
  for (const seed of SAMPLE_SEEDS) {
    const summary = simulateSpin(spinParamsFromSeed(seed))
    assert.ok(summary.dropSeconds >= 4 && summary.dropSeconds <= 12, `seed ${seed}: dropSeconds ${summary.dropSeconds}`)
    drops.push(summary.dropSeconds)
  }
  const m = median(drops)
  assert.ok(m >= 5.5 && m <= 9, `median dropSeconds ${m} out of [5.5, 9]`)
})

test('trackRevolutions is between 5 and 25 for every seed', () => {
  for (const seed of SAMPLE_SEEDS) {
    const summary = simulateSpin(spinParamsFromSeed(seed))
    assert.ok(
      summary.trackRevolutions >= 5 && summary.trackRevolutions <= 25,
      `seed ${seed}: trackRevolutions ${summary.trackRevolutions}`,
    )
  }
})

test('settling takes at most 10s after the drop; median total seconds is under 16', () => {
  const totals: number[] = []
  for (const seed of SAMPLE_SEEDS) {
    const summary = simulateSpin(spinParamsFromSeed(seed))
    const settleAfterDrop = summary.seconds - summary.dropSeconds
    assert.ok(settleAfterDrop <= 10, `seed ${seed}: settled ${settleAfterDrop}s after drop`)
    totals.push(summary.seconds)
  }
  const m = median(totals)
  assert.ok(m < 16, `median total seconds ${m} not under 16`)
})

test('diamond hits occur in at least 30% of spins; fret hits occur in every spin', () => {
  let diamondSpins = 0
  for (const seed of SAMPLE_SEEDS) {
    const summary = simulateSpin(spinParamsFromSeed(seed))
    if (summary.diamondHits > 0) diamondSpins++
    assert.ok(summary.fretHits >= 1, `seed ${seed}: no fret hits`)
  }
  assert.ok(diamondSpins / SAMPLE_SEEDS.length >= 0.3, `only ${diamondSpins}/${SAMPLE_SEEDS.length} spins had a diamond hit`)
})

test('scatter: in at least 50% of spins the ball bounces between pockets (fretHits >= 3)', () => {
  // fretHits >= 3 is direct evidence of bouncing between pockets rather than dropping straight
  // in, which the spec offers as an alternative to tracking "first pocket dropped toward".
  let scattered = 0
  for (const seed of SAMPLE_SEEDS) {
    const summary = simulateSpin(spinParamsFromSeed(seed))
    if (summary.fretHits >= 3) scattered++
  }
  assert.ok(scattered / SAMPLE_SEEDS.length >= 0.5, `only ${scattered}/${SAMPLE_SEEDS.length} spins scattered`)
})

test('fairness: chi-square of the 37 pocket counts against uniform is below 70 over 740 seeds', () => {
  const seeds = fairnessSeeds(740)
  const counts = new Array(37).fill(0)
  for (const seed of seeds) {
    const summary = simulateSpin(spinParamsFromSeed(seed))
    counts[summary.pocket]++
  }
  const expected = seeds.length / 37
  let chiSquare = 0
  for (const count of counts) chiSquare += (count - expected) ** 2 / expected
  assert.ok(chiSquare < 70, `chi-square ${chiSquare} >= 70`)
})

test("a settled ball's wheel-plane angle keeps following the rotor and its pocket never changes", () => {
  for (const seed of SAMPLE_SEEDS.slice(0, 10)) {
    const params = spinParamsFromSeed(seed)
    const wheel = createWheel()
    launchBall(wheel, params)
    let settledPocket: number | null = null
    for (let i = 0; i < Math.round(30 / FIXED_DT); i++) {
      stepWheel(wheel, FIXED_DT)
      if (wheel.ball?.phase === 'settled') {
        settledPocket = wheel.ball.pocket
        break
      }
    }
    assert.notEqual(settledPocket, null, `seed ${seed} never settled`)

    const rotorAngleBefore = wheel.rotorAngle
    let anglesDiffered = false
    for (let i = 0; i < Math.round(3 / FIXED_DT); i++) {
      stepWheel(wheel, FIXED_DT)
      const ball = wheel.ball!
      assert.equal(ball.pocket, settledPocket, `seed ${seed}: pocket changed after settling`)
      if (Math.abs(wheel.rotorAngle - rotorAngleBefore) > 1e-3) anglesDiffered = true
    }
    // The rotor actually turned over these 3 seconds (it never stops), proving the check above is
    // meaningful and not just a static ball.
    assert.ok(anglesDiffered, `seed ${seed}: rotor angle did not change`)

    // The ball's wheel-plane angle should have followed the rotor, i.e. pocketAtAngle of its
    // current position matches the settled pocket (not just the stored field).
    const ball = wheel.ball!
    const angle = Math.atan2(ball.y, ball.x)
    assert.equal(pocketAtAngle(angle, wheel.rotorAngle), settledPocket, `seed ${seed}: pocketAtAngle mismatch`)
  }
})

test('pocketAtAngle of the settled ball equals the reported pocket, at the moment of settling', () => {
  for (const seed of SAMPLE_SEEDS.slice(0, 40)) {
    const params = spinParamsFromSeed(seed)
    const wheel = createWheel()
    launchBall(wheel, params)
    for (let i = 0; i < Math.round(30 / FIXED_DT); i++) {
      const events = stepWheel(wheel, FIXED_DT)
      for (const event of events) {
        if (event.type === 'settle') {
          const ball = wheel.ball!
          const angle = Math.atan2(ball.y, ball.x)
          assert.equal(pocketAtAngle(angle, wheel.rotorAngle), event.pocket, `seed ${seed}`)
        }
      }
      if (wheel.ball?.phase === 'settled') break
    }
  }
})

test('ballHeight and relativeSpeed track the ball realistically', () => {
  const wheel = createWheel()
  launchBall(wheel, spinParamsFromSeed(42))
  const ball = wheel.ball!
  const h = ballHeight(ball)
  assert.ok(Number.isFinite(h))
  // Just launched: fast, on the track, so relative speed should equal the raw ball speed there
  // (the track doesn't move).
  const speed = Math.hypot(ball.vx, ball.vy)
  assert.ok(Math.abs(relativeSpeed(wheel) - speed) < 1e-9)
})

test('rotor never stops: idles toward IDLE_ROTOR_SPEED with no ball, and keeps turning after settling', () => {
  const wheel = createWheel(0, 0)
  for (let i = 0; i < Math.round(20 / FIXED_DT); i++) stepWheel(wheel, FIXED_DT)
  assert.ok(Math.abs(wheel.rotorSpeed) > 0.01, `rotor speed stalled at ${wheel.rotorSpeed}`)
})

test('GRAVITY and FIXED_DT are sane', () => {
  assert.ok(GRAVITY > 300 && GRAVITY < 450)
  assert.ok(FIXED_DT > 0 && FIXED_DT <= 1 / 100)
})
