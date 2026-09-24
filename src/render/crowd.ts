/**
 * The spectators who stand around the table: a croupier plus a scattering of guests in evening
 * wear who idle, watch the ball and cheer or groan at the result. Everything here is built from three.js
 * primitives (no models), animated procedurally, with a seeded PRNG so layout and motion are varied
 * but reproducible.
 */

import * as THREE from 'three'
import type { CrowdReactionKind } from '../game/crowd.ts'
import { TABLE_HEIGHT, WHEEL_CENTER_X, WHEEL_CENTER_Z } from './tableGeometry.ts'

export interface CrowdView {
  /** Add to the scene. */
  group: THREE.Group
  /** Starts a reaction, strength 0..1. A new reaction replaces a running one. */
  react(kind: CrowdReactionKind, strength: number): void
  /** Eases everyone back to idle (called when the player starts betting again). */
  calm(): void
  /** World point the spectators' heads turn toward; null means the wheel centre. */
  setWatchTarget(point: THREE.Vector3 | null): void
  /** `dt` seconds since last frame (0 while paused), `time` a running clock in seconds. */
  update(dt: number, time: number): void
  dispose(): void
}

/** Intensity of the warm fill light over the dealer side, exported so it can be tuned. */
export const CROWD_FILL_LIGHT_INTENSITY = 1.4
/** Reactions last long enough to fill the engine's crowd shot after the pocket close-up. */
const CHEER_BASE_SECONDS = 3.6
const GROAN_BASE_SECONDS = 2.8
/** Where the player stands, for the spectators to cheer or groan at. */
const PLAYER_LOOK_POINT = { x: 7, y: 58, z: 50 }

// -------------------------------------------------------------------------------------------
// Seeded PRNG - never Math.random for layout or per-figure variety.
// -------------------------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rangeOf = (rng: () => number, min: number, max: number): number => min + (max - min) * rng()
const deg = (d: number): number => (d * Math.PI) / 180
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))
const clamp01 = (v: number): number => clamp(v, 0, 1)
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
/** Exponential ease toward `target`; `tau` is the time constant in seconds. `dt = 0` is a no-op. */
const ease = (current: number, target: number, dt: number, tau: number): number =>
  dt <= 0 ? current : lerp(current, target, 1 - Math.exp(-dt / tau))

// -------------------------------------------------------------------------------------------
// Palette
// -------------------------------------------------------------------------------------------

const SUIT_COLORS = ['#111113', '#2b2b2e', '#101a33', '#4a0e18']
const DRESS_COLORS = ['#8a0303', '#0d5c37', '#cca63a', '#0c0c0e', '#1a2f8a']
const SKIN_TONES = ['#f2c9a0', '#e0ac7d', '#c98a5c', '#a9714a', '#7a4a28', '#4a2c1a']
const HAIR_COLORS = ['#141010', '#3b2412', '#6b4226', '#0a0a0a', '#a98a3a', '#8a8a8a']
const SHIRT_WHITE = '#f2ede0'
const CROUPIER_WAISTCOAT = '#101012'

// -------------------------------------------------------------------------------------------
// Shared geometry / material caches (instance-scoped so dispose() only tears down its own).
// -------------------------------------------------------------------------------------------

