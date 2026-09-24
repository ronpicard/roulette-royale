/**
 * Gold and coloured confetti that bursts over the table on a win, tumbles under gravity and drag,
 * settles flat on the felt or the floor (or vanishes into the wheel bowl), then shrinks away.
 *
 * One `InstancedMesh` holds a fixed capacity of pieces; particle state lives in typed arrays and
 * the mesh's per-instance matrices/colours are rewritten from those arrays each frame. Unused
 * slots are hidden with a zero-scale matrix rather than changing `mesh.count`.
 */

import * as THREE from 'three'
import {
  TABLE_HEIGHT,
  TABLE_MAX_X,
  TABLE_MAX_Z,
  TABLE_MIN_X,
  TABLE_MIN_Z,
  WHEEL_BASE_Y,
  WHEEL_CENTER_X,
  WHEEL_CENTER_Z,
  layoutToWorld,
} from './tableGeometry.ts'
import { LAYOUT_DEPTH, LAYOUT_WIDTH } from '../game/layout.ts'
import { BOWL_RADIUS, RIM_HEIGHT } from '../game/wheel.ts'

export interface ConfettiView {
  /** Add to the scene. */
  group: THREE.Group
  /** Launches a burst, strength 0..1 (a bigger win launches more and higher). */
  burst(strength: number): void
  /** Shrinks every live piece away over ~0.4 s (called when betting resumes). */
  clear(): void
  update(dt: number): void // dt = 0 while paused: nothing moves
  dispose(): void
}

// -------------------------------------------------------------------------------------------
// Tuning
// -------------------------------------------------------------------------------------------

const CAPACITY = 480
const PIECE_WIDTH = 1.1
const PIECE_HEIGHT = 0.6
const LAUNCH_HEIGHT_ABOVE_FELT = 44
const SPAWN_SPREAD_X = 30
const SPAWN_SPREAD_Y = 12
const SPAWN_SPREAD_Z = 18
const GRAVITY = 386 // in/s^2
const TERMINAL_FALL_SPEED = 20 // in/s
/** Linear drag coefficient: at terminal velocity, drag exactly cancels gravity. */
const DRAG_K = GRAVITY / TERMINAL_FALL_SPEED
const FLUTTER_AMPLITUDE = 8 // in/s
const NATURAL_SHRINK_DURATION = 0.5
const CLEAR_SHRINK_DURATION = 0.4
const MAX_AIRBORNE_AGE = 12
const GROUNDED_MIN_LIFETIME = 6
const GROUNDED_LIFETIME_SPREAD = 3 // 6..9 s
const TABLE_LANDING_Y = TABLE_HEIGHT + 0.05
const FLOOR_LANDING_Y = 0.05
const WHEEL_LANDING_Y = WHEEL_BASE_Y + RIM_HEIGHT

// `erasableSyntaxOnly` forbids real enums; plain numeric constants stand in for one.
const AIRBORNE = 0
const LANDED = 1
const SHRINKING = 2

const COLOR_STOPS: readonly { color: number; weight: number }[] = [
  { color: 0xf3d27a, weight: 0.3 }, // gold, light
  { color: 0xd4af37, weight: 0.25 }, // gold, deep
  { color: 0xb2123a, weight: 0.15 }, // ruby red
  { color: 0xf2ede1, weight: 0.15 }, // white / ivory
  { color: 0x1f7a4d, weight: 0.15 }, // emerald
]

function pickColor(rng: () => number): number {
  const r = rng()
  let cumulative = 0
  for (const stop of COLOR_STOPS) {
    cumulative += stop.weight
    if (r <= cumulative) return stop.color
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1]!.color
}

/** Launch points 44 in above the felt: above the layout centre, and midway to the wheel. */
function launchPoints(): readonly THREE.Vector3[] {
  const layoutCentre = layoutToWorld(LAYOUT_WIDTH / 2, LAYOUT_DEPTH / 2)
  const y = TABLE_HEIGHT + LAUNCH_HEIGHT_ABOVE_FELT
  const above = new THREE.Vector3(layoutCentre.x, y, layoutCentre.z)
  const midway = new THREE.Vector3((layoutCentre.x + WHEEL_CENTER_X) / 2, y, (layoutCentre.z + WHEEL_CENTER_Z) / 2)
  return [above, midway]
}

