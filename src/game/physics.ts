import type { BallState, SpinParams, WheelEvent, WheelState } from './types.ts'
import {
  BALL_RADIUS,
  DIAMOND_HALF_THICKNESS,
  DIAMOND_HEIGHT,
  DIAMONDS,
  FRET_HALF_THICKNESS,
  FRET_HEIGHT,
  LIP_HEIGHT,
  POCKET_ANGLE,
  POCKET_INNER_RADIUS,
  POCKET_OUTER_RADIUS,
  ROTOR_RADIUS,
  TRACK_INNER_RADIUS,
  TRACK_RADIUS,
  TURRET_RADIUS,
  fretLocalAngle,
  pocketAtAngle,
  pocketCentreAngle,
  pocketNumber,
  surfaceHeight,
  surfaceSlope,
} from './wheel.ts'

/**
 * The wheel physics simulation: pure, deterministic (no `Math.random`, no `Date`) and mutates
 * `WheelState` in place. `stepWheel` is the only entry point that advances time. Everything is
 * integrated in the wheel plane's inertial (non-rotating) frame: `BallState.x/y/vx/vy` are plain
 * Cartesian, not relative to the rotor. See `wheel.ts` for the geometry these numbers move over.
 */

/** The engine always steps the simulation with this timestep, in seconds. */
export const FIXED_DT = 1 / 1000

/** Magnitude the rotor eases back to once idle (no ball, or the ball has settled), rad/s. */
export const IDLE_ROTOR_SPEED = 0.6

/** Inches per second squared. */
export const GRAVITY = 386.1

// ---------------------------------------------------------------------------------------------
// Tuning constants (internal). Values were adjusted empirically against the targets in
// `physics.test.ts` (drop timing, settle timing, revolutions, diamond/fret/scatter rates, and
// the fairness chi-square).
// ---------------------------------------------------------------------------------------------

/** Rotor deceleration while a ball is in play, rad/s^2. */
const ROTOR_DECEL = 0.05
/** Rate constant (1/s) the rotor eases toward `IDLE_ROTOR_SPEED` once idle. */
const ROTOR_IDLE_EASE = 1.2

/** Ball centre never exceeds this radius (rim wall at `TRACK_RADIUS`, minus the ball radius). */
const RIM_MAX_R = TRACK_RADIUS - BALL_RADIUS
const RIM_RESTITUTION = 0.2
const RIM_EVENT_THRESHOLD = 3
/** Baseline rolling deceleration while riding the rim, in/s^2. */
const TRACK_ROLL_DECEL = 2
/** Extra deceleration while riding the rim, proportional to v^2/r (the centripetal load). */
const TRACK_WALL_FRICTION = 0.047
/** Light rolling drag on the stator/track when not pressed against the rim, in/s^2. */
const STATOR_ROLL_DECEL = 3.5

/** Viscous coupling (1/s) toward the rotor surface speed on the number ring. */
const RING_COUPLING = 1.6
/**
 * Constant (Coulomb) deceleration toward the rotor surface speed on the number ring, in/s^2.
 * Small, but on top of the viscous coupling it guarantees the ball can't stall indefinitely while
 * grazing the tips of two neighbouring frets right at the pocket boundary.
 */
const RING_ROLL_DECEL = 4
/** Viscous coupling (1/s) toward the rotor surface speed on the pocket floor. */
const POCKET_COUPLING = 3.2
/** Constant (Coulomb) deceleration toward the rotor surface speed on the pocket floor, in/s^2. */
const POCKET_ROLL_DECEL = 14

const DIAMOND_RESTITUTION = 0.5
const DIAMOND_TANGENT_LOSS = 0.18
const FRET_RESTITUTION = 0.35
const FRET_TANGENT_LOSS = 0.12
/**
 * Continuous tangential deceleration (in/s^2) while resting against a diamond or fret. Without
 * this, impact-only friction can balance exactly against slope gravity and trap the ball in a
 * stable grazing orbit around the obstacle's end cap, so it never settles.
 */
const CONTACT_ROLL_DECEL = 40
/**
 * Diamonds and frets are pyramidal, not flat-sided (see `wheelView.ts`), so a hit anywhere but
 * their exact midline deflects the ball sideways along their length, strongest toward the ends.
 * Without this, a ball hitting square-on with near-zero tangential speed can rest in an exact
 * (if physically degenerate) equilibrium against the flat capsule collision shape and never slide
 * off. `in/s^2`, scaled by how far from the midline the contact point is (`-1` to `1`).
 */
