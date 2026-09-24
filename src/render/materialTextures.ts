/**
 * Procedural material maps shared by the cabinet and the table: brushed stainless, painted wood,
 * scratched/smudged metal, and moulded plastic. Every export draws a fresh canvas (no image
 * files) and returns a new `THREE.CanvasTexture`; the caller owns and disposes it. Colour maps
 * use `SRGBColorSpace`; roughness and bump (data) maps use `NoColorSpace`. Every map tiles with
 * `RepeatWrapping`, built from seamless, seeded periodic noise so no `Math.random` call and no
 * visible seam appears when it repeats.
 */

import * as THREE from 'three'

// -------------------------------------------------------------------------------------------
// Small deterministic helpers (a local copy of `textures.ts`'s PRNG/canvas conventions - this
// file owns no shared export surface with that module, so it keeps its own tiny copies).
// -------------------------------------------------------------------------------------------

/** Deterministic 32-bit PRNG (mulberry32), so every texture here is stable across reloads. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Combines a handful of hex colour strings into a PRNG seed, so colour choice affects the grain. */
function seedFromHex(...hexes: readonly string[]): number {
  let seed = 0x1234567
  for (const hex of hexes) {
    const n = parseInt(hex.replace('#', ''), 16) || 0
    seed = (seed ^ (n + 0x9e3779b9 + ((seed << 6) >>> 0) + (seed >>> 2))) >>> 0
  }
  return seed
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function hexToRgb(hex: string): readonly [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable for texture')
  return { canvas, ctx }
}

/** A colour map: read in gamma-correct space, tiled. */
function finishColorTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.needsUpdate = true
  return texture
}

/** A data map (roughness/bump): read linearly, tiled. */
function finishDataTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.NoColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.needsUpdate = true
  return texture
}

