/**
 * The physical wheel: a static lacquered-wood bowl with eight chrome diamonds, a rotor that spins
 * with `wheel.rotorAngle` carrying the coloured number ring, pocket floor, 37 chrome frets and the
 * gold turret/spindle, and the ivory ball. Pure three.js: nothing here reads or mutates
 * `WheelState`/`BallState` except by copying numbers into meshes each frame.
 *
 * Frame: `group`'s local origin is the spindle on the pocket floor (`h = 0`), `y` up. A point at
 * rotor-frame angle `a`, radius `r`, height `h` sits at local `(r cos a, h, -r sin a)` (see
 * SPEC.md "Frames and units"); rotating an object by `rotation.y = a` orients its local `+x` axis
 * the same way, since three.js `Ry(a)` sends local `(d, 0, 0)` to `(d cos a, 0, -d sin a)`. Every
 * part below that is built pointing along local `+x` for angle 0 uses that rotation directly.
 *
 * `THREE.LatheGeometry` uses a different convention: with `phiStart = 0` its vertex at revolution
 * fraction `u` sits at `(r sin(u * 2π), h, r cos(u * 2π))`. Building lathes with
 * `phiStart = Math.PI / 2` instead makes `u * 2π = a`, i.e. texture U runs directly with the
 * rotor-frame angle above - see `wheelTextures.ts` for the derivation this relies on.
 */

import * as THREE from 'three'
import type { WheelState } from '../game/types.ts'
import { ballHeight, relativeSpeed } from '../game/physics.ts'
import {
  BALL_RADIUS,
  BOWL_RADIUS,
  DIAMOND_HALF_LENGTH,
  DIAMOND_HALF_THICKNESS,
  DIAMOND_HEIGHT,
  DIAMOND_RADIUS,
  DIAMONDS,
  FRET_HALF_THICKNESS,
  FRET_HEIGHT,
  LIP_HEIGHT,
  POCKET_ANGLE,
  POCKET_COUNT,
  POCKET_INNER_RADIUS,
  POCKET_OUTER_RADIUS,
  RIM_HEIGHT,
  ROTOR_RADIUS,
  TRACK_RADIUS,
  TURRET_RADIUS,
  fretLocalAngle,
  surfaceHeight,
} from '../game/wheel.ts'
import {
  makeBrushedMetalBump,
  makeBrushedMetalRoughness,
  makeScratchRoughness,
  makeWoodBump,
  makeWoodGrain,
} from './materialTextures.ts'
import { makeRotorColorTexture } from './wheelTextures.ts'
import type { RotorTextureBands } from './wheelTextures.ts'

export interface WheelView {
  /** Wheel-local frame: origin at the spindle on the pocket floor, y up. The engine positions it. */
  group: THREE.Group
  /** Poses the rotor and the ball from the physics state; rolls the ball by its motion over the surface. */
  update(wheel: WheelState, dt: number): void
  /** Ball centre in world space into `target`; false when no ball is on the wheel. */
  ballWorldPosition(target: THREE.Vector3): boolean
  /** Softly lights the number segment of pocket `index` (wheel order), or none for `null`. */
  highlightPocket(index: number | null): void
  dispose(): void
}

// -------------------------------------------------------------------------------------------
// Tuning
// -------------------------------------------------------------------------------------------

const LATHE_SEGMENTS = 128
/** See the header: this makes lathe texture U run directly with the rotor-frame angle. */
const LATHE_PHI_START = Math.PI / 2

const GOLD = 0xc9a54a
const CHROME = 0xd8dbe0
const OUTER_BOWL_TINT = '#4a2416'
const OUTER_BOWL_GRAIN = '#6d3a22'
const STATOR_TINT = '#1c0f09'
const STATOR_GRAIN = '#2c1911'
const TURRET_TINT = '#2a150c'
const TURRET_GRAIN = '#42230f'

const METAL_BUMP_SCALE = 0.015
const WOOD_BUMP_SCALE = 0.03

const HIGHLIGHT_COLOR = 0xf3d27a
const HIGHLIGHT_PULSE_HZ = 0.38