const RIDGE_DEFLECT_ACCEL = 150
const LIP_WALL_RESTITUTION = 0.3
const TURRET_WALL_RESTITUTION = 0.3

/** Fraction of an impact's normal speed added to `hopSpeed` (in/s of hop per in/s of impact). */
const HOP_FROM_IMPACT = 0.15
const HOP_LAND_RESTITUTION = 0.3
/** A landing softer than this (in/s, negative = downward) rests instead of bouncing. */
const HOP_LAND_BOUNCE_THRESHOLD = -3

/** Relative speed under which the ball counts as "slow" for settling, in/s. */
const SETTLE_SPEED = 2
/** Seconds slow in the pocket ring before the ball is declared settled. */
const SETTLE_SECONDS = 0.35
/** Time constant (s) the settled ball eases onto the pocket centre; ~3x this is "about 0.3 s". */
const SETTLE_EASE_TAU = 0.1

const MAX_BALL_SPEED = 500

// ---------------------------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------------------------

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** Wraps an angle to `(-pi, pi]`. */
function wrapAngle(a: number): number {
  let x = a % (2 * Math.PI)
  if (x > Math.PI) x -= 2 * Math.PI
  if (x <= -Math.PI) x += 2 * Math.PI
  return x
}

function closestPointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { x: number; y: number; t: number } {
  const abx = bx - ax
  const aby = by - ay
  const abLenSq = abx * abx + aby * aby
  const t = abLenSq > 1e-12 ? clamp01(((px - ax) * abx + (py - ay) * aby) / abLenSq) : 0
  return { x: ax + abx * t, y: ay + aby * t, t }
}

/** Rotor surface velocity at wheel-plane point `(x, y)`: `Ω × r = rotorSpeed * (-y, x)`. */
function rotorSurfaceVelocity(wheel: WheelState, x: number, y: number): { vx: number; vy: number } {
  return { vx: -wheel.rotorSpeed * y, vy: wheel.rotorSpeed * x }
}

// ---------------------------------------------------------------------------------------------
// State setup.
// ---------------------------------------------------------------------------------------------

/** A fresh wheel: no ball, rotor turning at `rotorSpeed` (idle by default). */
export function createWheel(rotorAngle = 0, rotorSpeed = IDLE_ROTOR_SPEED): WheelState {
  return { rotorAngle, rotorSpeed, ball: null, time: 0 }
}

/** Puts a ball on the track per `params`, replacing any previous ball, and resets `wheel.time`. */
export function launchBall(wheel: WheelState, params: SpinParams): void {
  const r = TRACK_RADIUS - BALL_RADIUS
  const x = r * Math.cos(params.ballAngle)
  const y = r * Math.sin(params.ballAngle)
  // Unit tangential direction, counter-clockwise positive.
  const tx = -Math.sin(params.ballAngle)
  const ty = Math.cos(params.ballAngle)
  const ball: BallState = {
    x,
    y,
    vx: tx * params.ballSpeed,
    vy: ty * params.ballSpeed,
    hop: 0,
    hopSpeed: 0,
    phase: 'track',
    pocket: null,
    settleTimer: 0,
  }
  wheel.ball = ball
  wheel.rotorSpeed = params.rotorSpeed
  wheel.time = 0
}

/** Height of the ball centre above the pocket floor, for rendering. */
export function ballHeight(ball: BallState): number {
  const r = Math.hypot(ball.x, ball.y)
  return surfaceHeight(r) + ball.hop + BALL_RADIUS
}

/** Ball speed relative to the surface under it (0 with no ball). */
export function relativeSpeed(wheel: WheelState): number {
  const ball = wheel.ball
  if (!ball) return 0
  const r = Math.hypot(ball.x, ball.y)
  if (r < ROTOR_RADIUS) {
    const sv = rotorSurfaceVelocity(wheel, ball.x, ball.y)
    return Math.hypot(ball.vx - sv.vx, ball.vy - sv.vy)
  }
  return Math.hypot(ball.vx, ball.vy)
}

// ---------------------------------------------------------------------------------------------
// Rotor.
// ---------------------------------------------------------------------------------------------

