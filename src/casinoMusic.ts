/**
 * Background lounge music, synthesised at runtime with Web Audio: no audio files.
 *
 * A small jazz trio plus vibraphone plays an endless, gently varied set in F major at a lazy
 * swing: a walking upright bass, a Rhodes-like keyboard comping chord stabs, a brushed ride and
 * hi-hat, and a sparse vibraphone melody that wanders through each chord. Two eight-bar chord
 * loops alternate so the tune never repeats exactly, and every rhythm and melody choice is
 * drawn fresh each bar.
 *
 * `startCasinoMusic` schedules one bar at a time a short way ahead of the clock (the classic
 * look-ahead scheduler), so it stays sample-accurate no matter how the main thread stutters.
 * The caller owns the output node it passes in and can duck or mute it however it likes;
 * `stop()` ends scheduling and lets the notes already in flight ring out.
 */

export interface CasinoMusic {
  /** Stops scheduling new bars. Notes already scheduled finish naturally. */
  stop(): void
}

// -------------------------------------------------------------------------------------------
// Tuning
// -------------------------------------------------------------------------------------------

const TEMPO_BPM = 104
const BEAT_SECONDS = 60 / TEMPO_BPM
const BAR_SECONDS = BEAT_SECONDS * 4
/** Where the off-beat eighth falls inside a beat: 0.5 is straight, 0.667 is hard swing. */
const SWING = 0.63
/** How far ahead of the clock a bar is scheduled, and how often the scheduler wakes. */
const LOOKAHEAD_SECONDS = 0.6
const SCHEDULER_INTERVAL_MS = 120

/** The whole band's level on the caller's output scale: a bed, well below the game sounds. */
const BAND_LEVEL = 0.1
const BASS_LEVEL = 0.55
const KEYS_LEVEL = 0.16
const VIBES_LEVEL = 0.2
const RIDE_LEVEL = 0.075
const HAT_LEVEL = 0.05

/** Chance the vibes sit a whole bar out, so the tune breathes. */
const VIBES_REST_BAR_CHANCE = 0.28
/** Chance of a vibes note on a down-beat eighth and on an off-beat eighth. */
const VIBES_NOTE_CHANCE_ON = 0.42
const VIBES_NOTE_CHANCE_OFF = 0.26

// -------------------------------------------------------------------------------------------
// Harmony
// -------------------------------------------------------------------------------------------

interface Chord {
  /** MIDI note of the root in the bass register. */
  root: number
  /** Semitone intervals above the root that make up the chord (3rd, 5th, 7th, 9th). */
  tones: readonly number[]
  /** Scale degrees (semitones above the root, one octave) the melody may use over this chord. */
  scale: readonly number[]
}

const MAJ7: readonly number[] = [4, 7, 11, 14]
const MIN7: readonly number[] = [3, 7, 10, 14]
const DOM7: readonly number[] = [4, 7, 10, 14]
const IONIAN: readonly number[] = [0, 2, 4, 5, 7, 9, 11]
const DORIAN: readonly number[] = [0, 2, 3, 5, 7, 9, 10]
const MIXOLYDIAN: readonly number[] = [0, 2, 4, 5, 7, 9, 10]
const LYDIAN: readonly number[] = [0, 2, 4, 6, 7, 9, 11]

const F = 41
const G = 43
const A = 45
const Bb = 46
const C = 48
const D = 38

const Fmaj7: Chord = { root: F, tones: MAJ7, scale: IONIAN }
const Bbmaj7: Chord = { root: Bb, tones: MAJ7, scale: LYDIAN }
const Gm7: Chord = { root: G, tones: MIN7, scale: DORIAN }
const Am7: Chord = { root: A, tones: MIN7, scale: DORIAN }
const Dm7: Chord = { root: D, tones: MIN7, scale: DORIAN }
const C7: Chord = { root: C, tones: DOM7, scale: MIXOLYDIAN }
const D7: Chord = { root: D, tones: DOM7, scale: MIXOLYDIAN }

/** Two eight-bar loops that alternate: a I–vi–ii–V turnaround, then a IV–iii–VI–ii–V climb. */
const PROGRESSIONS: readonly (readonly Chord[])[] = [
  [Fmaj7, Fmaj7, Dm7, Dm7, Gm7, C7, Am7, Dm7],
  [Gm7, C7, Fmaj7, Bbmaj7, Am7, D7, Gm7, C7],
]

