/**
 * The table itself: felt, the printed layout, the padded rail, the mahogany apron and pedestal,
 * chip stacks, hover highlights and the winning-number dolly. World space, already positioned -
 * every mesh is built directly at its absolute world coordinates (see `tableGeometry.ts`), so
 * `group` carries no transform of its own.
 */

import * as THREE from 'three'
import type { BetMap, ChipValue, SpinResult } from '../game/types.ts'
import { betAnchor, betHighlightRects, numberCellRect, type Rect } from '../game/layout.ts'
import { CHIP_VALUES, chipBreakdown } from '../game/bets.ts'
import {
  layoutToWorld,
  TABLE_HEIGHT,
  TABLE_MIN_X,
  TABLE_MAX_X,
  TABLE_MIN_Z,
  TABLE_MAX_Z,
  WHEEL_CENTER_X,
  WHEEL_CENTER_Z,
} from './tableGeometry.ts'
import { makeBrushedMetalBump, makeBrushedMetalRoughness, makePebbleBump, makeWoodBump, makeWoodGrain } from './materialTextures.ts'
import { makeChipTextures } from './chipTextures.ts'
import { FELT_MAX_X, FELT_MAX_Z, FELT_MIN_X, FELT_MIN_Z, makeFeltTexture } from './feltTexture.ts'

export interface TableView {
  /** World space, already positioned. */
  group: THREE.Group
  /** Chip stacks for the bets on the table; rebuild only stacks whose amount changed. */
  setBets(bets: BetMap): void
  /** Lights the boxes of the hovered bet (betHighlightRects), or clears with null. */
  setHover(betId: string | null): void
  /**
   * With a result: drop the dolly on the winning number's box, light the winning boxes gold,
   * slide losing stacks toward the wheel end and fade them over about 0.8 s, and stack each
   * winning bet's winnings (returned - stake, via chipBreakdown) beside it. With null: remove the
   * dolly, the winnings and any result state (bets are then set separately via setBets).
   */
  showResult(result: SpinResult | null): void
  update(dt: number, time: number): void
  dispose(): void
}

// -------------------------------------------------------------------------------------------
// Dimensions, inches
// -------------------------------------------------------------------------------------------

const RAIL_HEIGHT = 2.5
const WOOD_STRIP_HEIGHT = 0.35
const BRASS_LINE_HEIGHT = 0.06
const APRON_DEPTH = 5
const APRON_BOTTOM_Y = TABLE_HEIGHT - APRON_DEPTH
const PEDESTAL_INSET = 6
const KICK_HEIGHT = 3.5

const CHIP_DIAMETER = 1.55
const CHIP_RADIUS = CHIP_DIAMETER / 2
const CHIP_THICKNESS = 0.13
const CHIPS_PER_COLUMN = 20
const COLUMN_OFFSET = 0.35
const CHIP_INSTANCE_INITIAL_CAPACITY = 64

const HOVER_LIFT = 0.06
const RESULT_LIFT = 0.05
const FADE_SECONDS = 0.8
const DOLLY_DROP_SECONDS = 0.5
const DOLLY_RADIUS = 0.6
const DOLLY_HEIGHT = 2
const WINNINGS_OFFSET_V = 2.2

// -------------------------------------------------------------------------------------------
// Small deterministic helpers
// -------------------------------------------------------------------------------------------