function stepRotor(wheel: WheelState, dt: number): void {
  const ballInPlay = wheel.ball !== null && wheel.ball.phase !== 'settled'
  if (ballInPlay) {
    const sign = wheel.rotorSpeed >= 0 ? 1 : -1
    const magnitude = Math.max(0, Math.abs(wheel.rotorSpeed) - ROTOR_DECEL * dt)
    wheel.rotorSpeed = sign * magnitude
  } else {
    const sign = wheel.rotorSpeed >= 0 ? 1 : -1
    const target = sign * IDLE_ROTOR_SPEED
    wheel.rotorSpeed += (target - wheel.rotorSpeed) * Math.min(1, ROTOR_IDLE_EASE * dt)
  }
  wheel.rotorAngle += wheel.rotorSpeed * dt
  wheel.time += dt
}

// ---------------------------------------------------------------------------------------------
// Collision resolvers. Each mutates `ball` in place and may push events.
// ---------------------------------------------------------------------------------------------

/** The rim wall at `RIM_MAX_R`: bounces the ball inward and, while pinned, bleeds tangential speed. */
function resolveRim(ball: BallState, dt: number, events: WheelEvent[]): void {
  const r = Math.hypot(ball.x, ball.y)
  if (r <= RIM_MAX_R) return
  const ux = ball.x / r
  const uy = ball.y / r
  ball.x = ux * RIM_MAX_R
  ball.y = uy * RIM_MAX_R

  const vr = ball.vx * ux + ball.vy * uy
  if (vr > 0) {
    const impact = vr
    const dvr = -(1 + RIM_RESTITUTION) * vr
    ball.vx += dvr * ux
    ball.vy += dvr * uy
    ball.hopSpeed += HOP_FROM_IMPACT * impact
    if (impact > RIM_EVENT_THRESHOLD) events.push({ type: 'rim', intensity: clamp01(impact / 50) })
  }

  const tx = -uy
  const ty = ux
  const vt = ball.vx * tx + ball.vy * ty
  const decel = TRACK_ROLL_DECEL + (TRACK_WALL_FRICTION * (vt * vt)) / RIM_MAX_R
  const speed = Math.abs(vt)
  const newSpeed = Math.max(0, speed - decel * dt)
  const newVt = Math.sign(vt) * newSpeed
  ball.vx += (newVt - vt) * tx
  ball.vy += (newVt - vt) * ty
}

/**
 * The eight fixed stator diamonds: capsule collisions, active only below `DIAMOND_HEIGHT`. Besides
 * the impact restitution, contact also bleeds a little tangential speed every step it persists —
 * without this a ball can settle into a stable grazing orbit around a diamond's end cap (gravity's
 * inward pull exactly matched by the impact restitution) and never leave.
 */
function resolveDiamonds(ball: BallState, dt: number, events: WheelEvent[]): void {
  if (ball.hop >= DIAMOND_HEIGHT) return
  const minDist = BALL_RADIUS + DIAMOND_HALF_THICKNESS
  for (const d of DIAMONDS) {
    const p = closestPointOnSegment(ball.x, ball.y, d.a.x, d.a.y, d.b.x, d.b.y)
    const dx = ball.x - p.x
    const dy = ball.y - p.y
    const dist = Math.hypot(dx, dy)
    if (dist >= minDist) continue
    const nx = dist > 1e-6 ? dx / dist : 1
    const ny = dist > 1e-6 ? dy / dist : 0
    ball.x = p.x + nx * minDist
    ball.y = p.y + ny * minDist

    const vn = ball.vx * nx + ball.vy * ny
    if (vn < 0) {
      const impact = -vn
      const dvn = -(1 + DIAMOND_RESTITUTION) * vn
      ball.vx += dvn * nx
      ball.vy += dvn * ny

      const tx0 = -ny
      const ty0 = nx
      const vt0 = ball.vx * tx0 + ball.vy * ty0
      const newVt0 = vt0 * (1 - DIAMOND_TANGENT_LOSS)
      ball.vx += (newVt0 - vt0) * tx0
      ball.vy += (newVt0 - vt0) * ty0

      ball.hopSpeed += HOP_FROM_IMPACT * impact
      events.push({ type: 'diamond', intensity: clamp01(impact / 60) })
    }

    const tx = -ny
    const ty = nx
    const vt = ball.vx * tx + ball.vy * ty
    const speed = Math.abs(vt)
    const newSpeed = Math.max(0, speed - CONTACT_ROLL_DECEL * dt)
    const newVt = Math.sign(vt) * newSpeed
    ball.vx += (newVt - vt) * tx
    ball.vy += (newVt - vt) * ty

    const ridge = (p.t - 0.5) * 2
    const ridgeKick = RIDGE_DEFLECT_ACCEL * ridge * dt
    ball.vx += ridgeKick * tx
    ball.vy += ridgeKick * ty
  }
}

