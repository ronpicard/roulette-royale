/**
 * The plush casino floor around the roulette table: burgundy carpet, damask-and-mahogany walls
 * under a coffered, chandelier-lit ceiling, rows of slot machines, a couple of background gaming
 * tables, a backlit bar, marquee signage and a velvet rope. Everything here is code-built from
 * three.js primitives and canvas textures - no models, no image files.
 *
 * The engine owns every `THREE.Light`; nothing in this file is a light source, only materials lit
 * by the engine's lights/environment map and emissive surfaces that read as "glowing" under the
 * engine's own lighting and bloom pass.
 *
 * World frame: the floor is Y = 0, inches. The table occupies roughly `x` in [-60, 38], `z` in
 * [-19, 15] (see `tableGeometry.ts`); `ROOM_CLEAR_*` there must stay free of everything here except
 * the player-side stools.
 */

import * as THREE from 'three'
import { TABLE_HEIGHT, TABLE_MAX_X, TABLE_MAX_Z, TABLE_MIN_X, TABLE_MIN_Z } from './tableGeometry.ts'
import {
  makeBrushedMetalBump,
  makeBrushedMetalRoughness,
  makeWoodBump,
  makeWoodGrain,
} from './materialTextures.ts'

/** What the engine gets back: the room's group to add to the scene, an animator, and a disposer. */
export interface CasinoRoom {
  /** World frame in inches: floor at Y = 0. */
  group: THREE.Group
  /** Animates reel windows, chasing marquee bulbs, cove shimmer and chandelier flicker. */
  update(time: number): void
  dispose(): void
}

interface Disposable {
  dispose(): void
}

// -------------------------------------------------------------------------------------------
// Palette
// -------------------------------------------------------------------------------------------

const GOLD = '#d4af37'
const GOLD_BRIGHT = '#f3d27a'
const BRASS = '#c9a54a'
const BURGUNDY = '#4a0e18'
const BURGUNDY_DARK = '#2e070f'
const CARPET_BASE = '#330c15'
const TEAL = '#1f6b63'
const CREAM = '#e8dcc0'
const MAHOGANY_TINT = '#241209'
const MAHOGANY_GRAIN = '#5a3018'
const FELT_GREEN = '#0b3d22'
const COVE_WARM = '#ffcf8a'
const BULB_WARM = '#ffe3ab'

const TOPPER_KINDS: ReadonlyArray<{ label: string; color: string }> = [
  { label: 'JACKPOT', color: '#f3d27a' },
  { label: '7 7 7', color: '#e23c4f' },
  { label: 'ROYALE', color: '#b98cf2' },
  { label: 'DIAMOND', color: '#6fd6e8' },
]

// -------------------------------------------------------------------------------------------
// Room shell sizes (inches) - the far end stays within about 250 in of the table in every
// direction (fog hides anything further); `ROOM_CLEAR_*` from `tableGeometry.ts` is kept free of
// everything below except the player-side stools.
// -------------------------------------------------------------------------------------------

const ROOM_MIN_X = -230
const ROOM_MAX_X = 230
const ROOM_MIN_Z = -220
const ROOM_MAX_Z = 220
const ROOM_WIDTH = ROOM_MAX_X - ROOM_MIN_X
const ROOM_DEPTH = ROOM_MAX_Z - ROOM_MIN_Z
const TABLE_CENTER_X = (TABLE_MIN_X + TABLE_MAX_X) / 2
const TABLE_CENTER_Z = (TABLE_MIN_Z + TABLE_MAX_Z) / 2

const WALL_HEIGHT = 128
const CEILING_Y = WALL_HEIGHT
const WAINSCOT_HEIGHT = 34
const CROWN_Y = WALL_HEIGHT - 3
const COVE_Y = WALL_HEIGHT - 8

const CARPET_TEXTURE_SIZE = 2048
const CARPET_REPEAT = 18
const WALL_TEXTURE_SIZE = 1024
const CEILING_TEXTURE_SIZE = 1024
const CEILING_REPEAT = 5

// -------------------------------------------------------------------------------------------
// Small deterministic helpers (local copies: neither `materialTextures.ts` nor a shared texture
// module exports these canvas/PRNG conventions - `arcadeRoom.ts` in neon-pinball keeps the same
// local copies for the same reason).
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

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable for casino room texture')
  return { canvas, ctx }
}

function finishColorTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

/** Fills glowing text: a soft coloured halo under a bright core. */
function glowText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  glow: number,
): void {
  ctx.save()
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = color
  ctx.shadowBlur = glow
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
  ctx.fillText(text, x, y)
  ctx.shadowBlur = glow * 0.35
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.fillText(text, x, y)
  ctx.restore()
}

function glowPath(
  ctx: CanvasRenderingContext2D,
  points: ReadonlyArray<readonly [number, number]>,
  color: string,
  width: number,
  glow: number,
  closed = false,
): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const trace = (): void => {
    ctx.beginPath()
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
    if (closed) ctx.closePath()
  }
  ctx.shadowColor = color
  ctx.shadowBlur = glow
  ctx.strokeStyle = color
  ctx.lineWidth = width
  trace()
  ctx.stroke()
  ctx.restore()
}

// -------------------------------------------------------------------------------------------
// Carpet: bold repeating burgundy medallion pattern with gold/teal/cream swirls
// -------------------------------------------------------------------------------------------

const CARPET_SEED = 0xc4517

function drawMedallion(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rand: () => number): void {
  ctx.save()
  ctx.translate(cx, cy)
  // Outer ring of gold petals.
  const petals = 8
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2
    ctx.save()
    ctx.rotate(a)
    glowPath(
      ctx,
      [
        [0, -r * 0.15],
        [r * 0.7, 0],
        [0, r * 0.15],
      ],
      GOLD,
      r * 0.05,
      0,
      true,
    )
    ctx.restore()
  }
  // Teal ring.
  ctx.strokeStyle = TEAL
  ctx.lineWidth = Math.max(1, r * 0.05)
  ctx.globalAlpha = 0.8
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2)
  ctx.stroke()
  // Cream centre dot with a tiny gold core.
  ctx.globalAlpha = 0.9
  ctx.fillStyle = CREAM
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = GOLD
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.05, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  void rand
}