function hash32(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function jitterFor(betId: string, index: number): { dx: number; dz: number; rot: number } {
  const seed = hash32(`${betId}#${index}`)
  // A tiny deterministic spread from a hashed seed - no PRNG state to carry between calls.
  const a = ((seed & 0xff) / 255 - 0.5) * 0.12
  const b = (((seed >> 8) & 0xff) / 255 - 0.5) * 0.12
  const rot = (((seed >> 16) & 0xff) / 255) * Math.PI * 2
  return { dx: a, dz: b, rot }
}

interface Disposable {
  dispose(): void
}

function disposeAll(items: readonly Disposable[]): void {
  for (const item of items) item.dispose()
}

// -------------------------------------------------------------------------------------------
// Table outline: a "D" shape - straight sides along the layout, and a semicircular end centred on
// the wheel. Insetting the box by the same amount on every side keeps the curves concentric.
// -------------------------------------------------------------------------------------------

/** Where the straight sides end and the semicircular wheel end begins: its centre. */
function transitionX(minX: number, minZ: number, maxZ: number): number {
  return minX + (maxZ - minZ) / 2
}

/** Outline polygon in world `(x, z)`, closed, wound consistently, for the given inset box. */
function outlinePoints(minX: number, maxX: number, minZ: number, maxZ: number): { x: number; z: number }[] {
  const tx = transitionX(minX, minZ, maxZ)
  const cz = (minZ + maxZ) / 2
  const rx = tx - minX
  const rz = (maxZ - minZ) / 2
  const points: { x: number; z: number }[] = []
  points.push({ x: tx, z: minZ })
  points.push({ x: maxX, z: minZ })
  points.push({ x: maxX, z: maxZ })
  points.push({ x: tx, z: maxZ })
  const arcSegments = 40
  for (let i = 1; i <= arcSegments; i++) {
    const theta = Math.PI - (i / arcSegments) * Math.PI
    points.push({ x: tx - rx * Math.sin(theta), z: cz - rz * Math.cos(theta) })
  }
  return points
}

/** A flat `ShapeGeometry` for `points` (already in world x/z), lying at `y = 0`, with UVs set to `u,v` in `[0, 1]` over `(minX..maxX, minZ..maxZ)`. Translate the mesh up to place it. */
function buildFlatShape(
  points: readonly { x: number; z: number }[],
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.z)))
  const geometry = new THREE.ShapeGeometry(shape, 1)
  geometry.rotateX(-Math.PI / 2)
  const position = geometry.getAttribute('position')
  const uv = new Float32Array(position.count * 2)
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const z = position.getZ(i)
    uv[i * 2] = (x - minX) / (maxX - minX)
    uv[i * 2 + 1] = (z - minZ) / (maxZ - minZ)
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return geometry
}

/** A ring `ShapeGeometry` between an outer and inner outline (the rail), extruded to `height`. */
function buildRailGeometry(height: number): THREE.BufferGeometry {
  const outerPoints = outlinePoints(TABLE_MIN_X, TABLE_MAX_X, TABLE_MIN_Z, TABLE_MAX_Z)
  const innerPoints = outlinePoints(FELT_MIN_X, FELT_MAX_X, FELT_MIN_Z, FELT_MAX_Z)
  const shape = new THREE.Shape(outerPoints.map((p) => new THREE.Vector2(p.x, -p.z)))
  shape.holes.push(new THREE.Path(innerPoints.map((p) => new THREE.Vector2(p.x, -p.z))))
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 24 })
  // Extrude runs along local Z; rotate so it stands up along Y (same convention as the felt).
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

// -------------------------------------------------------------------------------------------
// Felt, rail, apron and pedestal
// -------------------------------------------------------------------------------------------

