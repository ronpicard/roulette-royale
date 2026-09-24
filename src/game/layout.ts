import type { PocketColor } from './types.ts'
import { numberColor } from './wheel.ts'
import { betById, insideBetId } from './bets.ts'

/**
 * The betting layout printed on the felt, in inches. Layout coordinates are `(u, v)`: `u` runs
 * along the table away from the wheel, `v` runs across it toward the player. `(0, 0)` is the
 * corner of the zero box farthest from the player.
 *
 * ```text
 *  v=0  +----+----+----+-- ... --+----+-----+
 *       |    |  3 |  6 |         | 36 | 2:1 |   row 0 (numbers divisible by 3)
 *       |  0 +----+----+-- ... --+----+-----+
 *       |    |  2 |  5 |         | 35 | 2:1 |   row 1
 *       |    +----+----+-- ... --+----+-----+
 *       |    |  1 |  4 |         | 34 | 2:1 |   row 2 (nearest the player)
 *       +----+----+----+-- ... --+----+-----+
 *            |  1st 12 |  2nd 12 |  3rd 12  |
 *            +----+----+-- ... --+----+
 *            |1-18|EVEN|RED|BLK|ODD|19-36|
 * ```
 */

export const ZERO_WIDTH = 3.8
/** Width of a number box along the table. */
export const CELL_U = 3.6
/** Depth of a number box across the table. */
export const CELL_V = 4.4
export const COLUMN_BET_WIDTH = 4.2
export const DOZEN_DEPTH = 3.8
export const EVEN_DEPTH = 3.8
/** Depth of the three rows of numbers. */
export const GRID_DEPTH = 3 * CELL_V
/** `u` where the numbers end and the column bets begin. */
export const GRID_END_U = ZERO_WIDTH + 12 * CELL_U
export const LAYOUT_WIDTH = GRID_END_U + COLUMN_BET_WIDTH
export const LAYOUT_DEPTH = GRID_DEPTH + DOZEN_DEPTH + EVEN_DEPTH
/**
 * A tap within this distance of a line between number boxes means the split, corner, street or
 * six line on that line rather than the straight-up number.
 */
export const EDGE_SNAP = 0.6

export interface Rect {
  u0: number
  v0: number
  u1: number
  v1: number
}

export type CellKind = 'zero' | 'number' | 'column' | 'dozen' | 'even'

/** A printed box on the felt and the bet it takes when tapped in its middle. */
export interface LayoutCell extends Rect {
  kind: CellKind
  betId: string
  /** Text printed in the box: the number, `2 to 1`, `1st 12`, `1-18`, `EVEN`, `ODD`, `19-36`, or `''` for the red and black diamonds. */
  text: string
  /** Colour of the number or diamond printed in the box, if any. */
  color: PocketColor | null
}

/** Column (0 to 11, away from the wheel) and row (0 far to 2 near) of number 1 to 36. */
export function numberGridPosition(n: number): { column: number; row: number } {
  return { column: Math.floor((n - 1) / 3), row: 2 - ((n - 1) % 3) }
}

/** The box of number `n`, 0 to 36. */
export function numberCellRect(n: number): Rect {
  if (n === 0) return { u0: 0, v0: 0, u1: ZERO_WIDTH, v1: GRID_DEPTH }
  const { column, row } = numberGridPosition(n)
  const u0 = ZERO_WIDTH + column * CELL_U
  const v0 = row * CELL_V
  return { u0, v0, u1: u0 + CELL_U, v1: v0 + CELL_V }
}

const EVEN_MONEY: readonly { betId: string; text: string; color: PocketColor | null }[] = [
  { betId: 'low', text: '1-18', color: null },
  { betId: 'even', text: 'EVEN', color: null },
  { betId: 'red', text: '', color: 'red' },
  { betId: 'black', text: '', color: 'black' },
  { betId: 'odd', text: 'ODD', color: null },
  { betId: 'high', text: '19-36', color: null },
]

/** Every printed box on the layout. */
export function layoutCells(): LayoutCell[] {
  const cells: LayoutCell[] = []
  cells.push({ ...numberCellRect(0), kind: 'zero', betId: 'straight:0', text: '0', color: 'green' })
  for (let n = 1; n <= 36; n++) {
    cells.push({ ...numberCellRect(n), kind: 'number', betId: `straight:${n}`, text: String(n), color: numberColor(n) })
  }
  for (let row = 0; row < 3; row++) {
    const column = 3 - row
    cells.push({
      u0: GRID_END_U,
      v0: row * CELL_V,
      u1: LAYOUT_WIDTH,
      v1: (row + 1) * CELL_V,
      kind: 'column',
      betId: `column:${column}`,
      text: '2 to 1',
      color: null,
    })
  }
  const ordinals = ['1st', '2nd', '3rd']
  for (let d = 0; d < 3; d++) {
    const u0 = ZERO_WIDTH + d * 4 * CELL_U
    cells.push({
      u0,
      v0: GRID_DEPTH,
      u1: u0 + 4 * CELL_U,
      v1: GRID_DEPTH + DOZEN_DEPTH,
      kind: 'dozen',
      betId: `dozen:${d + 1}`,
      text: `${ordinals[d]} 12`,
      color: null,
    })
  }
  EVEN_MONEY.forEach((box, i) => {
    const u0 = ZERO_WIDTH + i * 2 * CELL_U
    cells.push({
      u0,
      v0: GRID_DEPTH + DOZEN_DEPTH,
      u1: u0 + 2 * CELL_U,
      v1: LAYOUT_DEPTH,
      kind: 'even',
      betId: box.betId,
      text: box.text,
      color: box.color,
    })
  })
  return cells
}