function createCaches() {
  const geometries = new Map<string, THREE.BufferGeometry>()
  const materials = new Map<string, THREE.MeshStandardMaterial>()

  function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
    let g = geometries.get(key)
    if (!g) {
      g = make()
      geometries.set(key, g)
    }
    return g as T
  }

  function mat(color: string, roughness: number, metalness: number): THREE.MeshStandardMaterial {
    const key = `${color}|${roughness}|${metalness}`
    let m = materials.get(key)
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness, metalness })
      materials.set(key, m)
    }
    return m
  }

  return {
    geo,
    suitMat: (c: string) => mat(c, 0.7, 0),
    satinMat: (c: string) => mat(c, 0.35, 0.1),
    skinMat: (c: string) => mat(c, 0.6, 0),
    hairMat: (c: string) => mat(c, 0.5, 0),
    glassMat: (): THREE.MeshStandardMaterial => {
      let m = materials.get('glass')
      if (!m) {
        m = new THREE.MeshStandardMaterial({ color: '#e4f0ec', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
        materials.set('glass', m)
      }
      return m
    },
    disposeAll: () => {
      for (const g of geometries.values()) g.dispose()
      for (const m of materials.values()) m.dispose()
      geometries.clear()
      materials.clear()
    },
  }
}

type Caches = ReturnType<typeof createCaches>

// -------------------------------------------------------------------------------------------
// Figure hierarchy
// -------------------------------------------------------------------------------------------

interface Joints {
  hips: THREE.Group
  torso: THREE.Group
  /** The breathing chest (scaled uniformly). */
  torsoMesh: THREE.Object3D
  mouth: THREE.Mesh
  browL: THREE.Mesh
  browR: THREE.Mesh
  neck: THREE.Group
  shoulderL: THREE.Group
  shoulderR: THREE.Group
  elbowL: THREE.Group
  elbowR: THREE.Group
}

interface ReactionState {
  kind: CrowdReactionKind
  strength: number
  startTime: number
  delay: number
  duration: number
  full: boolean
  variant: number
}

interface CurrentPose {
  hipsRoll: number
  hipsX: number
  torsoPitch: number
  torsoYaw: number
  neckYaw: number
  neckPitch: number
  shoulderL: number
  shoulderR: number
  shoulderSpreadL: number
  shoulderSpreadR: number
  elbowL: number
  elbowR: number
  hopY: number
  breath: number
  /** 0 closed to 1 wide open. */
  mouthOpen: number
  /** 0 a wide smile/shout to 1 a round 'aww'. */
  mouthRound: number
  /** −1 brows raised at the inner ends (delight, or dismay) to 1 an angry frown. */
  frown: number
}

interface Figure {
  root: THREE.Group
  joints: Joints
  isCroupier: boolean
  holdsGlass: boolean
  rng: () => number
  phase: number
  tempo: number
  swayPeriod: number
  headWorldX: number
  headWorldY: number
  headWorldZ: number
  baseFacing: number
  cur: CurrentPose
  reaction: ReactionState | null
  calming: { fromWeight: number; startTime: number } | null
  weight: number
  gestureUntil: number
  gestureStart: number
  croupierClapStart: number | null
}

function defaultPose(): CurrentPose {
  return {
    hipsRoll: 0,
    hipsX: 0,
    torsoPitch: 0,
    torsoYaw: 0,
    neckYaw: 0,
    neckPitch: 0,
    shoulderL: 0,
    shoulderR: 0,
    shoulderSpreadL: 0,
    shoulderSpreadR: 0,
    elbowL: 0,
    elbowR: 0,
    hopY: 0,
    breath: 1,
    mouthOpen: 0,
    mouthRound: 0,
    frown: 0,
  }
}

interface FigureSpec {
  x: number
  z: number
  isCroupier?: boolean
  facing?: number
}

/** Every figure faces this point unless it has an explicit facing (the croupier faces +Z). */
const FACE_TOWARD_X = -10
const FACE_TOWARD_Z = 0

const FIGURE_SPECS: FigureSpec[] = [
  { x: -37, z: -32, isCroupier: true, facing: 0 },
  { x: -14, z: -34 },
  { x: -3, z: -38 },
  { x: 8, z: -34 },
  { x: 19, z: -38 },
  { x: 30, z: -34 },
  { x: 47, z: -9 },
  { x: 50, z: 7 },
]

const CANONICAL_HEIGHT = 66
const HIP_Y = 31
const TORSO_LEN = 17
const NECK_LEN = 3.2
const UPPER_ARM_LEN = 10
const FOREARM_LEN = 8.5
/** Chests are flatter front to back than they are wide. */
const TORSO_DEPTH_SCALE = 0.62
const SHOULDER_Y = TORSO_LEN - 2.4
const SHOULDER_X = 6.5
/** Arms hang this far out from the body at rest, so hands clear the hips and skirts. */
const REST_ABDUCTION = deg(7)
/** A glass-holding forearm is raised this far at rest. */
const GLASS_ELBOW = deg(-80)
const HEAD_RADIUS = 4

/** Half-profile of a jacket or bodice, bottom to top, as (radius, height): narrow waist, broad shoulders. */
const TORSO_PROFILE: readonly (readonly [number, number])[] = [
  [0, -1.5], [4.9, -1.5], [5.3, 1.5], [4.9, 5.5], [5.4, 10], [6.2, 13.8], [6.4, 15.6], [5.6, 17], [3.4, 17.9], [1.8, 18.2], [0, 18.3],
]

/** A downward-pointing V: the shirt front of a suit or the neckline of a dress. */
function makeVee(width: number, depth: number): THREE.ShapeGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(-width / 2, 0)
  shape.lineTo(width / 2, 0)
  shape.lineTo(0, -depth)
  shape.closePath()
  return new THREE.ShapeGeometry(shape)
}