/** A tiling casino-carpet tile: burgundy ground with a grid of gold/teal medallions and swirls. */
function makeCasinoCarpetTexture(): THREE.CanvasTexture {
  const size = CARPET_TEXTURE_SIZE
  const { canvas, ctx } = makeCanvas(size, size)
  const rand = mulberry32(CARPET_SEED)

  const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.7)
  gradient.addColorStop(0, CARPET_BASE)
  gradient.addColorStop(1, BURGUNDY_DARK)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  // Fine fibre speckle so the carpet is not a flat colour under close lighting.
  ctx.save()
  ctx.globalAlpha = 0.06
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#000000' : '#5a1a26'
    ctx.fillRect(rand() * size, rand() * size, 1.4, 1.4)
  }
  ctx.restore()

  // A 3x3 grid of medallions connected by thin gold swirl lines, tiling seamlessly at the edges by
  // wrapping the grid exactly across the canvas.
  const grid = 3
  const cell = size / grid
  for (let gy = -1; gy <= grid; gy++) {
    for (let gx = -1; gx <= grid; gx++) {
      const cx = (gx + 0.5) * cell
      const cy = (gy + 0.5) * cell
      drawMedallion(ctx, cx, cy, cell * 0.3, rand)
    }
  }
  ctx.save()
  ctx.strokeStyle = GOLD
  ctx.globalAlpha = 0.35
  ctx.lineWidth = cell * 0.02
  for (let gy = 0; gy <= grid; gy++) {
    ctx.beginPath()
    ctx.moveTo(0, gy * cell)
    ctx.lineTo(size, gy * cell)
    ctx.stroke()
  }
  for (let gx = 0; gx <= grid; gx++) {
    ctx.beginPath()
    ctx.moveTo(gx * cell, 0)
    ctx.lineTo(gx * cell, size)
    ctx.stroke()
  }
  ctx.restore()

  const texture = finishColorTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(CARPET_REPEAT, CARPET_REPEAT)
  texture.anisotropy = 8
  return texture
}

// -------------------------------------------------------------------------------------------
// Walls: damask wallpaper band over a mahogany wainscot, gold crown moulding and a warm cove strip
// -------------------------------------------------------------------------------------------

const DAMASK_SEED = 0x6a55c1

/** A tiling deep-red damask wallpaper pattern: interlocking gold fleur/ogee swirls. */
function makeDamaskTexture(): THREE.CanvasTexture {
  const size = WALL_TEXTURE_SIZE
  const { canvas, ctx } = makeCanvas(size, size)
  const rand = mulberry32(DAMASK_SEED)
  ctx.fillStyle = BURGUNDY
  ctx.fillRect(0, 0, size, size)

  const cell = size / 4
  ctx.save()
  ctx.globalAlpha = 0.5
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const cx = (gx + 0.5) * cell
      const cy = (gy + 0.5) * cell
      const r = cell * 0.38
      const points: Array<[number, number]> = []
      const lobes = 6
      for (let i = 0; i <= lobes * 8; i++) {
        const a = (i / (lobes * 8)) * Math.PI * 2
        const wobble = 1 + 0.35 * Math.sin(a * lobes)
        points.push([cx + Math.cos(a) * r * wobble, cy + Math.sin(a) * r * wobble])
      }
      glowPath(ctx, points, BURGUNDY_DARK, cell * 0.02, 0, true)
      ctx.strokeStyle = 'rgba(212, 175, 55, 0.4)'
      ctx.lineWidth = cell * 0.015
      ctx.beginPath()
      points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
      ctx.closePath()
      ctx.stroke()
    }
  }
  ctx.restore()
  ctx.save()
  ctx.globalAlpha = 0.04
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#000000' : '#7a2030'
    ctx.fillRect(rand() * size, rand() * size, 1, 1)
  }
  ctx.restore()

  const texture = finishColorTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

/** Coffered ceiling: a dark grid of recessed panels with a warm cove glow along the grid seams. */
function makeCofferedCeilingTexture(): THREE.CanvasTexture {
  const size = CEILING_TEXTURE_SIZE
  const { canvas, ctx } = makeCanvas(size, size)
  ctx.fillStyle = '#0e0a08'
  ctx.fillRect(0, 0, size, size)

  const tiles = 3
  const cell = size / tiles
  const inset = cell * 0.12
  for (let gy = 0; gy < tiles; gy++) {
    for (let gx = 0; gx < tiles; gx++) {
      const x = gx * cell + inset
      const y = gy * cell + inset
      const w = cell - inset * 2
      ctx.fillStyle = '#1a1210'
      ctx.fillRect(x, y, w, w)
      ctx.strokeStyle = GOLD
      ctx.globalAlpha = 0.4
      ctx.lineWidth = cell * 0.01
      ctx.strokeRect(x, y, w, w)
      ctx.globalAlpha = 1
    }
  }
  // Warm cove glow tracing the coffer seams (used as the emissive map too).
  ctx.save()
  ctx.strokeStyle = COVE_WARM
  ctx.shadowColor = COVE_WARM
  ctx.shadowBlur = cell * 0.05
  ctx.lineWidth = cell * 0.015
  for (let i = 0; i <= tiles; i++) {
    const p = i * cell
    ctx.beginPath()
    ctx.moveTo(p, 0)
    ctx.lineTo(p, size)
    ctx.moveTo(0, p)
    ctx.lineTo(size, p)
    ctx.stroke()
  }
  ctx.restore()

  const texture = finishColorTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(CEILING_REPEAT, CEILING_REPEAT)
  return texture
}

// -------------------------------------------------------------------------------------------
// Slot machine cabinet geometry (profile extrude, modelled on neon-pinball's arcade cabinet)
// -------------------------------------------------------------------------------------------

const SLOT_WIDTH = 24
const SLOT_HEIGHT = 74
const SLOT_DEPTH = 24
const SLOT_SPACING = 35

const KICK_FRONT = SLOT_DEPTH * 0.15
const BODY_FRONT = SLOT_DEPTH * 0.42
const SHELF_INNER = SLOT_DEPTH * 0.5
const SHELF_FRONT = SLOT_DEPTH * 0.75
const SHELF_TOP_HEIGHT = SLOT_HEIGHT * 0.48
const SHELF_UNDER_HEIGHT = SLOT_HEIGHT * 0.44
const BEZEL_BOTTOM_FRONT = SLOT_DEPTH * 0.35
const BEZEL_BOTTOM_HEIGHT = SLOT_HEIGHT * 0.52
const BEZEL_TOP_FRONT = SLOT_DEPTH * 0.58
const BEZEL_TOP_HEIGHT = SLOT_HEIGHT * 0.82
const TOPPER_FRONT = SLOT_DEPTH * 0.85
const TOPPER_TOP_HEIGHT = SLOT_HEIGHT
const TOPPER_UNDER_HEIGHT = SLOT_HEIGHT * 0.9
const BODY_TOP_HEIGHT = SLOT_HEIGHT * 0.86