// -------------------------------------------------------------------------------------------
// Disposal bookkeeping (see `tableView.ts` in the sister project for the same small pattern)
// -------------------------------------------------------------------------------------------

interface Disposable {
  dispose(): void
}

function disposeAll(items: readonly Disposable[]): void {
  for (const item of items) item.dispose()
}

/**
 * A full-revolution lathe whose faces point up and out of the wheel. `THREE.LatheGeometry` sets a
 * profile normal to `(dy, -dx)`, so every profile here, which runs outward from the spindle, would
 * face down into the table and be culled from above. Reversing the triangle winding and negating
 * the normals fixes that while keeping the UVs the rotor texture bands rely on.
 */
function makeLathe(points: THREE.Vector2[]): THREE.LatheGeometry {
  const geometry = new THREE.LatheGeometry(points, LATHE_SEGMENTS, LATHE_PHI_START, Math.PI * 2)
  const index = geometry.getIndex()
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1)
      index.setX(i + 1, index.getX(i + 2))
      index.setX(i + 2, b)
    }
    index.needsUpdate = true
  }
  const normals = geometry.getAttribute('normal')
  for (let i = 0; i < normals.count; i++) {
    normals.setXYZ(i, -normals.getX(i), -normals.getY(i), -normals.getZ(i))
  }
  normals.needsUpdate = true
  return geometry
}

// -------------------------------------------------------------------------------------------
// Profile sampling
// -------------------------------------------------------------------------------------------

/** `surfaceHeight` sampled at uniform radius steps, for lathes with no angle-dependent texture. */
function sampleSurfaceProfile(r0: number, r1: number, steps: number): THREE.Vector2[] {
  const points: THREE.Vector2[] = []
  for (let i = 0; i <= steps; i++) {
    const r = r0 + ((r1 - r0) * i) / steps
    points.push(new THREE.Vector2(r, surfaceHeight(r)))
  }
  return points
}

interface PocketRingProfile {
  points: THREE.Vector2[]
  bands: RotorTextureBands
}

/**
 * The pocket floor plus number ring, `POCKET_INNER_RADIUS` to `ROTOR_RADIUS`, sampled at uniform
 * radius steps (so the Lathe's index-based V is very nearly linear in radius) with the
 * `LIP_HEIGHT` riser inserted as an explicit vertical step at `POCKET_OUTER_RADIUS`. Returns the
 * exact V fractions of that riser so `wheelTextures.ts` can paint the matching bands.
 */
function buildPocketRingProfile(steps: number): PocketRingProfile {
  const points: THREE.Vector2[] = []
  let floorEndIndex = -1
  let ringStartIndex = -1
  for (let i = 0; i <= steps; i++) {
    const r = POCKET_INNER_RADIUS + ((ROTOR_RADIUS - POCKET_INNER_RADIUS) * i) / steps
    if (r < POCKET_OUTER_RADIUS) {
      points.push(new THREE.Vector2(r, surfaceHeight(r)))
      continue
    }
    if (floorEndIndex < 0) {
      points.push(new THREE.Vector2(POCKET_OUTER_RADIUS, 0))
      floorEndIndex = points.length - 1
      points.push(new THREE.Vector2(POCKET_OUTER_RADIUS, LIP_HEIGHT))
      ringStartIndex = points.length - 1
    }
    if (r > POCKET_OUTER_RADIUS) points.push(new THREE.Vector2(r, surfaceHeight(r)))
  }
  const last = points.length - 1
  return {
    points,
    bands: { floorStart: 0, floorEnd: floorEndIndex / last, ringStart: ringStartIndex / last },
  }
}

// -------------------------------------------------------------------------------------------
// Static bowl: outer lacquered mahogany shell, dark polished stator/track, brass rim bead
// -------------------------------------------------------------------------------------------