function buildFigure(spec: FigureSpec, seed: number, caches: Caches): Figure {
  const rng = mulberry32(seed)
  const isCroupier = spec.isCroupier === true
  const isWoman = isCroupier ? false : rng() < 0.5
  const skinColor = SKIN_TONES[Math.floor(rng() * SKIN_TONES.length)]!
  const skin = caches.skinMat(skinColor)
  const hair = caches.hairMat(HAIR_COLORS[Math.floor(rng() * HAIR_COLORS.length)]!)
  const dark = caches.suitMat('#0a0a0a')

  const root = new THREE.Group()
  const jitterX = rangeOf(rng, -1.5, 1.5)
  const jitterZ = rangeOf(rng, -1.5, 1.5)
  root.position.set(spec.x + jitterX, 0, spec.z + jitterZ)
  const heightScale = rangeOf(rng, 61 / CANONICAL_HEIGHT, 68 / CANONICAL_HEIGHT) * (isWoman ? 0.97 : 1)
  root.scale.setScalar(heightScale)

  const dx = FACE_TOWARD_X - root.position.x
  const dz = FACE_TOWARD_Z - root.position.z
  const baseFacing = spec.facing ?? Math.atan2(dx, dz) + rangeOf(rng, deg(-4), deg(4))
  root.rotation.y = baseFacing

  const hips = new THREE.Group()
  hips.position.set(0, HIP_Y, 0)
  root.add(hips)

  const dressColor = DRESS_COLORS[Math.floor(rng() * DRESS_COLORS.length)]!
  const suitColor = SUIT_COLORS[Math.floor(rng() * SUIT_COLORS.length)]!
  const outfit = isCroupier ? caches.suitMat(CROUPIER_WAISTCOAT) : isWoman ? caches.satinMat(dressColor) : caches.suitMat(suitColor)

  // Legs (men) or a floor-length gown (women) hanging from the hips.
  if (isWoman) {
    const skirt = new THREE.Mesh(
      caches.geo('skirt', () => new THREE.CylinderGeometry(4.9, 9.2, HIP_Y - 0.5, 18, 1, true)),
      outfit,
    )
    skirt.position.y = -(HIP_Y - 0.5) / 2
    skirt.scale.z = 0.8
    hips.add(skirt)
  } else {
    const trousers = isCroupier ? dark : outfit
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(caches.geo('leg', () => new THREE.CapsuleGeometry(2.3, HIP_Y - 6, 4, 8)), trousers)
      leg.position.set(side * 2.7, -(HIP_Y - 6) / 2 - 3, 0)
      hips.add(leg)
      const shoe = new THREE.Mesh(caches.geo('shoe', () => new THREE.BoxGeometry(3.2, 1.6, 5.4)), dark)
      shoe.position.set(side * 2.7, -HIP_Y + 0.8, 1.1)
      hips.add(shoe)
    }
  }

  const torso = new THREE.Group()
  hips.add(torso)

  // `chest` breathes (uniform scale); the lathe inside it carries the fixed front-to-back squash.
  const chest = new THREE.Group()
  torso.add(chest)
  const torsoMesh = new THREE.Mesh(
    caches.geo('torso', () => new THREE.LatheGeometry(TORSO_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 20)),
    outfit,
  )
  torsoMesh.scale.z = TORSO_DEPTH_SCALE
  chest.add(torsoMesh)

  // Shirt front, tie or bow tie (men), or a neckline and necklace (women), on the chest.
  const chestFront = 6.1 * TORSO_DEPTH_SCALE + 0.12
  if (isWoman) {
    const neckline = new THREE.Mesh(caches.geo('neckline', () => makeVee(5.2, 5)), skin)
    neckline.position.set(0, TORSO_LEN + 0.4, chestFront - 0.2)
    neckline.rotation.x = deg(-10)
    chest.add(neckline)
    const necklace = new THREE.Mesh(caches.geo('necklace', () => new THREE.TorusGeometry(2.2, 0.16, 6, 20)), caches.satinMat('#e8c46a'))
    necklace.position.set(0, TORSO_LEN + 0.7, 0.9)
    necklace.rotation.x = deg(70)
    chest.add(necklace)
  } else {
    const shirt = new THREE.Mesh(caches.geo('shirtVee', () => makeVee(4.2, 7)), caches.suitMat(SHIRT_WHITE))
    shirt.position.set(0, TORSO_LEN + 0.6, chestFront - 0.3)
    shirt.rotation.x = deg(-12)
    chest.add(shirt)
    const bowTie = isCroupier || rng() < 0.55
    const tieMat = isCroupier || rng() < 0.5 ? dark : caches.satinMat('#7a0f1a')
    if (bowTie) {
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(caches.geo('bowWing', () => new THREE.ConeGeometry(0.75, 1.5, 6)), tieMat)
        wing.position.set(side * 0.72, TORSO_LEN - 0.1, chestFront + 0.25)
        wing.rotation.z = side * deg(90)
        chest.add(wing)
      }
    } else {
      const tie = new THREE.Mesh(caches.geo('tie', () => new THREE.BoxGeometry(0.9, 5.2, 0.25)), tieMat)
      tie.position.set(0, TORSO_LEN - 2.6, chestFront + 0.05)
      tie.rotation.x = deg(-12)
      chest.add(tie)
    }
  }

  const neckMesh = new THREE.Mesh(caches.geo('neckMesh', () => new THREE.CylinderGeometry(1.55, 1.75, 3.6, 10)), skin)
  neckMesh.position.y = TORSO_LEN + 1.4
  torso.add(neckMesh)

  const neck = new THREE.Group()
  neck.position.set(0, TORSO_LEN + NECK_LEN, 0)
  torso.add(neck)

  // Head: a slightly tall ellipsoid with ears, eyes, nose and a mouth that opens to cheer or groan.
  const head = new THREE.Group()
  head.position.y = HEAD_RADIUS * 1.05
  head.scale.set(0.9, 1.1, 0.98)
  neck.add(head)
  head.add(new THREE.Mesh(caches.geo('head', () => new THREE.SphereGeometry(HEAD_RADIUS, 20, 16)), skin))
  const eyeMat = caches.suitMat('#1a120c')
  const brows: THREE.Mesh[] = []
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(caches.geo('eye', () => new THREE.SphereGeometry(0.42, 8, 6)), eyeMat)
    eye.position.set(side * 1.35, 0.55, 3.55)
    head.add(eye)
    const brow = new THREE.Mesh(caches.geo('brow', () => new THREE.BoxGeometry(1.4, 0.28, 0.3)), hair)
    brow.position.set(side * 1.35, 1.45, 3.6)
    brow.rotation.z = side * deg(-6)
    head.add(brow)
    brows.push(brow)
    const ear = new THREE.Mesh(caches.geo('ear', () => new THREE.SphereGeometry(0.95, 8, 6)), skin)
    ear.position.set(side * 3.85, 0, -0.2)
    ear.scale.set(0.45, 1, 0.7)
    head.add(ear)
  }
  const nose = new THREE.Mesh(caches.geo('nose', () => new THREE.SphereGeometry(0.6, 8, 6)), skin)
  nose.position.set(0, -0.35, 3.95)
  nose.scale.set(0.75, 1, 1.05)
  head.add(nose)
  const mouth = new THREE.Mesh(
    caches.geo('mouth', () => new THREE.SphereGeometry(0.55, 10, 6)),
    isWoman ? caches.satinMat('#6e1420') : caches.suitMat('#3a1810'),
  )
  mouth.position.set(0, -1.85, 3.45)
  mouth.scale.set(2, 0.4, 0.6)
  head.add(mouth)

  // Hair: a crown cap plus a back cap that leave the face clear, then a style.
  const crown = new THREE.Mesh(
    caches.geo('hairCrown', () => new THREE.SphereGeometry(HEAD_RADIUS * 1.06, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.3)),
    hair,
  )
  head.add(crown)
  const back = new THREE.Mesh(
    caches.geo('hairBack', () => new THREE.SphereGeometry(HEAD_RADIUS * 1.05, 18, 12, Math.PI * 1.08, Math.PI * 0.84, 0, Math.PI * 0.62)),
    hair,
  )
  head.add(back)
  if (isWoman) {
    if (rng() < 0.55) {
      const long = new THREE.Mesh(caches.geo('hairLong', () => new THREE.CapsuleGeometry(3.1, 5.5, 4, 10)), hair)
      long.position.set(0, -3.6, -2.4)
      long.scale.set(1.2, 1, 0.5)
      head.add(long)
    } else {
      const bun = new THREE.Mesh(caches.geo('hairBun', () => new THREE.SphereGeometry(1.9, 12, 8)), hair)
      bun.position.set(0, 2.6, -3.3)
      head.add(bun)
    }
  }

  const holdsGlass = !isCroupier && rng() < 0.3
  const armMat = isWoman ? skin : isCroupier ? caches.suitMat(SHIRT_WHITE) : outfit
  const cuffMat = caches.suitMat(SHIRT_WHITE)
  const elbows: THREE.Group[] = []
  const shouldersOut: THREE.Group[] = []
  for (const side of [-1, 1] as const) {
    const shoulder = new THREE.Group()
    shoulder.position.set(side * SHOULDER_X, SHOULDER_Y, 0)
    torso.add(shoulder)
    const upperArm = new THREE.Mesh(caches.geo('upperArm', () => new THREE.CapsuleGeometry(1.75, UPPER_ARM_LEN - 3.5, 4, 8)), armMat)
    upperArm.position.y = -UPPER_ARM_LEN / 2
    shoulder.add(upperArm)

    const elbow = new THREE.Group()
    elbow.position.y = -UPPER_ARM_LEN
    shoulder.add(elbow)
    const forearm = new THREE.Mesh(caches.geo('forearm', () => new THREE.CapsuleGeometry(1.5, FOREARM_LEN - 3, 4, 8)), armMat)
    forearm.position.y = -FOREARM_LEN / 2
    elbow.add(forearm)
    if (!isWoman && !isCroupier) {
      const cuff = new THREE.Mesh(caches.geo('cuff', () => new THREE.CylinderGeometry(1.45, 1.45, 0.9, 10)), cuffMat)
      cuff.position.y = -FOREARM_LEN + 1.2
      elbow.add(cuff)
    }
    const hand = new THREE.Mesh(caches.geo('hand', () => new THREE.SphereGeometry(1.35, 10, 8)), skin)
    hand.position.y = -FOREARM_LEN - 0.4
    hand.scale.set(0.8, 1.15, 0.95)
    elbow.add(hand)

    if (holdsGlass && side === 1) {
      // A coupe held upright: the elbow is flexed by GLASS_ELBOW at rest, so counter-rotate.
      const glass = new THREE.Group()
      glass.position.set(0, -FOREARM_LEN - 0.4, 0.9)
      glass.rotation.x = -GLASS_ELBOW
      const bowl = new THREE.Mesh(caches.geo('glassBowl', () => new THREE.ConeGeometry(1.5, 1.6, 14, 1, true)), caches.glassMat())
      bowl.rotation.x = Math.PI
      bowl.position.y = 2.6
      const stem = new THREE.Mesh(caches.geo('glassStem', () => new THREE.CylinderGeometry(0.12, 0.12, 2, 6)), caches.glassMat())
      stem.position.y = 1
      const drink = new THREE.Mesh(caches.geo('glassDrink', () => new THREE.CircleGeometry(1.1, 14)), caches.satinMat('#e8b84a'))
      drink.rotation.x = -Math.PI / 2
      drink.position.y = 2.95
      glass.add(bowl, stem, drink)
      elbow.add(glass)
    }

    elbows.push(elbow)
    shouldersOut.push(shoulder)
  }

  const headWorldY = (HIP_Y + TORSO_LEN + NECK_LEN + HEAD_RADIUS) * heightScale
  return {
    root,
    joints: {
      hips, torso, torsoMesh: chest, neck, mouth, browL: brows[0]!, browR: brows[1]!,
      shoulderL: shouldersOut[0]!, shoulderR: shouldersOut[1]!, elbowL: elbows[0]!, elbowR: elbows[1]!,
    },
    isCroupier,
    holdsGlass,
    rng,
    phase: rangeOf(rng, 0, Math.PI * 2),
    tempo: rangeOf(rng, 0.85, 1.2),
    swayPeriod: rangeOf(rng, 3, 6),
    headWorldX: root.position.x,
    headWorldY,
    headWorldZ: root.position.z,
    baseFacing,
    cur: defaultPose(),
    reaction: null,
    calming: null,
    weight: 0,
    gestureUntil: -Infinity,
    gestureStart: -Infinity,
    croupierClapStart: null,
  }
}

