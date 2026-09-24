/**
 * Builds the three.js scene, camera, renderer and simulation loop for one canvas: the whole
 * playable table. Everything created here (geometries, materials, textures, render targets, the
 * renderer, the composer, the DOM listeners) is disposed by `dispose()`, and nothing is created
 * outside this function, so the returned `EngineApi` is safe to construct and tear down repeatedly
 * (React StrictMode double-invokes it). See `SPEC.md` section D8 for the contract this follows.
 */

import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

import type {
  CameraView,
  EngineApi,
  EngineEvents,
  EngineMode,
  HudHover,
  HudResult,
  HudSnapshot,
  ViewInsets,
} from './engineApi.ts'

import { createCasinoRoom } from './casinoRoom.ts'
import { createTableView } from './tableView.ts'
import { createWheelView } from './wheelView.ts'
import { createToteBoard } from './toteBoard.ts'

import {
  TABLE_HEIGHT,
  TABLE_MAX_X,
  TABLE_MAX_Z,
  TABLE_MIN_X,
  TABLE_MIN_Z,
  WHEEL_BASE_Y,
  WHEEL_CENTER_X,
  WHEEL_CENTER_Z,
  LAYOUT_ORIGIN_X,
  LAYOUT_ORIGIN_Z,
  worldToLayout,
} from './tableGeometry.ts'

import { BOWL_RADIUS, RIM_HEIGHT } from '../game/wheel.ts'
import { LAYOUT_DEPTH, LAYOUT_WIDTH, betAtPoint } from '../game/layout.ts'
import { BET_LIMITS, PAYOUTS, betById, totalStaked } from '../game/bets.ts'
import {
  createSession,
  placeChip as sessionPlaceChip,
  removeBet as sessionRemoveBet,
  undo as sessionUndo,
  clearBets as sessionClearBets,
  rebet as sessionRebet,
  double as sessionDouble,
  beginSpin as sessionBeginSpin,
  settleSpin as sessionSettleSpin,
  refill as sessionRefill,
  isBroke,
  sessionFlags,
  toSave,
} from '../game/session.ts'
import { createWheel, launchBall, stepWheel, relativeSpeed, FIXED_DT } from '../game/physics.ts'
import { spinParamsFromSeed } from '../game/rng.ts'
import { attractBets } from '../game/autoplay.ts'
import type { ChipValue, Session, SessionSave, Transition, WheelEvent, WheelState } from '../game/types.ts'

// -------------------------------------------------------------------------------------------
// Loop timing
// -------------------------------------------------------------------------------------------

/** A frame slower than this is treated as a stall, not a moment to simulate for real. */
const MAX_FRAME_SECONDS = 1 / 20
/** However long a stalled (or quick-spin doubled) frame took, never step physics more than this many times to catch up. */
const MAX_FIXED_STEPS_PER_FRAME = 200
/** Seconds the dealer holds the ball after `beginSpin` before it is actually launched. */
const LAUNCH_DELAY_SECONDS = 0.7
/** Minimum gap between two `fret` sounds, simulated seconds, so a scattering ball does not machine-gun the speaker. */
const FRET_SOUND_MIN_GAP = 0.03
/** A relative ball speed (in/s) that maps to full rolling-sound level and pitch. */
const ROLLING_SPEED_REFERENCE = 220
/** How long the attract table sits with chips down before the wheel spins. */
const ATTRACT_BET_PAUSE_SECONDS = 2.5
/** How long the attract table shows a result before clearing for the next round. */
const ATTRACT_RESULT_PAUSE_SECONDS = 4
/** The attract session refills itself, silently, once its bankroll drops below this. */
const ATTRACT_REFILL_THRESHOLD = 150

// -------------------------------------------------------------------------------------------
// Renderer / post-processing look
// -------------------------------------------------------------------------------------------

const BACKGROUND_COLOR = 0x0b0706
const FOG_DENSITY = 0.0018
const TONE_MAPPING_EXPOSURE = 1.1
const ENVIRONMENT_INTENSITY = 0.5
const BLOOM_STRENGTH = 0.25
const BLOOM_RADIUS = 0.4
const BLOOM_THRESHOLD = 1.0
const SHADOW_MAP_SIZE = 2048

// -------------------------------------------------------------------------------------------
// Lights
// -------------------------------------------------------------------------------------------

/** How far above the felt the two table spotlights hang. */
const PENDANT_HEIGHT_ABOVE_FELT = 50
const LAYOUT_SPOT_INTENSITY = 3.2
const WHEEL_SPOT_INTENSITY = 3
const WHEEL_SPOT_OFFSET_X = 12
const WHEEL_SPOT_OFFSET_Z = 24
const HEMI_SKY_COLOR = 0x2a2014
const HEMI_GROUND_COLOR = 0x05030a
const HEMI_INTENSITY = 0.9
const RIM_LIGHT_COLOR = 0x9fc9ff
const RIM_LIGHT_INTENSITY = 0.32

// -------------------------------------------------------------------------------------------
// Environment capture
// -------------------------------------------------------------------------------------------

const ENVIRONMENT_SOFTBOX_INTENSITY = 2.2
const ENVIRONMENT_FILL_INTENSITY = 0.5

// -------------------------------------------------------------------------------------------
// Camera
// -------------------------------------------------------------------------------------------

const CAMERA_NEAR = 0.4
const CAMERA_FAR = 800
const CAMERA_FOV_DEGREES = 40
/** The settle close-up uses a tighter lens for a more dramatic look at the winning pocket. */
const CLOSEUP_FOV_DEGREES = 24
const FOV_EASE_RATE = 6
const PORTRAIT_ASPECT_THRESHOLD = 0.8
const VIEW_SMOOTH_TIME = 0.6
const MIN_FREE_FRACTION = 0.3
const CAMERA_FIT_MARGIN = 0.04
const FIT_ITERATIONS = 24
const FIT_MIN_EXTRA = 0
const FIT_MAX_EXTRA = 500