const SCREEN_MID_FRONT = (BEZEL_BOTTOM_FRONT + BEZEL_TOP_FRONT) / 2
const SCREEN_MID_HEIGHT = (BEZEL_BOTTOM_HEIGHT + BEZEL_TOP_HEIGHT) / 2
const SCREEN_SPAN = Math.hypot(BEZEL_TOP_FRONT - BEZEL_BOTTOM_FRONT, BEZEL_TOP_HEIGHT - BEZEL_BOTTOM_HEIGHT)
const SCREEN_TILT = Math.atan2(BEZEL_TOP_FRONT - BEZEL_BOTTOM_FRONT, BEZEL_TOP_HEIGHT - BEZEL_BOTTOM_HEIGHT)
const SCREEN_WIDTH = SLOT_WIDTH * 0.66

const TOPPER_MID_HEIGHT = (TOPPER_TOP_HEIGHT + TOPPER_UNDER_HEIGHT) / 2
const TOPPER_SPAN = TOPPER_TOP_HEIGHT - TOPPER_UNDER_HEIGHT

const PANEL_MID_FRONT = (BEZEL_BOTTOM_FRONT + SHELF_FRONT) / 2
const PANEL_MID_HEIGHT = (BEZEL_BOTTOM_HEIGHT + SHELF_TOP_HEIGHT) / 2
const PANEL_SPAN = Math.hypot(SHELF_FRONT - BEZEL_BOTTOM_FRONT, SHELF_TOP_HEIGHT - BEZEL_BOTTOM_HEIGHT)
const PANEL_TILT = Math.atan2(SHELF_FRONT - BEZEL_BOTTOM_FRONT, SHELF_TOP_HEIGHT - BEZEL_BOTTOM_HEIGHT)
const PANEL_WIDTH = SLOT_WIDTH * 0.7

interface ProfilePoint {
  front: number
  height: number
}

const SLOT_PROFILE: readonly ProfilePoint[] = [
  { front: 0, height: 0 },
  { front: 0, height: BODY_TOP_HEIGHT },
  { front: 0, height: TOPPER_TOP_HEIGHT },
  { front: TOPPER_FRONT, height: TOPPER_TOP_HEIGHT },
  { front: TOPPER_FRONT, height: TOPPER_UNDER_HEIGHT },
  { front: BEZEL_TOP_FRONT, height: BEZEL_TOP_HEIGHT },
  { front: BEZEL_BOTTOM_FRONT, height: BEZEL_BOTTOM_HEIGHT },
  { front: SHELF_FRONT, height: SHELF_TOP_HEIGHT },
  { front: SHELF_FRONT, height: SHELF_UNDER_HEIGHT },
  { front: SHELF_INNER, height: SHELF_UNDER_HEIGHT * 0.9 },
  { front: BODY_FRONT, height: SLOT_HEIGHT * 0.06 },
  { front: KICK_FRONT, height: 0 },
]

/**
 * Extrudes `SLOT_PROFILE` sideways into a full cabinet body. Local frame: X is width (centred), Y
 * is height off the floor, Z is depth from the back edge (the origin) toward the front, where the
 * screen and control panel are. Unrotated, the front faces world +Z (mirrors
 * `arcadeRoom.ts`'s `makeCabinetBodyGeometry`).
 */
function makeSlotCabinetGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  SLOT_PROFILE.forEach((p, i) => {
    const x = -p.front
    if (i === 0) shape.moveTo(x, p.height)
    else shape.lineTo(x, p.height)
  })
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: SLOT_WIDTH, bevelEnabled: false, steps: 1 })
  geometry.rotateY(Math.PI / 2)
  geometry.translate(-SLOT_WIDTH / 2, 0, 0)
  geometry.computeVertexNormals()
  return geometry
}

// -------------------------------------------------------------------------------------------
// Slot machine reel window and button panel textures
// -------------------------------------------------------------------------------------------

type ReelSymbolKind = 'seven' | 'bar' | 'bell' | 'star' | 'diamond' | 'cherry'
const REEL_SYMBOLS: readonly ReelSymbolKind[] = ['seven', 'bar', 'bell', 'star', 'diamond', 'cherry']
const REEL_CELL = 84
const REEL_COLUMNS = 3
const REEL_ROWS = REEL_SYMBOLS.length * 2 // repeated once so the vertical wrap reads seamlessly

function drawReelSymbol(ctx: CanvasRenderingContext2D, cx: number, cy: number, kind: ReelSymbolKind): void {
  const s = REEL_CELL * 0.32
  ctx.save()
  switch (kind) {
    case 'seven':
      glowText(ctx, '7', cx, cy, `900 ${s * 1.7}px Georgia, serif`, '#e23c4f', s * 0.5)
      break
    case 'bar':
      ctx.fillStyle = '#111111'
      ctx.fillRect(cx - s, cy - s * 0.45, s * 2, s * 0.9)
      glowText(ctx, 'BAR', cx, cy, `900 ${s * 0.7}px Georgia, serif`, GOLD_BRIGHT, s * 0.3)
      break
    case 'bell':
      ctx.fillStyle = GOLD_BRIGHT
      ctx.shadowColor = GOLD_BRIGHT
      ctx.shadowBlur = s * 0.4
      ctx.beginPath()
      ctx.arc(cx, cy - s * 0.1, s * 0.75, Math.PI, 0)
      ctx.lineTo(cx + s * 0.9, cy + s * 0.55)
      ctx.lineTo(cx - s * 0.9, cy + s * 0.55)
      ctx.closePath()
      ctx.fill()
      ctx.fillRect(cx - s * 0.15, cy + s * 0.55, s * 0.3, s * 0.2)
      break
    case 'star': {
      const points: Array<[number, number]> = []
      const spikes = 5
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? s : s * 0.45
        const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2
        points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
      }
      glowPath(ctx, points, '#6fd6e8', s * 0.12, s * 0.35, true)
      ctx.fillStyle = '#6fd6e8'
      ctx.fill()
      break
    }
    case 'diamond':
      ctx.fillStyle = '#b98cf2'
      ctx.shadowColor = '#b98cf2'
      ctx.shadowBlur = s * 0.4
      ctx.beginPath()
      ctx.moveTo(cx, cy - s)
      ctx.lineTo(cx + s * 0.7, cy)
      ctx.lineTo(cx, cy + s)
      ctx.lineTo(cx - s * 0.7, cy)
      ctx.closePath()
      ctx.fill()
      break
    case 'cherry':
      ctx.fillStyle = '#e23c4f'
      ctx.shadowColor = '#e23c4f'
      ctx.shadowBlur = s * 0.3
      ctx.beginPath()
      ctx.arc(cx - s * 0.35, cy + s * 0.4, s * 0.4, 0, Math.PI * 2)
      ctx.arc(cx + s * 0.35, cy + s * 0.5, s * 0.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#3c8a4a'
      ctx.lineWidth = s * 0.12
      ctx.beginPath()
      ctx.moveTo(cx - s * 0.35, cy + s * 0.1)
      ctx.lineTo(cx, cy - s)
      ctx.moveTo(cx + s * 0.35, cy + s * 0.2)
      ctx.lineTo(cx, cy - s)
      ctx.stroke()
      break
  }
  ctx.restore()
}