/**
 * The two rotor frets nearest the ball's rotor-frame angle: capsule collisions resolved against
 * the velocity relative to the rotor. Like the diamonds, contact also bleeds a little relative
 * tangential speed every step it persists, so the ball cannot settle into a stable orbit around a
 * fret's end instead of dropping between pockets.
 */
function resolveFrets(wheel: WheelState, ball: BallState, dt: number, events: WheelEvent[]): void {
  if (ball.hop >= FRET_HEIGHT) return
  const minDist = BALL_RADIUS + FRET_HALF_THICKNESS
  const localAngle = wrapAngle(Math.atan2(ball.y, ball.x) - wheel.rotorAngle)
  // fretLocalAngle(k) = -(k + 0.5) * POCKET_ANGLE, solved for the nearest integer k.
  const kf = -localAngle / POCKET_ANGLE - 0.5
  const k0 = Math.floor(kf)

  for (const k of [k0, k0 + 1]) {
    const angle = wheel.rotorAngle + fretLocalAngle(k)
    const ca = Math.cos(angle)
    const sa = Math.sin(angle)
    const ax = POCKET_INNER_RADIUS * ca
    const ay = POCKET_INNER_RADIUS * sa
    const bx = (POCKET_OUTER_RADIUS + 0.2) * ca
    const by = (POCKET_OUTER_RADIUS + 0.2) * sa
    const p = closestPointOnSegment(ball.x, ball.y, ax, ay, bx, by)
    const dx = ball.x - p.x
    const dy = ball.y - p.y
    const dist = Math.hypot(dx, dy)
    if (dist >= minDist) continue
    const nx = dist > 1e-6 ? dx / dist : ca
    const ny = dist > 1e-6 ? dy / dist : sa
    ball.x = p.x + nx * minDist
    ball.y = p.y + ny * minDist

    const sv = rotorSurfaceVelocity(wheel, ball.x, ball.y)
    const relvx = ball.vx - sv.vx
    const relvy = ball.vy - sv.vy
    const vn = relvx * nx + relvy * ny
    if (vn < 0) {
      const impact = -vn
      const dvn = -(1 + FRET_RESTITUTION) * vn
      ball.vx += dvn * nx
      ball.vy += dvn * ny

      const tx0 = -ny
      const ty0 = nx
      const relvx2 = ball.vx - sv.vx
      const relvy2 = ball.vy - sv.vy
      const relvt = relvx2 * tx0 + relvy2 * ty0
      const newRelVt = relvt * (1 - FRET_TANGENT_LOSS)
      ball.vx += (newRelVt - relvt) * tx0
      ball.vy += (newRelVt - relvt) * ty0

      ball.hopSpeed += HOP_FROM_IMPACT * impact
      events.push({ type: 'fret', intensity: clamp01(impact / 40) })
    }

    const tx = -ny
    const ty = nx
    const sv2 = rotorSurfaceVelocity(wheel, ball.x, ball.y)
    const relvx3 = ball.vx - sv2.vx
    const relvy3 = ball.vy - sv2.vy
    const relvt2 = relvx3 * tx + relvy3 * ty
    const speed = Math.abs(relvt2)
    const newSpeed = Math.max(0, speed - CONTACT_ROLL_DECEL * dt)
    const newRelVt2 = Math.sign(relvt2) * newSpeed
    ball.vx += (newRelVt2 - relvt2) * tx
    ball.vy += (newRelVt2 - relvt2) * ty

    const ridge = (p.t - 0.5) * 2
    const ridgeKick = RIDGE_DEFLECT_ACCEL * ridge * dt
    ball.vx += ridgeKick * tx
    ball.vy += ridgeKick * ty
  }
}

