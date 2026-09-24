/**
 * The felt canvas: deep casino green baize with the betting layout printed on it in cream/gold
 * and red/black number boxes, plus a small wordmark and crest in the open felt near the wheel.
 * The canvas covers the felt's world footprint exactly (see `FELT_MIN_X`/`FELT_MAX_X`/
 * `FELT_MIN_Z`/`FELT_MAX_Z`, the table outline inset by `RAIL_WIDTH`), so canvas pixel <-> world
 * `(x, z)` is one linear map, and `layoutCells()`/`numberCellRect()` (world via `layoutToWorld`)
 * land on it exactly. `texture.flipY = false`, so canvas row 0 (top, drawn first) is `FELT_MIN_Z`
 * and canvas column 0 is `FELT_MIN_X` - no separate flip bookkeeping needed anywhere else.
 */

import * as THREE from 'three'
import { layoutCells, GRID_DEPTH, GRID_END_U, LAYOUT_WIDTH, LAYOUT_DEPTH } from '../game/layout.ts'
import { layoutToWorld, TABLE_MIN_X, TABLE_MAX_X, TABLE_MIN_Z, TABLE_MAX_Z } from './tableGeometry.ts'

/** Width of the padded armrest rail, inset from the table's outer outline. */
export const RAIL_WIDTH = 4
export const FELT_MIN_X = TABLE_MIN_X + RAIL_WIDTH
export const FELT_MAX_X = TABLE_MAX_X - RAIL_WIDTH
export const FELT_MIN_Z = TABLE_MIN_Z + RAIL_WIDTH
export const FELT_MAX_Z = TABLE_MAX_Z - RAIL_WIDTH
const FELT_WORLD_WIDTH = FELT_MAX_X - FELT_MIN_X
const FELT_WORLD_HEIGHT = FELT_MAX_Z - FELT_MIN_Z

const CANVAS_WIDTH = 4096
const CANVAS_HEIGHT = Math.round((FELT_WORLD_HEIGHT / FELT_WORLD_WIDTH) * CANVAS_WIDTH)
const PX_PER_INCH = CANVAS_WIDTH / FELT_WORLD_WIDTH

const FELT_GREEN = '#0b3d24'
const FELT_GREEN_LIGHT = '#0f4a2c'
const ZERO_GREEN = '#0d5c34'
const NUMBER_RED = '#9a1620'
const NUMBER_BLACK = '#14100f'
const CREAM = '#ece2c4'
const GOLD = '#d4af37'
const CELL_BORDER = 'rgba(236, 226, 196, 0.65)'

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
  if (!ctx) throw new Error('2D canvas context unavailable for felt texture')
  return { canvas, ctx }
}

/** World `(x, z)` to canvas pixels. See the module doc comment for the (unflipped) convention. */
function worldToCanvas(x: number, z: number): { px: number; py: number } {
  return { px: (x - FELT_MIN_X) * PX_PER_INCH, py: (z - FELT_MIN_Z) * PX_PER_INCH }
}

/** Layout `(u, v)` to canvas pixels, via `layoutToWorld`. */
function layoutToCanvas(u: number, v: number): { px: number; py: number } {
  const p = layoutToWorld(u, v)
  return worldToCanvas(p.x, p.z)
}

function fillBackground(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = FELT_GREEN
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

  // Fine fibre grain: short faint strokes at random angles, seeded for a stable look.
  const rand = mulberry32(0x9e17c05)
  ctx.save()
  ctx.globalAlpha = 0.05
  for (let i = 0; i < 22000; i++) {
    const x = rand() * CANVAS_WIDTH
    const y = rand() * CANVAS_HEIGHT
    const len = 1.5 + rand() * 3
    const angle = rand() * Math.PI
    ctx.strokeStyle = rand() > 0.5 ? '#1c6b41' : '#062416'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
    ctx.stroke()
  }
  ctx.restore()

  // Subtle vignette toward the rail.
  const cx = CANVAS_WIDTH / 2
  const cy = CANVAS_HEIGHT / 2
  const gradient = ctx.createRadialGradient(cx, cy, Math.min(cx, cy) * 0.3, cx, cy, Math.max(cx, cy) * 1.15)
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.45)')
  ctx.save()
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
  ctx.restore()
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: { tl: number; tr: number; br: number; bl: number },
): void {
  ctx.beginPath()
  ctx.moveTo(x + r.tl, y)
  ctx.lineTo(x + w - r.tr, y)
  if (r.tr > 0) ctx.arcTo(x + w, y, x + w, y + r.tr, r.tr)
  ctx.lineTo(x + w, y + h - r.br)
  if (r.br > 0) ctx.arcTo(x + w, y + h, x + w - r.br, y + h, r.br)
  ctx.lineTo(x + r.bl, y + h)
  if (r.bl > 0) ctx.arcTo(x, y + h, x, y + h - r.bl, r.bl)
  ctx.lineTo(x, y + r.tl)
  if (r.tl > 0) ctx.arcTo(x, y, x + r.tl, y, r.tl)
  ctx.closePath()
}

function drawDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(cx, cy - r)
  ctx.lineTo(cx + r * 0.72, cy)
  ctx.lineTo(cx, cy + r)
  ctx.lineTo(cx - r * 0.72, cy)
  ctx.closePath()
  ctx.fill()
}