function buildFelt(): { mesh: THREE.Mesh } & Disposable {
  const points = outlinePoints(FELT_MIN_X, FELT_MAX_X, FELT_MIN_Z, FELT_MAX_Z)
  const geometry = buildFlatShape(points, FELT_MIN_X, FELT_MAX_X, FELT_MIN_Z, FELT_MAX_Z)
  geometry.translate(0, TABLE_HEIGHT, 0)
  const texture = makeFeltTexture()
  const bump = makePebbleBump()
  const material = new THREE.MeshPhysicalMaterial({
    map: texture,
    bumpMap: bump,
    bumpScale: 0.006,
    roughness: 0.92,
    clearcoat: 0,
    sheen: 0.4,
    sheenColor: new THREE.Color('#123a24'),
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  return {
    mesh,
    dispose() {
      geometry.dispose()
      material.dispose()
      texture.dispose()
      bump.dispose()
    },
  }
}

/** Padded leather rail with a wood strip and a brass trim line, following the table outline. */
function buildRail(): { group: THREE.Group } & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []

  const leatherGeometry = buildRailGeometry(RAIL_HEIGHT)
  const leatherBump = makePebbleBump()
  const leatherMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a1210,
    roughness: 0.75,
    bumpMap: leatherBump,
    bumpScale: 0.05,
  })
  const leather = new THREE.Mesh(leatherGeometry, leatherMaterial)
  leather.position.y = TABLE_HEIGHT
  leather.castShadow = true
  leather.receiveShadow = true
  disposables.push(leatherGeometry, leatherMaterial, leatherBump)
  group.add(leather)

  const stripGeometry = buildRailGeometry(WOOD_STRIP_HEIGHT)
  const woodColor = makeWoodGrain('#241209', '#3a2110')
  const woodBump = makeWoodBump()
  const woodMaterial = new THREE.MeshPhysicalMaterial({
    map: woodColor,
    bumpMap: woodBump,
    bumpScale: 0.02,
    roughness: 0.4,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
  })
  const strip = new THREE.Mesh(stripGeometry, woodMaterial)
  strip.position.y = TABLE_HEIGHT - WOOD_STRIP_HEIGHT
  strip.castShadow = true
  strip.receiveShadow = true
  disposables.push(stripGeometry, woodMaterial, woodColor, woodBump)
  group.add(strip)

  const brassGeometry = buildRailGeometry(BRASS_LINE_HEIGHT)
  const brassMaterial = new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 1, roughness: 0.3 })
  const brass = new THREE.Mesh(brassGeometry, brassMaterial)
  brass.position.y = TABLE_HEIGHT - WOOD_STRIP_HEIGHT - BRASS_LINE_HEIGHT
  brass.castShadow = true
  disposables.push(brassGeometry, brassMaterial)
  group.add(brass)

  return { group, dispose: () => disposeAll(disposables) }
}

/** The mahogany apron below the rail, and a sturdy pedestal/cabinet base down to a kick plate. */
/** How far the apron's top face sits below the felt. */
const APRON_FELT_GAP = 0.08

function buildApronAndBase(): { group: THREE.Group } & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []

  // Every extrude here uses the felt/rail's own `rotateX(-Math.PI / 2)` convention (world Z stays
  // world Z, not mirrored) with a *negative* depth, so the shape's `z = 0` face - the top - lands
  // at the translate's Y and the extrusion runs downward from there.
  const apronPoints = outlinePoints(TABLE_MIN_X + 1, TABLE_MAX_X - 1, TABLE_MIN_Z + 1, TABLE_MAX_Z - 1)
  const apronShape = new THREE.Shape(apronPoints.map((p) => new THREE.Vector2(p.x, -p.z)))
  const apronGeometry = new THREE.ExtrudeGeometry(apronShape, {
    depth: -APRON_DEPTH,
    bevelEnabled: false,
    curveSegments: 24,
  })
  apronGeometry.rotateX(-Math.PI / 2)
  // Its top face sits just under the felt; at exactly TABLE_HEIGHT the two z-fight.
  apronGeometry.translate(0, TABLE_HEIGHT - APRON_FELT_GAP, 0)
  const woodColor = makeWoodGrain('#3a1d10', '#5a3018')
  const woodBump = makeWoodBump()
  const apronMaterial = new THREE.MeshPhysicalMaterial({
    map: woodColor,
    bumpMap: woodBump,
    bumpScale: 0.02,
    roughness: 0.35,
    clearcoat: 0.7,
    clearcoatRoughness: 0.2,
    side: THREE.DoubleSide,
  })
  const apron = new THREE.Mesh(apronGeometry, apronMaterial)
  apron.castShadow = true
  apron.receiveShadow = true
  disposables.push(apronGeometry, apronMaterial, woodColor, woodBump)
  group.add(apron)

  const pedestalPoints = outlinePoints(
    TABLE_MIN_X + PEDESTAL_INSET,
    TABLE_MAX_X - PEDESTAL_INSET,
    TABLE_MIN_Z + PEDESTAL_INSET,
    TABLE_MAX_Z - PEDESTAL_INSET,
  )
  const pedestalShape = new THREE.Shape(pedestalPoints.map((p) => new THREE.Vector2(p.x, -p.z)))
  const pedestalHeight = Math.max(0.1, APRON_BOTTOM_Y - KICK_HEIGHT)
  const pedestalGeometry = new THREE.ExtrudeGeometry(pedestalShape, {
    depth: -pedestalHeight,
    bevelEnabled: false,
    curveSegments: 20,
  })
  pedestalGeometry.rotateX(-Math.PI / 2)
  pedestalGeometry.translate(0, APRON_BOTTOM_Y, 0)
  const cabinetMaterial = new THREE.MeshStandardMaterial({ color: 0x140b08, roughness: 0.6, side: THREE.DoubleSide })
  const pedestal = new THREE.Mesh(pedestalGeometry, cabinetMaterial)
  pedestal.castShadow = true
  pedestal.receiveShadow = true
  disposables.push(pedestalGeometry, cabinetMaterial)
  group.add(pedestal)

  const kickBump = makeBrushedMetalBump()
  const kickRoughness = makeBrushedMetalRoughness()
  const kickMaterial = new THREE.MeshStandardMaterial({
    color: 0x2b2f36,
    metalness: 0.8,
    roughness: 0.6,
    roughnessMap: kickRoughness,
    bumpMap: kickBump,
    bumpScale: 0.01,
    side: THREE.DoubleSide,
  })
  const kickGeometry = new THREE.ExtrudeGeometry(pedestalShape, { depth: -KICK_HEIGHT, bevelEnabled: false, curveSegments: 20 })
  kickGeometry.rotateX(-Math.PI / 2)
  kickGeometry.translate(0, KICK_HEIGHT, 0)
  const kick = new THREE.Mesh(kickGeometry, kickMaterial)
  kick.receiveShadow = true
  disposables.push(kickGeometry, kickMaterial, kickBump, kickRoughness)
  group.add(kick)

  return { group, dispose: () => disposeAll(disposables) }
}

