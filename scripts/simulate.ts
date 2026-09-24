/**
 * Runs a batch of headless spins through the real physics and prints the pocket/number
 * distribution (with a chi-square fairness statistic), drop and settle timing, track revolutions,
 * and diamond/fret hit rates. Then plays a session of the same length with `attractBets` driving
 * the wagers and reports the realised return against the theoretical 36/37 (the house's 1/37 edge).
 *
 * Usage: `node --experimental-strip-types scripts/simulate.ts [spinCount]` (default 2000 spins).
 */

import { simulateSpin } from '../src/game/physics.ts'
import { spinParamsFromSeed } from '../src/game/rng.ts'
import { WHEEL_ORDER } from '../src/game/wheel.ts'
import { attractBets } from '../src/game/autoplay.ts'
import { beginSpin, createSession, isBroke, placeChip, refill, settleSpin } from '../src/game/session.ts'

/** Default spin count when none is given on the command line. */
const DEFAULT_SPIN_COUNT = 2000

/** Seeds for the two phases are offset so the betting phase's spins do not replay the fairness phase's. */
const SESSION_SEED_OFFSET = 1_000_000_007

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

function chiSquare(counts: readonly number[], expectedTotal: number): number {
  const expected = expectedTotal / counts.length
  return counts.reduce((sum, observed) => sum + (observed - expected) ** 2 / expected, 0)
}

const spinCount = Number(process.argv[2] ?? DEFAULT_SPIN_COUNT)

console.log(`Simulating ${spinCount} spins...\n`)

// --- Phase 1: pure physics, pocket distribution and timing. ---

const pocketCounts = new Array(37).fill(0)
const numberCounts = new Array(37).fill(0)
const dropSeconds: number[] = []
const totalSeconds: number[] = []
const trackRevolutions: number[] = []
let diamondHits = 0
let fretHits = 0
let unsettled = 0

for (let i = 0; i < spinCount; i++) {
  const seed = 1000 + i * 7919
  const params = spinParamsFromSeed(seed)
  const summary = simulateSpin(params)

  pocketCounts[summary.pocket] = (pocketCounts[summary.pocket] ?? 0) + 1
  numberCounts[summary.number] = (numberCounts[summary.number] ?? 0) + 1
  dropSeconds.push(summary.dropSeconds)
  totalSeconds.push(summary.seconds)
  trackRevolutions.push(summary.trackRevolutions)
  diamondHits += summary.diamondHits
  fretHits += summary.fretHits
  if (!summary.settled) unsettled++
}

const chiSq = chiSquare(pocketCounts, spinCount)

console.log('Pocket distribution:')
console.log(`  chi-square (df 36): ${chiSq.toFixed(2)}`)
console.log(`  drop seconds:  mean=${mean(dropSeconds).toFixed(2)} min=${Math.min(...dropSeconds).toFixed(2)} max=${Math.max(...dropSeconds).toFixed(2)}`)
console.log(`  settle seconds: mean=${mean(totalSeconds).toFixed(2)} min=${Math.min(...totalSeconds).toFixed(2)} max=${Math.max(...totalSeconds).toFixed(2)}`)
console.log(`  track revolutions: mean=${mean(trackRevolutions).toFixed(2)}`)
console.log(`  diamond hits per spin: ${(diamondHits / spinCount).toFixed(2)}`)
console.log(`  fret hits per spin: ${(fretHits / spinCount).toFixed(2)}`)
console.log(`  unsettled spins: ${unsettled}`)
console.log(`  numbers seen: ${numberCounts.filter((n) => n > 0).length} / ${WHEEL_ORDER.length}\n`)

// --- Phase 2: a full session driven by attract bets, checking the realised house edge. ---

let session = createSession(null)

for (let i = 0; i < spinCount; i++) {
  if (isBroke(session)) session = refill(session).session

  const bets = attractBets(i, session.bankroll)
  for (const [betId, amount] of Object.entries(bets)) {
    session = placeChip(session, betId, amount).session
  }

  const spun = beginSpin(session)
  session = spun.session
  if (session.phase !== 'spinning') continue

  const seed = SESSION_SEED_OFFSET + i * 7919
  const summary = simulateSpin(spinParamsFromSeed(seed))
  session = settleSpin(session, summary.number).session
}

const { wagered, returned } = session.stats
const theoretical = 36 / 37
const realised = wagered > 0 ? returned / wagered : 0

console.log('Session (attract bets):')
console.log(`  spins: ${session.stats.spins}`)
console.log(`  wagered: ${wagered.toFixed(0)}`)
console.log(`  returned: ${returned.toFixed(0)}`)
console.log(`  realised return per credit: ${realised.toFixed(4)}`)
console.log(`  theoretical return per credit: ${theoretical.toFixed(4)}`)
console.log(`  final bankroll: ${session.bankroll.toFixed(0)}`)