/** Draws every printed box (`layoutCells()`) at its exact world footprint. */
function drawLayout(ctx: CanvasRenderingContext2D): void {
  for (const cell of layoutCells()) {
    const a = layoutToCanvas(cell.u0, cell.v0)
    const b = layoutToCanvas(cell.u1, cell.v1)
    const x = Math.min(a.px, b.px)
    const y = Math.min(a.py, b.py)
    const w = Math.abs(b.px - a.px)
    const h = Math.abs(b.py - a.py)
    const cx = x + w / 2
    const cy = y + h / 2

    if (cell.kind === 'zero') {
      // Rounded end toward the wheel (the low-`u` edge, canvas left, since the wheel sits at -x).
      const radius = Math.min(w * 0.45, h * 0.12)
      roundedRectPath(ctx, x, y, w, h, { tl: radius, bl: radius, tr: 0, br: 0 })
      ctx.fillStyle = ZERO_GREEN
      ctx.fill()
      ctx.strokeStyle = GOLD
      ctx.lineWidth = Math.max(2, w * 0.015)
      ctx.stroke()
      ctx.fillStyle = '#ffffff'
      ctx.font = `700 ${h * 0.42}px 'Georgia', serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('0', cx + w * 0.08, cy)
      continue
    }

    if (cell.kind === 'number') {
      const bg = cell.color === 'red' ? NUMBER_RED : NUMBER_BLACK
      ctx.fillStyle = bg
      ctx.fillRect(x, y, w, h)
      ctx.strokeStyle = CELL_BORDER
      ctx.lineWidth = Math.max(1.5, w * 0.01)
      ctx.strokeRect(x, y, w, h)
      ctx.fillStyle = '#ffffff'
      ctx.font = `700 ${Math.min(w, h) * 0.48}px 'Georgia', serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(cell.text, cx, cy + h * 0.02)
      continue
    }

    // Column, dozen and even-money boxes: green felt with a gold keyline, cream text or a diamond.
    ctx.fillStyle = cell.kind === 'column' ? FELT_GREEN_LIGHT : FELT_GREEN
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = GOLD
    ctx.lineWidth = Math.max(1.5, w * 0.006)
    ctx.strokeRect(x, y, w, h)

    if (cell.color) {
      drawDiamond(ctx, cx, cy, Math.min(w, h) * 0.3, cell.color === 'red' ? NUMBER_RED : NUMBER_BLACK)
    } else if (cell.text) {
      const fontSize = cell.kind === 'column' ? Math.min(w, h) * 0.24 : Math.min(w, h) * 0.3
      ctx.fillStyle = CREAM
      ctx.font = `700 ${fontSize}px 'Georgia', serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      if (cell.kind === 'column') {
        // "2 to 1" reads along the column strip, upright.
        ctx.fillText('2 TO 1', cx, cy)
      } else {
        ctx.fillText(cell.text, cx, cy)
      }
    }
  }

  // A heavier gold border around the whole number grid and the outer layout.
  const gridA = layoutToCanvas(0, 0)
  const gridB = layoutToCanvas(GRID_END_U, GRID_DEPTH)
  ctx.strokeStyle = GOLD
  ctx.lineWidth = 4
  ctx.strokeRect(
    Math.min(gridA.px, gridB.px),
    Math.min(gridA.py, gridB.py),
    Math.abs(gridB.px - gridA.px),
    Math.abs(gridB.py - gridA.py),
  )
  const outerA = layoutToCanvas(0, 0)
  const outerB = layoutToCanvas(LAYOUT_WIDTH, LAYOUT_DEPTH)
  ctx.lineWidth = 5
  ctx.strokeRect(
    Math.min(outerA.px, outerB.px),
    Math.min(outerA.py, outerB.py),
    Math.abs(outerB.px - outerA.px),
    Math.abs(outerB.py - outerA.py),
  )
}

/** A simple procedural rosette crest: concentric rings and a starburst, no image files. */
function drawCrest(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save()
  ctx.strokeStyle = GOLD
  ctx.globalAlpha = 0.85
  ctx.lineWidth = Math.max(1.5, r * 0.04)
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2)
  ctx.stroke()
  const points = 10
  ctx.beginPath()
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? r * 0.6 : r * 0.32
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2
    const px = cx + Math.cos(angle) * rad
    const py = cy + Math.sin(angle) * rad
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

/**
 * The wordmark on the dealer's side of the layout, and a small crest with the table-limit small
 * print in the chip rest on the player's side. The wheel fills its end of the table, so the
 * open felt beside the layout is the only place clear of it.
 */
function drawWheelEndArt(ctx: CanvasRenderingContext2D): void {
  const layoutMidU = LAYOUT_WIDTH / 2
  const far = worldToCanvas(layoutToWorld(layoutMidU, 0).x, (FELT_MIN_Z + layoutToWorld(0, 0).z) / 2)
  const near = worldToCanvas(layoutToWorld(layoutMidU, 0).x, (FELT_MAX_Z + layoutToWorld(0, LAYOUT_DEPTH).z) / 2)

  ctx.save()
  ctx.fillStyle = GOLD
  ctx.globalAlpha = 0.9
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${1.9 * PX_PER_INCH}px 'Georgia', serif`
  ctx.save()
  ctx.translate(far.px, far.py)
  ctx.fillText('ROULETTE ROYALE', 0, 0)
  ctx.restore()

  ctx.font = `400 ${0.75 * PX_PER_INCH}px 'Georgia', serif`
  ctx.fillStyle = CREAM
  ctx.globalAlpha = 0.75
  ctx.fillText('Minimum 1 · Maximum 250 straight up', near.px, near.py + 3.3 * PX_PER_INCH)
  ctx.restore()

  drawCrest(ctx, near.px, near.py - 0.6 * PX_PER_INCH, 2.4 * PX_PER_INCH)
}

function finishTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

/** The felt colour map: the printed layout (via `layoutCells()`), grain and the wheel-end art. */
export function makeFeltTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT)
  fillBackground(ctx)
  drawLayout(ctx)
  drawWheelEndArt(ctx)
  return finishTexture(canvas)
}