// -------------------------------------------------------------------------------------------
// Reaction pose targets
//
// Joint conventions (arms hang along −Y from the shoulder; Euler order XYZ, so the spread about
// Z applies first): shoulder X negative swings the arm forward and up (−90° straight ahead,
// −180° straight up); spread Z positive moves the LEFT arm inward and negative the RIGHT arm
// inward; elbow X negative bends the forearm naturally, toward the front of the upper arm.
// -------------------------------------------------------------------------------------------

/** Sets both shoulders' outward spread (abduction): positive is away from the body on both sides. */
function spreadOut(out: CurrentPose, left: number, right: number): void {
  out.shoulderSpreadL = -left
  out.shoulderSpreadR = right
}

/** Full-strength reaction pose, written into `out` (mutated in place - no allocation). */
function reactionPose(
  out: CurrentPose,
  kind: CrowdReactionKind,
  full: boolean,
  variant: number,
  strength: number,
  elapsed: number,
): void {
  if (kind === 'cheer') {
    out.mouthOpen = 0.75 + 0.25 * Math.abs(Math.sin(elapsed * 5))
    out.frown = -1
    out.neckPitch = deg(-10)
    const hop = full && (variant === 0 || strength >= 0.999)
    if (hop) out.hopY = Math.abs(Math.sin(elapsed * 6)) * 4.5 * strength
    if (!full) {
      if (variant === 0) {
        // One arm up.
        out.shoulderR = deg(-165)
        spreadOut(out, REST_ABDUCTION, deg(12))
        out.elbowR = deg(-12)
      } else {
        // Applause at the chest.
        const clap = Math.abs(Math.sin(elapsed * 9))
        out.shoulderL = deg(-45)
        out.shoulderR = deg(-45)
        spreadOut(out, deg(-14 + 12 * clap), deg(-14 + 12 * clap))
        out.elbowL = deg(-85)
        out.elbowR = deg(-85)
      }
      return
    }
    if (variant === 0) {
      // Both arms up in a V, fists pumping.
      const pump = Math.sin(elapsed * (7 + 2 * strength)) * deg(14)
      out.shoulderL = deg(-168) + pump
      out.shoulderR = deg(-168) - pump
      spreadOut(out, deg(18), deg(18))
      out.elbowL = deg(-14)
      out.elbowR = deg(-14)
    } else if (variant === 1) {
      // Clapping above the head.
      const clap = Math.abs(Math.sin(elapsed * 8))
      out.shoulderL = deg(-150)
      out.shoulderR = deg(-150)
      spreadOut(out, deg(-6 + 14 * clap), deg(-6 + 14 * clap))
      out.elbowL = deg(-45)
      out.elbowR = deg(-45)
    } else {
      // A fist pump, leaning back.
      const pump = Math.sin(elapsed * 7) * deg(18)
      out.shoulderR = deg(-150) + pump
      spreadOut(out, REST_ABDUCTION, deg(10))
      out.elbowR = deg(-70)
      out.torsoPitch = deg(-9)
    }
    return
  }

  // Groan: a disappointed "awww", brows up at the inner ends, shoulders dropping.
  out.mouthOpen = 0.6 - 0.3 * clamp01(elapsed / 2.5)
  out.mouthRound = 0.6
  out.frown = -0.9
  if (!full) {
    // Head drops with a slow shake.
    out.torsoPitch = deg(5)
    out.neckPitch = deg(10)
    out.neckYaw = Math.sin(elapsed * Math.PI * 1.2) * deg(12)
    spreadOut(out, deg(3), deg(3))
    return
  }
  if (variant === 0) {
    // Hands on head, elbows out.
    out.shoulderL = deg(-125)
    out.shoulderR = deg(-125)
    spreadOut(out, deg(55), deg(55))
    out.elbowL = deg(-125)
    out.elbowR = deg(-125)
    out.neckPitch = deg(-6)
  } else if (variant === 1) {
    // Face in one hand, head bowed into it.
    out.shoulderR = deg(-105)
    spreadOut(out, REST_ABDUCTION, deg(-18))
    out.elbowR = deg(-135)
    out.neckPitch = deg(16)
    out.torsoPitch = deg(6)
  } else {
    // Slumped, shaking the head.
    out.torsoPitch = deg(9)
    out.neckYaw = Math.sin(elapsed * Math.PI * 3) * deg(22)
    out.neckPitch = deg(12)
    spreadOut(out, deg(3), deg(3))
  }
}