/** A three-reel window strip: `REEL_COLUMNS` columns of symbols, tiling vertically for scrolling. */
function makeReelStripTexture(seed: number): THREE.CanvasTexture {
  const width = REEL_CELL * REEL_COLUMNS
  const height = REEL_CELL * REEL_ROWS
  const { canvas, ctx } = makeCanvas(width, height)
  const rand = mulberry32(seed)
  ctx.fillStyle = '#020202'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = 'rgba(212, 175, 55, 0.5)'
  ctx.lineWidth = 2
  for (let c = 1; c < REEL_COLUMNS; c++) {
    ctx.beginPath()
    ctx.moveTo(c * REEL_CELL, 0)
    ctx.lineTo(c * REEL_CELL, height)
    ctx.stroke()
  }
  for (let row = 0; row < REEL_ROWS; row++) {
    for (let col = 0; col < REEL_COLUMNS; col++) {
      const kind = REEL_SYMBOLS[Math.floor(rand() * REEL_SYMBOLS.length)] ?? 'seven'
      drawReelSymbol(ctx, col * REEL_CELL + REEL_CELL / 2, row * REEL_CELL + REEL_CELL / 2, kind)
    }
  }
  const texture = finishColorTexture(canvas)
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

/** A lit button panel: MAX BET / SPIN / CASHOUT buttons glowing on a dark plate. */
function makeButtonPanelTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(512, 220)
  ctx.fillStyle = '#0c0c0c'
  ctx.fillRect(0, 0, 512, 220)
  const buttons: ReadonlyArray<{ x: number; label: string; color: string }> = [
    { x: 90, label: 'MAX\nBET', color: '#c9a54a' },
    { x: 256, label: 'SPIN', color: '#e23c4f' },
    { x: 422, label: 'CASH\nOUT', color: '#3c8a4a' },
  ]
  for (const b of buttons) {
    ctx.save()
    ctx.fillStyle = b.color
    ctx.shadowColor = b.color
    ctx.shadowBlur = 26
    ctx.beginPath()
    ctx.arc(b.x, 110, 56, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.font = '700 30px Georgia, serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const lines = b.label.split('\n')
    lines.forEach((line, i) => ctx.fillText(line, b.x, 110 + (i - (lines.length - 1) / 2) * 32))
    ctx.restore()
  }
  return finishColorTexture(canvas)
}

/** A glowing cabinet topper sign: JACKPOT / 7 7 7 / ROYALE / DIAMOND. */
function makeTopperTexture(label: string, color: string): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(512, 200)
  ctx.fillStyle = '#0a0a0a'
  ctx.fillRect(0, 0, 512, 200)
  glowText(ctx, label, 256, 100, "900 68px 'Playfair Display', Georgia, serif", color, 30)
  return finishColorTexture(canvas)
}

// -------------------------------------------------------------------------------------------
// Gaming table felts (blackjack half-moon, craps)
// -------------------------------------------------------------------------------------------

function makeBlackjackFeltTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(1024, 640)
  ctx.fillStyle = FELT_GREEN
  ctx.fillRect(0, 0, 1024, 640)
  ctx.strokeStyle = CREAM
  ctx.globalAlpha = 0.8
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(512, 40, 480, 0.15 * Math.PI, 0.85 * Math.PI)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.fillStyle = CREAM
  ctx.font = '700 40px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.fillText('BLACKJACK PAYS 3 TO 2', 512, 300)
  ctx.font = '600 26px Georgia, serif'
  ctx.fillText('DEALER MUST STAND ON 17 AND DRAW TO 16', 512, 350)
  return finishColorTexture(canvas)
}

function makeCrapsFeltTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(1280, 640)
  ctx.fillStyle = FELT_GREEN
  ctx.fillRect(0, 0, 1280, 640)
  ctx.strokeStyle = '#c94b4b'
  ctx.lineWidth = 4
  ctx.globalAlpha = 0.85
  ctx.strokeRect(40, 40, 1200, 560)
  ctx.strokeRect(120, 100, 1040, 440)
  const numbers = [4, 5, 6, 8, 9, 10]
  ctx.font = '700 34px Georgia, serif'
  ctx.fillStyle = CREAM
  numbers.forEach((n, i) => {
    const x = 220 + i * 150
    ctx.strokeRect(x, 140, 120, 100)
    ctx.fillText(String(n), x + 60, 195)
  })
  ctx.font = '700 46px Georgia, serif'
  ctx.fillText('PASS LINE', 640, 480)
  ctx.font = '600 26px Georgia, serif'
  ctx.fillText('FIELD', 640, 560)
  return finishColorTexture(canvas)
}

// -------------------------------------------------------------------------------------------
// Bar backlight
// -------------------------------------------------------------------------------------------

function makeBottleShelfTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(1024, 384)
  const gradient = ctx.createLinearGradient(0, 0, 0, 384)
  gradient.addColorStop(0, '#3a2410')
  gradient.addColorStop(1, '#160d05')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 1024, 384)
  ctx.strokeStyle = 'rgba(212, 175, 55, 0.6)'
  ctx.lineWidth = 3
  for (let row = 0; row < 3; row++) {
    const y = 64 + row * 110
    ctx.beginPath()
    ctx.moveTo(20, y)
    ctx.lineTo(1004, y)
    ctx.stroke()
  }
  return finishColorTexture(canvas)
}

// -------------------------------------------------------------------------------------------
// Marquee sign textures
// -------------------------------------------------------------------------------------------

function makeMarqueeTexture(text: string): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(1024, 256)
  glowText(ctx, text, 512, 128, "900 110px 'Playfair Display', Georgia, serif", GOLD_BRIGHT, 34)
  return finishColorTexture(canvas)
}

// -------------------------------------------------------------------------------------------
// Room assembly
// -------------------------------------------------------------------------------------------