/** Builds a `size x size` greyscale data texture from a per-pixel `0..255` painter, in one pass. */
function makeGrayscaleTexture(size: number, paint: (x: number, y: number) => number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(size)
  const image = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.round(clamp01(paint(x, y) / 255) * 255)
      const idx = (y * size + x) * 4
      image.data[idx] = v
      image.data[idx + 1] = v
      image.data[idx + 2] = v
      image.data[idx + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

// -------------------------------------------------------------------------------------------
// Seamless periodic noise: every frequency is an integer number of cycles across the canvas, so
// the sum is exactly periodic in both directions and wraps with no seam.
// -------------------------------------------------------------------------------------------

interface Octave {
  freqX: number
  freqY: number
  phase: number
  amp: number
}

function octave(rand: () => number, freqX: number, freqY: number, amp: number): Octave {
  return { freqX, freqY, phase: rand() * Math.PI * 2, amp }
}

/** Sum of sine octaves, each an integer number of cycles across `width`/`height`: range about [-1, 1]. */
function sumOctaves(octaves: readonly Octave[], x: number, y: number, width: number, height: number): number {
  let v = 0
  for (const o of octaves) {
    const phaseX = (2 * Math.PI * (o.freqX * x)) / width
    const phaseY = (2 * Math.PI * (o.freqY * y)) / height
    v += o.amp * Math.sin(phaseX + phaseY + o.phase)
  }
  return v
}

function totalAmp(octaves: readonly Octave[]): number {
  let sum = 0
  for (const o of octaves) sum += o.amp
  return sum || 1
}

// -------------------------------------------------------------------------------------------
// Brushed stainless steel
// -------------------------------------------------------------------------------------------

const BRUSHED_SIZE = 256
const BRUSHED_ROUGHNESS_SEED = 0xb0055
const BRUSHED_BUMP_SEED = 0xb0066

/**
 * Fine parallel streaks for brushed stainless steel: a roughness map (data). Streaks run along U -
 * the dominant variation is a function of V only (horizontal bands spanning the full U axis), with
 * a fine high-frequency wobble along U so each streak is not perfectly uniform along its length.
 */
export function makeBrushedMetalRoughness(): THREE.CanvasTexture {
  const rand = mulberry32(BRUSHED_ROUGHNESS_SEED)
  const bands = [octave(rand, 0, 3, 0.4), octave(rand, 0, 11, 0.22), octave(rand, 0, 23, 0.12)]
  const grain = [octave(rand, 59, 0, 0.16), octave(rand, 127, 0, 0.08)]
  const canvas = makeGrayscaleTexture(BRUSHED_SIZE, (x, y) => {
    const band = sumOctaves(bands, x, y, BRUSHED_SIZE, BRUSHED_SIZE) / totalAmp(bands)
    const streak = sumOctaves(grain, x, y, BRUSHED_SIZE, BRUSHED_SIZE) / totalAmp(grain)
    return clamp01(0.72 + band * 0.16 + streak * 0.1) * 255
  })
  return finishDataTexture(canvas)
}

/** Height map to go with it, for `bumpMap`: the same streak structure, read as elevation. */
export function makeBrushedMetalBump(): THREE.CanvasTexture {
  const rand = mulberry32(BRUSHED_BUMP_SEED)
  const bands = [octave(rand, 0, 4, 0.32), octave(rand, 0, 13, 0.22), octave(rand, 0, 29, 0.14)]
  const grain = [octave(rand, 71, 0, 0.2), octave(rand, 151, 0, 0.1)]
  const canvas = makeGrayscaleTexture(BRUSHED_SIZE, (x, y) => {
    const band = sumOctaves(bands, x, y, BRUSHED_SIZE, BRUSHED_SIZE) / totalAmp(bands)
    const streak = sumOctaves(grain, x, y, BRUSHED_SIZE, BRUSHED_SIZE) / totalAmp(grain)
    return clamp01(0.5 + band * 0.22 + streak * 0.14) * 255
  })
  return finishDataTexture(canvas)
}

// -------------------------------------------------------------------------------------------
// Wood grain
// -------------------------------------------------------------------------------------------

const WOOD_SIZE = 256
const WOOD_GRAIN_LINE_COUNT = 4
const WOOD_RIDGE_SHARPNESS = 6
const WOOD_RIDGE_POWER = 2.2
const WOOD_BUMP_SEED = 0xf00d1e

interface WoodGrainLine {
  freqY: number
  freqX: number
  wobble: number
  phase: number
}

/** A handful of wavy, seamlessly-tiling grain lines: integer frequencies in both axes. */
function makeWoodGrainLines(rand: () => number): WoodGrainLine[] {
  return Array.from({ length: WOOD_GRAIN_LINE_COUNT }, (_, i) => ({
    freqY: 3 + i * 2 + Math.floor(rand() * 2),
    freqX: 1 + Math.floor(rand() * 3),
    wobble: 0.5 + rand() * 0.5,
    phase: rand() * Math.PI * 2,
  }))
}

/** The wavy grain field at one pixel, in about [-1, 1]: ridges (near 0) read as grain lines. */
function woodGrainField(lines: readonly WoodGrainLine[], x: number, y: number, size: number): number {
  let v = 0
  for (const line of lines) {
    const inner = Math.sin((2 * Math.PI * line.freqX * x) / size + line.phase)
    v += Math.sin((2 * Math.PI * line.freqY * y) / size + line.wobble * inner) / lines.length
  }
  return v
}

/**
 * Wood grain colour map in the given base tint (CSS hex), e.g. black-painted plywood or maple.
 * Tiles along U.
 */
export function makeWoodGrain(tint: string, grain: string): THREE.CanvasTexture {
  const rand = mulberry32(seedFromHex(tint, grain))
  const tintRgb = hexToRgb(tint)
  const grainRgb = hexToRgb(grain)
  const lines = makeWoodGrainLines(rand)
  const { canvas, ctx } = makeCanvas(WOOD_SIZE)
  const image = ctx.createImageData(WOOD_SIZE, WOOD_SIZE)
  for (let y = 0; y < WOOD_SIZE; y++) {
    for (let x = 0; x < WOOD_SIZE; x++) {
      const field = woodGrainField(lines, x, y, WOOD_SIZE)
      const ridge = Math.max(0, 1 - Math.abs(field) * WOOD_RIDGE_SHARPNESS)
      const mix = clamp01(Math.pow(ridge, WOOD_RIDGE_POWER))
      const idx = (y * WOOD_SIZE + x) * 4
      image.data[idx] = Math.round(tintRgb[0] + (grainRgb[0] - tintRgb[0]) * mix)
      image.data[idx + 1] = Math.round(tintRgb[1] + (grainRgb[1] - tintRgb[1]) * mix)
      image.data[idx + 2] = Math.round(tintRgb[2] + (grainRgb[2] - tintRgb[2]) * mix)
      image.data[idx + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return finishColorTexture(canvas)
}

/** Matching height map for the grain: the same wavy ridges, generic (no colour), read as elevation. */
export function makeWoodBump(): THREE.CanvasTexture {
  const rand = mulberry32(WOOD_BUMP_SEED)
  const lines = makeWoodGrainLines(rand)
  const canvas = makeGrayscaleTexture(WOOD_SIZE, (x, y) => {
    const field = woodGrainField(lines, x, y, WOOD_SIZE)
    const ridge = clamp01(1 - Math.abs(field) * WOOD_RIDGE_SHARPNESS * 0.8)
    return clamp01(0.5 + ridge * 0.4) * 255
  })
  return finishDataTexture(canvas)
}

// -------------------------------------------------------------------------------------------
// Scratches and smudges
// -------------------------------------------------------------------------------------------

const SCRATCH_SIZE = 256
const SCRATCH_SEED = 0x5c8a7c
const SCRATCH_BASE = 58
const SCRATCH_COUNT = 46
const SCRATCH_SMUDGE_COUNT = 5

/** Random fine scratches and smudges as a roughness map: mostly smooth with slightly rougher hairlines. */
export function makeScratchRoughness(): THREE.CanvasTexture {
  const rand = mulberry32(SCRATCH_SEED)
  const { canvas, ctx } = makeCanvas(SCRATCH_SIZE)
  ctx.fillStyle = `rgb(${SCRATCH_BASE}, ${SCRATCH_BASE}, ${SCRATCH_BASE})`
  ctx.fillRect(0, 0, SCRATCH_SIZE, SCRATCH_SIZE)

  // Broad, very low-contrast smudges: a slightly rougher patch, softly faded.
  for (let i = 0; i < SCRATCH_SMUDGE_COUNT; i++) {
    const x = rand() * SCRATCH_SIZE
    const y = rand() * SCRATCH_SIZE
    const r = SCRATCH_SIZE * (0.12 + rand() * 0.18)
    const shade = SCRATCH_BASE + 20 + rand() * 20
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r)
    gradient.addColorStop(0, `rgba(${shade}, ${shade}, ${shade}, 0.35)`)
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, SCRATCH_SIZE, SCRATCH_SIZE)
  }

  // Thin, bright hairline scratches at random positions and angles.
  for (let i = 0; i < SCRATCH_COUNT; i++) {
    const x = rand() * SCRATCH_SIZE
    const y = rand() * SCRATCH_SIZE
    const angle = rand() * Math.PI
    const len = SCRATCH_SIZE * (0.08 + rand() * 0.22)
    const dx = Math.cos(angle) * len
    const dy = Math.sin(angle) * len
    const bright = 150 + rand() * 90
    ctx.save()
    ctx.globalAlpha = 0.25 + rand() * 0.35
    ctx.strokeStyle = `rgb(${bright}, ${bright}, ${bright})`
    ctx.lineWidth = 0.6 + rand() * 0.5
    ctx.beginPath()
    ctx.moveTo(x - dx / 2, y - dy / 2)
    ctx.lineTo(x + dx / 2, y + dy / 2)
    ctx.stroke()
    ctx.restore()
  }

  return finishDataTexture(canvas)
}

// -------------------------------------------------------------------------------------------
// Moulded rubber / textured plastic
// -------------------------------------------------------------------------------------------

const PEBBLE_SIZE = 256
const PEBBLE_SEED = 0x9eb61e
const PEBBLE_OCTAVES = 5

/** Pebbled height map for moulded rubber and textured ABS plastic. */
export function makePebbleBump(): THREE.CanvasTexture {
  const rand = mulberry32(PEBBLE_SEED)
  const cells: Octave[] = []
  for (let i = 0; i < PEBBLE_OCTAVES; i++) {
    cells.push(octave(rand, 6 + Math.floor(rand() * 10), 6 + Math.floor(rand() * 10), 1 / (i + 1)))
  }
  const weight = totalAmp(cells)
  const canvas = makeGrayscaleTexture(PEBBLE_SIZE, (x, y) => {
    let v = 0
    for (const o of cells) {
      const sx = Math.sin((2 * Math.PI * (o.freqX * x)) / PEBBLE_SIZE + o.phase)
      const sy = Math.sin((2 * Math.PI * (o.freqY * y)) / PEBBLE_SIZE + o.phase * 1.3)
      v += Math.max(0, sx * sy) * o.amp
    }
    return clamp01(0.35 + (v / weight) * 0.6) * 255
  })
  return finishDataTexture(canvas)
}

// -------------------------------------------------------------------------------------------
// Powder coat / painted sheet metal
// -------------------------------------------------------------------------------------------

const POWDER_SIZE = 256
const POWDER_SEED = 0x907dc0a7
const POWDER_OCTAVES = 4

/** Orange-peel height map for powder-coated or painted sheet metal. */
export function makePowderCoatBump(): THREE.CanvasTexture {
  const rand = mulberry32(POWDER_SEED)
  const octaves: Octave[] = []
  for (let i = 0; i < POWDER_OCTAVES; i++) {
    octaves.push(octave(rand, 3 + Math.floor(rand() * 4), 3 + Math.floor(rand() * 4), 1 / (i + 1)))
  }
  const weight = totalAmp(octaves)
  const canvas = makeGrayscaleTexture(POWDER_SIZE, (x, y) => {
    const v = sumOctaves(octaves, x, y, POWDER_SIZE, POWDER_SIZE) / weight
    return clamp01(0.5 + v * 0.22) * 255
  })
  return finishDataTexture(canvas)
}
