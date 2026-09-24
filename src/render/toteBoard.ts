/**
 * The tote board: a free-standing result display behind the wheel, on a brushed-steel pole with a
 * weighted base. A portrait LED-style screen shows the recent history, hot/cold numbers and
 * colour percentages; a small backlit plaque above it carries the header. World space, inches;
 * self-positioned at `(TOTE_BOARD_X, 0, TOTE_BOARD_Z)` with the screen facing `+z` (the player).
 */

import * as THREE from 'three'
import { numberColor, POCKET_COUNT } from '../game/wheel.ts'
import { makeBrushedMetalBump, makeBrushedMetalRoughness } from './materialTextures.ts'
import { TOTE_BOARD_SCREEN_Y, TOTE_BOARD_X, TOTE_BOARD_Z } from './tableGeometry.ts'

export interface ToteBoard {
  /** World space, positioned at (TOTE_BOARD_X, 0, TOTE_BOARD_Z), screen facing +z. */
  group: THREE.Group
  /** Redraws the screen: history newest first, counts indexed by number (37 entries). */
  setHistory(history: readonly number[], counts: readonly number[]): void
  update(time: number): void
  dispose(): void
}

// ---------------------------------------------------------------------------------------------
// Dimensions, inches. The pole and base are brushed steel; the housing is black gloss with a
// gold trim frame; the screen and header are emissive canvas planes.
// ---------------------------------------------------------------------------------------------

const SCREEN_WIDTH = 18
const SCREEN_HEIGHT = 28
const SCREEN_MARGIN = 1.4
const HEADER_HEIGHT = 3.2
const HEADER_GAP = 0.7
const HOUSING_DEPTH = 3
const TRIM_THICKNESS = 0.5
const TRIM_DEPTH = 0.4
const POLE_RADIUS = 1.05
const BASE_RADIUS = 8
const BASE_HEIGHT = 3
const BASE_TOP_RADIUS = 6.4

const CANVAS_WIDTH = 512
const CANVAS_HEIGHT = 800
const HEADER_CANVAS_WIDTH = 1024
const HEADER_CANVAS_HEIGHT = 200

const HISTORY_DISPLAY_COUNT = 14
const HOT_COLD_COUNT = 4

const GOLD = '#c9a54a'
const GOLD_BRIGHT = '#f3d27a'
const BLACK_GLOSS = '#0a0a0d'
/** Dark bronze: bright steel mirrored the room into a pale blue flare on the floor. */
const STEEL = '#4a3b26'
const SCREEN_RED = '#d0212f'
const SCREEN_WHITE = '#f4f1ea'
const SCREEN_GREEN = '#1f9a53'
const DISPLAY_FONT = '"Playfair Display", Didot, Georgia, serif'

const screenPanelHeight = SCREEN_HEIGHT + SCREEN_MARGIN * 2
const housingWidth = SCREEN_WIDTH + SCREEN_MARGIN * 2
const housingTotalHeight = HEADER_HEIGHT + HEADER_GAP + screenPanelHeight
const housingBottomY = TOTE_BOARD_SCREEN_Y - screenPanelHeight / 2
const housingTopY = housingBottomY + housingTotalHeight
const housingCenterY = (housingBottomY + housingTopY) / 2
const headerCenterY = housingTopY - HEADER_HEIGHT / 2
const poleTopY = housingBottomY - 0.3
const poleBottomY = BASE_HEIGHT
const poleHeight = Math.max(1, poleTopY - poleBottomY)
const poleCenterY = (poleTopY + poleBottomY) / 2

interface Disposable {
  dispose(): void
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable for tote board texture')
  return { canvas, ctx }
}

function finishTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

/** Colour of the number's text on the board, per the classic tote layout. */
function textColorFor(n: number): string {
  const color = numberColor(n)
  if (color === 'red') return SCREEN_RED
  if (color === 'green') return SCREEN_GREEN
  return SCREEN_WHITE
}

/** The `take` numbers with the highest ('desc') or lowest ('asc') counts, ties broken by number. */
function rankedNumbers(counts: readonly number[], take: number, order: 'desc' | 'asc'): number[] {
  const entries = Array.from({ length: POCKET_COUNT }, (_, number) => ({ number, count: counts[number] ?? 0 }))
  entries.sort((a, b) => (order === 'desc' ? b.count - a.count : a.count - b.count) || a.number - b.number)
  return entries.slice(0, take).map((e) => e.number)
}