/** The 13 vertical grid lines, `u = ZERO_WIDTH + k * CELL_U` for `k = 0..12`. */
const VERTICAL_LINES: readonly number[] = (() => {
  const lines: number[] = []
  for (let k = 0; k <= 12; k++) lines.push(ZERO_WIDTH + k * CELL_U)
  return lines
})()

/** The 4 horizontal grid lines, `v = j * CELL_V` for `j = 0..3`. */
const HORIZONTAL_LINES: readonly number[] = (() => {
  const lines: number[] = []
  for (let j = 0; j <= 3; j++) lines.push(j * CELL_V)
  return lines
})()

/** Index of the nearest line to `value` when within `EDGE_SNAP`, else `null`. */
function nearestLine(value: number, lines: readonly number[]): number | null {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < lines.length; i++) {
    const d = Math.abs(value - lines[i]!)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return bestDist <= EDGE_SNAP ? best : null
}

/** Inverse of `numberGridPosition`: the number at `row` (0..2) and `column` (0..11). */
function numberAt(row: number, column: number): number {
  return 3 * (column + 1) - row
}

/** Column (0..11, clamped) containing `u`, measured from `ZERO_WIDTH`. */
function columnOf(u: number): number {
  return Math.min(11, Math.max(0, Math.floor((u - ZERO_WIDTH) / CELL_U)))
}

/** Row (0..2, clamped) containing `v`. */
function rowOf(v: number): number {
  return Math.min(2, Math.max(0, Math.floor(v / CELL_V)))
}

/** Centre of the horizontal band `row` occupies. */
function rowMidV(row: number): number {
  return (row + 0.5) * CELL_V
}

/** Centre of the vertical band `column` occupies. */
function columnMidU(column: number): number {
  return ZERO_WIDTH + (column + 0.5) * CELL_U
}

/**
 * The bet a tap at `(u, v)` places, or `null` off the layout. Taps in the middle of a box take
 * that box's bet; taps within `EDGE_SNAP` of the lines between number boxes take the split,
 * corner, street, six line, trio or first-four bet on that line. See `SPEC.md` for the rules.
 */
export function betAtPoint(u: number, v: number): string | null {
  if (u < 0 || u > LAYOUT_WIDTH || v < 0 || v > LAYOUT_DEPTH) return null
  // The two empty corners: under the zero box, and under the column bets.
  if (u < ZERO_WIDTH && v > GRID_DEPTH) return null
  if (u > GRID_END_U && v > GRID_DEPTH) return null

  if (u > GRID_END_U) {
    const row = rowOf(v)
    return `column:${3 - row}`
  }

  if (v > GRID_DEPTH) {
    if (v <= GRID_DEPTH + DOZEN_DEPTH) {
      const d = Math.min(2, Math.max(0, Math.floor((u - ZERO_WIDTH) / (4 * CELL_U))))
      return `dozen:${d + 1}`
    }
    const i = Math.min(5, Math.max(0, Math.floor((u - ZERO_WIDTH) / (2 * CELL_U))))
    return EVEN_MONEY[i]!.betId
  }

  // Inside the number grid, including the zero box (u can be less than ZERO_WIDTH here).
  const vK = nearestLine(u, VERTICAL_LINES)
  const hK = nearestLine(v, HORIZONTAL_LINES)
  // k = 12 (the column-bet line) and j = 0 (the far edge) count as "no line near".
  const vEff: 'zero' | 'between' | 'none' = vK === null || vK === 12 ? 'none' : vK === 0 ? 'zero' : 'between'
  const hEff: 'nearEdge' | 'betweenRows' | 'none' = hK === null || hK === 0 ? 'none' : hK === 3 ? 'nearEdge' : 'betweenRows'

  if (u < ZERO_WIDTH && vEff !== 'zero') return 'straight:0'

  if (vEff === 'zero') {
    if (hEff === 'nearEdge') return insideBetId('firstFour', [0, 1, 2, 3])
    if (hEff === 'betweenRows') return insideBetId('trio', hK === 1 ? [0, 2, 3] : [0, 1, 2])
    const row = rowOf(v)
    return insideBetId('split', [0, numberAt(row, 0)])
  }

  if (vEff === 'between') {
    const columnLeft = vK! - 1
    const columnRight = vK!
    if (hEff === 'nearEdge') {
      const n = numberAt(2, columnLeft)
      return insideBetId('sixLine', [n, n + 1, n + 2, n + 3, n + 4, n + 5])
    }
    if (hEff === 'betweenRows') {
      const rowUpper = hK! - 1
      const rowLower = hK!
      return insideBetId('corner', [
        numberAt(rowUpper, columnLeft),
        numberAt(rowUpper, columnRight),
        numberAt(rowLower, columnLeft),
        numberAt(rowLower, columnRight),
      ])
    }
    const row = rowOf(v)
    return insideBetId('split', [numberAt(row, columnLeft), numberAt(row, columnRight)])
  }

  // vEff === 'none': u >= ZERO_WIDTH here (the zero-box case returned above).
  const column = columnOf(u)
  if (hEff === 'nearEdge') {
    const n = numberAt(2, column)
    return insideBetId('street', [n, n + 1, n + 2])
  }
  if (hEff === 'betweenRows') {
    const rowUpper = hK! - 1
    const rowLower = hK!
    return insideBetId('split', [numberAt(rowUpper, column), numberAt(rowLower, column)])
  }
  const row = rowOf(v)
  return insideBetId('straight', [numberAt(row, column)])
}