export function createConfetti(): ConfettiView {
  const group = new THREE.Group()

  const geometry = new THREE.PlaneGeometry(PIECE_WIDTH, PIECE_HEIGHT)
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, metalness: 0.55, roughness: 0.35 })
  const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY)
  mesh.count = CAPACITY
  mesh.frustumCulled = false
  mesh.castShadow = false
  group.add(mesh)

  // Particle state, struct-of-arrays.
  const active = new Uint8Array(CAPACITY)
  const state = new Uint8Array(CAPACITY)
  const px = new Float32Array(CAPACITY)
  const py = new Float32Array(CAPACITY)
  const pz = new Float32Array(CAPACITY)
  const vx = new Float32Array(CAPACITY)
  const vy = new Float32Array(CAPACITY)
  const vz = new Float32Array(CAPACITY)
  const spinAxisX = new Float32Array(CAPACITY)
  const spinAxisY = new Float32Array(CAPACITY)
  const spinAxisZ = new Float32Array(CAPACITY)
  const spinRate = new Float32Array(CAPACITY)
  const spinAngle = new Float32Array(CAPACITY)
  const flutterPhase = new Float32Array(CAPACITY)
  const flutterFreq = new Float32Array(CAPACITY)
  const age = new Float32Array(CAPACITY)
  const groundedAt = new Float32Array(CAPACITY)
  const groundedLifetime = new Float32Array(CAPACITY)
  const shrinkStart = new Float32Array(CAPACITY)
  const shrinkDuration = new Float32Array(CAPACITY)
  const shrinkFrom = new Float32Array(CAPACITY)
  const scale = new Float32Array(CAPACITY)
  const landedQX = new Float32Array(CAPACITY)
  const landedQY = new Float32Array(CAPACITY)
  const landedQZ = new Float32Array(CAPACITY)
  const landedQW = new Float32Array(CAPACITY)

  let cursor = 0
  let clock = 0

  const points = launchPoints()

  // Scratch objects reused every frame; never allocated in update().
  const dummy = new THREE.Object3D()
  const scratchColor = new THREE.Color()
  const scratchAxis = new THREE.Vector3()
  const scratchQuat = new THREE.Quaternion()
  const scratchYawQuat = new THREE.Quaternion()
  const UP_AXIS = new THREE.Vector3(0, 1, 0)
  const FLAT_BASE_QUAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
  const ZERO_SCALE_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0)

  for (let i = 0; i < CAPACITY; i++) {
    mesh.setMatrixAt(i, ZERO_SCALE_MATRIX)
  }
  mesh.instanceMatrix.needsUpdate = true

  function deactivate(i: number): void {
    active[i] = 0
    mesh.setMatrixAt(i, ZERO_SCALE_MATRIX)
  }

  function writeMatrix(i: number): void {
    dummy.position.set(px[i]!, py[i]!, pz[i]!)
    if (state[i] === AIRBORNE) {
      scratchAxis.set(spinAxisX[i]!, spinAxisY[i]!, spinAxisZ[i]!)
      dummy.quaternion.setFromAxisAngle(scratchAxis, spinAngle[i]!)
    } else {
      dummy.quaternion.set(landedQX[i]!, landedQY[i]!, landedQZ[i]!, landedQW[i]!)
    }
    dummy.scale.setScalar(scale[i]!)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }

  function spawnOne(strength: number, rng: () => number): void {
    const i = cursor
    cursor = (cursor + 1) % CAPACITY

    const origin = points[Math.floor(rng() * points.length) % points.length]!
    // Drag stops sideways drift within a few inches, so the burst's width comes from where the
    // pieces start: a cloud about the size of the layout.
    px[i] = origin.x + (rng() - 0.5) * SPAWN_SPREAD_X
    py[i] = origin.y + rng() * SPAWN_SPREAD_Y
    pz[i] = origin.z + (rng() - 0.5) * SPAWN_SPREAD_Z

    const speedScale = 0.7 + 0.5 * strength
    vy[i] = (25 + rng() * 30) * speedScale
    const spreadAngle = rng() * Math.PI * 2
    const spreadMag = rng() * 60
    vx[i] = Math.cos(spreadAngle) * spreadMag
    vz[i] = Math.sin(spreadAngle) * spreadMag

    const axisTheta = rng() * Math.PI * 2
    const axisZ = rng() * 2 - 1
    const axisR = Math.sqrt(Math.max(0, 1 - axisZ * axisZ))
    spinAxisX[i] = Math.cos(axisTheta) * axisR
    spinAxisY[i] = Math.sin(axisTheta) * axisR
    spinAxisZ[i] = axisZ
    spinRate[i] = 4 + rng() * 10
    spinAngle[i] = rng() * Math.PI * 2

    flutterPhase[i] = rng() * Math.PI * 2
    flutterFreq[i] = 2 + rng() * 2

    age[i] = 0
    state[i] = AIRBORNE
    scale[i] = 1
    active[i] = 1

    scratchColor.setHex(pickColor(rng))
    mesh.setColorAt(i, scratchColor)

    writeMatrix(i)
  }

  function land(i: number, groundY: number): void {
    py[i] = groundY
    vx[i] = 0
    vy[i] = 0
    vz[i] = 0
    state[i] = LANDED
    groundedAt[i] = clock
    groundedLifetime[i] = GROUNDED_MIN_LIFETIME + Math.random() * GROUNDED_LIFETIME_SPREAD

    const yaw = Math.random() * Math.PI * 2
    scratchYawQuat.setFromAxisAngle(UP_AXIS, yaw)
    scratchQuat.copy(scratchYawQuat).multiply(FLAT_BASE_QUAT)
    landedQX[i] = scratchQuat.x
    landedQY[i] = scratchQuat.y
    landedQZ[i] = scratchQuat.z
    landedQW[i] = scratchQuat.w
  }

  function startShrink(i: number, duration: number): void {
    state[i] = SHRINKING
    shrinkStart[i] = clock
    shrinkDuration[i] = duration
    shrinkFrom[i] = scale[i]!
  }

  return {
    group,

    burst(strength: number) {
      const s = Math.min(1, Math.max(0, strength))
      const count = Math.round(120 + 360 * s)
      for (let n = 0; n < count; n++) spawnOne(s, Math.random)
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.instanceMatrix.needsUpdate = true
    },

    clear() {
      for (let i = 0; i < CAPACITY; i++) {
        if (!active[i]) continue
        if (state[i] === SHRINKING) continue
        startShrink(i, CLEAR_SHRINK_DURATION)
      }
    },

    update(dt: number) {
      if (dt <= 0) return
      clock += dt

      let touched = false
      for (let i = 0; i < CAPACITY; i++) {
        if (!active[i]) continue
        touched = true

        if (state[i] === AIRBORNE) {
          age[i]! += dt

          const ax = -DRAG_K * vx[i]!
          const ay = -GRAVITY - DRAG_K * vy[i]!
          const az = -DRAG_K * vz[i]!
          vx[i]! += ax * dt
          vy[i]! += ay * dt
          vz[i]! += az * dt

          const flutter = Math.sin(clock * flutterFreq[i]! * 2 * Math.PI + flutterPhase[i]!) * FLUTTER_AMPLITUDE
          const flutterCross = Math.cos(clock * flutterFreq[i]! * 2 * Math.PI + flutterPhase[i]!) * FLUTTER_AMPLITUDE
          px[i]! += (vx[i]! + flutter) * dt
          py[i]! += vy[i]! * dt
          pz[i]! += (vz[i]! + flutterCross) * dt

          spinAngle[i]! += spinRate[i]! * dt

          const dx = px[i]! - WHEEL_CENTER_X
          const dz = pz[i]! - WHEEL_CENTER_Z
          const inBowl = Math.hypot(dx, dz) <= BOWL_RADIUS + 0.5
          const onTable =
            px[i]! >= TABLE_MIN_X && px[i]! <= TABLE_MAX_X && pz[i]! >= TABLE_MIN_Z && pz[i]! <= TABLE_MAX_Z

          let groundY: number
          if (inBowl) groundY = WHEEL_LANDING_Y
          else if (onTable) groundY = TABLE_LANDING_Y
          else groundY = FLOOR_LANDING_Y

          if (py[i]! <= groundY) {
            if (inBowl) {
              deactivate(i)
              continue
            }
            land(i, groundY)
          } else if (age[i]! > MAX_AIRBORNE_AGE) {
            startShrink(i, NATURAL_SHRINK_DURATION)
          }
        } else if (state[i] === LANDED) {
          if (clock - groundedAt[i]! >= groundedLifetime[i]!) {
            startShrink(i, NATURAL_SHRINK_DURATION)
          }
        } else {
          const t = (clock - shrinkStart[i]!) / shrinkDuration[i]!
          if (t >= 1) {
            deactivate(i)
            continue
          }
          scale[i] = shrinkFrom[i]! * (1 - t)
        }

        writeMatrix(i)
      }

      if (touched) mesh.instanceMatrix.needsUpdate = true
    },

    dispose() {
      group.remove(mesh)
      geometry.dispose()
      material.dispose()
    },
  }
}
