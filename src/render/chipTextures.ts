/**
 * Procedural casino chip textures: a face (top/bottom cap) and an edge (barrel) canvas per
 * denomination. No image files - drawn fresh per call, `RepeatWrapping` for the edge (it wraps
 * once around the cylinder), `ClampToEdge` for the face. The caller owns and disposes the result.
 */

import * as THREE from 'three'
import type { ChipValue } from '../game/types.ts'

const FACE_SIZE = 256
const EDGE_WIDTH = 512
const EDGE_HEIGHT = 48
/** Rectangular edge-spot inserts around the barrel, alternating with the base colour. */
const EDGE_SPOT_COUNT = 8

interface ChipPalette {
  base: string
  baseDark: string
  insert: string
  text: string
}

const CHIP_PALETTES: Readonly<Record<ChipValue, ChipPalette>> = {
  1: { base: '#f2efe6', baseDark: '#d8d3c2', insert: '#1f4fae', text: '#1f4fae' },
  5: { base: '#7c1420', baseDark: '#5c0f18', insert: '#f2efe6', text: '#f2efe6' },
  25: { base: '#175c34', baseDark: '#0f4324', insert: '#f2efe6', text: '#f2efe6' },
  100: { base: '#141414', baseDark: '#050505', insert: '#d4af37', text: '#d4af37' },
  500: { base: '#4a1a5c', baseDark: '#33123f', insert: '#d4af37', text: '#d4af37' },
}

/** Text printed on the chip face, e.g. `1`, `5`, `25`, `100`, `500`. */
function chipLabel(value: ChipValue): string {
  return String(value)
}

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable for chip texture')
  return { canvas, ctx }
}

function finishTexture(canvas: HTMLCanvasElement, wrap: THREE.Wrapping): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = wrap
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

/** The circular top/bottom face: base disc, dashed rim spots, an inner ring and the value. */
function drawFace(ctx: CanvasRenderingContext2D, palette: ChipPalette, value: ChipValue): void {
  const cx = FACE_SIZE / 2
  const cy = FACE_SIZE / 2
  const r = FACE_SIZE / 2 - 2

  ctx.fillStyle = palette.base
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()

  // Dashed rim: alternating base/insert wedges near the edge, like moulded chip spots seen from above.
  const rimOuter = r * 0.96
  const rimInner = r * 0.8
  const dashes = 16
  for (let i = 0; i < dashes; i++) {
    if (i % 2 !== 0) continue
    const a0 = (i / dashes) * Math.PI * 2
    const a1 = ((i + 1) / dashes) * Math.PI * 2
    ctx.fillStyle = palette.insert
    ctx.beginPath()
    ctx.arc(cx, cy, rimOuter, a0, a1)
    ctx.arc(cx, cy, rimInner, a1, a0, true)
    ctx.closePath()
    ctx.fill()
  }

  // Inner ring and central medallion.
  ctx.strokeStyle = palette.insert
  ctx.lineWidth = r * 0.045
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.66, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = palette.baseDark
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.58, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = palette.text
  ctx.font = `700 ${r * 0.55}px 'Georgia', serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(chipLabel(value), cx, cy + r * 0.03)
}

/** The barrel: alternating rectangular colour-spot inserts, the classic casino chip edge. */
function drawEdge(ctx: CanvasRenderingContext2D, palette: ChipPalette): void {
  ctx.fillStyle = palette.base
  ctx.fillRect(0, 0, EDGE_WIDTH, EDGE_HEIGHT)
  const spotWidth = EDGE_WIDTH / EDGE_SPOT_COUNT
  for (let i = 0; i < EDGE_SPOT_COUNT; i++) {
    if (i % 2 !== 0) continue
    const x = i * spotWidth
    ctx.fillStyle = palette.insert
    ctx.fillRect(x + spotWidth * 0.12, 0, spotWidth * 0.76, EDGE_HEIGHT)
    ctx.strokeStyle = palette.baseDark
    ctx.lineWidth = 1
    ctx.strokeRect(x + spotWidth * 0.12, 0.5, spotWidth * 0.76, EDGE_HEIGHT - 1)
  }
  // A thin dark line top and bottom, like the chip's edge chamfer catching a shadow.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
  ctx.fillRect(0, 0, EDGE_WIDTH, 2)
  ctx.fillRect(0, EDGE_HEIGHT - 2, EDGE_WIDTH, 2)
}

export interface ChipTextureSet {
  face: THREE.CanvasTexture
  edge: THREE.CanvasTexture
}

/** Face and edge textures for one chip denomination. */
export function makeChipTextures(value: ChipValue): ChipTextureSet {
  const palette = CHIP_PALETTES[value]

  const { canvas: faceCanvas, ctx: faceCtx } = makeCanvas(FACE_SIZE, FACE_SIZE)
  drawFace(faceCtx, palette, value)
  const face = finishTexture(faceCanvas, THREE.ClampToEdgeWrapping)

  const { canvas: edgeCanvas, ctx: edgeCtx } = makeCanvas(EDGE_WIDTH, EDGE_HEIGHT)
  drawEdge(edgeCtx, palette)
  const edge = finishTexture(edgeCanvas, THREE.RepeatWrapping)

  return { face, edge }
}
