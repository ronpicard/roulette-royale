import type { PocketColor } from './types.ts'

/**
 * The geometry of a European single-zero wheel, in inches and radians. The wheel plane is seen
 * from above with the spindle at the origin; angles run counter-clockwise from `+x`. Heights are
 * measured up from the pocket floor.
 *
 * Going out from the spindle: the turret cone, the pockets separated by frets, the number ring
 * (the sloped outer edge of the rotor), the stator cone with its eight diamonds, the ball track,
 * and the rim of the wooden bowl.
 */

/** The numbers in wheel order, clockwise as printed on a real European wheel. Index 0 is the zero pocket. */
export const WHEEL_ORDER: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31,
  9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
]

export const POCKET_COUNT = 37
/** Angle each pocket spans, radians. */
export const POCKET_ANGLE = (2 * Math.PI) / POCKET_COUNT

const RED_NUMBERS: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
])

export const BALL_RADIUS = 0.4

/** Foot of the turret cone and inner edge of the pockets. */
export const POCKET_INNER_RADIUS = 6.9
/** Outer edge of the pockets, where the number ring steps down into them. */
export const POCKET_OUTER_RADIUS = 8.6
/** Outer edge of the rotor (and of the number ring). */
export const ROTOR_RADIUS = 10.8
/** Radius of the centre of each diamond on the stator. */
export const DIAMOND_RADIUS = 12.0
/** Inner edge of the ball track. */
export const TRACK_INNER_RADIUS = 13.3
/** Inner face of the rim wall the ball rides against. */
export const TRACK_RADIUS = 14.5
/** Outer edge of the wooden bowl. */
export const BOWL_RADIUS = 16.5
/** Height of the top of the rim wall. */
export const RIM_HEIGHT = 3.3
/** Radius at which the turret's spindle cap sits; the ball never reaches it. */
export const TURRET_RADIUS = 3.2

/** Height of the step from the number ring down into the pockets. */
export const LIP_HEIGHT = 0.35
/** Height of the frets above the pocket floor. A ball hopping higher than this passes over them. */
export const FRET_HEIGHT = 0.3
/** Half the thickness of a fret, as a collision radius. */
export const FRET_HALF_THICKNESS = 0.06

/** Slope (rise per inch outward) of each band of the wheel. */
export const TURRET_SLOPE = 0.8
export const NUMBER_RING_SLOPE = 0.3
export const STATOR_SLOPE = 0.52
export const TRACK_SLOPE = 0.25

const RING_TOP = LIP_HEIGHT + (ROTOR_RADIUS - POCKET_OUTER_RADIUS) * NUMBER_RING_SLOPE
const STATOR_TOP = RING_TOP + (TRACK_INNER_RADIUS - ROTOR_RADIUS) * STATOR_SLOPE

export type DiamondOrientation = 'vertical' | 'horizontal'

export interface Diamond {
  /** Angle of the diamond's centre on the stator, radians. */
  angle: number
  /** 'vertical' diamonds point along the radius, 'horizontal' ones lie along the track. */
  orientation: DiamondOrientation
  /** End points of the diamond's long axis in the wheel plane. */
  a: { x: number; y: number }
  b: { x: number; y: number }
}

export const DIAMOND_COUNT = 8
/** Half the length of a diamond's long axis. */
export const DIAMOND_HALF_LENGTH = 0.45
/** Half the thickness of a diamond, as a collision radius. */
export const DIAMOND_HALF_THICKNESS = 0.16
/** Height of a diamond above the stator. A ball hopping higher than this passes over it. */
export const DIAMOND_HEIGHT = 0.4