const TABLE_VIEW_ELEVATION = toRad(42)
const TABLE_VIEW_BASE_DISTANCE = 78
const WHEEL_VIEW_ELEVATION = toRad(58)
const WHEEL_VIEW_BASE_DISTANCE = 32
const OVERHEAD_BASE_HEIGHT = 140
/** How much of the ball's position the wheel view's look-at drifts toward, once settled or spinning. */
const WHEEL_LOOK_BALL_SHARE = 0.2
/**
 * The settle close-up eye: fixed above the player's side of the wheel, this high above the pocket
 * floor and this far toward the player from the spindle. It pans to follow the ball as the rotor
 * turns rather than orbiting with it, so the shot never swings over the turret.
 */
const CLOSEUP_EYE_HEIGHT = 24
const CLOSEUP_EYE_BACK = 16
/** How long the auto camera's settle close-up holds before returning to the table view. */
const AUTO_CLOSEUP_SECONDS = 2.8

/**
 * Rendering cost steps, best first. The engine starts at the first step a device can likely hold
 * and only ever steps down, when frames stay slow, so a phone never flip-flops between two looks.
 */
const QUALITY_STEPS: { pixelRatio: number; bloom: boolean; shadowMapSize: number }[] = [
  { pixelRatio: 2, bloom: true, shadowMapSize: 2048 },
  { pixelRatio: 1.5, bloom: true, shadowMapSize: 1024 },
  { pixelRatio: 1, bloom: true, shadowMapSize: 1024 },
  { pixelRatio: 1, bloom: false, shadowMapSize: 1024 },
]
/** Touch devices start one step down: their screens are dense and their GPUs are not. */
const TOUCH_START_QUALITY = 1
const SLOW_FRAME_SECONDS = 1 / 38
const SLOW_FRAMES_TO_STEP_DOWN = 90
const QUALITY_SETTLE_FRAMES = 60

// -------------------------------------------------------------------------------------------
// Pointer input
// -------------------------------------------------------------------------------------------

const TAP_MAX_MOVE_PX = 10
const TAP_MAX_MS = 500
const LONG_PRESS_MS = 550

// -------------------------------------------------------------------------------------------
// Small maths helpers
// -------------------------------------------------------------------------------------------

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * One axis of a critically-damped spring toward `target`, in the spirit of Unity's
 * `Mathf.SmoothDamp`: reaches the target smoothly in about `smoothTime` seconds with no overshoot.
 */
function smoothDamp(
  current: number,
  target: number,
  velocity: { v: number },
  smoothTime: number,
  dt: number,
): number {
  const omega = 2 / Math.max(1e-4, smoothTime)
  const x = omega * dt
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const change = current - target
  const temp = (velocity.v + omega * change) * dt
  velocity.v = (velocity.v - omega * temp) * exp
  let output = target + (change + temp) * exp
  if (target - current > 0 === output > target) {
    output = target
    velocity.v = (output - target) / Math.max(1e-4, dt)
  }
  return output
}

function dampVector3(
  current: THREE.Vector3,
  target: THREE.Vector3,
  velocity: { x: { v: number }; y: { v: number }; z: { v: number } },
  smoothTime: number,
  dt: number,
): void {
  current.x = smoothDamp(current.x, target.x, velocity.x, smoothTime, dt)
  current.y = smoothDamp(current.y, target.y, velocity.y, smoothTime, dt)
  current.z = smoothDamp(current.z, target.z, velocity.z, smoothTime, dt)
}

/**
 * Centre of the points' bounding box. Unlike their average, it does not lean toward whichever
 * part of the table has more fit points (the wheel ring has 16, the layout 4), so the camera
 * aims at the middle of what it has to show.
 */
function boundsCenter(points: readonly THREE.Vector3[]): THREE.Vector3 {
  return new THREE.Box3().setFromPoints(points as THREE.Vector3[]).getCenter(new THREE.Vector3())
}

function arraysEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function resultEquals(a: HudResult | null, b: HudResult | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.number === b.number && a.color === b.color && a.staked === b.staked && a.returned === b.returned && a.net === b.net
}

function hoverEquals(a: HudHover | null, b: HudHover | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.betId === b.betId && a.label === b.label && a.payout === b.payout && a.amount === b.amount && a.limit === b.limit
}

function hudEquals(a: HudSnapshot, b: HudSnapshot): boolean {
  return (
    a.phase === b.phase &&
    a.bankroll === b.bankroll &&
    a.totalBet === b.totalBet &&
    a.selectedChip === b.selectedChip &&
    a.canSpin === b.canSpin &&
    a.canUndo === b.canUndo &&
    a.canClear === b.canClear &&
    a.canRebet === b.canRebet &&
    a.canDouble === b.canDouble &&
    a.broke === b.broke &&
    a.spins === b.spins &&
    resultEquals(a.lastResult, b.lastResult) &&
    hoverEquals(a.hover, b.hover) &&
    arraysEqual(a.history, b.history)
  )
}

// -------------------------------------------------------------------------------------------
// Engine
// -------------------------------------------------------------------------------------------

/**
 * Builds and runs the whole table on `canvas`, reporting sound/HUD/message/save events back
 * through `events`. See the module doc comment above.
 */
