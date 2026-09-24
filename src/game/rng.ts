import type { SpinParams } from './types.ts'

/**
 * Deterministic randomness for spins: mulberry32, a small, fast 32-bit PRNG. Never uses
 * `Math.random` or `Date` so the same seed always gives the same spin.
 */

/** Mulberry32: returns a generator of numbers in `[0, 1)`, deterministic for a given seed. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Derives the parameters of one spin from a 32-bit seed, deterministically.
 *
 * Ranges (tuned to `physics.ts`'s targets — drop between 4 and 12 s with a 5.5–9 s median,
 * settling by 16 s median, every spin settling within 30 s):
 * - `ballAngle`: uniform in `[0, 2π)`.
 * - direction: `+1` or `-1` with equal probability.
 * - `ballSpeed` (in/s along the track, signed by direction): `direction * (190 + 70 * rng())`,
 *   i.e. magnitude uniform in `[190, 260)`.
 * - `rotorSpeed` (rad/s, opposite sign to the ball): `-direction * (1.6 + 1.2 * rng())`,
 *   i.e. magnitude uniform in `[1.6, 2.8)`.
 */
export function spinParamsFromSeed(seed: number): SpinParams {
  const rng = createRng(seed)
  const ballAngle = rng() * 2 * Math.PI
  const direction = rng() < 0.5 ? 1 : -1
  const ballSpeed = direction * (190 + 70 * rng())
  const rotorSpeed = -direction * (1.6 + 1.2 * rng())
  return { ballAngle, ballSpeed, rotorSpeed }
}