function buildStaticBowl(): { group: THREE.Group } & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []

  // Dark polished stator cone and ball track, following `surfaceHeight`, plus the vertical inner
  // face of the rim wall the ball rides against.
  const statorPoints = sampleSurfaceProfile(ROTOR_RADIUS, TRACK_RADIUS, 40)
  statorPoints.push(new THREE.Vector2(TRACK_RADIUS, RIM_HEIGHT))
  const statorGeometry = makeLathe(statorPoints)
  const statorColor = makeWoodGrain(STATOR_TINT, STATOR_GRAIN)
  const statorBump = makeWoodBump()
  statorColor.repeat.set(10, 2)
  statorBump.repeat.set(10, 2)
  const statorMaterial = new THREE.MeshPhysicalMaterial({
    map: statorColor,
    bumpMap: statorBump,
    bumpScale: WOOD_BUMP_SCALE,
    roughness: 0.32,
    clearcoat: 0.85,
    clearcoatRoughness: 0.3,
  })
  const statorMesh = new THREE.Mesh(statorGeometry, statorMaterial)
  statorMesh.castShadow = true
  statorMesh.receiveShadow = true
  disposables.push(statorGeometry, statorColor, statorBump, statorMaterial)
  group.add(statorMesh)

  // Rounded rim top and the outer lacquered mahogany bowl side, down to the felt.
  const outerPoints = [
    new THREE.Vector2(TRACK_RADIUS, RIM_HEIGHT),
    new THREE.Vector2(TRACK_RADIUS + 0.7, RIM_HEIGHT + 0.55),
    new THREE.Vector2(BOWL_RADIUS * 0.94, RIM_HEIGHT + 0.75),
    new THREE.Vector2(BOWL_RADIUS, RIM_HEIGHT + 0.1),
    new THREE.Vector2(BOWL_RADIUS, -1.2),
  ]
  const outerGeometry = makeLathe(outerPoints)
  const outerColor = makeWoodGrain(OUTER_BOWL_TINT, OUTER_BOWL_GRAIN)
  const outerBump = makeWoodBump()
  outerColor.repeat.set(14, 3)
  outerBump.repeat.set(14, 3)
  const outerMaterial = new THREE.MeshPhysicalMaterial({
    map: outerColor,
    bumpMap: outerBump,
    bumpScale: WOOD_BUMP_SCALE,
    roughness: 0.4,
    clearcoat: 0.9,
    // Soft enough that the spotlight overhead spreads into a sheen rather than a hot spot.
    clearcoatRoughness: 0.28,
  })
  const outerMesh = new THREE.Mesh(outerGeometry, outerMaterial)
  outerMesh.castShadow = true
  outerMesh.receiveShadow = true
  disposables.push(outerGeometry, outerColor, outerBump, outerMaterial)
  group.add(outerMesh)

  // Thin brass bead on the rim edge, where the stator/track meets the rounded top.
  const beadGeometry = new THREE.TorusGeometry(TRACK_RADIUS, 0.08, 10, LATHE_SEGMENTS)
  const beadMaterial = new THREE.MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.25 })
  const bead = new THREE.Mesh(beadGeometry, beadMaterial)
  bead.rotation.x = Math.PI / 2
  bead.position.y = RIM_HEIGHT
  bead.castShadow = true
  disposables.push(beadGeometry, beadMaterial)
  group.add(bead)

  return { group, dispose: () => disposeAll(disposables) }
}

// -------------------------------------------------------------------------------------------
// Diamonds: eight polished-chrome deflectors on the stator
// -------------------------------------------------------------------------------------------

function buildDiamonds(chromeMaterial: THREE.Material): { group: THREE.Group } & Disposable {
  const group = new THREE.Group()
  // Every diamond shares one size (`wheel.ts` gives a single half-length/thickness/height for
  // all eight), so one geometry serves every instance; only position and yaw differ.
  const geometry = new THREE.OctahedronGeometry(1, 0)
  geometry.scale(DIAMOND_HALF_LENGTH, DIAMOND_HEIGHT / 2, DIAMOND_HALF_THICKNESS * 1.6)
  const surfaceY = surfaceHeight(DIAMOND_RADIUS) + DIAMOND_HEIGHT / 2

  for (const diamond of DIAMONDS) {
    const mesh = new THREE.Mesh(geometry, chromeMaterial)
    const cx = (diamond.a.x + diamond.b.x) / 2
    const cy = (diamond.a.y + diamond.b.y) / 2
    mesh.position.set(cx, surfaceY, -cy)
    mesh.rotation.y = Math.atan2(diamond.b.y - diamond.a.y, diamond.b.x - diamond.a.x)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }

  return { group, dispose: () => geometry.dispose() }
}