/** Comping rhythms as swung-eighth slots (0..7) within the bar, with a velocity for each hit. */
const COMP_PATTERNS: readonly (readonly { slot: number; velocity: number }[])[] = [
  [{ slot: 0, velocity: 1 }, { slot: 3, velocity: 0.8 }],
  [{ slot: 0, velocity: 1 }, { slot: 3, velocity: 0.75 }, { slot: 6, velocity: 0.65 }],
  [{ slot: 1, velocity: 0.85 }, { slot: 4, velocity: 0.8 }],
  [{ slot: 0, velocity: 0.9 }, { slot: 5, velocity: 0.75 }],
  [{ slot: 2, velocity: 0.85 }, { slot: 6, velocity: 0.7 }],
  [{ slot: 3, velocity: 0.9 }],
]

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!
}

/** Time of swung-eighth `slot` (0..7) after `barStart`. */
function slotTime(barStart: number, slot: number): number {
  const beat = Math.floor(slot / 2)
  const off = slot % 2 === 1 ? SWING : 0
  return barStart + (beat + off) * BEAT_SECONDS
}

// -------------------------------------------------------------------------------------------
// The band
// -------------------------------------------------------------------------------------------

export function startCasinoMusic(context: AudioContext, out: AudioNode): CasinoMusic {
  const bus = context.createGain()
  bus.gain.value = BAND_LEVEL
  // A gentle roll-off keeps the band sounding like it is across the room, not in the speakers.
  const tone = context.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = 5200
  tone.Q.value = 0.5
  bus.connect(tone)
  tone.connect(out)

  const noise = context.createBuffer(1, Math.floor(context.sampleRate), context.sampleRate)
  {
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }

  /** Tears an oscillator and its gain down once the note has finished. */
  function cleanupOnEnd(source: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
    source.onended = () => {
      source.disconnect()
      for (const node of nodes) node.disconnect()
    }
  }

  function envelope(gain: GainNode, t: number, peak: number, attack: number, decay: number, sustain: number, release: number): number {
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.linearRampToValueAtTime(peak, t + attack)
    gain.gain.setTargetAtTime(peak * sustain, t + attack, decay / 3)
    const end = t + attack + decay + release
    gain.gain.setTargetAtTime(0.0001, end - release, release / 4)
    return end + 0.05
  }

  // --- Upright bass: a sine with a touch of triangle body, plucked and let ring ----------------
  function bassNote(t: number, midi: number, velocity: number): void {
    const hz = midiToHz(midi)
    const body = context.createOscillator()
    body.type = 'sine'
    body.frequency.value = hz
    const grit = context.createOscillator()
    grit.type = 'triangle'
    grit.frequency.value = hz
    const gritGain = context.createGain()
    gritGain.gain.value = 0.35
    const lowpass = context.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.setValueAtTime(900, t)
    lowpass.frequency.setTargetAtTime(260, t + 0.02, 0.12)
    const gain = context.createGain()
    const end = envelope(gain, t, BASS_LEVEL * velocity, 0.012, 0.35, 0.45, 0.25)
    body.connect(lowpass)
    grit.connect(gritGain)
    gritGain.connect(lowpass)
    lowpass.connect(gain)
    gain.connect(bus)
    body.start(t)
    grit.start(t)
    body.stop(end)
    grit.stop(end)
    cleanupOnEnd(body, lowpass, gain)
    cleanupOnEnd(grit, gritGain)
  }

  // --- Keys: a Rhodes-ish tine, a fundamental with a soft octave partial, slightly detuned ------
  function keysNote(t: number, midi: number, velocity: number): void {
    const hz = midiToHz(midi)
    const detune = (Math.random() - 0.5) * 8
    const fundamental = context.createOscillator()
    fundamental.type = 'triangle'
    fundamental.frequency.value = hz
    fundamental.detune.value = detune
    const tine = context.createOscillator()
    tine.type = 'sine'
    tine.frequency.value = hz * 2
    tine.detune.value = detune
    const tineGain = context.createGain()
    tineGain.gain.setValueAtTime(0.5, t)
    tineGain.gain.setTargetAtTime(0.12, t, 0.25)
    const lowpass = context.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 2200
    const gain = context.createGain()
    const end = envelope(gain, t, KEYS_LEVEL * velocity, 0.006, 0.7, 0.3, 0.35)
    fundamental.connect(lowpass)
    tine.connect(tineGain)
    tineGain.connect(lowpass)
    lowpass.connect(gain)
    gain.connect(bus)
    fundamental.start(t)
    tine.start(t)
    fundamental.stop(end)
    tine.stop(end)
    cleanupOnEnd(fundamental, lowpass, gain)
    cleanupOnEnd(tine, tineGain)
  }

  // --- Vibraphone: a pure tone with a bright fourth partial and a slow motor tremolo -----------
  function vibesNote(t: number, midi: number, velocity: number): void {
    const hz = midiToHz(midi)
    const fundamental = context.createOscillator()
    fundamental.type = 'sine'
    fundamental.frequency.value = hz
    const partial = context.createOscillator()
    partial.type = 'sine'
    partial.frequency.value = hz * 4
    const partialGain = context.createGain()
    partialGain.gain.setValueAtTime(0.18, t)
    partialGain.gain.setTargetAtTime(0.02, t, 0.15)
    const tremolo = context.createOscillator()
    tremolo.type = 'sine'
    tremolo.frequency.value = 4.6
    const tremoloDepth = context.createGain()
    tremoloDepth.gain.value = 0.3
    const tremoloGain = context.createGain()
    tremoloGain.gain.value = 0.7
    tremolo.connect(tremoloDepth)
    tremoloDepth.connect(tremoloGain.gain)
    const gain = context.createGain()
    const end = envelope(gain, t, VIBES_LEVEL * velocity, 0.004, 1.3, 0.25, 0.5)
    fundamental.connect(tremoloGain)
    partial.connect(partialGain)
    partialGain.connect(tremoloGain)
    tremoloGain.connect(gain)
    gain.connect(bus)
    fundamental.start(t)
    partial.start(t)
    tremolo.start(t)
    fundamental.stop(end)
    partial.stop(end)
    tremolo.stop(end)
    cleanupOnEnd(fundamental, tremoloGain, gain)
    cleanupOnEnd(partial, partialGain)
    cleanupOnEnd(tremolo, tremoloDepth)
  }

  // --- Brushes: ride and closed hat from band-passed noise -------------------------------------
  function noiseHit(t: number, centreHz: number, q: number, decay: number, level: number): void {
    const source = context.createBufferSource()
    source.buffer = noise
    source.loop = true
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = centreHz
    filter.Q.value = q
    const gain = context.createGain()
    gain.gain.setValueAtTime(level, t)
    gain.gain.setTargetAtTime(0.0001, t + 0.005, decay / 4)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(bus)
    source.start(t, Math.random() * 0.8)
    source.stop(t + decay + 0.1)
    cleanupOnEnd(source, filter, gain)
  }

  function ride(t: number, velocity: number): void {
    noiseHit(t, 5200, 1.2, 0.32, RIDE_LEVEL * velocity)
    // A faint metallic ping under the wash gives the ride its bell.
    const ping = context.createOscillator()
    ping.type = 'sine'
    ping.frequency.value = 4100 + Math.random() * 300
    const gain = context.createGain()
    gain.gain.setValueAtTime(RIDE_LEVEL * velocity * 0.3, t)
    gain.gain.setTargetAtTime(0.0001, t, 0.05)
    ping.connect(gain)
    gain.connect(bus)
    ping.start(t)
    ping.stop(t + 0.3)
    cleanupOnEnd(ping, gain)
  }

  function hat(t: number, velocity: number): void {
    noiseHit(t, 8600, 2.5, 0.07, HAT_LEVEL * velocity)
  }

  // --- Arrangement -----------------------------------------------------------------------------

  let bar = 0
  let nextBarTime = context.currentTime + 0.1
  let lastVibesMidi = 72
  let timer: ReturnType<typeof setInterval> | null = null

  function chordAt(barIndex: number): Chord {
    const progression = PROGRESSIONS[Math.floor(barIndex / 8) % PROGRESSIONS.length]!
    return progression[barIndex % 8]!
  }

  /** Keeps a bass note inside the upright's comfortable register. */
  function bassRegister(midi: number): number {
    let m = midi
    while (m < 36) m += 12
    while (m > 52) m -= 12
    return m
  }

  function walkingBass(barStart: number, chord: Chord, next: Chord): void {
    const root = bassRegister(chord.root)
    const third = bassRegister(chord.root + chord.tones[0]!)
    const fifth = bassRegister(chord.root + chord.tones[1]!)
    const nextRoot = bassRegister(next.root)
    const approach = Math.random() < 0.5 ? nextRoot - 1 : nextRoot + 1
    const line = [
      root,
      Math.random() < 0.6 ? third : fifth,
      Math.random() < 0.5 ? fifth : bassRegister(root + 12),
      Math.random() < 0.7 ? approach : bassRegister(nextRoot + 7),
    ]
    line.forEach((midi, beat) => {
      bassNote(barStart + beat * BEAT_SECONDS, midi, beat === 0 ? 1 : 0.85 + Math.random() * 0.1)
    })
    // The occasional skipped eighth before beat three gives the line its bounce.
    if (Math.random() < 0.3) bassNote(slotTime(barStart, 3), line[1]!, 0.55)
  }

  function comping(barStart: number, chord: Chord): void {
    const pattern = pick(COMP_PATTERNS)
    // Rootless voicing an octave and a bit above the bass: 3rd, 7th, 9th, and sometimes the 5th.
    const voicing = [chord.tones[0]!, chord.tones[2]!, chord.tones[3]!]
    if (Math.random() < 0.5) voicing.push(chord.tones[1]!)
    for (const hit of pattern) {
      const t = slotTime(barStart, hit.slot)
      voicing.forEach((interval, i) => {
        // A light strum: each voice lands a few milliseconds after the last.
        keysNote(t + i * 0.012, chord.root + 24 + interval, hit.velocity * (0.85 + Math.random() * 0.15))
      })
    }
  }

  function brushes(barStart: number): void {
    for (let beat = 0; beat < 4; beat++) {
      const t = barStart + beat * BEAT_SECONDS
      ride(t, beat % 2 === 0 ? 0.9 : 1)
      // The swung skip note after beats two and four: "ding ding-a ding".
      if (beat % 2 === 1) ride(t + SWING * BEAT_SECONDS, 0.55)
      if (beat % 2 === 1) hat(t, 1)
    }
  }

  function vibes(barStart: number, chord: Chord): void {
    if (Math.random() < VIBES_REST_BAR_CHANCE) return
    // Every scale note over three octaves, so the melody can step or leap without leaving the key.
    const pool: number[] = []
    for (let octave = 24; octave <= 48; octave += 12) {
      for (const degree of chord.scale) pool.push(chord.root + octave + degree)
    }
    const chordTones = new Set(chord.tones.map((interval) => (chord.root + interval) % 12))
    for (let slot = 0; slot < 8; slot++) {
      const chance = slot % 2 === 0 ? VIBES_NOTE_CHANCE_ON : VIBES_NOTE_CHANCE_OFF
      if (Math.random() > chance) continue
      const near = pool.filter((m) => Math.abs(m - lastVibesMidi) <= 5 && m !== lastVibesMidi && m >= 65 && m <= 86)
      const leap = pool.filter((m) => chordTones.has(m % 12) && m >= 65 && m <= 86)
      const choices = Math.random() < 0.8 && near.length > 0 ? near : leap
      if (choices.length === 0) continue
      const midi = pick(choices)
      lastVibesMidi = midi
      vibesNote(slotTime(barStart, slot), midi, 0.7 + Math.random() * 0.3)
    }
  }

  function scheduleBar(barStart: number, barIndex: number): void {
    const chord = chordAt(barIndex)
    const next = chordAt(barIndex + 1)
    walkingBass(barStart, chord, next)
    comping(barStart, chord)
    brushes(barStart)
    vibes(barStart, chord)
  }

  function tick(): void {
    // Schedule every bar that starts inside the look-ahead window.
    while (nextBarTime < context.currentTime + LOOKAHEAD_SECONDS) {
      // If the page was in the background long enough for the clock to run past us, skip ahead
      // rather than cramming missed bars into the present.
      if (nextBarTime < context.currentTime - BAR_SECONDS) {
        nextBarTime = context.currentTime + 0.05
      }
      scheduleBar(nextBarTime, bar)
      nextBarTime += BAR_SECONDS
      bar += 1
    }
  }

  tick()
  timer = setInterval(tick, SCHEDULER_INTERVAL_MS)

  function stop(): void {
    if (timer !== null) clearInterval(timer)
    timer = null
    const now = context.currentTime
    bus.gain.setTargetAtTime(0.0001, now, 0.4)
    setTimeout(() => {
      bus.disconnect()
      tone.disconnect()
    }, 3000)
  }

  return { stop }
}