// -------------------------------------------------------------------------------------------
// Chips
// -------------------------------------------------------------------------------------------

interface ChipMeshSet {
  mesh: THREE.InstancedMesh
  capacity: number
  faceTexture: THREE.CanvasTexture
  edgeTexture: THREE.CanvasTexture
  geometry: THREE.CylinderGeometry
  sideMaterial: THREE.MeshStandardMaterial
  capMaterial: THREE.MeshStandardMaterial
}

function buildChipGeometry(): THREE.CylinderGeometry {
  const geometry = new THREE.CylinderGeometry(CHIP_RADIUS, CHIP_RADIUS, CHIP_THICKNESS, 28, 1, false)
  return geometry
}

function buildChipMeshSet(value: ChipValue, parent: THREE.Group, capacity: number): ChipMeshSet {
  const { face, edge } = makeChipTextures(value)
  const geometry = buildChipGeometry()
  const sideMaterial = new THREE.MeshStandardMaterial({ map: edge, roughness: 0.55, metalness: 0 })
  const capMaterial = new THREE.MeshStandardMaterial({ map: face, roughness: 0.4, metalness: 0 })
  const mesh = new THREE.InstancedMesh(geometry, [sideMaterial, capMaterial, capMaterial], capacity)
  mesh.count = 0
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.frustumCulled = false
  parent.add(mesh)
  return { mesh, capacity, faceTexture: face, edgeTexture: edge, geometry, sideMaterial, capMaterial }
}

interface ChipInstance {
  denom: ChipValue
  /** Offset from the stack's anchor, world inches. */
  x: number
  y: number
  z: number
  rot: number
}

/** `chipBreakdown(amount)` laid out largest-first from the anchor, columns of `CHIPS_PER_COLUMN`. */
function layoutChips(betId: string, amount: number): ChipInstance[] {
  const chips = chipBreakdown(amount)
  const out: ChipInstance[] = []
  chips.forEach((denom, index) => {
    const column = Math.floor(index / CHIPS_PER_COLUMN)
    const heightIndex = index % CHIPS_PER_COLUMN
    const { dx, dz, rot } = jitterFor(betId, index)
    out.push({
      denom,
      x: dx + column * COLUMN_OFFSET,
      y: heightIndex * CHIP_THICKNESS + CHIP_THICKNESS / 2,
      z: dz,
      rot,
    })
  })
  return out
}

