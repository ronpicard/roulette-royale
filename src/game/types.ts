/**
 * Shared types for the roulette game. Everything under `src/game/` is pure and deterministic:
 * no DOM, no three.js, no `Math.random` or `Date`.
 *
 * Units are inches, seconds and radians. The wheel lives in its own 2D plane seen from above:
 * the origin is the spindle, `x` and `y` are horizontal, and angles run counter-clockwise from
 * `+x` when viewed from above. Heights (`h`) are measured up from the pocket floor.
 */

/** A European wheel has 37 pockets: 0 to 36. */
export type PocketColor = 'red' | 'black' | 'green'

/** The ball's life on the wheel, from launch to rest. */
export type BallPhase =
  /** Riding the ball track against the outer rim. */
  | 'track'
  /** Left the track and running down the stator (the fixed cone with the diamonds). */
  | 'falling'
  /** On the rotor: crossing the number ring or bouncing between the frets. */
  | 'rotor'
  /** At rest in a pocket and carried round by the rotor. */
  | 'settled'

export interface BallState {
  /** Centre of the ball in the wheel plane, inches. */
  x: number
  y: number
  /** Velocity in the wheel plane (not relative to the rotor), inches per second. */
  vx: number
  vy: number
  /** Height of the bottom of the ball above the surface beneath it, inches. 0 when rolling. */
  hop: number
  /** Vertical speed of the hop, inches per second, positive up. */
  hopSpeed: number
  phase: BallPhase
  /** Index into `WHEEL_ORDER` of the pocket the ball rests in, once settled. */
  pocket: number | null
  /** Seconds the ball has spent slow in one pocket; it settles once this passes a threshold. */
  settleTimer: number
}

export interface WheelState {
  /** Rotor angle, radians, counter-clockwise from above. Pocket `i` is centred on `rotorAngle + i * POCKET_ANGLE`. */
  rotorAngle: number
  /** Rotor angular velocity, radians per second, counter-clockwise positive. */
  rotorSpeed: number
  /** `null` while the dealer holds the ball. */
  ball: BallState | null
  /** Seconds since the current ball was launched. */
  time: number
}

/** Everything that decides one spin. `spinParamsFromSeed` derives these from a 32-bit seed. */
export interface SpinParams {
  /** Where on the track the dealer releases the ball, radians. */
  ballAngle: number
  /** Launch speed along the track, inches per second. Its sign is the direction (+ counter-clockwise). */
  ballSpeed: number
  /** Rotor speed the dealer gives the wheel as the ball is launched, radians per second, opposite in sign to `ballSpeed`. */
  rotorSpeed: number
}

/** Something the ball did during a physics step. `intensity` runs 0 to 1. */
export type WheelEvent =
  | { type: 'diamond'; intensity: number }
  | { type: 'fret'; intensity: number }
  | { type: 'rim'; intensity: number }
  /** The ball left the ball track. */
  | { type: 'drop' }
  /** The ball crossed from the number ring down into the pocket ring. */
  | { type: 'pocketDrop'; intensity: number }
  /** The ball came to rest. `number` is the winning number. */
  | { type: 'settle'; pocket: number; number: number }

export type BetKind =
  | 'straight'
  | 'split'
  | 'street'
  | 'trio'
  | 'corner'
  | 'firstFour'
  | 'sixLine'
  | 'column'
  | 'dozen'
  | 'red'
  | 'black'
  | 'odd'
  | 'even'
  | 'low'
  | 'high'

export interface Bet {
  /** Stable, unique id, e.g. `straight:17`, `split:17-20`, `red`. Made only by `bets.ts`. */
  id: string
  kind: BetKind
  /** The numbers the bet covers, ascending. */
  numbers: number[]
  /** Short text for the HUD, e.g. `17`, `Split 17/20`, `Red`, `2nd 12`. */
  label: string
}

/** Chip values in the rack, in credits. */
export type ChipValue = 1 | 5 | 25 | 100 | 500

export type SessionPhase = 'betting' | 'spinning' | 'result'

/** Amount staked on each bet, keyed by bet id. Only positive amounts are stored. */
export type BetMap = Record<string, number>

export interface BetOutcome {
  betId: string
  amount: number
  /** Stake plus winnings handed back, or 0 for a losing bet. */
  returned: number
}

export interface SpinResult {
  number: number
  color: PocketColor
  outcomes: BetOutcome[]
  /** Everything staked on the spin. */
  staked: number
  /** Everything handed back (stakes of winning bets plus winnings). */
  returned: number
  /** `returned - staked`. */
  net: number
}

export interface SessionStats {
  spins: number
  wagered: number
  returned: number
  /** Largest single-spin net win. */
  biggestWin: number
  /** Highest bankroll reached. */
  bestBankroll: number
  /** How often each number came up, indexed by number 0 to 36. */
  counts: number[]
}

export interface Session {
  phase: SessionPhase
  /** Credits not on the table. */
  bankroll: number
  /** Chips on the table this round. */
  bets: BetMap
  /** Stack of placements this round, newest last, for undo. */
  undo: BetMap[]
  /** The bets of the last spin, for rebet. */
  lastBets: BetMap | null
  /** Winning numbers, newest first, at most `HISTORY_LENGTH`. */
  history: number[]
  lastResult: SpinResult | null
  stats: SessionStats
}

/** What is kept in localStorage between visits. */
export interface SessionSave {
  version: 1
  bankroll: number
  history: number[]
  stats: SessionStats
}

export type SoundName =
  | 'chip'
  | 'chipRemove'
  | 'clear'
  | 'launch'
  | 'noMoreBets'
  | 'diamond'
  | 'fret'
  | 'rim'
  | 'drop'
  | 'pocketDrop'
  | 'settle'
  | 'win'
  | 'bigWin'
  | 'lose'
  | 'refill'
  | 'denied'

/** Side effects a session transition asks the engine to perform. */
export type Command =
  | { type: 'sound'; name: SoundName }
  | { type: 'message'; text: string; seconds: number }
  /** Save the session to storage now. */
  | { type: 'save' }

export interface Transition {
  session: Session
  commands: Command[]
}