// -------------------------------------------------------------------------------------------
// createCrowd
// -------------------------------------------------------------------------------------------

export function createCrowd(): CrowdView {
  const group = new THREE.Group()
  const caches = createCaches()

  const light = new THREE.SpotLight(0xffd9a0, CROWD_FILL_LIGHT_INTENSITY)
  light.decay = 0
  light.distance = 0
  light.castShadow = false
  light.penumbra = 0.8
  light.angle = deg(58)
  light.position.set(-5, 110, -10)
  light.target.position.set(-5, 45, -36)
  group.add(light)
  group.add(light.target)

  const figures: Figure[] = FIGURE_SPECS.map((spec, i) => {
    const fig = buildFigure(spec, 0x9e3779b1 ^ (i * 2654435761), caches)
    fig.root.traverse((obj) => {
      obj.castShadow = false
      obj.receiveShadow = false
    })
    group.add(fig.root)
    return fig
  })

  let watchTarget: { x: number; y: number; z: number } | null = null
  const wheelWatchPoint = { x: WHEEL_CENTER_X, y: TABLE_HEIGHT + 8, z: WHEEL_CENTER_Z }

  function react(kind: CrowdReactionKind, strength: number): void {
    const s = clamp01(strength)
    const duration = kind === 'cheer' ? CHEER_BASE_SECONDS + 2 * s : GROAN_BASE_SECONDS + 1.5 * s
    for (const fig of figures) {
      if (fig.isCroupier) {
        if (kind === 'cheer') fig.croupierClapStart = -1 // set to real time on next update tick
        continue
      }
      const full = fig.rng() < 0.4 + 0.6 * s
      const variantCount = kind === 'cheer' ? (full ? 3 : 2) : full ? 3 : 1
      fig.reaction = {
        kind,
        strength: s,
        startTime: -1, // resolved to the real clock on the next update() call
        delay: rangeOf(fig.rng, 0.05, 0.45),
        duration,
        full,
        variant: Math.floor(fig.rng() * variantCount),
      }
      fig.calming = null
    }
    pendingReactionStart = true
  }

  // react() doesn't receive the running clock, so the start time is latched on the next update().
  let pendingReactionStart = false

  function calm(): void {
    for (const fig of figures) {
      if (fig.weight > 0) {
        fig.calming = { fromWeight: fig.weight, startTime: -1 }
        fig.reaction = null
      }
    }
    pendingCalmStart = true
  }
  let pendingCalmStart = false

  function setWatchTarget(point: THREE.Vector3 | null): void {
    watchTarget = point ? { x: point.x, y: point.y, z: point.z } : null
  }

  function update(dt: number, time: number): void {
    if (pendingReactionStart) {
      for (const fig of figures) {
        if (fig.reaction && fig.reaction.startTime < 0) fig.reaction.startTime = time
        if (fig.isCroupier && fig.croupierClapStart === -1) fig.croupierClapStart = time
      }
      pendingReactionStart = false
    }
    if (pendingCalmStart) {
      for (const fig of figures) {
        if (fig.calming && fig.calming.startTime < 0) fig.calming.startTime = time
      }
      pendingCalmStart = false
    }

    const target = watchTarget ?? wheelWatchPoint

    for (const fig of figures) {
      updateFigure(fig, dt, time, target)
    }
  }

  function updateFigure(fig: Figure, dt: number, time: number, target: { x: number; y: number; z: number }): void {
    const p = fig.cur
    const t = time * fig.tempo + fig.phase

    // --- reaction weight -------------------------------------------------------------------
    let weight = 0
    let poseKind: CrowdReactionKind | null = null
    let poseFull = false
    let poseVariant = 0
    let poseStrength = 0
    let poseElapsed = 0
    if (fig.reaction && fig.reaction.startTime >= 0) {
      const r = fig.reaction
      const since = time - r.startTime - r.delay
      if (since < 0) {
        weight = 0
      } else if (since < r.duration) {
        weight = clamp01(since / 0.15)
      } else if (since < r.duration + 0.6) {
        weight = 1 - clamp01((since - r.duration) / 0.6)
      } else {
        weight = 0
        fig.reaction = null
      }
      poseKind = r.kind
      poseFull = r.full
      poseVariant = r.variant
      poseStrength = r.strength
      poseElapsed = Math.max(0, since)
    } else if (fig.calming && fig.calming.startTime >= 0) {
      const since = time - fig.calming.startTime
      weight = fig.calming.fromWeight * (1 - clamp01(since / 0.4))
      if (since >= 0.4) fig.calming = null
    }
    fig.weight = weight

    // --- idle pose ---------------------------------------------------------------------------
    const idle = defaultPose()
    idle.breath = 1 + Math.sin(t * 2 * Math.PI * 0.25) * 0.01
    idle.torsoPitch = Math.sin(t * 2 * Math.PI * 0.25) * deg(0.6)
    idle.hipsRoll = Math.sin((time * fig.tempo + fig.phase) * (2 * Math.PI) / fig.swayPeriod) * deg(2.5)
    idle.hipsX = Math.sin((time * fig.tempo + fig.phase) * (2 * Math.PI) / fig.swayPeriod) * 1
    spreadOut(idle, REST_ABDUCTION, REST_ABDUCTION)
    if (fig.holdsGlass) idle.elbowR = GLASS_ELBOW

    // Occasional neighbour gesture: a brief extra torso yaw.
    if (!fig.isCroupier && time > fig.gestureUntil && fig.rng() < dt * 0.03) {
      fig.gestureStart = time
      fig.gestureUntil = time + 1.4
    }
    if (time < fig.gestureUntil) {
      const g = (time - fig.gestureStart) / 1.4
      idle.torsoYaw = Math.sin(g * Math.PI) * deg(18)
    }

    // --- reaction pose (blended in by weight) ------------------------------------------------
    const reactionTarget = defaultPose()
    Object.assign(reactionTarget, idle)
    if (poseKind && weight > 0) {
      reactionPose(reactionTarget, poseKind, poseFull, poseVariant, poseStrength, poseElapsed)
    }

    const targetPose: CurrentPose = {
      hipsRoll: lerp(idle.hipsRoll, reactionTarget.hipsRoll, weight),
      hipsX: lerp(idle.hipsX, reactionTarget.hipsX, weight),
      torsoPitch: lerp(idle.torsoPitch, reactionTarget.torsoPitch, weight),
      torsoYaw: lerp(idle.torsoYaw, reactionTarget.torsoYaw, weight),
      neckYaw: lerp(idle.neckYaw, reactionTarget.neckYaw, weight),
      neckPitch: lerp(idle.neckPitch, reactionTarget.neckPitch, weight),
      shoulderL: lerp(idle.shoulderL, reactionTarget.shoulderL, weight),
      shoulderR: lerp(idle.shoulderR, reactionTarget.shoulderR, weight),
      shoulderSpreadL: lerp(idle.shoulderSpreadL, reactionTarget.shoulderSpreadL, weight),
      shoulderSpreadR: lerp(idle.shoulderSpreadR, reactionTarget.shoulderSpreadR, weight),
      elbowL: lerp(idle.elbowL, reactionTarget.elbowL, weight),
      elbowR: lerp(idle.elbowR, reactionTarget.elbowR, weight),
      hopY: lerp(idle.hopY, reactionTarget.hopY, weight),
      breath: idle.breath,
      mouthOpen: lerp(idle.mouthOpen, reactionTarget.mouthOpen, weight),
      mouthRound: lerp(idle.mouthRound, reactionTarget.mouthRound, weight),
      frown: lerp(idle.frown, reactionTarget.frown, weight),
    }

    // --- head look-at (independent of body pose, own damping time constant) -----------------
    // While reacting, they cheer or groan at the player rather than at the wheel.
    const look = weight > 0.5 ? PLAYER_LOOK_POINT : target
    const dx = look.x - fig.headWorldX
    const dy = look.y - fig.headWorldY
    const dz = look.z - fig.headWorldZ
    const horizontal = Math.sqrt(dx * dx + dz * dz)
    const worldYaw = Math.atan2(dx, dz)
    let desiredYaw = worldYaw - fig.baseFacing
    desiredYaw = Math.atan2(Math.sin(desiredYaw), Math.cos(desiredYaw))
    desiredYaw = clamp(desiredYaw, deg(-70), deg(70))
    const desiredPitch = clamp(Math.atan2(dy, Math.max(1, horizontal)), deg(-35), deg(35))
    const headTau = 0.25 + fig.phase * 0.01
    targetPose.neckYaw += desiredYaw
    targetPose.neckPitch += -desiredPitch

    // --- ease current pose toward target, apply to the hierarchy ----------------------------
    const bodyTau = 0.15
    p.hipsRoll = ease(p.hipsRoll, targetPose.hipsRoll, dt, bodyTau)
    p.hipsX = ease(p.hipsX, targetPose.hipsX, dt, bodyTau)
    p.torsoPitch = ease(p.torsoPitch, targetPose.torsoPitch, dt, bodyTau)
    p.torsoYaw = ease(p.torsoYaw, targetPose.torsoYaw, dt, bodyTau)
    p.neckYaw = ease(p.neckYaw, targetPose.neckYaw, dt, headTau)
    p.neckPitch = ease(p.neckPitch, targetPose.neckPitch, dt, headTau)
    p.shoulderL = ease(p.shoulderL, targetPose.shoulderL, dt, bodyTau)
    p.shoulderR = ease(p.shoulderR, targetPose.shoulderR, dt, bodyTau)
    p.shoulderSpreadL = ease(p.shoulderSpreadL, targetPose.shoulderSpreadL, dt, bodyTau)
    p.shoulderSpreadR = ease(p.shoulderSpreadR, targetPose.shoulderSpreadR, dt, bodyTau)
    p.elbowL = ease(p.elbowL, targetPose.elbowL, dt, bodyTau)
    p.elbowR = ease(p.elbowR, targetPose.elbowR, dt, bodyTau)
    p.hopY = ease(p.hopY, targetPose.hopY, dt, 0.08)
    p.breath = dt <= 0 ? p.breath : targetPose.breath
    p.mouthOpen = ease(p.mouthOpen, targetPose.mouthOpen, dt, 0.08)
    p.mouthRound = ease(p.mouthRound, targetPose.mouthRound, dt, 0.15)
    p.frown = ease(p.frown, targetPose.frown, dt, 0.15)

    const j = fig.joints
    fig.root.position.y = p.hopY
    j.hips.rotation.z = p.hipsRoll
    j.hips.position.x = p.hipsX
    j.torso.rotation.x = p.torsoPitch
    j.torso.rotation.y = p.torsoYaw
    j.torsoMesh.scale.setScalar(p.breath)
    j.neck.rotation.y = p.neckYaw
    j.neck.rotation.x = p.neckPitch
    j.shoulderL.rotation.x = p.shoulderL
    j.shoulderL.rotation.z = p.shoulderSpreadL
    j.shoulderR.rotation.x = p.shoulderR
    j.shoulderR.rotation.z = p.shoulderSpreadR
    j.elbowL.rotation.x = p.elbowL
    j.elbowR.rotation.x = p.elbowR
    j.mouth.scale.set(2 - 1.1 * p.mouthRound, 0.4 + 1.4 * p.mouthOpen, 0.6)
    // Brows tilt from their resting angle: inner ends up in delight, down in a frown.
    j.browL.rotation.z = deg(6) - p.frown * deg(22)
    j.browR.rotation.z = -deg(6) + p.frown * deg(22)
    j.browL.position.y = 1.45 - Math.min(0, p.frown) * 0.5
    j.browR.position.y = 1.45 - Math.min(0, p.frown) * 0.5

    // --- croupier: a polite 3-beat clap on a cheer, otherwise idle --------------------------
    if (fig.isCroupier && fig.croupierClapStart !== null && fig.croupierClapStart >= 0) {
      const since = time - fig.croupierClapStart
      const beatDuration = 0.9
      if (since >= 0 && since < beatDuration) {
        const beat = Math.sin(since * (2 * Math.PI) * (3 / beatDuration)) * 0.5 + 0.5
        j.shoulderL.rotation.x = deg(-50)
        j.shoulderR.rotation.x = deg(-50)
        j.shoulderL.rotation.z = deg(24 - beat * 12)
        j.shoulderR.rotation.z = -deg(24 - beat * 12)
        j.elbowL.rotation.x = deg(-80)
        j.elbowR.rotation.x = deg(-80)
      } else if (since >= beatDuration) {
        fig.croupierClapStart = null
      }
    }
  }

  function dispose(): void {
    caches.disposeAll()
    group.remove(light, light.target)
  }

  return { group, react, calm, setWatchTarget, update, dispose }
}