/** The pocket lip at `POCKET_OUTER_RADIUS`: a drop crossing inward, a wall crossing outward. */
function resolvePocketLip(wheel: WheelState, ball: BallState, rPrev: number, rNow: number, events: WheelEvent[]): void {
  if (rPrev >= POCKET_OUTER_RADIUS && rNow < POCKET_OUTER_RADIUS) {
    ball.hop += LIP_HEIGHT
    const speed = Math.hypot(ball.vx, ball.vy)
    events.push({ type: 'pocketDrop', intensity: clamp01(speed / 60) })
    return
  }
  if (rPrev < POCKET_OUTER_RADIUS && rNow >= POCKET_OUTER_RADIUS) {
    if (ball.hop >= LIP_HEIGHT) {
      ball.hop -= LIP_HEIGHT
      return
    }
    const r = rNow > 1e-6 ? rNow : 1e-6
    const ux = ball.x / r
    const uy = ball.y / r
    const clamped = POCKET_OUTER_RADIUS - 1e-4
    ball.x = ux * clamped
    ball.y = uy * clamped
    const sv = rotorSurfaceVelocity(wheel, ball.x, ball.y)
    const relvx = ball.vx - sv.vx
    const relvy = ball.vy - sv.vy
    const vr = relvx * ux + relvy * uy
    if (vr > 0) {
      const dvr = -(1 + LIP_WALL_RESTITUTION) * vr
      ball.vx += dvr * ux
      ball.vy += dvr * uy
    }
  }
}

/** Safety-net wall at `TURRET_RADIUS + BALL_RADIUS`; the turret slope should keep the ball out here. */
function resolveTurretWall(ball: BallState): void {
  const minR = TURRET_RADIUS + BALL_RADIUS
  const r = Math.hypot(ball.x, ball.y)
  if (r >= minR || r < 1e-6) return
  const ux = ball.x / r
  const uy = ball.y / r
  ball.x = ux * minR
  ball.y = uy * minR
  const vr = ball.vx * ux + ball.vy * uy
  if (vr < 0) {
    const dvr = -(1 + TURRET_WALL_RESTITUTION) * vr
    ball.vx += dvr * ux
    ball.vy += dvr * uy
  }
}

// ---------------------------------------------------------------------------------------------
// Rolling friction toward the surface velocity.
// ---------------------------------------------------------------------------------------------

function applyStaticDrag(ball: BallState, decel: number, dt: number): void {
  const speed = Math.hypot(ball.vx, ball.vy)
  if (speed < 1e-9) return
  const newSpeed = Math.max(0, speed - decel * dt)
  const scale = newSpeed / speed
  ball.vx *= scale
  ball.vy *= scale
}

/** Viscous decay of the velocity relative to the rotor surface, at rate `coupling` (1/s). */
function applyRotorViscous(wheel: WheelState, ball: BallState, coupling: number, dt: number): void {
  const sv = rotorSurfaceVelocity(wheel, ball.x, ball.y)
  const decay = Math.exp(-coupling * dt)
  ball.vx = sv.vx + (ball.vx - sv.vx) * decay
  ball.vy = sv.vy + (ball.vy - sv.vy) * decay
}

/** Constant (Coulomb) decay of the velocity relative to the rotor surface, at rate `decel` (in/s^2). */
function applyRotorConstant(wheel: WheelState, ball: BallState, decel: number, dt: number): void {
  const sv = rotorSurfaceVelocity(wheel, ball.x, ball.y)
  const relvx = ball.vx - sv.vx
  const relvy = ball.vy - sv.vy
  const relSpeed = Math.hypot(relvx, relvy)
  if (relSpeed < 1e-9) return
  const newSpeed = Math.max(0, relSpeed - decel * dt)
  const scale = newSpeed / relSpeed
  ball.vx = sv.vx + relvx * scale
  ball.vy = sv.vy + relvy * scale
}

function applySurfaceFriction(wheel: WheelState, ball: BallState, dt: number): void {
  const r = Math.hypot(ball.x, ball.y)
  if (r >= ROTOR_RADIUS) {
    applyStaticDrag(ball, STATOR_ROLL_DECEL, dt)
  } else if (r >= POCKET_OUTER_RADIUS) {
    applyRotorViscous(wheel, ball, RING_COUPLING, dt)
    applyRotorConstant(wheel, ball, RING_ROLL_DECEL, dt)
  } else {
    applyRotorViscous(wheel, ball, POCKET_COUPLING, dt)
    applyRotorConstant(wheel, ball, POCKET_ROLL_DECEL, dt)
  }
}