export function createEngine(canvas: HTMLCanvasElement, events: EngineEvents): EngineApi {
  // --- Renderer / scene -----------------------------------------------------------------------

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  const requestedQuality = new URLSearchParams(window.location.search).get('quality')
  const qualityPinned = requestedQuality === 'high' || requestedQuality === 'low'
  const touchDevice = window.matchMedia('(pointer: coarse)').matches
  let qualityStep =
    requestedQuality === 'high' ? 0
    : requestedQuality === 'low' ? QUALITY_STEPS.length - 1
    : touchDevice ? TOUCH_START_QUALITY
    : 0
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY_STEPS[qualityStep]!.pixelRatio))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(BACKGROUND_COLOR)
  scene.fog = new THREE.FogExp2(BACKGROUND_COLOR, FOG_DENSITY)

  // --- Environment: the room's own glow lights the lacquer and chrome, not a studio softbox -----

  const room = createCasinoRoom()
  const pmremGenerator = new THREE.PMREMGenerator(renderer)
  const environmentScene = new THREE.Scene()
  environmentScene.background = new THREE.Color(BACKGROUND_COLOR)
  const softboxGeometry = new THREE.PlaneGeometry(90, 60)
  const softboxMaterial = new THREE.MeshBasicMaterial({ color: 0xffe9cf, side: THREE.DoubleSide })
  softboxMaterial.color.multiplyScalar(ENVIRONMENT_SOFTBOX_INTENSITY)
  const softbox = new THREE.Mesh(softboxGeometry, softboxMaterial)
  softbox.rotation.x = Math.PI / 2
  softbox.position.set(WHEEL_CENTER_X + 30, TABLE_HEIGHT + 90, 10)
  const environmentFill = new THREE.HemisphereLight(0x8a7550, 0x140a06, ENVIRONMENT_FILL_INTENSITY)
  environmentScene.add(room.group, softbox, environmentFill)
  const environmentTarget = pmremGenerator.fromScene(environmentScene, 0.015, 1, 900, {
    position: new THREE.Vector3(WHEEL_CENTER_X, TABLE_HEIGHT + 30, 0),
  })
  const envMap = environmentTarget.texture
  scene.environment = envMap
  scene.environmentIntensity = ENVIRONMENT_INTENSITY
  environmentScene.remove(room.group, softbox, environmentFill)
  softboxGeometry.dispose()
  softboxMaterial.dispose()
  environmentFill.dispose()
  pmremGenerator.dispose()
  scene.add(room.group)

  // --- Post-processing -------------------------------------------------------------------------

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEGREES, 1, CAMERA_NEAR, CAMERA_FAR)

  const composer = new EffectComposer(renderer)
  const renderPass = new RenderPass(scene, camera)
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD)
  const outputPass = new OutputPass()
  bloomPass.enabled = QUALITY_STEPS[qualityStep]!.bloom
  composer.addPass(renderPass)
  composer.addPass(bloomPass)
  composer.addPass(outputPass)

  // --- Scene content: table, wheel, tote board --------------------------------------------------

  const table = createTableView()
  const wheelView = createWheelView()
  wheelView.group.position.set(WHEEL_CENTER_X, WHEEL_BASE_Y, WHEEL_CENTER_Z)
  const tote = createToteBoard()
  scene.add(table.group, wheelView.group, tote.group)

  // --- Lighting (all point/spot lights decay = 0: the scene is in inches, not metres) -----------

  const layoutFocus = new THREE.Vector3(LAYOUT_ORIGIN_X + LAYOUT_WIDTH / 2, TABLE_HEIGHT, LAYOUT_ORIGIN_Z + LAYOUT_DEPTH / 2)
  const wheelFocus = new THREE.Vector3(WHEEL_CENTER_X, TABLE_HEIGHT, WHEEL_CENTER_Z)
  const pendantY = TABLE_HEIGHT + PENDANT_HEIGHT_ABOVE_FELT

  // The lights hang where a table lamp would; no hood is modelled, since at camera height it
  // would block the view of the layout.

  const layoutSpot = new THREE.SpotLight(0xffdca8, LAYOUT_SPOT_INTENSITY)
  layoutSpot.position.set(layoutFocus.x, pendantY - 3, layoutFocus.z)
  layoutSpot.target.position.copy(layoutFocus)
  layoutSpot.angle = Math.atan2(Math.max(LAYOUT_WIDTH, LAYOUT_DEPTH) * 0.65, PENDANT_HEIGHT_ABOVE_FELT)
  layoutSpot.penumbra = 0.55
  layoutSpot.decay = 0
  layoutSpot.distance = 0
  layoutSpot.castShadow = true
  layoutSpot.shadow.mapSize.setScalar(Math.min(SHADOW_MAP_SIZE, QUALITY_STEPS[qualityStep]!.shadowMapSize))
  layoutSpot.shadow.camera.near = 10
  layoutSpot.shadow.camera.far = PENDANT_HEIGHT_ABOVE_FELT * 2.2
  layoutSpot.shadow.bias = -0.0006
  layoutSpot.shadow.normalBias = 0.02
  scene.add(layoutSpot, layoutSpot.target)

  // Hung toward the player's side of the wheel, not straight above it or behind it. The flat
  // lacquered pocket floor and turret cap mirror a lamp overhead into the overhead camera, and a
  // lamp behind the wheel into the seated one, as a blown-out spot.
  const wheelSpot = new THREE.SpotLight(0xffdca8, WHEEL_SPOT_INTENSITY)
  wheelSpot.position.set(wheelFocus.x - WHEEL_SPOT_OFFSET_X, pendantY - 3, wheelFocus.z + WHEEL_SPOT_OFFSET_Z)
  wheelSpot.target.position.copy(wheelFocus)
  wheelSpot.angle = Math.atan2(BOWL_RADIUS * 1.3, Math.hypot(PENDANT_HEIGHT_ABOVE_FELT, WHEEL_SPOT_OFFSET_X, WHEEL_SPOT_OFFSET_Z))
  wheelSpot.penumbra = 0.55
  wheelSpot.decay = 0
  wheelSpot.distance = 0
  wheelSpot.castShadow = true
  wheelSpot.shadow.mapSize.setScalar(Math.min(SHADOW_MAP_SIZE, QUALITY_STEPS[qualityStep]!.shadowMapSize))
  wheelSpot.shadow.camera.near = 10
  wheelSpot.shadow.camera.far = PENDANT_HEIGHT_ABOVE_FELT * 2.2
  wheelSpot.shadow.bias = -0.0006
  wheelSpot.shadow.normalBias = 0.02
  scene.add(wheelSpot, wheelSpot.target)

  const hemiFill = new THREE.HemisphereLight(HEMI_SKY_COLOR, HEMI_GROUND_COLOR, HEMI_INTENSITY)
  scene.add(hemiFill)

  const rimLight = new THREE.DirectionalLight(RIM_LIGHT_COLOR, RIM_LIGHT_INTENSITY)
  rimLight.position.set(WHEEL_CENTER_X - 10, TABLE_HEIGHT + 70, WHEEL_CENTER_Z - 60)
  scene.add(rimLight)

  // --- Camera fit geometry (static; only the fixed line of sight per view is a function of state) -

  const layoutMinX = LAYOUT_ORIGIN_X
  const layoutMinZ = LAYOUT_ORIGIN_Z
  const layoutMaxX = LAYOUT_ORIGIN_X + LAYOUT_WIDTH
  const layoutMaxZ = LAYOUT_ORIGIN_Z + LAYOUT_DEPTH
  const wheelBowlTopY = WHEEL_BASE_Y + RIM_HEIGHT
  const wheelBowlBottomY = TABLE_HEIGHT

  function bowlRingPoints(y: number): THREE.Vector3[] {
    const points: THREE.Vector3[] = []
    const segments = 8
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2
      points.push(new THREE.Vector3(WHEEL_CENTER_X + Math.cos(a) * BOWL_RADIUS, y, WHEEL_CENTER_Z + Math.sin(a) * BOWL_RADIUS))
    }
    return points
  }

  const wheelBowlFitPoints: THREE.Vector3[] = [...bowlRingPoints(wheelBowlBottomY), ...bowlRingPoints(wheelBowlTopY)]
  const tableWheelFocusFitPoints: THREE.Vector3[] = [
    new THREE.Vector3(layoutMinX, TABLE_HEIGHT, layoutMinZ),
    new THREE.Vector3(layoutMaxX, TABLE_HEIGHT, layoutMinZ),
    new THREE.Vector3(layoutMinX, TABLE_HEIGHT, layoutMaxZ),
    new THREE.Vector3(layoutMaxX, TABLE_HEIGHT, layoutMaxZ),
    ...wheelBowlFitPoints,
  ]
  const tableFootprintFitPoints: THREE.Vector3[] = [
    new THREE.Vector3(TABLE_MIN_X, TABLE_HEIGHT, TABLE_MIN_Z),
    new THREE.Vector3(TABLE_MAX_X, TABLE_HEIGHT, TABLE_MIN_Z),
    new THREE.Vector3(TABLE_MIN_X, TABLE_HEIGHT, TABLE_MAX_Z),
    new THREE.Vector3(TABLE_MAX_X, TABLE_HEIGHT, TABLE_MAX_Z),
  ]

  const TABLE_WHEEL_FOCUS_CENTER = boundsCenter(tableWheelFocusFitPoints)
  const TABLE_CENTER = new THREE.Vector3((TABLE_MIN_X + TABLE_MAX_X) / 2, TABLE_HEIGHT, (TABLE_MIN_Z + TABLE_MAX_Z) / 2)
  const WHEEL_LOOK_TARGET = new THREE.Vector3(WHEEL_CENTER_X, WHEEL_BASE_Y + 2, WHEEL_CENTER_Z)
  const OVERHEAD_UP_LANDSCAPE = new THREE.Vector3(0, 0, -1)
  const OVERHEAD_UP_PORTRAIT = new THREE.Vector3(1, 0, 0)
  const CLOSEUP_EYE = new THREE.Vector3(WHEEL_CENTER_X, WHEEL_BASE_Y + CLOSEUP_EYE_HEIGHT, WHEEL_CENTER_Z + CLOSEUP_EYE_BACK)

  type ResolvedView = 'table' | 'wheel' | 'overhead' | 'closeup'
  type FitView = 'table' | 'wheel' | 'overhead'

  // --- Session / physics state -------------------------------------------------------------------

  let mode: EngineMode = 'attract'
  let session: Session = createSession(null)
  let wheel: WheelState = createWheel()
  let selectedChip: ChipValue = 5
  let quickSpin = false
  let paused = false
  let cameraView: CameraView = 'auto'

  let launchTimer: number | null = null
  let lastFretSoundTime = -Infinity
  let lastRollLevel = 0
  let lastRollPitch = 0
  let showingResult = false
  let previousPhase = session.phase
  let resultElapsed = 0
  let simTime = 0

  type AttractStep = 'placing' | 'waiting' | 'spinning' | 'result'
  let attractStep: AttractStep = 'placing'
  let attractTimer = 0
  let attractSeedCounter = Date.now() >>> 0

  let hoveredBetId: string | null = null
  let lastHud: HudSnapshot | null = null

  // --- Command execution ---------------------------------------------------------------------

  /** Applies a session `Transition`: adopts its new session, runs its commands (unless `silent`, as in attract mode), and syncs the table's chips. */
  function applyTransition(t: Transition, silent: boolean): void {
    session = t.session
    for (const command of t.commands) {
      switch (command.type) {
        case 'sound':
          if (!silent) events.onSound(command.name, 1)
          break
        case 'message':
          if (!silent) events.onMessage(command.text, command.seconds)
          break
        case 'save':
          if (!silent) events.onSave(toSave(session))
          break
      }
    }
    table.setBets(session.bets)
  }

  /** The first betting action after a result clears the dolly, the winning highlight and the winnings display. */
  function beginAction(): void {
    if (showingResult) {
      table.showResult(null)
      wheelView.highlightPocket(null)
      showingResult = false
    }
  }

  function clearLongPressTimer(): void {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
  }

  function resetDisplayState(): void {
    table.showResult(null)
    wheelView.highlightPocket(null)
    table.setHover(null)
    hoveredBetId = null
    canvas.style.cursor = ''
    showingResult = false
    resultElapsed = 0
    previousPhase = session.phase
    launchTimer = null
    clearLongPressTimer()
    pointerDownInfo = null
  }

  // --- Game lifecycle --------------------------------------------------------------------------

  function beginPlay(save: SessionSave | null): void {
    mode = 'play'
    session = createSession(save)
    wheel = createWheel()
    resetDisplayState()
    table.setBets(session.bets)
    tote.setHistory(session.history, session.stats.counts)
    lastHud = null
  }

  function nextAttractSeed(): number {
    attractSeedCounter = (attractSeedCounter + 0x9e3779b9) >>> 0
    return attractSeedCounter
  }

  function placeAttractBets(): void {
    const bets = attractBets(nextAttractSeed(), session.bankroll)
    for (const [betId, amount] of Object.entries(bets)) {
      applyTransition(sessionPlaceChip(session, betId, amount), true)
    }
    attractStep = 'waiting'
    attractTimer = ATTRACT_BET_PAUSE_SECONDS
  }

  function beginAttract(): void {
    mode = 'attract'
    session = createSession(null)
    wheel = createWheel()
    resetDisplayState()
    table.setBets(session.bets)
    tote.setHistory(session.history, session.stats.counts)
    attractStep = 'placing'
    attractTimer = 0
    placeAttractBets()
  }

  function drawSeed(): number {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      return crypto.getRandomValues(new Uint32Array(1))[0]
    }
    return Math.floor(Math.random() * 0xffffffff) >>> 0
  }

  function doSpin(): void {
    beginAction()
    applyTransition(sessionBeginSpin(session), mode !== 'play')
    if (session.phase === 'spinning') launchTimer = LAUNCH_DELAY_SECONDS
  }

  function handleSettle(pocket: number, number: number): void {
    applyTransition(sessionSettleSpin(session, number), mode !== 'play')
    table.showResult(session.lastResult)
    wheelView.highlightPocket(pocket)
    tote.setHistory(session.history, session.stats.counts)
    showingResult = true
    if (mode === 'attract') {
      attractStep = 'result'
      attractTimer = ATTRACT_RESULT_PAUSE_SECONDS
      if (session.bankroll < ATTRACT_REFILL_THRESHOLD) applyTransition(sessionRefill(session), true)
    }
  }

  function handleWheelEvent(event: WheelEvent): void {
    switch (event.type) {
      case 'diamond':
        if (mode === 'play') events.onSound('diamond', event.intensity)
        break
      case 'fret':
        if (wheel.time - lastFretSoundTime >= FRET_SOUND_MIN_GAP) {
          lastFretSoundTime = wheel.time
          if (mode === 'play') events.onSound('fret', event.intensity)
        }
        break
      case 'rim':
        if (mode === 'play') events.onSound('rim', event.intensity)
        break
      case 'drop':
        if (mode === 'play') events.onSound('drop', 1)
        break
      case 'pocketDrop':
        if (mode === 'play') events.onSound('pocketDrop', event.intensity)
        break
      case 'settle':
        handleSettle(event.pocket, event.number)
        break
    }
  }

  function fixedStep(dt: number): void {
    for (const event of stepWheel(wheel, dt)) handleWheelEvent(event)
  }

  function updateRollingSound(): void {
    if (mode !== 'play') return
    const active = wheel.ball !== null
    const speed = active ? Math.abs(relativeSpeed(wheel)) : 0
    const level = active ? clamp01(speed / ROLLING_SPEED_REFERENCE) : 0
    const pitch = active ? clamp01(speed / ROLLING_SPEED_REFERENCE) : 0
    const levelChanged = Math.abs(level - lastRollLevel) > 0.02 || (level === 0 && lastRollLevel !== 0)
    const pitchChanged = Math.abs(pitch - lastRollPitch) > 0.02 || (pitch === 0 && lastRollPitch !== 0)
    if (levelChanged || pitchChanged) {
      lastRollLevel = level
      lastRollPitch = pitch
      events.onRolling(level, pitch)
    }
  }

  // --- Camera rig ----------------------------------------------------------------------------

  const probeCamera = new THREE.PerspectiveCamera(CAMERA_FOV_DEGREES, 1, CAMERA_NEAR, CAMERA_FAR)
  const projectedScratch = new THREE.Vector3()
  const rigEyeScratch = new THREE.Vector3()
  const rigLookScratch = new THREE.Vector3()
  const rigUpScratch = new THREE.Vector3(0, 1, 0)
  const ballWorldScratch = new THREE.Vector3()

  const fitExtra: Record<FitView, number> = { table: 0, wheel: 0, overhead: 0 }

  let insets: ViewInsets = { left: 0, top: 0, right: 0, bottom: 0 }
  let aspect = 1

  const cameraPosition = new THREE.Vector3()
  const cameraLookAt = new THREE.Vector3()
  const cameraUp = new THREE.Vector3(0, 1, 0)
  const cameraPositionVelocity = { x: { v: 0 }, y: { v: 0 }, z: { v: 0 } }
  const cameraLookAtVelocity = { x: { v: 0 }, y: { v: 0 }, z: { v: 0 } }
  let cameraInitialized = false

  function isPortrait(): boolean {
    return aspect < PORTRAIT_ASPECT_THRESHOLD
  }

  function resolveView(): ResolvedView {
    if (cameraView !== 'auto') return cameraView
    if (session.phase === 'spinning') return 'wheel'
    if (session.phase === 'result' && resultElapsed < AUTO_CLOSEUP_SECONDS) return 'closeup'
    return 'table'
  }

  function viewFov(view: ResolvedView): number {
    return view === 'closeup' ? CLOSEUP_FOV_DEGREES : CAMERA_FOV_DEGREES
  }

  /** Fills the rig scratch vectors with the un-pulled-back, fixed line of sight for `view`. */
  function buildRig(view: FitView, portrait: boolean): void {
    if (view === 'wheel') {
      rigLookScratch.copy(WHEEL_LOOK_TARGET)
      rigEyeScratch.set(
        WHEEL_CENTER_X,
        WHEEL_LOOK_TARGET.y + Math.sin(WHEEL_VIEW_ELEVATION) * WHEEL_VIEW_BASE_DISTANCE,
        WHEEL_CENTER_Z + Math.cos(WHEEL_VIEW_ELEVATION) * WHEEL_VIEW_BASE_DISTANCE,
      )
      rigUpScratch.set(0, 1, 0)
      return
    }
    if (view === 'overhead') {
      rigLookScratch.copy(TABLE_CENTER)
      rigEyeScratch.set(TABLE_CENTER.x, TABLE_CENTER.y + OVERHEAD_BASE_HEIGHT, TABLE_CENTER.z)
      rigUpScratch.copy(portrait ? OVERHEAD_UP_PORTRAIT : OVERHEAD_UP_LANDSCAPE)
      return
    }
    // 'table': a seated 3/4 view in landscape; a large rotated overhead of the layout and wheel in
    // portrait, so the numbers stay big enough to tap.
    if (portrait) {
      rigLookScratch.copy(TABLE_WHEEL_FOCUS_CENTER)
      rigEyeScratch.set(TABLE_WHEEL_FOCUS_CENTER.x, TABLE_WHEEL_FOCUS_CENTER.y + OVERHEAD_BASE_HEIGHT, TABLE_WHEEL_FOCUS_CENTER.z)
      rigUpScratch.copy(OVERHEAD_UP_PORTRAIT)
      return
    }
    rigLookScratch.copy(TABLE_WHEEL_FOCUS_CENTER)
    rigEyeScratch.set(
      TABLE_WHEEL_FOCUS_CENTER.x,
      TABLE_WHEEL_FOCUS_CENTER.y + Math.sin(TABLE_VIEW_ELEVATION) * TABLE_VIEW_BASE_DISTANCE,
      TABLE_WHEEL_FOCUS_CENTER.z + Math.cos(TABLE_VIEW_ELEVATION) * TABLE_VIEW_BASE_DISTANCE,
    )
    rigUpScratch.set(0, 1, 0)
  }

  function pullBackScratch(extra: number): void {
    if (extra <= 0) return
    const dx = rigEyeScratch.x - rigLookScratch.x
    const dy = rigEyeScratch.y - rigLookScratch.y
    const dz = rigEyeScratch.z - rigLookScratch.z
    const length = Math.hypot(dx, dy, dz)
    if (length < 1e-6) return
    const scale = (length + extra) / length
    rigEyeScratch.set(rigLookScratch.x + dx * scale, rigLookScratch.y + dy * scale, rigLookScratch.z + dz * scale)
  }

  function cornersFit(points: readonly THREE.Vector3[], limitX: number, limitY: number): boolean {
    probeCamera.updateMatrixWorld(true)
    probeCamera.updateProjectionMatrix()
    return points.every((corner) => {
      projectedScratch.copy(corner).project(probeCamera)
      return Math.abs(projectedScratch.x) <= limitX && Math.abs(projectedScratch.y) <= limitY
    })
  }

  function fitPointsFor(view: FitView): readonly THREE.Vector3[] {
    if (view === 'wheel') return wheelBowlFitPoints
    if (view === 'overhead') return tableFootprintFitPoints
    return tableWheelFocusFitPoints
  }

  /** Binary-searches the pull-back distance for `view` so its fit points project inside the canvas minus `insets`. */
  function fitView(view: FitView): number {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return fitExtra[view]

    const freeX = Math.max(MIN_FREE_FRACTION, (width - insets.left - insets.right) / width)
    const freeY = Math.max(MIN_FREE_FRACTION, (height - insets.top - insets.bottom) / height)
    const limitX = freeX * (1 - CAMERA_FIT_MARGIN)
    const limitY = freeY * (1 - CAMERA_FIT_MARGIN)
    const portrait = isPortrait()
    const points = fitPointsFor(view)

    probeCamera.fov = CAMERA_FOV_DEGREES
    probeCamera.aspect = aspect
    probeCamera.near = CAMERA_NEAR
    probeCamera.far = CAMERA_FAR

    function fits(extra: number): boolean {
      buildRig(view, portrait)
      pullBackScratch(extra)
      probeCamera.position.copy(rigEyeScratch)
      probeCamera.up.copy(rigUpScratch)
      probeCamera.lookAt(rigLookScratch)
      return cornersFit(points, limitX, limitY)
    }

    let lo = FIT_MIN_EXTRA
    let hi = FIT_MAX_EXTRA
    if (!fits(hi)) return hi
    for (let i = 0; i < FIT_ITERATIONS; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) hi = mid
      else lo = mid
    }
    return hi
  }

  function refitAllViews(): void {
    fitExtra.table = fitView('table')
    fitExtra.wheel = fitView('wheel')
    fitExtra.overhead = fitView('overhead')
  }

  function applyViewOffset(): void {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    camera.setViewOffset(
      width,
      height,
      -(insets.left - insets.right) / 2,
      -(insets.top - insets.bottom) / 2,
      width,
      height,
    )
  }

  function updateCamera(dt: number): void {
    const portrait = isPortrait()
    const resolved = resolveView()

    if (resolved === 'closeup' && wheelView.ballWorldPosition(ballWorldScratch)) {
      rigLookScratch.copy(ballWorldScratch)
      rigEyeScratch.copy(CLOSEUP_EYE)
      rigUpScratch.set(0, 1, 0)
    } else {
      const fitView: FitView = resolved === 'closeup' ? 'table' : resolved
      buildRig(fitView, portrait)
      pullBackScratch(fitExtra[fitView])
      if (fitView === 'wheel' && wheelView.ballWorldPosition(ballWorldScratch)) {
        rigLookScratch.lerp(ballWorldScratch, WHEEL_LOOK_BALL_SHARE)
      }
    }

    if (!cameraInitialized) {
      cameraPosition.copy(rigEyeScratch)
      cameraLookAt.copy(rigLookScratch)
      cameraUp.copy(rigUpScratch)
      cameraInitialized = true
    } else {
      dampVector3(cameraPosition, rigEyeScratch, cameraPositionVelocity, VIEW_SMOOTH_TIME, dt)
      dampVector3(cameraLookAt, rigLookScratch, cameraLookAtVelocity, VIEW_SMOOTH_TIME, dt)
      cameraUp.copy(rigUpScratch)
    }

    const targetFov = viewFov(resolved)
    if (dt > 0 && Math.abs(camera.fov - targetFov) > 0.01) {
      camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-FOV_EASE_RATE * dt))
      camera.updateProjectionMatrix()
    }

    camera.position.copy(cameraPosition)
    camera.up.copy(cameraUp)
    camera.lookAt(cameraLookAt)
  }

  // --- HUD -------------------------------------------------------------------------------------

  function buildHud(): HudSnapshot {
    const flags = sessionFlags(session)
    let hover: HudHover | null = null
    if (hoveredBetId) {
      const bet = betById(hoveredBetId)
      if (bet) {
        hover = {
          betId: hoveredBetId,
          label: bet.label,
          payout: PAYOUTS[bet.kind],
          amount: session.bets[hoveredBetId] ?? 0,
          limit: BET_LIMITS[bet.kind],
        }
      }
    }
    const lastResult: HudResult | null = session.lastResult
      ? {
          number: session.lastResult.number,
          color: session.lastResult.color,
          staked: session.lastResult.staked,
          returned: session.lastResult.returned,
          net: session.lastResult.net,
        }
      : null
    return {
      phase: session.phase,
      bankroll: session.bankroll,
      totalBet: totalStaked(session.bets),
      selectedChip,
      lastResult,
      history: session.history.slice(0, 20),
      hover,
      canSpin: flags.canSpin,
      canUndo: flags.canUndo,
      canClear: flags.canClear,
      canRebet: flags.canRebet,
      canDouble: flags.canDouble,
      broke: isBroke(session),
      spins: session.stats.spins,
    }
  }

  function updateHud(): void {
    if (mode !== 'play') return
    const next = buildHud()
    if (!lastHud || !hudEquals(lastHud, next)) {
      lastHud = next
      events.onHud(next)
    }
  }

  // --- Pointer input (play mode, not spinning) --------------------------------------------------

  const raycaster = new THREE.Raycaster()
  const pointerNdc = new THREE.Vector2()
  const feltPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_HEIGHT)
  const feltHit = new THREE.Vector3()

  let pointerDownInfo: { x: number; y: number; time: number; pointerId: number } | null = null
  let longPressTimer: ReturnType<typeof setTimeout> | null = null

  function pointerActive(): boolean {
    return mode === 'play' && session.phase !== 'spinning'
  }

  function pointerToBet(clientX: number, clientY: number): string | null {
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    pointerNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1))
    raycaster.setFromCamera(pointerNdc, camera)
    if (!raycaster.ray.intersectPlane(feltPlane, feltHit)) return null
    const { u, v } = worldToLayout(feltHit.x, feltHit.z)
    try {
      return betAtPoint(u, v)
    } catch {
      return null
    }
  }

  function setHover(betId: string | null): void {
    if (betId === hoveredBetId) return
    hoveredBetId = betId
    table.setHover(betId)
    canvas.style.cursor = betId ? 'pointer' : ''
  }

  function removeBetAt(clientX: number, clientY: number): void {
    const betId = pointerToBet(clientX, clientY)
    if (!betId) return
    beginAction()
    applyTransition(sessionRemoveBet(session, betId), mode !== 'play')
    navigator.vibrate?.(15)
  }

  function handlePointerMove(e: PointerEvent): void {
    if (!pointerActive()) {
      setHover(null)
      return
    }
    setHover(pointerToBet(e.clientX, e.clientY))
  }

  function handlePointerDown(e: PointerEvent): void {
    if (!pointerActive() || e.button !== 0) return
    clearLongPressTimer()
    pointerDownInfo = { x: e.clientX, y: e.clientY, time: performance.now(), pointerId: e.pointerId }
    const { clientX, clientY } = e
    longPressTimer = setTimeout(() => {
      longPressTimer = null
      pointerDownInfo = null
      if (pointerActive()) removeBetAt(clientX, clientY)
    }, LONG_PRESS_MS)
  }

  function handlePointerUp(e: PointerEvent): void {
    const info = pointerDownInfo
    if (!info || info.pointerId !== e.pointerId) return
    clearLongPressTimer()
    pointerDownInfo = null
    if (!pointerActive()) return
    const moved = Math.hypot(e.clientX - info.x, e.clientY - info.y)
    const elapsed = performance.now() - info.time
    if (moved < TAP_MAX_MOVE_PX && elapsed < TAP_MAX_MS) {
      const betId = pointerToBet(e.clientX, e.clientY)
      if (betId) {
        beginAction()
        applyTransition(sessionPlaceChip(session, betId, selectedChip), mode !== 'play')
      }
    }
  }

  function handlePointerLeave(): void {
    clearLongPressTimer()
    pointerDownInfo = null
    setHover(null)
  }

  function handleContextMenu(e: MouseEvent): void {
    e.preventDefault()
    if (!pointerActive()) return
    removeBetAt(e.clientX, e.clientY)
  }

  canvas.addEventListener('pointermove', handlePointerMove)
  canvas.addEventListener('pointerdown', handlePointerDown)
  canvas.addEventListener('pointerup', handlePointerUp)
  canvas.addEventListener('pointercancel', handlePointerLeave)
  canvas.addEventListener('pointerleave', handlePointerLeave)
  canvas.addEventListener('contextmenu', handleContextMenu)

  // --- Resize ------------------------------------------------------------------------------------

  function handleResize(): void {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    renderer.setSize(width, height, false)
    composer.setSize(width, height)
    aspect = width / height
    camera.aspect = aspect
    camera.clearViewOffset()
    camera.updateProjectionMatrix()
    refitAllViews()
    applyViewOffset()
  }

  const resizeObserver = new ResizeObserver(() => handleResize())
  resizeObserver.observe(canvas)
  handleResize()

  // --- Visibility: drop accumulated time instead of a catch-up burst -----------------------------

  let wasHidden = document.visibilityState === 'hidden'

  function handleVisibilityChange(): void {
    const hidden = document.visibilityState === 'hidden'
    if (hidden && !wasHidden) accumulator = 0
    wasHidden = hidden
  }
  document.addEventListener('visibilitychange', handleVisibilityChange)

  // --- Main loop -----------------------------------------------------------------------------

  let rafId = 0
  let lastFrameTime = 0
  let hasLastFrameTime = false
  let accumulator = 0

  let smoothedFrameSeconds = 0
  let slowFrames = 0
  let settleFrames = QUALITY_SETTLE_FRAMES

  function applyQualityStep(): void {
    const step = QUALITY_STEPS[qualityStep]!
    const pixelRatio = Math.min(window.devicePixelRatio, step.pixelRatio)
    renderer.setPixelRatio(pixelRatio)
    composer.setPixelRatio(pixelRatio)
    bloomPass.enabled = step.bloom
    layoutSpot.shadow.mapSize.setScalar(Math.min(SHADOW_MAP_SIZE, step.shadowMapSize))
    wheelSpot.shadow.mapSize.setScalar(Math.min(SHADOW_MAP_SIZE, step.shadowMapSize))
    handleResize()
  }

  function watchFrameRate(frameSeconds: number): void {
    if (qualityPinned || qualityStep >= QUALITY_STEPS.length - 1) return
    if (settleFrames > 0) {
      settleFrames--
      smoothedFrameSeconds = frameSeconds
      return
    }
    smoothedFrameSeconds += (frameSeconds - smoothedFrameSeconds) * 0.1
    slowFrames = smoothedFrameSeconds > SLOW_FRAME_SECONDS ? slowFrames + 1 : 0
    if (slowFrames < SLOW_FRAMES_TO_STEP_DOWN) return
    qualityStep++
    slowFrames = 0
    settleFrames = QUALITY_SETTLE_FRAMES
    applyQualityStep()
  }

  function stepAttract(dt: number): void {
    if (mode !== 'attract') return
    if (attractStep === 'waiting') {
      attractTimer -= dt
      if (attractTimer <= 0) {
        attractTimer = 0
        attractStep = 'spinning'
        doSpin()
      }
    } else if (attractStep === 'result') {
      attractTimer -= dt
      if (attractTimer <= 0) {
        attractTimer = 0
        beginAction()
        applyTransition(sessionClearBets(session), true)
        attractStep = 'placing'
        placeAttractBets()
      }
    }
  }

  function animate(now: number): void {
    rafId = requestAnimationFrame(animate)
    if (!hasLastFrameTime) {
      hasLastFrameTime = true
      lastFrameTime = now
      return
    }
    const frameSeconds = (now - lastFrameTime) / 1000
    const dt = Math.min(MAX_FRAME_SECONDS, frameSeconds)
    lastFrameTime = now

    const hidden = document.visibilityState === 'hidden'
    if (!paused && !hidden) {
      const speedFactor = quickSpin ? 2 : 1

      if (launchTimer !== null) {
        launchTimer -= dt * speedFactor
        if (launchTimer <= 0) {
          launchTimer = null
          launchBall(wheel, spinParamsFromSeed(drawSeed()))
          lastFretSoundTime = -Infinity
          if (mode === 'play') events.onSound('launch', 1)
        }
      }

      stepAttract(dt)

      accumulator += dt * speedFactor
      let steps = 0
      while (accumulator >= FIXED_DT && steps < MAX_FIXED_STEPS_PER_FRAME) {
        fixedStep(FIXED_DT)
        accumulator -= FIXED_DT
        steps++
      }
      if (steps === MAX_FIXED_STEPS_PER_FRAME) accumulator = 0
    } else if (hidden) {
      accumulator = 0
    }

    if (session.phase !== previousPhase) {
      if (session.phase === 'result') resultElapsed = 0
      if (session.phase === 'spinning') setHover(null)
      previousPhase = session.phase
    }
    if (session.phase === 'result' && !paused) resultElapsed += dt

    if (!hidden) watchFrameRate(frameSeconds)
    if (!paused) updateRollingSound()

    if (!paused) simTime += dt
    room.update(simTime)
    table.update(paused ? 0 : dt, simTime)
    wheelView.update(wheel, paused ? 0 : dt)
    tote.update(simTime)

    updateCamera(paused ? 0 : dt)
    updateHud()

    composer.render()
  }
  // Starts only now: attract mode touches pointer and camera state declared above.
  beginAttract()
  rafId = requestAnimationFrame(animate)

  // --- Public API --------------------------------------------------------------------------------

  return {
    startSession(save: SessionSave | null): void {
      beginPlay(save)
    },

    showAttract(): void {
      beginAttract()
    },

    selectChip(value: ChipValue): void {
      selectedChip = value
    },

    placeChip(betId: string): void {
      beginAction()
      applyTransition(sessionPlaceChip(session, betId, selectedChip), mode !== 'play')
    },

    spin(): void {
      doSpin()
    },

    undo(): void {
      beginAction()
      applyTransition(sessionUndo(session), mode !== 'play')
    },

    clearBets(): void {
      beginAction()
      applyTransition(sessionClearBets(session), mode !== 'play')
    },

    rebet(): void {
      beginAction()
      applyTransition(sessionRebet(session), mode !== 'play')
    },

    double(): void {
      beginAction()
      applyTransition(sessionDouble(session), mode !== 'play')
    },

    refill(): void {
      applyTransition(sessionRefill(session), mode !== 'play')
    },

    setCameraView(view: CameraView): void {
      cameraView = view
    },

    setQuickSpin(on: boolean): void {
      quickSpin = on
    },

    setViewInsets(next: ViewInsets): void {
      const clean = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0)
      insets = { left: clean(next.left), top: clean(next.top), right: clean(next.right), bottom: clean(next.bottom) }
      refitAllViews()
      applyViewOffset()
    },

    setPaused(next: boolean): void {
      paused = next
    },

    resize(): void {
      handleResize()
    },

    dispose(): void {
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointerup', handlePointerUp)
      canvas.removeEventListener('pointercancel', handlePointerLeave)
      canvas.removeEventListener('pointerleave', handlePointerLeave)
      canvas.removeEventListener('contextmenu', handleContextMenu)
      clearLongPressTimer()

      table.dispose()
      wheelView.dispose()
      tote.dispose()
      room.dispose()


      renderPass.dispose()
      bloomPass.dispose()
      outputPass.dispose()
      composer.dispose()
      environmentTarget.dispose()
      renderer.dispose()
    },
  }
}