interface LiveStack {
  amount: number
  anchor: { x: number; y: number; z: number }
  chips: ChipInstance[]
}

interface FadingStack {
  anchor: { x: number; y: number; z: number }
  chips: ChipInstance[]
}

interface WinningsStack {
  anchor: { x: number; y: number; z: number }
  chips: ChipInstance[]
}

// -------------------------------------------------------------------------------------------
// Hover / result highlight planes
// -------------------------------------------------------------------------------------------

function rectToWorld(rect: Rect): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const a = layoutToWorld(rect.u0, rect.v0)
  const b = layoutToWorld(rect.u1, rect.v1)
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) }
}

function buildHighlightPlane(rect: Rect, y: number, color: THREE.ColorRepresentation): THREE.Mesh {
  const { minX, maxX, minZ, maxZ } = rectToWorld(rect)
  const geometry = new THREE.PlaneGeometry(Math.max(0.01, maxX - minX), Math.max(0.01, maxZ - minZ))
  geometry.rotateX(-Math.PI / 2)
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set((minX + maxX) / 2, y, (minZ + maxZ) / 2)
  return mesh
}

function disposeHighlightMeshes(meshes: readonly THREE.Mesh[]): void {
  for (const mesh of meshes) {
    mesh.geometry.dispose()
    const material = mesh.material as THREE.Material
    material.dispose()
  }
}

// -------------------------------------------------------------------------------------------
// Dolly
// -------------------------------------------------------------------------------------------

function buildDolly(): { group: THREE.Group; cylinder: THREE.Mesh } & Disposable {
  const group = new THREE.Group()
  const bodyGeometry = new THREE.CylinderGeometry(DOLLY_RADIUS, DOLLY_RADIUS, DOLLY_HEIGHT, 24)
  // Polished ivory rather than clear glass: transmission rendered the dolly near black in the
  // dim room and costs an extra scene pass.
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xf4efe2,
    roughness: 0.25,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  })
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
  body.position.y = DOLLY_HEIGHT / 2
  body.castShadow = true

  const capGeometry = new THREE.CylinderGeometry(DOLLY_RADIUS * 1.05, DOLLY_RADIUS * 1.05, 0.18, 24)
  const capMaterial = new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 1, roughness: 0.25 })
  const cap = new THREE.Mesh(capGeometry, capMaterial)
  cap.position.y = DOLLY_HEIGHT + 0.09
  cap.castShadow = true

  group.add(body, cap)
  return {
    group,
    cylinder: body,
    dispose() {
      bodyGeometry.dispose()
      bodyMaterial.dispose()
      capGeometry.dispose()
      capMaterial.dispose()
    },
  }
}

// -------------------------------------------------------------------------------------------
// createTableView
// -------------------------------------------------------------------------------------------