// ---------------------------------------------------------------------------------------------
// Hop (vertical) dynamics, phase and settling.
// ---------------------------------------------------------------------------------------------

function stepHop(ball: BallState, dt: number): void {
  if (ball.hop <= 0 && ball.hopSpeed === 0) return
  ball.hopSpeed -= GRAVITY * dt
  ball.hop += ball.hopSpeed * dt
  if (ball.hop <= 0) {
    if (ball.hopSpeed < HOP_LAND_BOUNCE_THRESHOLD) {
      ball.hop = 0
      ball.hopSpeed = -ball.hopSpeed * HOP_LAND_RESTITUTION
    } else {
      ball.hop = 0
      ball.hopSpeed = 0
    }
  }
}

function updatePhase(ball: BallState, r: number, events: WheelEvent[]): void {
  if (ball.phase === 'track' && r < TRACK_INNER_RADIUS) {
    ball.phase = 'falling'
    events.push({ type: 'drop' })
  }
  if (ball.phase !== 'settled' && ball.phase !== 'rotor' && r < ROTOR_RADIUS) {
    ball.phase = 'rotor'
  }
}

function updateSettleTimer(wheel: WheelState, ball: BallState, r: number, dt: number, events: WheelEvent[]): void {
  const inPocketRing = r >= POCKET_INNER_RADIUS && r <= POCKET_OUTER_RADIUS
  const slow = relativeSpeed(wheel) < SETTLE_SPEED
  if (inPocketRing && ball.hop === 0 && slow) {
    ball.settleTimer += dt
    if (ball.settleTimer >= SETTLE_SECONDS) {
      const angle = Math.atan2(ball.y, ball.x)
      const pocket = pocketAtAngle(angle, wheel.rotorAngle)
      ball.phase = 'settled'
      ball.pocket = pocket
      const number = pocketNumber(pocket)
      events.push({ type: 'settle', pocket, number })
    }
  } else {
    ball.settleTimer = 0
  }
}

/**
 * Once settled, the ball rigidly follows the rotor: eases onto the pocket centre over ~0.3 s. The
 * angular offset from the pocket centre is invariant under pure rotor rotation, so it must be
 * captured against the rotor angle *before* `stepRotor` advances it this step and only then eased
 * toward zero — comparing the ball's pre-step position against the post-step target instead would
 * reinject a fresh `rotorSpeed * dt` offset every step (a steady lag of roughly `rotorSpeed` times
 * `SETTLE_EASE_TAU`, easily bigger than half a pocket) rather than ever converging.
 */
function stepSettledBall(wheel: WheelState, ball: BallState, dt: number): void {
  const pocket = ball.pocket ?? 0
  const prevTargetAngle = pocketCentreAngle(pocket, wheel.rotorAngle)
  const prevR = Math.hypot(ball.x, ball.y)
  const prevAngle = Math.atan2(ball.y, ball.x)
  const angleOffset = wrapAngle(prevAngle - prevTargetAngle)

  const targetR = (POCKET_INNER_RADIUS + POCKET_OUTER_RADIUS) / 2
  const k = 1 - Math.exp(-dt / SETTLE_EASE_TAU)
  const newAngleOffset = angleOffset * (1 - k)
  const newR = prevR + (targetR - prevR) * k

  stepRotor(wheel, dt)

  const targetAngle = pocketCentreAngle(pocket, wheel.rotorAngle)
  const newAngle = targetAngle + newAngleOffset

  ball.x = newR * Math.cos(newAngle)
  ball.y = newR * Math.sin(newAngle)
  ball.hop = 0
  ball.hopSpeed = 0
  const sv = rotorSurfaceVelocity(wheel, ball.x, ball.y)
  ball.vx = sv.vx
  ball.vy = sv.vy
  ball.settleTimer = SETTLE_SECONDS
}

function guardBall(ball: BallState): void {
  if (!Number.isFinite(ball.x) || !Number.isFinite(ball.y)) {
    ball.x = TRACK_RADIUS - BALL_RADIUS
    ball.y = 0
  }
  if (!Number.isFinite(ball.vx) || !Number.isFinite(ball.vy)) {
    ball.vx = 0
    ball.vy = 0
  }
  if (!Number.isFinite(ball.hop)) ball.hop = 0
  if (!Number.isFinite(ball.hopSpeed)) ball.hopSpeed = 0
  const speed = Math.hypot(ball.vx, ball.vy)
  if (speed > MAX_BALL_SPEED) {
    const scale = MAX_BALL_SPEED / speed
    ball.vx *= scale
    ball.vy *= scale
  }
}