function drawVignette(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const bg = ctx.createLinearGradient(0, 0, 0, height)
  bg.addColorStop(0, '#0a0d12')
  bg.addColorStop(1, '#04060a')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)
  const vignette = ctx.createRadialGradient(
    width / 2, height / 2, height * 0.2,
    width / 2, height / 2, height * 0.75,
  )
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.55)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)
}

function drawNumberChip(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, n: number,
): void {
  const color = numberColor(n)
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fillStyle = color === 'red' ? SCREEN_RED : color === 'green' ? SCREEN_GREEN : '#1a1a1a'
  ctx.fill()
  ctx.lineWidth = radius * 0.14
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
  ctx.stroke()
  ctx.fillStyle = '#f4f1ea'
  ctx.font = `700 ${radius * 1.15}px ${DISPLAY_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(n), cx, cy + radius * 0.06)
  ctx.restore()
}

function drawPercentBar(
  ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number,
  label: string, color: string, fraction: number,
): void {
  ctx.save()
  ctx.font = `600 ${height * 0.85}px ${DISPLAY_FONT}`
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(244, 241, 234, 0.75)'
  ctx.textAlign = 'left'
  ctx.fillText(label, x, y + height / 2)
  const labelWidth = width * 0.16
  const trackX = x + labelWidth
  const trackWidth = width - labelWidth - width * 0.14
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
  ctx.beginPath()
  ctx.roundRect(trackX, y, trackWidth, height, height / 2)
  ctx.fill()
  const filled = Math.max(height, trackWidth * clamp01(fraction))
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.roundRect(trackX, y, filled, height, height / 2)
  ctx.fill()
  ctx.fillStyle = SCREEN_WHITE
  ctx.textAlign = 'right'
  ctx.fillText(`${Math.round(clamp01(fraction) * 100)}%`, x + width, y + height / 2)
  ctx.restore()
}

function paintScreen(
  ctx: CanvasRenderingContext2D, history: readonly number[], counts: readonly number[],
): void {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
  drawVignette(ctx, CANVAS_WIDTH, CANVAS_HEIGHT)

  if (history.length === 0) {
    ctx.save()
    ctx.font = `700 42px ${DISPLAY_FONT}`
    ctx.fillStyle = GOLD_BRIGHT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(243, 210, 122, 0.6)'
    ctx.shadowBlur = 18
    ctx.fillText('PLACE YOUR', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 30)
    ctx.fillText('BETS', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 30)
    ctx.restore()
    return
  }

  // --- Recent history: newest first and largest, red right-aligned, black left, zero centred. ---
  const shown = history.slice(0, HISTORY_DISPLAY_COUNT)
  const listTop = 24
  const listBottom = 548
  const rowMargin = CANVAS_WIDTH * 0.08
  let y = listTop
  for (let i = 0; i < shown.length; i++) {
    const n = shown[i]!
    const t = shown.length > 1 ? i / (shown.length - 1) : 0
    const fontSize = lerp(58, 24, t)
    const rowHeight = lerp(46, 24, t)
    const color = numberColor(n)
    ctx.save()
    ctx.font = `700 ${fontSize}px ${DISPLAY_FONT}`
    ctx.textBaseline = 'top'
    ctx.fillStyle = textColorFor(n)
    if (i === 0) {
      ctx.shadowColor = 'rgba(255, 255, 255, 0.35)'
      ctx.shadowBlur = 10
    }
    if (color === 'green') {
      ctx.textAlign = 'center'
      ctx.fillText(String(n), CANVAS_WIDTH / 2, y)
    } else if (color === 'red') {
      ctx.textAlign = 'right'
      ctx.fillText(String(n), CANVAS_WIDTH - rowMargin, y)
    } else {
      ctx.textAlign = 'left'
      ctx.fillText(String(n), rowMargin, y)
    }
    ctx.restore()
    y += rowHeight
    if (y > listBottom) break
  }

  // --- Hot / cold, from the all-time counts. ---
  const hot = rankedNumbers(counts, HOT_COLD_COUNT, 'desc')
  const cold = rankedNumbers(counts, HOT_COLD_COUNT, 'asc')
  const panelY = 588
  ctx.save()
  ctx.font = `700 22px ${DISPLAY_FONT}`
  ctx.fillStyle = GOLD_BRIGHT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('HOT', CANVAS_WIDTH * 0.08, panelY)
  ctx.textAlign = 'right'
  ctx.fillText('COLD', CANVAS_WIDTH * 0.92, panelY)
  ctx.restore()

  const chipRadius = 22
  const chipY = panelY + 34
  for (let i = 0; i < hot.length; i++) {
    const cx = CANVAS_WIDTH * 0.08 + chipRadius + i * (chipRadius * 2 + 6)
    drawNumberChip(ctx, cx, chipY, chipRadius, hot[i]!)
  }
  for (let i = 0; i < cold.length; i++) {
    const cx = CANVAS_WIDTH * 0.92 - chipRadius - i * (chipRadius * 2 + 6)
    drawNumberChip(ctx, cx, chipY, chipRadius, cold[i]!)
  }

  // --- Colour percentages, over the whole history passed in. ---
  let red = 0
  let black = 0
  let green = 0
  for (const n of history) {
    const color = numberColor(n)
    if (color === 'red') red++
    else if (color === 'black') black++
    else green++
  }
  const total = history.length || 1
  const barX = CANVAS_WIDTH * 0.08
  const barWidth = CANVAS_WIDTH * 0.84
  const barHeight = 30
  const barGap = 44
  let barY = chipY + 60
  drawPercentBar(ctx, barX, barY, barWidth, barHeight, 'RED', SCREEN_RED, red / total)
  barY += barGap
  drawPercentBar(ctx, barX, barY, barWidth, barHeight, 'BLK', '#4a4d55', black / total)
  barY += barGap
  drawPercentBar(ctx, barX, barY, barWidth, barHeight, 'GRN', SCREEN_GREEN, green / total)
}

function paintHeader(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, HEADER_CANVAS_WIDTH, HEADER_CANVAS_HEIGHT)
  ctx.fillStyle = '#07080a'
  ctx.fillRect(0, 0, HEADER_CANVAS_WIDTH, HEADER_CANVAS_HEIGHT)
  ctx.save()
  ctx.font = `700 120px ${DISPLAY_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(243, 210, 122, 0.85)'
  ctx.shadowBlur = 26
  ctx.fillStyle = GOLD_BRIGHT
  ctx.fillText('ROULETTE ROYALE', HEADER_CANVAS_WIDTH / 2, HEADER_CANVAS_HEIGHT / 2)
  ctx.restore()
}

export function createToteBoard(): ToteBoard {
  const disposables: Disposable[] = []
  const own = (item: Disposable): void => { disposables.push(item) }

  const group = new THREE.Group()
  group.position.set(TOTE_BOARD_X, 0, TOTE_BOARD_Z)

  const brushedRoughness = makeBrushedMetalRoughness()
  own(brushedRoughness)
  const brushedBump = makeBrushedMetalBump()
  own(brushedBump)
  const steelMaterial = new THREE.MeshStandardMaterial({
    color: STEEL,
    metalness: 1,
    roughness: 0.45,
    roughnessMap: brushedRoughness,
    bumpMap: brushedBump,
    bumpScale: 0.01,
  })
  own(steelMaterial)

  // --- Weighted base ---
  {
    const geometry = new THREE.CylinderGeometry(BASE_TOP_RADIUS, BASE_RADIUS, BASE_HEIGHT, 48)
    const mesh = new THREE.Mesh(geometry, steelMaterial)
    mesh.position.y = BASE_HEIGHT / 2
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    own({ dispose: () => geometry.dispose() })
  }

  // --- Pole ---
  {
    const geometry = new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS * 1.15, poleHeight, 24)
    const mesh = new THREE.Mesh(geometry, steelMaterial)
    mesh.position.y = poleCenterY
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    own({ dispose: () => geometry.dispose() })
  }

  // --- Housing: black gloss, gold trim frame ---
  const housingMaterial = new THREE.MeshPhysicalMaterial({
    color: BLACK_GLOSS,
    roughness: 0.28,
    metalness: 0.15,
    clearcoat: 1,
    clearcoatRoughness: 0.2,
  })
  own(housingMaterial)
  {
    const geometry = new THREE.BoxGeometry(housingWidth, housingTotalHeight, HOUSING_DEPTH)
    const mesh = new THREE.Mesh(geometry, housingMaterial)
    mesh.position.set(0, housingCenterY, 0)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    own({ dispose: () => geometry.dispose() })
  }

  const goldMaterial = new THREE.MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.3 })
  own(goldMaterial)
  {
    const geometry = new THREE.BoxGeometry(
      housingWidth + TRIM_THICKNESS * 2,
      housingTotalHeight + TRIM_THICKNESS * 2,
      TRIM_DEPTH,
    )
    const mesh = new THREE.Mesh(geometry, goldMaterial)
    mesh.position.set(0, housingCenterY, -HOUSING_DEPTH / 2 + TRIM_DEPTH / 2 - 0.02)
    group.add(mesh)
    own({ dispose: () => geometry.dispose() })
  }
  // A thin gold divider between the header plaque and the screen.
  {
    const geometry = new THREE.BoxGeometry(housingWidth, TRIM_THICKNESS * 0.5, TRIM_DEPTH)
    const mesh = new THREE.Mesh(geometry, goldMaterial)
    mesh.position.set(0, housingTopY - HEADER_HEIGHT - HEADER_GAP / 2, HOUSING_DEPTH / 2 - 0.05)
    group.add(mesh)
    own({ dispose: () => geometry.dispose() })
  }

  // --- Header plaque (static) ---
  const headerCanvas = makeCanvas(HEADER_CANVAS_WIDTH, HEADER_CANVAS_HEIGHT)
  paintHeader(headerCanvas.ctx)
  const headerTexture = finishTexture(headerCanvas.canvas)
  own(headerTexture)
  const headerMaterial = new THREE.MeshStandardMaterial({
    map: headerTexture,
    emissiveMap: headerTexture,
    emissive: 0xffffff,
    emissiveIntensity: 1.1,
    roughness: 0.5,
  })
  own(headerMaterial)
  {
    const geometry = new THREE.PlaneGeometry(housingWidth - SCREEN_MARGIN, HEADER_HEIGHT - SCREEN_MARGIN * 0.4)
    const mesh = new THREE.Mesh(geometry, headerMaterial)
    mesh.position.set(0, headerCenterY, HOUSING_DEPTH / 2 + 0.03)
    group.add(mesh)
    own({ dispose: () => geometry.dispose() })
  }

  // --- Screen (dynamic) ---
  const screenCanvas = makeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT)
  paintScreen(screenCanvas.ctx, [], [])
  const screenTexture = finishTexture(screenCanvas.canvas)
  own(screenTexture)
  const screenMaterial = new THREE.MeshStandardMaterial({
    map: screenTexture,
    emissiveMap: screenTexture,
    emissive: 0xffffff,
    emissiveIntensity: 1.3,
    roughness: 0.35,
  })
  own(screenMaterial)
  {
    const geometry = new THREE.PlaneGeometry(SCREEN_WIDTH, SCREEN_HEIGHT)
    const mesh = new THREE.Mesh(geometry, screenMaterial)
    mesh.position.set(0, TOTE_BOARD_SCREEN_Y, HOUSING_DEPTH / 2 + 0.03)
    group.add(mesh)
    own({ dispose: () => geometry.dispose() })
  }

  function setHistory(history: readonly number[], counts: readonly number[]): void {
    paintScreen(screenCanvas.ctx, history, counts)
    screenTexture.needsUpdate = true
  }

  function update(time: number): void {
    const shimmer = Math.sin(time * 1.3) * 0.12
    screenMaterial.emissiveIntensity = 1.3 + shimmer
    headerMaterial.emissiveIntensity = 1.1 + Math.sin(time * 0.9 + 1.4) * 0.15
  }

  function dispose(): void {
    for (const item of disposables) item.dispose()
    disposables.length = 0
  }

  return { group, setHistory, update, dispose }
}
