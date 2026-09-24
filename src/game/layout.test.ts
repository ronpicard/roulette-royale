import test from 'node:test'
import assert from 'node:assert/strict'
import { ALL_BETS } from './bets.ts'
import {
  DOZEN_DEPTH,
  EVEN_DEPTH,
  GRID_DEPTH,
  GRID_END_U,
  LAYOUT_DEPTH,
  LAYOUT_WIDTH,
  ZERO_WIDTH,
  betAnchor,
  betAtPoint,
  betHighlightRects,
  layoutCells,
  numberCellRect,
} from './layout.ts'
import type { Rect } from './layout.ts'

function rectsEqual(a: Rect, b: Rect): boolean {
  return a.u0 === b.u0 && a.v0 === b.v0 && a.u1 === b.u1 && a.v1 === b.v1
}

test('every bet anchor round-trips through betAtPoint', () => {
  for (const bet of ALL_BETS) {
    const anchor = betAnchor(bet.id)
    const found = betAtPoint(anchor.u, anchor.v)
    assert.equal(found, bet.id, `anchor of ${bet.id} at (${anchor.u}, ${anchor.v}) resolved to ${found}`)
  }
})

test('betAnchor throws for an unknown id', () => {
  assert.throws(() => betAnchor('nope'), Error)
})

test('a tap in the middle of each number box gives the straight bet', () => {
  for (let n = 0; n <= 36; n++) {
    const rect = numberCellRect(n)
    const u = (rect.u0 + rect.u1) / 2
    const v = (rect.v0 + rect.v1) / 2
    assert.equal(betAtPoint(u, v), `straight:${n}`)
  }
})

test('representative taps give each inside bet kind', () => {
  // Split across columns: 17/20.
  assert.equal(betAtPoint(25.4, 6.6), 'split:17-20')
  // Split up a column: 17/18.
  assert.equal(betAtPoint(23.6, 4.4), 'split:17-18')
  // Corner: 17/18/20/21.
  assert.equal(betAtPoint(25.4, 4.4), 'corner:17-18-20-21')
  // Street: 16-18.
  assert.equal(betAtPoint(23.6, GRID_DEPTH), 'street:16-17-18')
  // Six line: 16-21.
  assert.equal(betAtPoint(25.4, GRID_DEPTH), 'sixLine:16-17-18-19-20-21')
  // Trios.
  assert.equal(betAtPoint(ZERO_WIDTH, 2 * 4.4), 'trio:0-1-2')
  assert.equal(betAtPoint(ZERO_WIDTH, 4.4), 'trio:0-2-3')
  // First four.
  assert.equal(betAtPoint(ZERO_WIDTH, GRID_DEPTH), 'firstFour:0-1-2-3')
  // Zero splits.
  assert.equal(betAtPoint(ZERO_WIDTH, 11), 'split:0-1')
})

test('representative taps give every outside box', () => {
  for (const cell of layoutCells()) {
    if (cell.kind === 'zero' || cell.kind === 'number') continue
    const u = (cell.u0 + cell.u1) / 2
    const v = (cell.v0 + cell.v1) / 2
    assert.equal(betAtPoint(u, v), cell.betId, `centre of ${cell.betId}'s box should resolve to itself`)
  }
})

test('off-layout points and the two dead corners give null', () => {
  assert.equal(betAtPoint(-1, 5), null)
  assert.equal(betAtPoint(LAYOUT_WIDTH + 1, 5), null)
  assert.equal(betAtPoint(5, -1), null)
  assert.equal(betAtPoint(5, LAYOUT_DEPTH + 1), null)

  // Dead corner under the zero box.
  assert.equal(betAtPoint(1, GRID_DEPTH + 1), null)
  // Dead corner under the column bets.
  assert.equal(betAtPoint(GRID_END_U + 1, GRID_DEPTH + 1), null)
})

test('layoutCells boxes do not overlap and tile the layout apart from the two dead corners', () => {
  const cells = layoutCells()

  // Floating-point noise (e.g. `(3.8 + 3 * 3.6) + 3.6` vs `3.8 + 4 * 3.6`) can put adjacent edges a
  // few ULPs apart, so require a non-trivial overlap before flagging it.
  const EPS = 1e-6
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i]!
      const b = cells[j]!
      const overlaps = a.u0 < b.u1 - EPS && a.u1 > b.u0 + EPS && a.v0 < b.v1 - EPS && a.v1 > b.v0 + EPS
      assert.ok(!overlaps, `${a.betId} and ${b.betId} overlap`)
    }
  }

  const totalArea = cells.reduce((sum, c) => sum + (c.u1 - c.u0) * (c.v1 - c.v0), 0)
  const deadCornerArea =
    ZERO_WIDTH * (LAYOUT_DEPTH - GRID_DEPTH) + (LAYOUT_WIDTH - GRID_END_U) * (LAYOUT_DEPTH - GRID_DEPTH)
  const fullArea = LAYOUT_WIDTH * LAYOUT_DEPTH
  assert.ok(Math.abs(totalArea - (fullArea - deadCornerArea)) < 1e-6)
  // Sanity: the dead corner area matches the even/dozen band width times the two side pieces.
  assert.ok(Math.abs(LAYOUT_DEPTH - GRID_DEPTH - (DOZEN_DEPTH + EVEN_DEPTH)) < 1e-9)
})

test('betHighlightRects covers exactly the bet numbers for inside bets, and the box for outside bets', () => {
  for (const bet of ALL_BETS) {
    const rects = betHighlightRects(bet.id)
    if (
      bet.kind === 'column' ||
      bet.kind === 'dozen' ||
      bet.kind === 'red' ||
      bet.kind === 'black' ||
      bet.kind === 'odd' ||
      bet.kind === 'even' ||
      bet.kind === 'low' ||
      bet.kind === 'high'
    ) {
      const cell = layoutCells().find((c) => c.betId === bet.id)!
      assert.equal(rects.length, 1)
      assert.ok(rectsEqual(rects[0]!, { u0: cell.u0, v0: cell.v0, u1: cell.u1, v1: cell.v1 }))
    } else {
      assert.equal(rects.length, bet.numbers.length)
      const expected = bet.numbers.map((n) => numberCellRect(n))
      for (const rect of expected) {
        assert.ok(rects.some((r) => rectsEqual(r, rect)))
      }
    }
  }
})

test('betHighlightRects throws for an unknown id', () => {
  assert.throws(() => betHighlightRects('nope'), Error)
})