// ---------------------------------------------------------------------------------------------
// The one entry point that advances time.
// ---------------------------------------------------------------------------------------------

function stepMovingBall(wheel: WheelState, ball: BallState, dt: number, events: WheelEvent[]): void {
  const rPrev = Math.hypot(ball.x, ball.y)

  if (ball.hop <= 0) {
    const s = surfaceSlope(rPrev)
    const ar = (-GRAVITY * s) / (1 + s * s)
    if (rPrev > 1e-6) {
      const ux = ball.x / rPrev
      const uy = ball.y / rPrev
      ball.vx += ar * ux * dt
      ball.vy += ar * uy * dt
    }
  }

  ball.x += ball.vx * dt
  ball.y += ball.vy * dt

  resolveRim(ball, dt, events)
  resolveDiamonds(ball, dt, events)
  resolveFrets(wheel, ball, dt, events)

  const rAfterCollisions = Math.hypot(ball.x, ball.y)
  resolvePocketLip(wheel, ball, rPrev, rAfterCollisions, events)
  resolveTurretWall(ball)

  applySurfaceFriction(wheel, ball, dt)

  stepHop(ball, dt)

  const rFinal = Math.hypot(ball.x, ball.y)
  updatePhase(ball, rFinal, events)
  updateSettleTimer(wheel, ball, rFinal, dt, events)

  guardBall(ball)
}

/** Advances the whole wheel by `dt` (normally `FIXED_DT`), returning this step's events. */
export function stepWheel(wheel: WheelState, dt: number): WheelEvent[] {
  const events: WheelEvent[] = []
  const ball = wheel.ball

  if (ball && ball.phase === 'settled') {
    // Advances the rotor itself, after capturing the ball's rotor-invariant offset — see the
    // doc comment on `stepSettledBall`.
    stepSettledBall(wheel, ball, dt)
    return events
  }

  stepRotor(wheel, dt)
  if (!ball) return events
  stepMovingBall(wheel, ball, dt, events)
  return events
}

// ---------------------------------------------------------------------------------------------
// Whole-spin summary, used by tests and `scripts/simulate.ts`.
// ---------------------------------------------------------------------------------------------

export interface SpinSummary {
  pocket: number
  number: number
  seconds: number
  dropSeconds: number
  trackRevolutions: number
  diamondHits: number
  fretHits: number
  settled: boolean
}

/** Runs a full spin from `params` at a fixed timestep until it settles or `maxSeconds` elapses. */
export function simulateSpin(params: SpinParams, rotorAngle = 0, maxSeconds = 40): SpinSummary {
  const wheel = createWheel(rotorAngle)
  launchBall(wheel, params)
  const ball = wheel.ball!

  let dropSeconds = 0
  let dropSeen = false
  let trackAngleAccum = 0
  let prevAngle = Math.atan2(ball.y, ball.x)
  let diamondHits = 0
  let fretHits = 0
  let pocket = -1
  let number = -1
  let settled = false

  const maxSteps = Math.round(maxSeconds / FIXED_DT)
  for (let i = 0; i < maxSteps; i++) {
    const events = stepWheel(wheel, FIXED_DT)

    if (!dropSeen && wheel.ball) {
      const angle = Math.atan2(wheel.ball.y, wheel.ball.x)
      let delta = angle - prevAngle
      while (delta > Math.PI) delta -= 2 * Math.PI
      while (delta <= -Math.PI) delta += 2 * Math.PI
      trackAngleAccum += Math.abs(delta)
      prevAngle = angle
    }

    for (const event of events) {
      if (event.type === 'drop' && !dropSeen) {
        dropSeen = true
        dropSeconds = wheel.time
      } else if (event.type === 'diamond') {
        diamondHits++
      } else if (event.type === 'fret') {
        fretHits++
      } else if (event.type === 'settle') {
        settled = true
        pocket = event.pocket
        number = event.number
      }
    }
    if (settled) break
  }

  return {
    pocket,
    number,
    seconds: wheel.time,
    dropSeconds,
    trackRevolutions: trackAngleAccum / (2 * Math.PI),
    diamondHits,
    fretHits,
    settled,
  }
}