/** Where the centre of a bet's chip stack sits on the layout. Throws for an unknown bet id. */
export function betAnchor(betId: string): { u: number; v: number } {
  const bet = betById(betId)
  if (bet === null) throw new Error(`betAnchor: unknown bet id ${betId}`)
  const nums = bet.numbers

  switch (bet.kind) {
    case 'straight': {
      const rect = numberCellRect(nums[0]!)
      return { u: (rect.u0 + rect.u1) / 2, v: (rect.v0 + rect.v1) / 2 }
    }
    case 'split': {
      if (nums[0] === 0) {
        const { row } = numberGridPosition(nums[1]!)
        return { u: ZERO_WIDTH, v: rowMidV(row) }
      }
      const a = nums[0]!
      const b = nums[1]!
      if (b - a === 3) {
        const { row, column } = numberGridPosition(a)
        return { u: ZERO_WIDTH + (column + 1) * CELL_U, v: rowMidV(row) }
      }
      // b - a === 1: up the column. The smaller number sits at the row of the shared line.
      const { row, column } = numberGridPosition(a)
      return { u: columnMidU(column), v: row * CELL_V }
    }
    case 'street': {
      const { column } = numberGridPosition(nums[0]!)
      return { u: columnMidU(column), v: GRID_DEPTH }
    }
    case 'trio': {
      return { u: ZERO_WIDTH, v: nums.includes(3) ? CELL_V : 2 * CELL_V }
    }
    case 'corner': {
      const { row, column } = numberGridPosition(nums[0]!)
      return { u: ZERO_WIDTH + (column + 1) * CELL_U, v: row * CELL_V }
    }
    case 'firstFour':
      return { u: ZERO_WIDTH, v: GRID_DEPTH }
    case 'sixLine': {
      const { column } = numberGridPosition(nums[0]!)
      return { u: ZERO_WIDTH + (column + 1) * CELL_U, v: GRID_DEPTH }
    }
    case 'column': {
      const c = Number(betId.slice('column:'.length))
      const row = 3 - c
      return { u: (GRID_END_U + LAYOUT_WIDTH) / 2, v: rowMidV(row) }
    }
    case 'dozen': {
      const d = Number(betId.slice('dozen:'.length))
      const u0 = ZERO_WIDTH + (d - 1) * 4 * CELL_U
      return { u: u0 + 2 * CELL_U, v: GRID_DEPTH + DOZEN_DEPTH / 2 }
    }
    default: {
      // red, black, odd, even, low, high
      const idx = EVEN_MONEY.findIndex((box) => box.betId === betId)
      const u0 = ZERO_WIDTH + idx * 2 * CELL_U
      return { u: u0 + CELL_U, v: GRID_DEPTH + DOZEN_DEPTH + EVEN_DEPTH / 2 }
    }
  }
}

/** The boxes to light while a bet is hovered: its number boxes for inside bets, its own box for outside bets. */
export function betHighlightRects(betId: string): Rect[] {
  const bet = betById(betId)
  if (bet === null) throw new Error(`betHighlightRects: unknown bet id ${betId}`)

  const outsideKinds = new Set(['column', 'dozen', 'red', 'black', 'odd', 'even', 'low', 'high'])
  if (outsideKinds.has(bet.kind)) {
    const cell = layoutCells().find((c) => c.betId === betId)
    if (cell === undefined) throw new Error(`betHighlightRects: no box for ${betId}`)
    return [{ u0: cell.u0, v0: cell.v0, u1: cell.u1, v1: cell.v1 }]
  }

  return bet.numbers.map((n) => numberCellRect(n))
}
