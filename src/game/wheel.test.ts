import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DIAMONDS,
  DIAMOND_COUNT,
  DIAMOND_RADIUS,
  POCKET_ANGLE,
  POCKET_COUNT,
  POCKET_OUTER_RADIUS,
  ROTOR_RADIUS,
  TRACK_INNER_RADIUS,
  TRACK_RADIUS,
  TURRET_RADIUS,
  WHEEL_ORDER,
  numberColor,
  pocketAtAngle,
  pocketCentreAngle,
  pocketIndexOfNumber,
  pocketNumber,
  surfaceHeight,
  surfaceSlope,
} from './wheel.ts'

test('WHEEL_ORDER holds 0 to 36 exactly once', () => {
  assert.equal(WHEEL_ORDER.length, POCKET_COUNT)
  const seen = new Set(WHEEL_ORDER)
  assert.equal(seen.size, 37)
  for (let n = 0; n <= 36; n++) assert.ok(seen.has(n), `missing ${n}`)
})

test('18 red, 18 black, 1 green', () => {
  let red = 0
  let black = 0
  let green = 0
  for (const n of WHEEL_ORDER) {
    const c = numberColor(n)
    if (c === 'red') red++
    else if (c === 'black') black++
    else green++
  }
  assert.equal(red, 18)
  assert.equal(black, 18)
  assert.equal(green, 1)
})

test('colours alternate red/black around the wheel after zero', () => {
  // WHEEL_ORDER[0] is 0 (green); every consecutive pair after that alternates colour.
  assert.equal(WHEEL_ORDER[0], 0)
  for (let i = 1; i < WHEEL_ORDER.length - 1; i++) {
    const a = numberColor(WHEEL_ORDER[i]!)
    const b = numberColor(WHEEL_ORDER[i + 1]!)
    assert.notEqual(a, b, `pockets ${i} and ${i + 1} (numbers ${WHEEL_ORDER[i]}/${WHEEL_ORDER[i + 1]}) are both ${a}`)
  }
  // Wrap-around: last pocket to zero.
  const last = numberColor(WHEEL_ORDER[WHEEL_ORDER.length - 1]!)
  assert.notEqual(last, 'green')
})

test('pocketNumber / pocketIndexOfNumber round-trip', () => {
  for (let i = 0; i < POCKET_COUNT; i++) {
    const n = pocketNumber(i)
    assert.equal(pocketIndexOfNumber(n), i)
  }
  // pocketNumber wraps modulo POCKET_COUNT, including negative indices.
  assert.equal(pocketNumber(POCKET_COUNT), pocketNumber(0))
  assert.equal(pocketNumber(-1), pocketNumber(POCKET_COUNT - 1))
})

test('pocketAtAngle(pocketCentreAngle(i, r), r) === i for all i and a few rotor angles', () => {
  const rotorAngles = [0, 0.5, 1.2345, -2, Math.PI, 10.7, -37.2]
  for (const rotorAngle of rotorAngles) {
    for (let i = 0; i < POCKET_COUNT; i++) {
      const angle = pocketCentreAngle(i, rotorAngle)
      assert.equal(pocketAtAngle(angle, rotorAngle), i, `rotorAngle=${rotorAngle} i=${i}`)
    }
  }
})

test('surfaceHeight is continuous except the LIP_HEIGHT step at POCKET_OUTER_RADIUS', () => {
  const boundaries = [3.2, 6.9, 8.6, 10.8, 13.3, 14.5]
  const eps = 1e-6
  for (const r of boundaries) {
    const below = surfaceHeight(r - eps)
    const above = surfaceHeight(r + eps)
    if (Math.abs(r - POCKET_OUTER_RADIUS) < 1e-9) {
      assert.ok(Math.abs(above - below) > 0.01, `expected a lip step at ${r}`)
    } else {
      assert.ok(Math.abs(above - below) < 1e-3, `expected continuity at ${r}, got ${below} vs ${above}`)
    }
  }
})

test('surfaceSlope matches the numerical derivative of surfaceHeight', () => {
  const h = 1e-4
  const samples = [4, 5.5, 7.5, 9.5, 12, 14]
  for (const r of samples) {
    const numerical = (surfaceHeight(r + h) - surfaceHeight(r - h)) / (2 * h)
    const analytic = surfaceSlope(r)
    assert.ok(Math.abs(numerical - analytic) < 1e-2, `r=${r}: numerical=${numerical} analytic=${analytic}`)
  }
})

test('the eight diamonds sit at DIAMOND_RADIUS and alternate orientation', () => {
  assert.equal(DIAMONDS.length, DIAMOND_COUNT)
  for (const d of DIAMONDS) {
    const midx = (d.a.x + d.b.x) / 2
    const midy = (d.a.y + d.b.y) / 2
    const r = Math.hypot(midx, midy)
    assert.ok(Math.abs(r - DIAMOND_RADIUS) < 1e-9, `diamond centre radius ${r} != ${DIAMOND_RADIUS}`)
    const angleR = Math.hypot(d.a.x, d.a.y)
    assert.ok(angleR > 0)
  }
  for (let i = 0; i < DIAMONDS.length - 1; i++) {
    assert.notEqual(DIAMONDS[i]!.orientation, DIAMONDS[i + 1]!.orientation)
  }
})

test('geometry sanity: radii increase outward as expected', () => {
  assert.ok(TURRET_RADIUS < ROTOR_RADIUS)
  assert.ok(ROTOR_RADIUS < DIAMOND_RADIUS)
  assert.ok(DIAMOND_RADIUS < TRACK_INNER_RADIUS)
  assert.ok(TRACK_INNER_RADIUS < TRACK_RADIUS)
  assert.ok(POCKET_ANGLE > 0)
})
