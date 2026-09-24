/**
 * Procedural canvases for the wheel: the rotor's combined pocket-floor + number-ring colour map
 * (37 coloured segments with gold numerals). No image files; everything is drawn to a canvas and
 * handed back as a `THREE.CanvasTexture` the caller owns and disposes.
 *
 * The map is built for the pocket-ring `THREE.LatheGeometry` in `wheelView.ts`, which is revolved
 * with `phiStart = Math.PI / 2` so that texture U runs directly with the rotor-frame angle used
 * throughout the game code: column `x` is angle `(x / width) * 2π`. V runs with the profile's
 * point index; `wheelView.ts` samples that profile at uniform radius steps and hands in the exact
 * V fractions of the pocket floor and the number ring as `RotorTextureBands`, so the paint lines
 * up with the geometry without either file needing to duplicate the other's radius math.
 */

import * as THREE from 'three'
import {
  numberColor,
  pocketAtAngle,
  pocketNumber,
  POCKET_COUNT,
  POCKET_INNER_RADIUS,
  POCKET_OUTER_RADIUS,
  ROTOR_RADIUS,
} from '../game/wheel.ts'

const ROTOR_TEXTURE_WIDTH = 4096
const ROTOR_TEXTURE_HEIGHT = 256

const GOLD = '#c9a54a'
const RED = '#b3121b'
const BLACK = '#141414'
const GREEN = '#0b7a3b'
/** Pocket-floor colours are this fraction of the bright number-ring colour: "slightly darker". */
const FLOOR_DARKEN = 0.55
/** Numeral cap-to-baseline size on the wheel, inches, before shrinking to fit a pocket's width. */
const NUMERAL_FONT_INCHES = 1.05
/** Widest a numeral may run across its segment, as a fraction of the segment's width. */
const NUMERAL_MAX_WIDTH_FRACTION = 0.8

/** V fractions (0 at the turret side, 1 at the rim) of the rotor lathe's colour bands. */
export interface RotorTextureBands {
  /** Where the pocket floor begins; always 0 in practice (the lathe starts there). */
  floorStart: number
  /** Where the pocket floor ends, just before the lip riser up to the number ring. */
  floorEnd: number
  /** Where the number ring begins, just after the lip riser. Runs to 1. */
  ringStart: number
}

function hexToRgb(hex: string): readonly [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function colorForNumber(n: number): readonly [number, number, number] {
  const color = numberColor(n)
  return hexToRgb(color === 'red' ? RED : color === 'black' ? BLACK : GREEN)
}

/** Rotor-frame angle, radians, of canvas column `x` for the `phiStart = PI/2` lathe (see header). */
function angleForColumn(x: number, width: number): number {
  return (x / width) * Math.PI * 2
}

/**
 * The pocket-floor-and-number-ring colour map: darker pocket colour below `bands.floorEnd`,
 * bright pocket colour above `bands.ringStart`, and gold numerals centred in the ring band.
 *
 * Canvas up is V toward the rim, so a numeral's top points out of the wheel, as on a real one.
 * U runs counter-clockwise seen from above, which is right to left for someone reading from
 * outside the rim, so each numeral is drawn mirrored. A canvas pixel also covers a different
 * length along U (the circumference) than along V (the radius), so numerals are scaled across
 * U to keep their true proportions on the wheel.
 */
export function makeRotorColorTexture(bands: RotorTextureBands): THREE.CanvasTexture {
  const width = ROTOR_TEXTURE_WIDTH
  const height = ROTOR_TEXTURE_HEIGHT
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable for wheel texture')

  const image = ctx.createImageData(width, height)
  for (let y = 0; y < height; y++) {
    // Canvas row 0 is the top; CanvasTexture's default flipY samples it at v = 1 (the rim).
    const v = 1 - y / (height - 1)
    const onRing = v >= bands.ringStart
    const darken = onRing ? 1 : FLOOR_DARKEN
    for (let x = 0; x < width; x++) {
      const angle = angleForColumn(x, width)
      const index = pocketAtAngle(angle, 0)
      const n = pocketNumber(index)
      const [r, g, b] = colorForNumber(n)
      const idx = (y * width + x) * 4
      image.data[idx] = Math.round(r * darken)
      image.data[idx + 1] = Math.round(g * darken)
      image.data[idx + 2] = Math.round(b * darken)
      image.data[idx + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)

  // Gold numerals, centred in the number ring band.
  const ringMidV = (bands.ringStart + 1) / 2
  const ringMidY = (1 - ringMidV) * (height - 1)
  const ringMidRadius = (POCKET_OUTER_RADIUS + ROTOR_RADIUS) / 2
  const inchesPerPixelU = (2 * Math.PI * ringMidRadius) / width
  const inchesPerPixelV = (ROTOR_RADIUS - POCKET_INNER_RADIUS) / height
  const stretchU = inchesPerPixelV / inchesPerPixelU
  const segmentWidthPx = width / POCKET_COUNT
  const fontSize = Math.round(NUMERAL_FONT_INCHES / inchesPerPixelV)
  ctx.font = `700 ${fontSize}px Georgia, 'Times New Roman', serif`
  ctx.fillStyle = GOLD
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let index = 0; index < POCKET_COUNT; index++) {
    const n = pocketNumber(index)
    const wrapped = (((-index * (Math.PI * 2)) / POCKET_COUNT) % (Math.PI * 2)) + Math.PI * 2
    const u = (wrapped % (Math.PI * 2)) / (Math.PI * 2)
    const x = u * width
    const text = String(n)
    const naturalWidth = ctx.measureText(text).width * stretchU
    const fit = Math.min(1, (segmentWidthPx * NUMERAL_MAX_WIDTH_FRACTION) / naturalWidth)
    // Draw the numeral once in place and once shifted a full wrap either side, so a numeral
    // that straddles the U = 0 / 1 seam is not cut off by the canvas edge.
    for (const shift of [0, -width, width]) {
      ctx.save()
      ctx.translate(x + shift, ringMidY)
      ctx.scale(-stretchU * fit, fit)
      ctx.fillText(text, 0, 0)
      ctx.restore()
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}
