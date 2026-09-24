/**
 * Where everything stands in the world, in inches. three.js world axes: `y` is up, the player
 * sits on the `+z` side of the table looking toward `-z`, the wheel is at the `-x` end and the
 * layout runs toward `+x`. The floor is `y = 0`.
 *
 * The wheel plane of `src/game/wheel.ts` maps to the world as `(x, y, h) -> (WHEEL_CENTER_X + x,
 * WHEEL_BASE_Y + h, WHEEL_CENTER_Z - y)`, so a wheel-plane angle `a` is a three.js rotation of
 * `a` about `+y`, and a counter-clockwise wheel seen from above turns counter-clockwise in the world.
 *
 * The layout of `src/game/layout.ts` maps as `(u, v) -> (LAYOUT_ORIGIN_X + u, TABLE_HEIGHT,
 * LAYOUT_ORIGIN_Z + v)`.
 */

/** Height of the felt. */
export const TABLE_HEIGHT = 30

export const WHEEL_CENTER_X = -40
export const WHEEL_CENTER_Z = -1
/** World height of the wheel's pocket floor. The wheel bowl sits in a well in the table, its rim above the felt. */
export const WHEEL_BASE_Y = TABLE_HEIGHT + 1.2

export const LAYOUT_ORIGIN_X = -20
export const LAYOUT_ORIGIN_Z = -12

/**
 * Outer edge of the table top, including its padded rail, in world `x` and `z`. The wheel end is
 * a semicircle centred on the wheel, so the table is deep enough to seat the whole bowl inside
 * the rail: `TABLE_MIN_X` is the wheel centre less the half depth, and the depth is centred on
 * `WHEEL_CENTER_Z`.
 */
export const TABLE_MIN_X = -63
export const TABLE_MAX_X = 38
export const TABLE_MIN_Z = -24
export const TABLE_MAX_Z = 22

/**
 * The tote board (the lit history display) stands on the floor beyond the wheel end of the table
 * and faces the player, low enough to sit in the seated view beside the wheel.
 */
export const TOTE_BOARD_X = WHEEL_CENTER_X - 20
export const TOTE_BOARD_Z = TABLE_MIN_Z - 10
/** Height of the centre of the tote board's screen. */
export const TOTE_BOARD_SCREEN_Y = 42

/**
 * The casino room keeps this box clear around the table (floor to ceiling), apart from the tote
 * board and the stools along the player's side, so every camera view sees the table unobstructed.
 */
export const ROOM_CLEAR_MIN_X = -80
export const ROOM_CLEAR_MAX_X = 60
export const ROOM_CLEAR_MIN_Z = -40
export const ROOM_CLEAR_MAX_Z = 50

export interface Point3 {
  x: number
  y: number
  z: number
}

export function wheelToWorld(x: number, y: number, h: number): Point3 {
  return { x: WHEEL_CENTER_X + x, y: WHEEL_BASE_Y + h, z: WHEEL_CENTER_Z - y }
}

export function layoutToWorld(u: number, v: number): Point3 {
  return { x: LAYOUT_ORIGIN_X + u, y: TABLE_HEIGHT, z: LAYOUT_ORIGIN_Z + v }
}

export function worldToLayout(x: number, z: number): { u: number; v: number } {
  return { u: x - LAYOUT_ORIGIN_X, v: z - LAYOUT_ORIGIN_Z }
}