export function createTableView(): TableView {
  const group = new THREE.Group()

  const felt = buildFelt()
  const rail = buildRail()
  const base = buildApronAndBase()
  group.add(felt.mesh, rail.group, base.group)

  const chipParent = new THREE.Group()
  group.add(chipParent)
  const chipSets = new Map<ChipValue, ChipMeshSet>()
  for (const value of CHIP_VALUES) chipSets.set(value, buildChipMeshSet(value, chipParent, CHIP_INSTANCE_INITIAL_CAPACITY))

  const hoverGroup = new THREE.Group()
  group.add(hoverGroup)
  let hoverMeshes: THREE.Mesh[] = []

  const resultHighlightGroup = new THREE.Group()
  group.add(resultHighlightGroup)
  let resultHighlightMeshes: THREE.Mesh[] = []

  const dolly = buildDolly()
  dolly.group.visible = false
  group.add(dolly.group)

  const liveStacks = new Map<string, LiveStack>()
  /** Winning bets' original stake, kept in place through the result even after `setBets({})`. */
  let resultStakeStacks: LiveStack[] = []
  let fadingStacks: FadingStack[] = []
  let winningsStacks: WinningsStack[] = []
  let dollyStartTime = 0
  let dollyTargetY = TABLE_HEIGHT
  let resultActive = false

  function growCapacity(value: ChipValue, needed: number): ChipMeshSet {
    const set = chipSets.get(value)!
    if (needed <= set.capacity) return set
    let capacity = set.capacity
    while (capacity < needed) capacity *= 2
    chipParent.remove(set.mesh)
    set.mesh.dispose()
    const rebuilt = new THREE.InstancedMesh(set.geometry, [set.sideMaterial, set.capMaterial, set.capMaterial], capacity)
    rebuilt.castShadow = true
    rebuilt.receiveShadow = true
    rebuilt.frustumCulled = false
    rebuilt.count = 0
    chipParent.add(rebuilt)
    const next: ChipMeshSet = { ...set, mesh: rebuilt, capacity }
    chipSets.set(value, next)
    return next
  }

  function anchorOf(betId: string): { x: number; y: number; z: number } {
    const { u, v } = betAnchor(betId)
    const p = layoutToWorld(u, v)
    return { x: p.x, y: TABLE_HEIGHT, z: p.z }
  }

  function setBets(bets: BetMap): void {
    for (const betId of Object.keys(bets)) {
      const amount = bets[betId]!
      const existing = liveStacks.get(betId)
      if (existing && existing.amount === amount) continue
      liveStacks.set(betId, { amount, anchor: anchorOf(betId), chips: layoutChips(betId, amount) })
    }
    for (const betId of Array.from(liveStacks.keys())) {
      if (!(betId in bets)) liveStacks.delete(betId)
    }
  }

  function setHover(betId: string | null): void {
    disposeHighlightMeshes(hoverMeshes)
    hoverGroup.clear()
    hoverMeshes = []
    if (betId === null) return
    for (const rect of betHighlightRects(betId)) {
      const mesh = buildHighlightPlane(rect, TABLE_HEIGHT + HOVER_LIFT, 0xf3d27a)
      hoverMeshes.push(mesh)
      hoverGroup.add(mesh)
    }
  }

  /**
   * `outcome.betId`'s stack, from the bets still on the table if `setBets({})` has not run yet
   * (cheap: reuses its cached chip layout), else rebuilt from the outcome itself - so a result
   * renders correctly whichever order the engine calls `showResult`/`setBets({})` in.
   */
  function stackFor(betId: string, amount: number): { anchor: { x: number; y: number; z: number }; chips: ChipInstance[] } {
    const existing = liveStacks.get(betId)
    if (existing) return existing
    return { anchor: anchorOf(betId), chips: layoutChips(betId, amount) }
  }

  function showResult(result: SpinResult | null): void {
    disposeHighlightMeshes(resultHighlightMeshes)
    resultHighlightGroup.clear()
    resultHighlightMeshes = []
    resultStakeStacks = []
    fadingStacks = []
    winningsStacks = []
    resultActive = false
    dolly.group.visible = false

    if (result === null) return

    resultActive = true
    dollyStartTime = 0
    const winningRect = numberCellRect(result.number)
    const dollyCenter = layoutToWorld((winningRect.u0 + winningRect.u1) / 2, (winningRect.v0 + winningRect.v1) / 2)
    dolly.group.position.set(dollyCenter.x, TABLE_HEIGHT, dollyCenter.z)
    dollyTargetY = TABLE_HEIGHT
    dolly.group.visible = true

    const litRects: Rect[] = []
    for (const outcome of result.outcomes) {
      const { anchor, chips } = stackFor(outcome.betId, outcome.amount)
      if (outcome.returned > 0) {
        for (const rect of betHighlightRects(outcome.betId)) litRects.push(rect)
        resultStakeStacks.push({ amount: outcome.amount, anchor, chips })
        const winAmount = outcome.returned - outcome.amount
        if (winAmount > 0) {
          const winAnchor = { x: anchor.x, y: anchor.y, z: anchor.z + WINNINGS_OFFSET_V }
          winningsStacks.push({ anchor: winAnchor, chips: layoutChips(`${outcome.betId}:win`, winAmount) })
        }
      } else {
        fadingStacks.push({ anchor, chips })
      }
    }

    for (const rect of litRects) {
      const mesh = buildHighlightPlane(rect, TABLE_HEIGHT + RESULT_LIFT, 0xd4af37)
      resultHighlightMeshes.push(mesh)
      resultHighlightGroup.add(mesh)
    }
  }

  const tmpMatrix = new THREE.Matrix4()
  const tmpQuat = new THREE.Quaternion()
  const tmpScale = new THREE.Vector3(1, 1, 1)
  const tmpPos = new THREE.Vector3()
  const tmpEuler = new THREE.Euler()

  function writeInstance(set: ChipMeshSet, index: number, x: number, y: number, z: number, rot: number, scale: number): void {
    tmpEuler.set(0, rot, 0)
    tmpQuat.setFromEuler(tmpEuler)
    tmpPos.set(x, y, z)
    tmpScale.set(scale, scale, scale)
    tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
    set.mesh.setMatrixAt(index, tmpMatrix)
  }

  function rebuildChipInstances(elapsed: number): void {
    const counts = new Map<ChipValue, number>()
    for (const value of CHIP_VALUES) counts.set(value, 0)

    const place = (
      anchor: { x: number; y: number; z: number },
      chips: readonly ChipInstance[],
      offsetX: number,
      offsetZ: number,
      scale: number,
    ): void => {
      for (const chip of chips) {
        const index = counts.get(chip.denom)!
        const set = growCapacity(chip.denom, index + 1)
        writeInstance(set, index, anchor.x + chip.x + offsetX, anchor.y + chip.y, anchor.z + chip.z + offsetZ, chip.rot, scale)
        counts.set(chip.denom, index + 1)
      }
    }

    for (const stack of liveStacks.values()) place(stack.anchor, stack.chips, 0, 0, 1)
    for (const stack of resultStakeStacks) place(stack.anchor, stack.chips, 0, 0, 1)
    for (const stack of winningsStacks) place(stack.anchor, stack.chips, 0, 0, 1)
    for (const stack of fadingStacks) {
      const t = Math.min(1, elapsed / FADE_SECONDS)
      const eased = t * t
      const slideX = (WHEEL_CENTER_X - stack.anchor.x) * eased * 0.4
      const slideZ = (WHEEL_CENTER_Z - stack.anchor.z) * eased * 0.4
      const scale = Math.max(0, 1 - eased)
      if (scale <= 0.001) continue
      place(stack.anchor, stack.chips, slideX, slideZ, scale)
    }

    for (const [value, set] of chipSets) {
      const count = counts.get(value)!
      set.mesh.count = count
      if (count > 0) set.mesh.instanceMatrix.needsUpdate = true
    }
  }

  function update(dt: number, time: number): void {
    if (resultActive) dollyStartTime += dt
    const dollyT = Math.min(1, dollyStartTime / DOLLY_DROP_SECONDS)
    const dollyEase = 1 - Math.pow(1 - dollyT, 3)
    if (dolly.group.visible) {
      dolly.group.position.y = dollyTargetY + (1 - dollyEase) * 6
    }

    if (resultHighlightMeshes.length > 0) {
      const shimmer = 0.35 + 0.2 * Math.sin(time * 3)
      for (const mesh of resultHighlightMeshes) (mesh.material as THREE.MeshBasicMaterial).opacity = shimmer
    }
    if (hoverMeshes.length > 0) {
      const shimmer = 0.32 + 0.1 * Math.sin(time * 5)
      for (const mesh of hoverMeshes) (mesh.material as THREE.MeshBasicMaterial).opacity = shimmer
    }

    const elapsed = resultActive ? dollyStartTime : 0
    rebuildChipInstances(elapsed)
  }

  function dispose(): void {
    felt.dispose()
    rail.dispose()
    base.dispose()
    for (const set of chipSets.values()) {
      set.mesh.dispose()
      set.geometry.dispose()
      set.sideMaterial.dispose()
      set.capMaterial.dispose()
      set.faceTexture.dispose()
      set.edgeTexture.dispose()
    }
    disposeHighlightMeshes(hoverMeshes)
    disposeHighlightMeshes(resultHighlightMeshes)
    dolly.dispose()
  }

  return { group, setBets, setHover, showResult, update, dispose }
}