// -------------------------------------------------------------------------------------------
// Rotor: pocket floor + number ring, 37 frets, turret cone and gold spindle
// -------------------------------------------------------------------------------------------

function buildPocketRing(): { mesh: THREE.Mesh } & Disposable {
  const { points, bands } = buildPocketRingProfile(64)
  const geometry = makeLathe(points)
  const colorMap = makeRotorColorTexture(bands)
  const roughnessMap = makeScratchRoughness()
  const material = new THREE.MeshPhysicalMaterial({
    map: colorMap,
    roughness: 0.34,
    roughnessMap,
    clearcoat: 0.7,
    clearcoatRoughness: 0.2,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return { mesh, dispose: () => disposeAll([geometry, colorMap, roughnessMap, material]) }
}

function buildFrets(chromeMaterial: THREE.Material): { mesh: THREE.InstancedMesh } & Disposable {
  const length = POCKET_OUTER_RADIUS + 0.2 - POCKET_INNER_RADIUS
  const geometry = new THREE.BoxGeometry(length, FRET_HEIGHT, FRET_HALF_THICKNESS * 2)
  const mesh = new THREE.InstancedMesh(geometry, chromeMaterial, POCKET_COUNT)
  mesh.castShadow = true
  mesh.receiveShadow = true

  const midR = POCKET_INNER_RADIUS + length / 2
  // The blade is short and mostly over the (near-flat) pocket floor, so one average height for
  // its whole span reads fine against the true sloped surface underneath.
  const midY = (surfaceHeight(POCKET_INNER_RADIUS) + surfaceHeight(POCKET_OUTER_RADIUS + 0.2)) / 2 + FRET_HEIGHT / 2
  const matrix = new THREE.Matrix4()
  for (let k = 0; k < POCKET_COUNT; k++) {
    const angle = fretLocalAngle(k)
    matrix.makeRotationY(angle)
    matrix.setPosition(midR * Math.cos(angle), midY, -midR * Math.sin(angle))
    mesh.setMatrixAt(k, matrix)
  }
  mesh.instanceMatrix.needsUpdate = true

  return { mesh, dispose: () => geometry.dispose() }
}

function buildTurret(woodMaterial: THREE.Material, goldMaterial: THREE.Material): { group: THREE.Group } & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []

  const coneGeometry = makeLathe(sampleSurfaceProfile(TURRET_RADIUS, POCKET_INNER_RADIUS, 24))
  const cone = new THREE.Mesh(coneGeometry, woodMaterial)
  cone.castShadow = true
  cone.receiveShadow = true
  disposables.push(coneGeometry)
  group.add(cone)

  // Brass trim ring where the turret meets the pocket floor.
  const trimGeometry = new THREE.TorusGeometry(POCKET_INNER_RADIUS, 0.07, 8, LATHE_SEGMENTS)
  const trim = new THREE.Mesh(trimGeometry, goldMaterial)
  trim.rotation.x = Math.PI / 2
  trim.position.y = surfaceHeight(POCKET_INNER_RADIUS)
  trim.castShadow = true
  disposables.push(trimGeometry)
  group.add(trim)

  // The spindle cap closes off the cone (cut off at `TURRET_RADIUS`), topped by the classic
  // four-arm cross handle with a ball knob at each tip.
  const capY = surfaceHeight(TURRET_RADIUS)
  const capGeometry = new THREE.CircleGeometry(TURRET_RADIUS, LATHE_SEGMENTS)
  capGeometry.rotateX(-Math.PI / 2)
  // Lacquered wood like the cone, so the spotlight overhead does not flare off a gold disc.
  const cap = new THREE.Mesh(capGeometry, woodMaterial)
  cap.position.y = capY
  cap.receiveShadow = true
  disposables.push(capGeometry)
  group.add(cap)

  const shaftHeight = 0.6
  const shaftGeometry = new THREE.CylinderGeometry(0.5, 0.6, shaftHeight, 16)
  const shaft = new THREE.Mesh(shaftGeometry, goldMaterial)
  shaft.position.y = capY + shaftHeight / 2
  shaft.castShadow = true
  disposables.push(shaftGeometry)
  group.add(shaft)

  const armY = capY + shaftHeight
  const armLength = TURRET_RADIUS * 1.5
  const armThickness = 0.35
  const armGeometryX = new THREE.BoxGeometry(armLength, armThickness, armThickness)
  const armX = new THREE.Mesh(armGeometryX, goldMaterial)
  armX.position.y = armY
  armX.castShadow = true
  disposables.push(armGeometryX)
  group.add(armX)

  const armGeometryZ = new THREE.BoxGeometry(armThickness, armThickness, armLength)
  const armZ = new THREE.Mesh(armGeometryZ, goldMaterial)
  armZ.position.y = armY
  armZ.castShadow = true
  disposables.push(armGeometryZ)
  group.add(armZ)

  const knobGeometry = new THREE.SphereGeometry(armThickness * 0.9, 16, 12)
  const knobOffsets: readonly (readonly [number, number])[] = [
    [armLength / 2, 0],
    [-armLength / 2, 0],
    [0, armLength / 2],
    [0, -armLength / 2],
  ]
  for (const [x, z] of knobOffsets) {
    const knob = new THREE.Mesh(knobGeometry, goldMaterial)
    knob.position.set(x, armY, z)
    knob.castShadow = true
    group.add(knob)
  }
  disposables.push(knobGeometry)

  return { group, dispose: () => disposeAll(disposables) }
}

// -------------------------------------------------------------------------------------------
// Highlight overlay
// -------------------------------------------------------------------------------------------

/**
 * A flat additive gold sector over one pocket's number segment and floor, rebuilt (cheaply - one
 * sector, changed rarely) whenever the highlighted pocket changes. `RingGeometry`'s own theta
 * convention already matches the rotor-frame angle directly (unlike the Lathe's, see the header),
 * so no extra offset is needed here.
 */
function buildHighlight(): {
  mesh: THREE.Mesh
  setPocket(index: number | null): void
  setPulse(phase: number): void
  dispose(): void
} {
  const material = new THREE.MeshBasicMaterial({
    color: HIGHLIGHT_COLOR,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material)
  mesh.position.y = LIP_HEIGHT + 0.12
  mesh.renderOrder = 10
  mesh.visible = false

  let sectorGeometry: THREE.BufferGeometry | null = null

  function setPocket(index: number | null): void {
    if (sectorGeometry) {
      sectorGeometry.dispose()
      sectorGeometry = null
    }
    if (index === null) {
      mesh.visible = false
      material.opacity = 0
      return
    }
    const center = -index * POCKET_ANGLE
    const geometry = new THREE.RingGeometry(POCKET_INNER_RADIUS, ROTOR_RADIUS, 24, 1, center - POCKET_ANGLE / 2, POCKET_ANGLE)
    geometry.rotateX(-Math.PI / 2)
    mesh.geometry = geometry
    sectorGeometry = geometry
    mesh.visible = true
  }

  function setPulse(phase: number): void {
    if (!mesh.visible) return
    material.opacity = 0.35 + 0.25 * Math.sin(phase * Math.PI * 2 * HIGHLIGHT_PULSE_HZ)
  }

  return {
    mesh,
    setPocket,
    setPulse,
    dispose: () => {
      if (sectorGeometry) sectorGeometry.dispose()
      material.dispose()
    },
  }
}

// -------------------------------------------------------------------------------------------
// Ball
// -------------------------------------------------------------------------------------------

function buildBall(): { mesh: THREE.Mesh } & Disposable {
  const geometry = new THREE.SphereGeometry(BALL_RADIUS, 32, 24)
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xf4f1ea,
    roughness: 0.3,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.visible = false
  return { mesh, dispose: () => disposeAll([geometry, material]) }
}

// -------------------------------------------------------------------------------------------
// Assembly
// -------------------------------------------------------------------------------------------

export function createWheelView(): WheelView {
  const group = new THREE.Group()
  const disposables: Disposable[] = []

  // Shared metal materials/maps: chrome (diamonds, frets) and gold (bead, trim, spindle - these
  // stay untextured, a plain polished-gold `MeshStandardMaterial` per the spec).
  const chromeRoughness = makeBrushedMetalRoughness()
  const chromeBump = makeBrushedMetalBump()
  const chromeMaterial = new THREE.MeshStandardMaterial({
    color: CHROME,
    metalness: 1,
    roughness: 0.3,
    roughnessMap: chromeRoughness,
    bumpMap: chromeBump,
    bumpScale: METAL_BUMP_SCALE,
  })
  const goldMaterial = new THREE.MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.25 })
  disposables.push(chromeRoughness, chromeBump, chromeMaterial, goldMaterial)

  const turretColor = makeWoodGrain(TURRET_TINT, TURRET_GRAIN)
  const turretBump = makeWoodBump()
  turretColor.repeat.set(8, 2)
  turretBump.repeat.set(8, 2)
  const turretMaterial = new THREE.MeshPhysicalMaterial({
    map: turretColor,
    bumpMap: turretBump,
    bumpScale: WOOD_BUMP_SCALE,
    roughness: 0.3,
    clearcoat: 0.8,
    clearcoatRoughness: 0.15,
  })
  disposables.push(turretColor, turretBump, turretMaterial)

  const bowl = buildStaticBowl()
  const diamonds = buildDiamonds(chromeMaterial)
  disposables.push(bowl, diamonds)
  group.add(bowl.group, diamonds.group)

  const rotorGroup = new THREE.Group()
  const pocketRing = buildPocketRing()
  const frets = buildFrets(chromeMaterial)
  const turret = buildTurret(turretMaterial, goldMaterial)
  const highlight = buildHighlight()
  disposables.push(pocketRing, frets, turret, highlight)
  rotorGroup.add(pocketRing.mesh, frets.mesh, turret.group, highlight.mesh)
  group.add(rotorGroup)

  const ball = buildBall()
  disposables.push(ball)
  group.add(ball.mesh)

  let elapsedTime = 0
  let hasBall = false
  const rollAxis = new THREE.Vector3()

  function update(wheel: WheelState, dt: number): void {
    elapsedTime += dt
    rotorGroup.rotation.y = wheel.rotorAngle

    const physicsBall = wheel.ball
    if (physicsBall) {
      hasBall = true
      ball.mesh.visible = true
      const h = ballHeight(physicsBall)
      ball.mesh.position.set(physicsBall.x, h, -physicsBall.y)

      const speed = Math.hypot(physicsBall.vx, physicsBall.vy)
      if (speed > 1e-4) {
        const dirX = physicsBall.vx / speed
        const dirY = physicsBall.vy / speed
        // Local motion direction is `(dirX, 0, -dirY)`; the rolling axis is perpendicular to it
        // in the horizontal plane.
        rollAxis.set(-dirY, 0, -dirX).normalize()
        const angle = (relativeSpeed(wheel) * dt) / BALL_RADIUS
        if (Number.isFinite(angle)) ball.mesh.rotateOnWorldAxis(rollAxis, angle)
      }
    } else {
      hasBall = false
      ball.mesh.visible = false
    }

    highlight.setPulse(elapsedTime)
  }

  function ballWorldPosition(target: THREE.Vector3): boolean {
    if (!hasBall) return false
    group.updateMatrixWorld(true)
    ball.mesh.getWorldPosition(target)
    return true
  }

  function highlightPocket(index: number | null): void {
    highlight.setPocket(index)
  }

  function dispose(): void {
    disposeAll(disposables)
  }

  return { group, update, ballWorldPosition, highlightPocket, dispose }
}