/** The eight diamonds, alternating vertical and horizontal, the first at 22.5 degrees. */
export const DIAMONDS: readonly Diamond[] = Array.from({ length: DIAMOND_COUNT }, (_, i) => {
  const angle = ((i + 0.5) * 2 * Math.PI) / DIAMOND_COUNT
  const orientation: DiamondOrientation = i % 2 === 0 ? 'vertical' : 'horizontal'
  const cx = DIAMOND_RADIUS * Math.cos(angle)
  const cy = DIAMOND_RADIUS * Math.sin(angle)
  // Unit vector of the long axis: radial for vertical diamonds, tangential for horizontal ones.
  const ux = orientation === 'vertical' ? Math.cos(angle) : -Math.sin(angle)
  const uy = orientation === 'vertical' ? Math.sin(angle) : Math.cos(angle)
  return {
    angle,
    orientation,
    a: { x: cx - ux * DIAMOND_HALF_LENGTH, y: cy - uy * DIAMOND_HALF_LENGTH },
    b: { x: cx + ux * DIAMOND_HALF_LENGTH, y: cy + uy * DIAMOND_HALF_LENGTH },
  }
})

/** Height of the surface at radius `r`, measured up from the pocket floor. */
export function surfaceHeight(r: number): number {
  if (r < POCKET_INNER_RADIUS) return (POCKET_INNER_RADIUS - r) * TURRET_SLOPE
  if (r < POCKET_OUTER_RADIUS) return 0
  if (r < ROTOR_RADIUS) return LIP_HEIGHT + (r - POCKET_OUTER_RADIUS) * NUMBER_RING_SLOPE
  if (r < TRACK_INNER_RADIUS) return RING_TOP + (r - ROTOR_RADIUS) * STATOR_SLOPE
  const clamped = Math.min(r, TRACK_RADIUS)
  return STATOR_TOP + (clamped - TRACK_INNER_RADIUS) * TRACK_SLOPE
}

/** Rise of the surface per inch outward at radius `r`. Negative on the turret, which slopes down outward. */
export function surfaceSlope(r: number): number {
  if (r < POCKET_INNER_RADIUS) return -TURRET_SLOPE
  if (r < POCKET_OUTER_RADIUS) return 0
  if (r < ROTOR_RADIUS) return NUMBER_RING_SLOPE
  if (r < TRACK_INNER_RADIUS) return STATOR_SLOPE
  return TRACK_SLOPE
}

/** True for radii on the rotor (which turns), false for the stator and track (which do not). */
export function isOnRotor(r: number): boolean {
  return r < ROTOR_RADIUS
}

export function numberColor(number: number): PocketColor {
  if (number === 0) return 'green'
  return RED_NUMBERS.has(number) ? 'red' : 'black'
}

/** The number in pocket `index` (0 to 36, wheel order). */
export function pocketNumber(index: number): number {
  return WHEEL_ORDER[((index % POCKET_COUNT) + POCKET_COUNT) % POCKET_COUNT]!
}

/** The wheel-order index of the pocket holding `number`. */
export function pocketIndexOfNumber(number: number): number {
  return WHEEL_ORDER.indexOf(number)
}

/**
 * Wheel-plane angle of the centre of pocket `index` for a rotor at `rotorAngle`. Index order
 * runs clockwise seen from above, like the numbers on a real wheel, so the angle decreases with
 * the index. `pocketAtAngle` is the inverse.
 */
export function pocketCentreAngle(index: number, rotorAngle: number): number {
  return rotorAngle - index * POCKET_ANGLE
}

/** Index of the pocket under wheel-plane angle `angle` for a rotor at `rotorAngle`. */
export function pocketAtAngle(angle: number, rotorAngle: number): number {
  const local = (rotorAngle - angle) / POCKET_ANGLE
  const index = Math.round(local)
  return ((index % POCKET_COUNT) + POCKET_COUNT) % POCKET_COUNT
}

/**
 * Rotor-frame angle of fret `k`, the separator between pocket `k` and pocket `k + 1`. Add it to
 * `rotorAngle` to get the wheel-plane angle: frets sit at `rotorAngle - (k + 0.5) * POCKET_ANGLE`.
 */
export function fretLocalAngle(k: number): number {
  return -(k + 0.5) * POCKET_ANGLE
}