export function createCasinoRoom(): CasinoRoom {
  const disposables: Disposable[] = []
  const own = <T extends Disposable>(item: T): T => {
    disposables.push(item)
    return item
  }

  const group = new THREE.Group()
  const dummy = new THREE.Object3D()

  // --- Floor -------------------------------------------------------------------------------
  {
    const texture = own(makeCasinoCarpetTexture())
    const geometry = own(new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH))
    // Pile carpet has no specular sheen: fully rough, and it barely reflects the room.
    const material = own(new THREE.MeshStandardMaterial({
        map: texture,
        // Tints the pattern down so the floor stays behind the table instead of competing with it.
        color: 0x8c7c7c,
        roughness: 1,
        metalness: 0,
        envMapIntensity: 0.25,
      }))
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.receiveShadow = true
    group.add(mesh)
  }

  // --- Ceiling -------------------------------------------------------------------------------
  {
    const texture = own(makeCofferedCeilingTexture())
    const geometry = own(new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH))
    const material = own(
      new THREE.MeshStandardMaterial({
        map: texture,
        emissiveMap: texture,
        emissive: 0xffffff,
        emissiveIntensity: 0.35,
        roughness: 0.9,
      }),
    )
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = Math.PI / 2
    mesh.position.y = CEILING_Y
    mesh.receiveShadow = true
    group.add(mesh)
  }

  // --- Walls: damask wallpaper band + mahogany wainscot -----------------------------------------
  const damaskTexture = own(makeDamaskTexture())
  const wainscotColor = own(makeWoodGrain(MAHOGANY_TINT, MAHOGANY_GRAIN))
  const wainscotBump = own(makeWoodBump())
  const crownRoughness = own(makeBrushedMetalRoughness())
  const crownBump = own(makeBrushedMetalBump())

  const wallpaperMaterial = own(new THREE.MeshStandardMaterial({ map: damaskTexture, roughness: 0.75, metalness: 0.03 }))
  const wainscotMaterial = own(
    new THREE.MeshStandardMaterial({ map: wainscotColor, bumpMap: wainscotBump, bumpScale: 0.6, roughness: 0.4, metalness: 0.05 }),
  )
  const crownMaterial = own(
    new THREE.MeshStandardMaterial({
      color: GOLD,
      roughnessMap: crownRoughness,
      bumpMap: crownBump,
      bumpScale: 0.3,
      roughness: 0.35,
      metalness: 0.85,
    }),
  )
  const coveMaterial = own(
    new THREE.MeshStandardMaterial({ color: COVE_WARM, emissive: COVE_WARM, emissiveIntensity: 1.1, roughness: 0.5 }),
  )

  interface WallSpec {
    length: number
    position: THREE.Vector3
    rotationY: number
  }
  const wallSpecs: readonly WallSpec[] = [
    { length: ROOM_WIDTH, position: new THREE.Vector3(0, 0, ROOM_MIN_Z), rotationY: 0 },
    { length: ROOM_WIDTH, position: new THREE.Vector3(0, 0, ROOM_MAX_Z), rotationY: Math.PI },
    { length: ROOM_DEPTH, position: new THREE.Vector3(ROOM_MIN_X, 0, 0), rotationY: Math.PI / 2 },
    { length: ROOM_DEPTH, position: new THREE.Vector3(ROOM_MAX_X, 0, 0), rotationY: -Math.PI / 2 },
  ]
  const wallpaperHeight = WALL_HEIGHT - WAINSCOT_HEIGHT
  for (const wall of wallSpecs) {
    const wallGroup = new THREE.Group()
    wallGroup.position.copy(wall.position)
    wallGroup.rotation.y = wall.rotationY

    const wallpaperGeometry = own(new THREE.PlaneGeometry(wall.length, wallpaperHeight))
    const wallpaper = new THREE.Mesh(wallpaperGeometry, wallpaperMaterial)
    wallpaper.position.y = WAINSCOT_HEIGHT + wallpaperHeight / 2
    wallpaper.receiveShadow = true
    wallGroup.add(wallpaper)

    const wainscotGeometry = own(new THREE.PlaneGeometry(wall.length, WAINSCOT_HEIGHT))
    const wainscot = new THREE.Mesh(wainscotGeometry, wainscotMaterial)
    wainscot.position.y = WAINSCOT_HEIGHT / 2
    wainscot.receiveShadow = true
    wallGroup.add(wainscot)

    const crownGeometry = own(new THREE.BoxGeometry(wall.length, 3, 3))
    const crown = new THREE.Mesh(crownGeometry, crownMaterial)
    crown.position.y = CROWN_Y
    crown.position.z = 0.3
    wallGroup.add(crown)

    const coveGeometry = own(new THREE.BoxGeometry(wall.length, 1, 1.2))
    const cove = new THREE.Mesh(coveGeometry, coveMaterial)
    cove.position.y = COVE_Y
    cove.position.z = 0.5
    wallGroup.add(cove)

    group.add(wallGroup)
  }

  // --- Chandeliers -----------------------------------------------------------------------------
  const chandelierRodMaterial = own(new THREE.MeshStandardMaterial({ color: BRASS, roughness: 0.3, metalness: 1 }))
  const chandelierRingMaterial = own(new THREE.MeshStandardMaterial({ color: BRASS, roughness: 0.3, metalness: 1 }))
  const chandelierBulbMaterial = own(
    new THREE.MeshStandardMaterial({ color: BULB_WARM, emissive: BULB_WARM, emissiveIntensity: 1.6, roughness: 0.4 }),
  )
  const chandelierCrystalMaterial = own(
    new THREE.MeshPhysicalMaterial({
      color: '#fff6dc',
      roughness: 0.05,
      metalness: 0,
      transmission: 0.9,
      thickness: 1.5,
      ior: 1.5,
    }),
  )
  const chandelierRodGeometry = own(new THREE.CylinderGeometry(0.4, 0.4, 8, 8))
  const chandelierRingGeometry = own(new THREE.TorusGeometry(9, 0.5, 8, 24))
  const chandelierCrystalGeometry = own(new THREE.OctahedronGeometry(1.1, 0))
  const bulbsPerChandelier = 8
  const crystalsPerChandelier = 12
  const chandelierPositions: readonly THREE.Vector3[] = [
    // Behind the dealer rather than over the table, so it frames the seated view without
    // hanging between the overhead camera and the layout.
    new THREE.Vector3(TABLE_CENTER_X, 0, TABLE_CENTER_Z - 110),
    new THREE.Vector3(-140, 0, -150),
    new THREE.Vector3(140, 0, -150),
    new THREE.Vector3(0, 0, 160),
  ]
  const chandelierBulbGeometry = own(new THREE.SphereGeometry(0.7, 8, 6))
  const chandelierBulbs = own(
    new THREE.InstancedMesh(chandelierBulbGeometry, chandelierBulbMaterial, chandelierPositions.length * bulbsPerChandelier),
  )
  const chandelierCrystals = own(
    new THREE.InstancedMesh(chandelierCrystalGeometry, chandelierCrystalMaterial, chandelierPositions.length * crystalsPerChandelier),
  )
  let bulbInstance = 0
  let crystalInstance = 0
  for (const pos of chandelierPositions) {
    const chandelierY = CEILING_Y - 14
    const rod = new THREE.Mesh(chandelierRodGeometry, chandelierRodMaterial)
    rod.position.set(pos.x, chandelierY + 4, pos.z)
    group.add(rod)
    const ring = new THREE.Mesh(chandelierRingGeometry, chandelierRingMaterial)
    ring.rotation.x = Math.PI / 2
    ring.position.set(pos.x, chandelierY, pos.z)
    group.add(ring)
    for (let i = 0; i < bulbsPerChandelier; i++) {
      const a = (i / bulbsPerChandelier) * Math.PI * 2
      dummy.position.set(pos.x + Math.cos(a) * 9, chandelierY, pos.z + Math.sin(a) * 9)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      chandelierBulbs.setMatrixAt(bulbInstance, dummy.matrix)
      bulbInstance++
    }
    for (let i = 0; i < crystalsPerChandelier; i++) {
      const a = (i / crystalsPerChandelier) * Math.PI * 2
      const r = 5 + (i % 3) * 1.5
      dummy.position.set(pos.x + Math.cos(a) * r, chandelierY - 3 - (i % 3), pos.z + Math.sin(a) * r)
      dummy.rotation.set(0, a, 0)
      dummy.updateMatrix()
      chandelierCrystals.setMatrixAt(crystalInstance, dummy.matrix)
      crystalInstance++
    }
  }
  chandelierBulbs.instanceMatrix.needsUpdate = true
  chandelierCrystals.instanceMatrix.needsUpdate = true
  group.add(chandelierBulbs, chandelierCrystals)

  // --- Slot machines -----------------------------------------------------------------------------
  const slotBodyGeometry = own(makeSlotCabinetGeometry())
  const slotBodyMaterial = own(new THREE.MeshStandardMaterial({ color: '#12100d', roughness: 0.5, metalness: 0.3 }))
  const screenGeometry = own(new THREE.PlaneGeometry(SCREEN_WIDTH, SCREEN_SPAN))
  const topperGeometry = own(new THREE.PlaneGeometry(SLOT_WIDTH * 0.82, TOPPER_SPAN * 1.4))
  const panelGeometry = own(new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_SPAN))
  const reelBaseTexture = own(makeReelStripTexture(0x2001))
  const buttonTexture = own(makeButtonPanelTexture())
  const panelMaterial = own(
    new THREE.MeshStandardMaterial({ map: buttonTexture, emissiveMap: buttonTexture, emissive: 0xffffff, emissiveIntensity: 0.7, roughness: 0.6 }),
  )
  const topperTextures = TOPPER_KINDS.map((k) => own(makeTopperTexture(k.label, k.color)))
  const topperMaterials = topperTextures.map((texture) =>
    own(new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.5 })),
  )

  interface SlotPlacement {
    x: number
    z: number
    rotY: number
  }
  const slotPlacements: SlotPlacement[] = []
  const farRowZ = ROOM_MIN_Z + SLOT_DEPTH / 2 + 2
  for (let i = 0; i < 8; i++) slotPlacements.push({ x: (i - 3.5) * SLOT_SPACING, z: farRowZ, rotY: 0 })
  const eastRowX = ROOM_MAX_X - SLOT_DEPTH / 2 - 2
  for (let i = 0; i < 6; i++) slotPlacements.push({ x: eastRowX, z: (i - 2.5) * SLOT_SPACING, rotY: -Math.PI / 2 })

  const stoolSeatMaterial = own(new THREE.MeshStandardMaterial({ color: '#3a1218', roughness: 0.55, metalness: 0.1 }))
  const stoolLegMaterial = own(new THREE.MeshStandardMaterial({ color: '#c8c8cc', roughness: 0.3, metalness: 0.9 }))
  const stoolSeatGeometry = own(new THREE.CylinderGeometry(5, 4.2, 2, 14))
  const stoolLegGeometry = own(new THREE.CylinderGeometry(0.6, 0.6, 24, 8))
  const slotStoolSeats = own(new THREE.InstancedMesh(stoolSeatGeometry, stoolSeatMaterial, slotPlacements.length))
  const slotStoolLegs = own(new THREE.InstancedMesh(stoolLegGeometry, stoolLegMaterial, slotPlacements.length))
  const reelTextures: THREE.CanvasTexture[] = []

  slotPlacements.forEach((p, i) => {
    const body = new THREE.Mesh(slotBodyGeometry, slotBodyMaterial)
    body.position.set(p.x, 0, p.z)
    body.rotation.y = p.rotY
    body.receiveShadow = true
    body.castShadow = true
    group.add(body)

    const reelTexture = i === 0 ? reelBaseTexture : own(reelBaseTexture.clone() as THREE.CanvasTexture)
    reelTexture.wrapS = THREE.ClampToEdgeWrapping
    reelTexture.wrapT = THREE.RepeatWrapping
    reelTextures.push(reelTexture)
    const screenMaterial = own(
      new THREE.MeshStandardMaterial({ map: reelTexture, emissiveMap: reelTexture, emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.6 }),
    )
    const screen = new THREE.Mesh(screenGeometry, screenMaterial)
    screen.position.set(0, SCREEN_MID_HEIGHT, SCREEN_MID_FRONT)
    screen.rotation.x = SCREEN_TILT
    body.add(screen)

    const topperMaterial = topperMaterials[i % topperMaterials.length] ?? topperMaterials[0]
    const topper = new THREE.Mesh(topperGeometry, topperMaterial)
    topper.position.set(0, TOPPER_MID_HEIGHT, TOPPER_FRONT * 0.98)
    body.add(topper)

    const panel = new THREE.Mesh(panelGeometry, panelMaterial)
    panel.position.set(0, PANEL_MID_HEIGHT, PANEL_MID_FRONT)
    panel.rotation.x = PANEL_TILT
    body.add(panel)

    dummy.position.set(
      p.x + Math.sin(p.rotY) * (SHELF_FRONT + 12),
      13,
      p.z + Math.cos(p.rotY) * (SHELF_FRONT + 12),
    )
    dummy.rotation.set(0, p.rotY, 0)
    dummy.updateMatrix()
    slotStoolSeats.setMatrixAt(i, dummy.matrix)
    slotStoolLegs.setMatrixAt(i, dummy.matrix)
  })
  slotStoolSeats.instanceMatrix.needsUpdate = true
  slotStoolLegs.instanceMatrix.needsUpdate = true
  group.add(slotStoolSeats, slotStoolLegs)

  // --- Player-side bar stools (five, spread along the player's side of our table) ----------------
  const railStoolSeats = own(new THREE.InstancedMesh(stoolSeatGeometry, stoolSeatMaterial, 5))
  const railStoolLegs = own(new THREE.InstancedMesh(stoolLegGeometry, stoolLegMaterial, 5))
  const railStoolXs = [-30, -15, 0, 15, 30]
  railStoolXs.forEach((x, i) => {
    dummy.position.set(x, 13, TABLE_MAX_Z + 8)
    dummy.rotation.set(0, 0, 0)
    dummy.updateMatrix()
    railStoolSeats.setMatrixAt(i, dummy.matrix)
    railStoolLegs.setMatrixAt(i, dummy.matrix)
  })
  railStoolSeats.instanceMatrix.needsUpdate = true
  railStoolLegs.instanceMatrix.needsUpdate = true
  group.add(railStoolSeats, railStoolLegs)

  // --- Background gaming tables: blackjack half-moon and craps ---------------------------------
  const bgTableWoodColor = own(makeWoodGrain(MAHOGANY_TINT, MAHOGANY_GRAIN))
  const bgTableWoodBump = own(makeWoodBump())
  const railMaterial = own(
    new THREE.MeshStandardMaterial({ map: bgTableWoodColor, bumpMap: bgTableWoodBump, bumpScale: 0.5, roughness: 0.35 }),
  )
  const chipMaterial = own(new THREE.MeshStandardMaterial({ color: '#c9a54a', roughness: 0.4, metalness: 0.2 }))
  const chipGeometry = own(new THREE.CylinderGeometry(0.8, 0.8, 0.3, 16))

  function buildBackgroundTable(x: number, z: number, felt: THREE.CanvasTexture, width: number, depth: number): void {
    const feltMaterial = own(new THREE.MeshStandardMaterial({ map: felt, roughness: 0.95 }))
    const feltGeometry = own(new THREE.CylinderGeometry(width / 2, width / 2, 1, 32))
    feltGeometry.scale(1, 1, depth / width)
    const feltMesh = new THREE.Mesh(feltGeometry, feltMaterial)
    feltMesh.position.set(x, TABLE_HEIGHT, z)
    feltMesh.receiveShadow = true
    group.add(feltMesh)

    const railGeometry = own(new THREE.CylinderGeometry(width / 2 + 2, width / 2 + 2, 4, 32))
    railGeometry.scale(1, 1, (depth + 4) / (width + 4))
    const rail = new THREE.Mesh(railGeometry, railMaterial)
    rail.position.set(x, TABLE_HEIGHT - 3, z)
    rail.receiveShadow = true
    group.add(rail)

    const legGeometry = own(new THREE.CylinderGeometry(2, 2.4, TABLE_HEIGHT - 4, 8))
    const leg = new THREE.Mesh(legGeometry, railMaterial)
    leg.position.set(x, (TABLE_HEIGHT - 4) / 2, z)
    leg.castShadow = true
    group.add(leg)

    const stackCount = 4
    const stacks = own(new THREE.InstancedMesh(chipGeometry, chipMaterial, stackCount * 4))
    let n = 0
    for (let i = 0; i < stackCount; i++) {
      const sx = x + (i - (stackCount - 1) / 2) * (width * 0.18)
      for (let h = 0; h < 4; h++) {
        dummy.position.set(sx, TABLE_HEIGHT + 0.5 + h * 0.3, z)
        dummy.rotation.set(0, 0, 0)
        dummy.updateMatrix()
        stacks.setMatrixAt(n, dummy.matrix)
        n++
      }
    }
    stacks.instanceMatrix.needsUpdate = true
    group.add(stacks)
  }

  const blackjackFelt = own(makeBlackjackFeltTexture())
  const crapsFelt = own(makeCrapsFeltTexture())
  buildBackgroundTable(-140, -170, blackjackFelt, 90, 60)
  buildBackgroundTable(140, -170, crapsFelt, 110, 55)

  // --- Bar with backlit bottle shelves ----------------------------------------------------------
  {
    const barX = 150
    const barZ = ROOM_MAX_Z - 12
    const bottleShelfTexture = own(makeBottleShelfTexture())
    const shelfMaterial = own(
      new THREE.MeshStandardMaterial({
        map: bottleShelfTexture,
        emissiveMap: bottleShelfTexture,
        emissive: 0xffffff,
        emissiveIntensity: 0.5,
        roughness: 0.5,
      }),
    )
    const shelfGeometry = own(new THREE.PlaneGeometry(70, 26))
    const shelf = new THREE.Mesh(shelfGeometry, shelfMaterial)
    shelf.rotation.y = Math.PI
    shelf.position.set(barX, 16 + 13, barZ + 8)
    group.add(shelf)

    const bottleMaterials = ['#3c8a4a', '#8a3c3c', '#c9a54a', '#3c5c8a'].map((c) =>
      own(new THREE.MeshStandardMaterial({ color: c, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 })),
    )
    const bottleGeometry = own(new THREE.CylinderGeometry(0.9, 1.1, 6, 8))
    const bottleRand = mulberry32(0x8071)
    for (let row = 0; row < 3; row++) {
      const count = own(new THREE.InstancedMesh(bottleGeometry, bottleMaterials[row % bottleMaterials.length] ?? bottleMaterials[0], 16))
      for (let i = 0; i < 16; i++) {
        dummy.position.set(barX - 33 + i * 4.2, 16 + row * 8.5 + 3, barZ + 8.3)
        dummy.rotation.set(0, bottleRand() * Math.PI, 0)
        dummy.updateMatrix()
        count.setMatrixAt(i, dummy.matrix)
      }
      count.instanceMatrix.needsUpdate = true
      group.add(count)
    }

    const counterGeometry = own(new THREE.BoxGeometry(70, 16, 8))
    const counter = new THREE.Mesh(counterGeometry, railMaterial)
    counter.position.set(barX, 8, barZ)
    counter.castShadow = true
    counter.receiveShadow = true
    group.add(counter)
  }

  // --- Marquee signs with chasing bulb borders --------------------------------------------------
  interface MarqueeSpec {
    text: string
    position: THREE.Vector3
    rotationY: number
    width: number
    height: number
  }
  const marqueeSpecs: readonly MarqueeSpec[] = [
    { text: 'CASINO', position: new THREE.Vector3(0, 100, ROOM_MAX_Z - 2), rotationY: Math.PI, width: 70, height: 17.5 },
    { text: 'ROYALE', position: new THREE.Vector3(ROOM_MIN_X + 2, 100, TABLE_CENTER_Z), rotationY: Math.PI / 2, width: 60, height: 15 },
    { text: 'HIGH LIMIT', position: new THREE.Vector3(ROOM_MAX_X - 2, 100, -60), rotationY: -Math.PI / 2, width: 60, height: 15 },
  ]
  const marqueeGeometry = own(new THREE.PlaneGeometry(1, 1))
  const bulbGeometry = own(new THREE.SphereGeometry(0.55, 8, 6))
  const chaseMaterials = [0, 1, 2].map(() =>
    own(new THREE.MeshStandardMaterial({ color: GOLD_BRIGHT, emissive: GOLD_BRIGHT, emissiveIntensity: 0.5, roughness: 0.4 })),
  )
  const chaseCounts = [0, 0, 0]
  for (const spec of marqueeSpecs) {
    const perimeter = 2 * (spec.width + spec.height)
    const bulbCount = Math.round(perimeter / 3)
    chaseCounts[0] += Math.ceil(bulbCount / 3)
    chaseCounts[1] += Math.ceil(bulbCount / 3)
    chaseCounts[2] += Math.ceil(bulbCount / 3)
  }
  const chaseMeshes = chaseMaterials.map((m, i) => own(new THREE.InstancedMesh(bulbGeometry, m, chaseCounts[i] ?? 1)))
  const chaseIndices = [0, 0, 0]

  marqueeSpecs.forEach((spec) => {
    const texture = own(makeMarqueeTexture(spec.text))
    const material = own(
      new THREE.MeshStandardMaterial({
        map: texture,
        emissiveMap: texture,
        emissive: 0xffffff,
        emissiveIntensity: 1.3,
        roughness: 0.4,
        side: THREE.DoubleSide,
      }),
    )
    const mesh = new THREE.Mesh(marqueeGeometry, material)
    mesh.scale.set(spec.width, spec.height, 1)
    mesh.position.copy(spec.position)
    mesh.rotation.y = spec.rotationY
    group.add(mesh)

    const perimeter = 2 * (spec.width + spec.height)
    const bulbCount = Math.round(perimeter / 3)
    for (let i = 0; i < bulbCount; i++) {
      const t = i / bulbCount
      const d = t * perimeter
      let localX: number
      let localY: number
      const halfW = spec.width / 2
      const halfH = spec.height / 2
      if (d < spec.width) {
        localX = -halfW + d
        localY = -halfH
      } else if (d < spec.width + spec.height) {
        localX = halfW
        localY = -halfH + (d - spec.width)
      } else if (d < spec.width * 2 + spec.height) {
        localX = halfW - (d - spec.width - spec.height)
        localY = halfH
      } else {
        localX = -halfW
        localY = halfH - (d - spec.width * 2 - spec.height)
      }
      dummy.position.set(spec.position.x, spec.position.y, spec.position.z)
      const cos = Math.cos(spec.rotationY)
      const sin = Math.sin(spec.rotationY)
      dummy.position.x += localX * cos
      dummy.position.z += -localX * sin
      dummy.position.y += localY
      // Offset a hair along the sign's own local +Z (toward the room) so bulbs sit in front of the plane.
      dummy.position.x += 0.3 * sin
      dummy.position.z += 0.3 * cos
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      const group3 = i % 3
      const mesh3 = chaseMeshes[group3]
      if (mesh3) {
        mesh3.setMatrixAt(chaseIndices[group3] ?? 0, dummy.matrix)
        chaseIndices[group3] = (chaseIndices[group3] ?? 0) + 1
      }
    }
  })
  chaseMeshes.forEach((m) => {
    m.instanceMatrix.needsUpdate = true
    group.add(m)
  })

  // --- Red velvet rope with brass stanchions ------------------------------------------------------
  {
    const stanchionMaterial = own(new THREE.MeshStandardMaterial({ color: BRASS, roughness: 0.3, metalness: 1 }))
    const poleGeometry = own(new THREE.CylinderGeometry(0.6, 0.6, 30, 10))
    const capGeometry = own(new THREE.SphereGeometry(1, 10, 8))
    const ropeMaterial = own(new THREE.MeshStandardMaterial({ color: '#5c0d16', roughness: 0.6 }))
    const ropeGeometry = own(new THREE.CylinderGeometry(0.5, 0.5, 20, 8))
    const stanchionXs = [-40, -20, 0, 20, 40]
    const ropeZ = ROOM_MAX_Z - 30
    const poles = own(new THREE.InstancedMesh(poleGeometry, stanchionMaterial, stanchionXs.length))
    const caps = own(new THREE.InstancedMesh(capGeometry, stanchionMaterial, stanchionXs.length))
    stanchionXs.forEach((x, i) => {
      dummy.position.set(x, 15, ropeZ)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      poles.setMatrixAt(i, dummy.matrix)
      dummy.position.set(x, 30, ropeZ)
      dummy.updateMatrix()
      caps.setMatrixAt(i, dummy.matrix)
    })
    poles.instanceMatrix.needsUpdate = true
    caps.instanceMatrix.needsUpdate = true
    group.add(poles, caps)

    const ropeSegments = own(new THREE.InstancedMesh(ropeGeometry, ropeMaterial, stanchionXs.length - 1))
    for (let i = 0; i < stanchionXs.length - 1; i++) {
      const xa = stanchionXs[i] ?? 0
      const xb = stanchionXs[i + 1] ?? 0
      dummy.position.set((xa + xb) / 2, 27, ropeZ)
      dummy.rotation.set(0, 0, Math.PI / 2)
      dummy.updateMatrix()
      ropeSegments.setMatrixAt(i, dummy.matrix)
    }
    ropeSegments.instanceMatrix.needsUpdate = true
    group.add(ropeSegments)
  }

  // --- Animation state --------------------------------------------------------------------------
  const reelSpeeds = slotPlacements.map((_, i) => 0.15 + (i % 5) * 0.03)

  return {
    group,
    update(time: number) {
      reelTextures.forEach((texture, i) => {
        const speed = reelSpeeds[i] ?? 0.2
        texture.offset.y = (time * speed) % 1
      })

      chaseMaterials.forEach((material, i) => {
        const phase = (time * 3 - i * (1 / 3)) % 1
        material.emissiveIntensity = phase < 0.4 ? 1.6 : 0.35
      })

      topperMaterials.forEach((material, i) => {
        material.emissiveIntensity = 0.85 + 0.25 * Math.sin(time * 1.6 + i * 1.3)
      })

      coveMaterial.emissiveIntensity = 1.0 + 0.15 * Math.sin(time * 0.5)
      chandelierBulbMaterial.emissiveIntensity = 1.5 + 0.15 * Math.sin(time * 0.9)
    },
    dispose() {
      for (const item of disposables) item.dispose()
    },
  }
}
