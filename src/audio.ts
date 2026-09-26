/** Synthesised casino roulette sound effects, entirely Web Audio, no asset files. */

import type { SoundName } from './game/types.ts'
import type { CasinoMusic } from './casinoMusic.ts'
import { startCasinoMusic } from './casinoMusic.ts'

const MASTER_GAIN = 0.5
const MUTE_RAMP_SECONDS = 0.03
const NOISE_BUFFER_SECONDS = 1
/** No voice re-triggers faster than this, so a burst of identical events doesn't clip together. */
const MIN_VOICE_INTERVAL_S = 0.025
/** Rolling loop's gain and filter frequency ease toward their targets with this time constant. */
const ROLLING_TIME_CONSTANT = 0.09
/** The ball's roar: band-passed noise whose centre climbs with speed, from a slow rumble to a hiss. */
const ROLLING_MIN_FREQ = 450
const ROLLING_MAX_FREQ = 3200
/**
 * Laps per second at full rolling pitch: the ball track is about 88 in round and a full-pitch ball
 * moves at about 220 in/s. The roar swells and dips once a lap, the way a real wheel "whooms".
 */
const ROLLING_LAP_HZ_AT_FULL = 2.5
const ROLLING_LAP_HZ_MIN = 0.4
/** How far the once-a-lap swell moves the roar's loudness (fraction) and its filter centre (fraction). */
const ROLLING_LAP_GAIN_DEPTH = 0.3
const ROLLING_LAP_FREQ_DEPTH = 0.08
/** Grit: a looped buffer of tiny random ticks, a hard ball skittering over the wooden track. */
const ROLLING_GRIT_BUFFER_SECONDS = 2
const ROLLING_GRIT_TICKS_PER_SECOND = 420
const ROLLING_GRIT_HIGHPASS_HZ = 2200

/** Crowd voices (cheer/groan) are bused through a compressor so overlapping voices never clip. */
const CROWD_COMPRESSOR_THRESHOLD_DB = -18
const CROWD_COMPRESSOR_RATIO = 4
/** A crowd's reaction lands slightly after the event that caused it. */
const CROWD_REACTION_DELAY_MIN_S = 0.15
const CROWD_REACTION_DELAY_MAX_S = 0.2

/** Murmur level eases toward its "hushed while rolling" target with this time constant. */
const AMBIENCE_HUSH_TIME_CONSTANT = 0.8
const AMBIENCE_JINGLE_MIN_DELAY_MS = 5000
const AMBIENCE_JINGLE_MAX_DELAY_MS = 9000

export interface GameAudio {
  play(name: SoundName, intensity?: number): void
  /** Looping ball roll: level 0 silent to 1 loud, pitch 0 to 1. */
  setRolling(level: number, pitch: number): void
  setMuted(muted: boolean): void
  /** Call from a user gesture to unlock the AudioContext. */
  resume(): void
  dispose(): void
}

type AudioContextConstructor = typeof AudioContext
type ToneExtras = { type?: OscillatorType; endFreq?: number; attack?: number }
type Voice = (context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number) => void

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

// A short envelope: near-silent, ramp up to `peak`, ramp back down, both exponential.
function scheduleEnvelope(gain: GainNode, now: number, attack: number, peak: number, duration: number): void {
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
}

// Plays one enveloped oscillator (optionally sweeping to `endFreq`) and cleans itself up.
function playTone(
  context: AudioContext, out: AudioNode, now: number,
  freq: number, duration: number, peak: number, extras: ToneExtras = {},
): void {
  const osc = context.createOscillator()
  osc.type = extras.type ?? 'sine'
  osc.frequency.setValueAtTime(freq, now)
  if (extras.endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, extras.endFreq), now + duration)
  }
  const gain = context.createGain()
  scheduleEnvelope(gain, now, extras.attack ?? 0.006, peak, duration)
  osc.connect(gain)
  gain.connect(out)
  osc.onended = () => {
    osc.disconnect()
    gain.disconnect()
  }
  osc.start(now)
  osc.stop(now + duration + 0.02)
}

/** Plays one enveloped, band-passed slice of the shared noise buffer and cleans itself up. */
function playNoiseBurst(
  context: AudioContext, out: AudioNode, buffer: AudioBuffer, now: number,
  freq: number, q: number, duration: number, peak: number, attack = 0.003,
): void {
  const source = context.createBufferSource()
  source.buffer = buffer
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = freq
  filter.Q.value = q
  const gain = context.createGain()
  scheduleEnvelope(gain, now, attack, peak, duration)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(out)
  source.onended = () => {
    source.disconnect()
    filter.disconnect()
    gain.disconnect()
  }
  source.start(now)
  source.stop(now + duration + 0.02)
}

/** Plays a short staggered run of tones. */
function playArpeggio(
  context: AudioContext, out: AudioNode, now: number,
  freqs: readonly number[], noteDuration: number, peak: number, extras: ToneExtras, stagger: number,
): void {
  freqs.forEach((freq, i) => playTone(context, out, now + i * stagger, freq, noteDuration, peak, extras))
}

// ---------------------------------------------------------------------------------------------
// One voice per SoundName. The `Record` below makes the compiler check every name has a voice.
// ---------------------------------------------------------------------------------------------

function voiceChip(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.7 + 0.3 * clamp01(intensity)
  playNoiseBurst(context, out, buffer, now, 3200, 5, 0.02, 0.07 * amount, 0.001)
  playNoiseBurst(context, out, buffer, now + 0.025, 3600, 5.5, 0.018, 0.06 * amount, 0.001)
}

function voiceChipRemove(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.6 + 0.4 * clamp01(intensity)
  playNoiseBurst(context, out, buffer, now, 1400, 3.5, 0.03, 0.05 * amount, 0.002)
  playNoiseBurst(context, out, buffer, now + 0.03, 1200, 3, 0.03, 0.04 * amount, 0.002)
}

function voiceClear(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.7 + 0.3 * clamp01(intensity)
  const count = 7
  for (let i = 0; i < count; i++) {
    const t = now + i * 0.032 + Math.random() * 0.006
    const freq = 2600 + Math.random() * 1200
    playNoiseBurst(context, out, buffer, t, freq, 4.5, 0.02, 0.05 * amount * (1 - i / (count * 1.6)), 0.001)
  }
}

function voiceLaunch(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.7 + 0.3 * clamp01(intensity)
  const source = context.createBufferSource()
  source.buffer = buffer
  source.loop = true
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 1.4
  filter.frequency.setValueAtTime(300, now)
  filter.frequency.exponentialRampToValueAtTime(2200, now + 0.32)
  const gain = context.createGain()
  scheduleEnvelope(gain, now, 0.05, 0.09 * amount, 0.34)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(out)
  source.start(now)
  source.stop(now + 0.36)
  source.onended = () => {
    source.disconnect()
    filter.disconnect()
    gain.disconnect()
  }
  // The ball meeting the track as it leaves the croupier's fingers: a hard little tick and thud.
  playNoiseBurst(context, out, buffer, now + 0.3, 3000, 4, 0.025, 0.07 * amount, 0.0008)
  playTone(context, out, now + 0.3, 240, 0.05, 0.04 * amount, { type: 'sine', endFreq: 140, attack: 0.002 })
}

function voiceNoMoreBets(context: AudioContext, out: GainNode, _buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.1 * (0.8 + 0.2 * clamp01(intensity))
  playTone(context, out, now, 1600, 0.55, peak, { type: 'sine', attack: 0.002 })
  playTone(context, out, now, 3200, 0.35, peak * 0.4, { type: 'sine', attack: 0.002 })
}

function voiceDiamond(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = clamp01(intensity)
  playNoiseBurst(context, out, buffer, now, 2400 + amount * 800, 6, 0.03, 0.03 + amount * 0.11, 0.001)
  playTone(context, out, now, 900 + amount * 300, 0.05, 0.02 + amount * 0.07, { type: 'triangle', endFreq: 500, attack: 0.001 })
}

function voiceFret(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = clamp01(intensity)
  const jitter = 1 + (Math.random() - 0.5) * 0.5
  playNoiseBurst(context, out, buffer, now, 4200 * jitter, 8, 0.012, 0.02 + amount * 0.06, 0.0005)
}

function voiceRim(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = clamp01(intensity)
  playNoiseBurst(context, out, buffer, now, 500 + amount * 200, 1.6, 0.05, 0.03 + amount * 0.07, 0.004)
  playTone(context, out, now, 150, 0.06, 0.02 + amount * 0.05, { type: 'sine', endFreq: 90, attack: 0.005 })
}

function voiceDrop(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.6 + 0.4 * clamp01(intensity)
  for (let i = 0; i < 4; i++) {
    const t = now + i * 0.028
    playNoiseBurst(context, out, buffer, t, 1800 - i * 260, 3.5, 0.02, 0.05 * amount * (1 - i * 0.16), 0.001)
  }
  playTone(context, out, now, 500, 0.14, 0.05 * amount, { type: 'sine', endFreq: 200, attack: 0.006 })
}

function voicePocketDrop(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.6 + 0.4 * clamp01(intensity)
  for (let i = 0; i < 5; i++) {
    const t = now + i * 0.02 + Math.random() * 0.006
    playNoiseBurst(context, out, buffer, t, 1600 + Math.random() * 900, 3.2, 0.018, 0.05 * amount, 0.001)
  }
}

function voiceSettle(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.7 + 0.3 * clamp01(intensity)
  playNoiseBurst(context, out, buffer, now, 1100, 3, 0.02, 0.04 * amount, 0.001)
  playTone(context, out, now + 0.006, 130, 0.14, 0.06 * amount, { type: 'sine', endFreq: 60, attack: 0.008 })
}

function voiceWin(context: AudioContext, out: GainNode, _buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.11 * (0.8 + 0.2 * clamp01(intensity))
  playArpeggio(context, out, now, [523.25, 659.25, 783.99], 0.16, peak, { type: 'triangle', attack: 0.008 }, 0.1)
}

function voiceBigWin(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.13 * (0.85 + 0.15 * clamp01(intensity))
  playArpeggio(
    context, out, now, [392, 523.25, 659.25, 783.99, 1046.5], 0.12, peak,
    { type: 'sawtooth', attack: 0.005 }, 0.07,
  )
  for (let i = 0; i < 6; i++) {
    const t = now + 0.1 + i * 0.05 + Math.random() * 0.03
    playNoiseBurst(context, out, buffer, t, 3200 + Math.random() * 2200, 7, 0.03, peak * 0.35, 0.001)
  }
}

function voiceLose(context: AudioContext, out: GainNode, _buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.08 * (0.8 + 0.2 * clamp01(intensity))
  playArpeggio(context, out, now, [220, 164.81], 0.22, peak, { type: 'sine', attack: 0.015 }, 0.16)
}

function voiceRefill(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.8 + 0.2 * clamp01(intensity)
  const notes = [1046.5, 1318.51, 1567.98, 2093, 1567.98, 2093]
  for (let i = 0; i < notes.length; i++) {
    const t = now + i * 0.06
    playTone(context, out, t, notes[i]!, 0.14, 0.06 * amount, { type: 'triangle', attack: 0.003 })
    playNoiseBurst(context, out, buffer, t, 4000, 6, 0.015, 0.02 * amount, 0.001)
  }
}

function voiceDenied(context: AudioContext, out: GainNode, _buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.07 * (0.8 + 0.2 * clamp01(intensity))
  playTone(context, out, now, 110, 0.18, peak, { type: 'square', endFreq: 90, attack: 0.01 })
  playTone(context, out, now, 116, 0.18, peak * 0.7, { type: 'square', endFreq: 95, attack: 0.01 })
}

// --- Crowd cheer/groan helpers --------------------------------------------------------------------
// `out` for both is the lazily-created crowd bus (see `ensureCrowdBus`), never the master directly.

const CHEER_ROAR_FREQS = [500, 1100, 2300] as const

/** One looped, band-passed noise layer of the cheer's roar bed: swelling in, easing out, roughened by a slow LFO. */
function playCheerRoarLayer(
  context: AudioContext, out: AudioNode, buffer: AudioBuffer,
  start: number, duration: number, freq: number, peak: number,
): void {
  const source = context.createBufferSource()
  source.buffer = buffer
  source.loop = true
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = freq
  filter.Q.value = 1.2

  const gain = context.createGain()
  const releaseAt = start + Math.max(0.3, duration - 1.2)
  const stop = start + duration
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.25)
  gain.gain.exponentialRampToValueAtTime(peak * 0.7, releaseAt)
  gain.gain.exponentialRampToValueAtTime(0.0001, stop)

  const lfo = context.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 5 + Math.random() * 4
  const lfoDepth = context.createGain()
  lfoDepth.gain.value = peak * 0.18
  lfo.connect(lfoDepth)
  lfoDepth.connect(gain.gain)

  source.connect(filter)
  filter.connect(gain)
  gain.connect(out)

  source.start(start)
  lfo.start(start)
  source.stop(stop + 0.05)
  lfo.stop(stop + 0.05)
  source.onended = () => {
    source.disconnect()
    filter.disconnect()
    gain.disconnect()
  }
  lfo.onended = () => {
    lfo.disconnect()
    lfoDepth.disconnect()
  }
}

/** One shouted "woo/yeah" voice: a rising-then-falling sawtooth through two vowel formants. */
function playCheerShout(context: AudioContext, out: AudioNode, start: number, freq: number, len: number, peak: number): void {
  const osc = context.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(freq, start)
  osc.frequency.exponentialRampToValueAtTime(freq * 1.35, start + 0.35)
  osc.frequency.exponentialRampToValueAtTime(freq * 0.9, start + len)

  const vibrato = context.createOscillator()
  vibrato.type = 'sine'
  vibrato.frequency.value = 5 + Math.random() * 2
  const vibratoDepth = context.createGain()
  vibratoDepth.gain.value = freq * 0.02
  vibrato.connect(vibratoDepth)
  vibratoDepth.connect(osc.frequency)

  const formant1 = context.createBiquadFilter()
  formant1.type = 'bandpass'
  formant1.frequency.value = 750
  formant1.Q.value = 6
  const formant2 = context.createBiquadFilter()
  formant2.type = 'bandpass'
  formant2.frequency.value = 1200
  formant2.Q.value = 8

  const gain = context.createGain()
  scheduleEnvelope(gain, start, 0.05, peak, len)

  osc.connect(formant1)
  osc.connect(formant2)
  formant1.connect(gain)
  formant2.connect(gain)
  gain.connect(out)

  const stop = start + len + 0.05
  osc.start(start)
  vibrato.start(start)
  osc.stop(stop)
  vibrato.stop(stop)
  osc.onended = () => {
    osc.disconnect()
    formant1.disconnect()
    formant2.disconnect()
    gain.disconnect()
  }
  vibrato.onended = () => {
    vibrato.disconnect()
    vibratoDepth.disconnect()
  }
}

/** One two-finger whistle: a sine gliding up then down. */
function playCheerWhistle(context: AudioContext, out: AudioNode, start: number, freq: number, peak: number): void {
  const osc = context.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, start)
  osc.frequency.exponentialRampToValueAtTime(freq * 1.2, start + 0.25)
  osc.frequency.exponentialRampToValueAtTime(freq * 1.2 * 0.7, start + 0.75)
  const gain = context.createGain()
  scheduleEnvelope(gain, start, 0.03, peak, 0.75)
  osc.connect(gain)
  gain.connect(out)
  osc.start(start)
  osc.stop(start + 0.8)
  osc.onended = () => {
    osc.disconnect()
    gain.disconnect()
  }
}

function voiceCheer(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const s = clamp01(intensity)
  const start = now + CROWD_REACTION_DELAY_MIN_S + Math.random() * (CROWD_REACTION_DELAY_MAX_S - CROWD_REACTION_DELAY_MIN_S)
  const duration = 3.2 + 1.8 * s
  // Combined peak: a little above `bigWin`'s ~0.13 at s = 1, about half that at s = 0.3.
  const peak = 0.04 + 0.11 * s

  for (const freq of CHEER_ROAR_FREQS) {
    playCheerRoarLayer(context, out, buffer, start, duration, freq, peak * 0.4)
  }

  const shoutCount = Math.round(5 + 9 * s)
  for (let i = 0; i < shoutCount; i++) {
    const shoutStart = start + Math.random() * duration * 0.6
    const len = 0.6 + Math.random() * 0.5
    const freq = 180 + Math.random() * 240
    playCheerShout(context, out, shoutStart, freq, len, peak * 0.55)
  }

  const whistleCount = Math.round(1 + 3 * s)
  for (let i = 0; i < whistleCount; i++) {
    const whistleStart = start + Math.random() * duration * 0.6
    const freq = 2200 + Math.random() * 800
    playCheerWhistle(context, out, whistleStart, freq, peak * 0.45)
  }

  const clapCount = Math.round(20 + 60 * s)
  for (let i = 0; i < clapCount; i++) {
    // Product of two randoms skews early: dense just after the roar swells in, thin by the end.
    const bias = Math.random() * Math.random()
    const t = start + 0.6 + bias * Math.max(0.1, duration - 0.9)
    const freq = 1500 + Math.random() * 1000
    playNoiseBurst(context, out, buffer, t, freq, 1.5, 0.02 + Math.random() * 0.015, peak * (0.4 + Math.random() * 0.4), 0.002)
  }
}

/**
 * One voice of a disappointed "awww": a sawtooth glottal source whose pitch lifts briefly then sags
 * by about a third, through "aw" vowel formants that close towards "oh" as it fades.
 */
function playGroanVoice(context: AudioContext, out: AudioNode, start: number, freq: number, length: number, peak: number): void {
  const osc = context.createOscillator()
  osc.type = 'sawtooth'
  osc.detune.value = (Math.random() - 0.5) * 30
  const lift = 0.12 + Math.random() * 0.1
  osc.frequency.setValueAtTime(freq, start)
  osc.frequency.linearRampToValueAtTime(freq * 1.1, start + lift)
  osc.frequency.exponentialRampToValueAtTime(freq * (0.64 + Math.random() * 0.1), start + length)

  // A little unsteadiness, as a sigh has.
  const vibrato = context.createOscillator()
  vibrato.type = 'sine'
  vibrato.frequency.value = 5 + Math.random() * 2
  const vibratoDepth = context.createGain()
  vibratoDepth.gain.value = freq * 0.012
  vibrato.connect(vibratoDepth)
  vibratoDepth.connect(osc.frequency)

  const lowpass = context.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = 2400

  const formant1 = context.createBiquadFilter()
  formant1.type = 'bandpass'
  formant1.Q.value = 4
  formant1.frequency.setValueAtTime(720, start)
  formant1.frequency.exponentialRampToValueAtTime(480, start + length)
  const formant2 = context.createBiquadFilter()
  formant2.type = 'bandpass'
  formant2.Q.value = 7
  formant2.frequency.setValueAtTime(1150, start)
  formant2.frequency.exponentialRampToValueAtTime(850, start + length)
  const formant2Gain = context.createGain()
  formant2Gain.gain.value = 0.5

  const gain = context.createGain()
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.12)
  gain.gain.setValueAtTime(peak, start + length * 0.35)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length)

  osc.connect(lowpass)
  lowpass.connect(formant1)
  lowpass.connect(formant2)
  formant1.connect(gain)
  formant2.connect(formant2Gain)
  formant2Gain.connect(gain)
  gain.connect(out)

  const stop = start + length + 0.05
  osc.start(start)
  vibrato.start(start)
  osc.stop(stop)
  vibrato.stop(stop)
  osc.onended = () => {
    osc.disconnect()
    lowpass.disconnect()
    formant1.disconnect()
    formant2.disconnect()
    formant2Gain.disconnect()
    gain.disconnect()
  }
  vibrato.onended = () => {
    vibrato.disconnect()
    vibratoDepth.disconnect()
  }
}

/** The crowd's sad "awww" at a loss: a chorus of falling voices over a breathy sigh. */
function voiceGroan(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const s = clamp01(intensity)
  const start = now + CROWD_REACTION_DELAY_MIN_S + Math.random() * (CROWD_REACTION_DELAY_MAX_S - CROWD_REACTION_DELAY_MIN_S)
  const duration = 1.6 + 1.0 * s
  // Same combined-loudness target as the cheer.
  const peak = 0.04 + 0.11 * s

  const voiceCount = Math.round(6 + 8 * s)
  for (let i = 0; i < voiceCount; i++) {
    const stagger = Math.random() * 0.3
    // Mostly lower voices, a third higher ones.
    const freq = Math.random() < 1 / 3 ? 210 + Math.random() * 70 : 105 + Math.random() * 60
    const length = Math.max(0.6, duration - stagger) * (0.8 + Math.random() * 0.2)
    playGroanVoice(context, out, start + stagger, freq, length, peak * (0.4 + Math.random() * 0.3))
  }

  // Breathy sigh under the voices, falling in brightness with them.
  const breathSource = context.createBufferSource()
  breathSource.buffer = buffer
  breathSource.loop = true
  const breathFilter = context.createBiquadFilter()
  breathFilter.type = 'bandpass'
  breathFilter.Q.value = 0.8
  breathFilter.frequency.setValueAtTime(1100, start)
  breathFilter.frequency.exponentialRampToValueAtTime(450, start + duration)
  const breathGain = context.createGain()
  const breathStop = start + duration + 0.3
  breathGain.gain.setValueAtTime(0.0001, start)
  breathGain.gain.exponentialRampToValueAtTime(peak * 0.25, start + 0.2)
  breathGain.gain.exponentialRampToValueAtTime(0.0001, breathStop)
  breathSource.connect(breathFilter)
  breathFilter.connect(breathGain)
  breathGain.connect(out)
  breathSource.start(start)
  breathSource.stop(breathStop + 0.05)
  breathSource.onended = () => {
    breathSource.disconnect()
    breathFilter.disconnect()
    breathGain.disconnect()
  }
}

// Every `SoundName` maps to a voice; a missing or misspelled key fails to type-check.
const VOICES: Record<SoundName, Voice> = {
  chip: voiceChip,
  chipRemove: voiceChipRemove,
  clear: voiceClear,
  launch: voiceLaunch,
  noMoreBets: voiceNoMoreBets,
  diamond: voiceDiamond,
  fret: voiceFret,
  rim: voiceRim,
  drop: voiceDrop,
  pocketDrop: voicePocketDrop,
  settle: voiceSettle,
  win: voiceWin,
  bigWin: voiceBigWin,
  lose: voiceLose,
  cheer: voiceCheer,
  groan: voiceGroan,
  refill: voiceRefill,
  denied: voiceDenied,
}

/**
 * The rolling-ball loop. Roar (band-passed noise) and body (low-passed noise) share `lapGain`,
 * which `lapLfo` swells once a lap; grit (the tick buffer) plays alongside, faster as the ball is.
 */
interface RollingNodes {
  source: AudioBufferSourceNode
  roarFilter: BiquadFilterNode
  roarGain: GainNode
  bodyFilter: BiquadFilterNode
  bodyGain: GainNode
  lapGain: GainNode
  lapLfo: OscillatorNode
  lapLfoGain: GainNode
  lapLfoFreqDepth: GainNode
  grit: AudioBufferSourceNode
  gritFilter: BiquadFilterNode
  gritGain: GainNode
}

/** The crowd bus that `voiceCheer`/`voiceGroan` play into: GainNode -> DynamicsCompressorNode -> master. */
interface CrowdBusNodes {
  input: GainNode
  compressor: DynamicsCompressorNode
}

/** Continuous casino room tone: a lounge-music bed (eased by `setRolling`) plus a scheduled slot jingle. */
interface AmbienceNodes {
  musicBus: GainNode
  music: CasinoMusic
  jingleTimeout: ReturnType<typeof setTimeout> | null
}

export function createAudio(): GameAudio {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let noiseBuffer: AudioBuffer | null = null
  let rolling: RollingNodes | null = null
  let crowdBus: CrowdBusNodes | null = null
  let ambience: AmbienceNodes | null = null
  let unlocked = false
  let muted = false
  const lastPlayedAt = new Map<SoundName, number>()

  function ensureContext(): boolean {
    if (ctx && master) return true
    try {
      const w = window as unknown as {
        AudioContext?: AudioContextConstructor
        webkitAudioContext?: AudioContextConstructor
      }
      const Ctor = w.AudioContext ?? w.webkitAudioContext
      if (!Ctor) return false
      const context = new Ctor()
      const gain = context.createGain()
      gain.gain.value = muted ? 0 : MASTER_GAIN
      gain.connect(context.destination)
      ctx = context
      master = gain
      return true
    } catch {
      ctx = null
      master = null
      return false
    }
  }

  /** One shared noise buffer, generated once and reused by every noise-based voice. */
  function getNoiseBuffer(context: AudioContext): AudioBuffer {
    if (noiseBuffer) return noiseBuffer
    const length = Math.floor(context.sampleRate * NOISE_BUFFER_SECONDS)
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    noiseBuffer = buffer
    return buffer
  }

  /** Lazily builds the crowd bus that `cheer`/`groan` voices play into. */
  function ensureCrowdBus(context: AudioContext, out: GainNode): GainNode {
    if (crowdBus) return crowdBus.input
    const input = context.createGain()
    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = CROWD_COMPRESSOR_THRESHOLD_DB
    compressor.ratio.value = CROWD_COMPRESSOR_RATIO
    input.connect(compressor)
    compressor.connect(out)
    crowdBus = { input, compressor }
    return input
  }

  function playJingle(context: AudioContext, out: GainNode): void {
    const now = context.currentTime
    const root = 700 + Math.random() * 300
    const ratios = [1, 1.125, 1.25, 1.5, 1.667, 1.875, 2]
    const noteCount = 4 + Math.floor(Math.random() * 4)
    const lowpass = context.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 2500
    lowpass.connect(out)
    for (let i = 0; i < noteCount; i++) {
      const ratio = ratios[Math.floor(Math.random() * ratios.length)]!
      const freq = root * ratio
      const t = now + i * 0.14
      const osc = context.createOscillator()
      osc.type = i % 2 === 0 ? 'triangle' : 'sine'
      osc.frequency.value = freq
      const gain = context.createGain()
      scheduleEnvelope(gain, t, 0.01, 0.015, 0.18)
      osc.connect(gain)
      gain.connect(lowpass)
      osc.start(t)
      osc.stop(t + 0.2)
      osc.onended = () => {
        osc.disconnect()
        gain.disconnect()
      }
    }
    // The shared lowpass outlives the last note briefly, then disconnects itself.
    setTimeout(() => lowpass.disconnect(), noteCount * 140 + 260)
  }

  function scheduleNextJingle(): void {
    if (!ambience) return
    const delay = AMBIENCE_JINGLE_MIN_DELAY_MS + Math.random() * (AMBIENCE_JINGLE_MAX_DELAY_MS - AMBIENCE_JINGLE_MIN_DELAY_MS)
    ambience.jingleTimeout = setTimeout(() => {
      try {
        if (ctx && master && !muted && ctx.state === 'running') playJingle(ctx, master)
      } catch { /* no-op: audio is optional */ }
      scheduleNextJingle()
    }, delay)
  }

  /** Starts the background lounge music (plus its jingle schedule) once, on the first unlock. */
  function startAmbience(): void {
    if (ambience || !ctx || !master) return
    try {
      const context = ctx
      const out = master
      const musicBus = context.createGain()
      musicBus.gain.value = 1
      musicBus.connect(out)
      const music = startCasinoMusic(context, musicBus)
      ambience = { musicBus, music, jingleTimeout: null }
      scheduleNextJingle()
    } catch { /* no-op: audio is optional */ }
  }

  function resume(): void {
    try {
      if (!ensureContext() || !ctx) return
      if (ctx.state === 'suspended') void ctx.resume()
      unlocked = true
      startAmbience()
    } catch { /* no-op: audio is optional */ }
  }

  function setMuted(nextMuted: boolean): void {
    muted = nextMuted
    if (!ctx || !master) return
    try {
      const now = ctx.currentTime
      const target = muted ? 0 : MASTER_GAIN
      master.gain.cancelScheduledValues(now)
      master.gain.setValueAtTime(master.gain.value, now)
      master.gain.linearRampToValueAtTime(target, now + MUTE_RAMP_SECONDS)
    } catch { /* no-op: audio is optional */ }
  }

  function canPlay(): boolean {
    return unlocked && !muted && ctx !== null && master !== null
  }

  /** Runs `action` with the live context/master gain when playable, and never throws. */
  function withAudio(action: (context: AudioContext, out: GainNode) => void): void {
    if (!canPlay() || !ctx || !master) return
    try {
      action(ctx, master)
    } catch { /* no-op: audio is optional */ }
  }

  function play(name: SoundName, intensity = 1): void {
    withAudio((context, out) => {
      const now = context.currentTime
      const last = lastPlayedAt.get(name) ?? -Infinity
      if (now - last < MIN_VOICE_INTERVAL_S) return
      lastPlayedAt.set(name, now)
      const target = name === 'cheer' || name === 'groan' ? ensureCrowdBus(context, out) : out
      VOICES[name](context, target, getNoiseBuffer(context), now, clamp01(intensity))
    })
  }

  /** A looped buffer of sparse, tiny decaying ticks at random strengths: the track's grit. */
  function createGritBuffer(context: AudioContext): AudioBuffer {
    const length = Math.floor(context.sampleRate * ROLLING_GRIT_BUFFER_SECONDS)
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)
    const tickCount = Math.round(ROLLING_GRIT_TICKS_PER_SECOND * ROLLING_GRIT_BUFFER_SECONDS)
    const decaySamples = context.sampleRate * 0.0004
    for (let t = 0; t < tickCount; t++) {
      const at = Math.floor(Math.random() * length)
      // Mostly faint, the odd sharper one.
      const strength = Math.pow(Math.random(), 2.5) * (Math.random() < 0.5 ? -1 : 1)
      for (let k = 0; k < decaySamples * 5 && at + k < length; k++) {
        data[at + k] += strength * Math.exp(-k / decaySamples) * (Math.random() * 2 - 1)
      }
    }
    return buffer
  }

  /** Lazily builds the rolling-ball loop, silent until `setRolling` eases it up. */
  function ensureRolling(context: AudioContext, out: GainNode): RollingNodes {
    if (rolling) return rolling
    const now = context.currentTime
    const source = context.createBufferSource()
    source.buffer = getNoiseBuffer(context)
    source.loop = true

    // Once-a-lap swell shared by the roar and the body.
    const lapGain = context.createGain()
    lapGain.gain.value = 1
    lapGain.connect(out)
    const lapLfo = context.createOscillator()
    lapLfo.type = 'sine'
    lapLfo.frequency.value = ROLLING_LAP_HZ_MIN
    const lapLfoGain = context.createGain()
    lapLfoGain.gain.value = ROLLING_LAP_GAIN_DEPTH
    lapLfo.connect(lapLfoGain)
    lapLfoGain.connect(lapGain.gain)

    const roarFilter = context.createBiquadFilter()
    roarFilter.type = 'bandpass'
    roarFilter.Q.value = 1.6
    roarFilter.frequency.value = ROLLING_MIN_FREQ
    const lapLfoFreqDepth = context.createGain()
    lapLfoFreqDepth.gain.value = 0
    lapLfo.connect(lapLfoFreqDepth)
    lapLfoFreqDepth.connect(roarFilter.frequency)
    const roarGain = context.createGain()
    roarGain.gain.value = 0
    source.connect(roarFilter)
    roarFilter.connect(roarGain)
    roarGain.connect(lapGain)

    // The wooden bowl resonating under the ball.
    const bodyFilter = context.createBiquadFilter()
    bodyFilter.type = 'lowpass'
    bodyFilter.Q.value = 2
    bodyFilter.frequency.value = 180
    const bodyGain = context.createGain()
    bodyGain.gain.value = 0
    source.connect(bodyFilter)
    bodyFilter.connect(bodyGain)
    bodyGain.connect(lapGain)

    const grit = context.createBufferSource()
    grit.buffer = createGritBuffer(context)
    grit.loop = true
    const gritFilter = context.createBiquadFilter()
    gritFilter.type = 'highpass'
    gritFilter.frequency.value = ROLLING_GRIT_HIGHPASS_HZ
    const gritGain = context.createGain()
    gritGain.gain.value = 0
    grit.connect(gritFilter)
    gritFilter.connect(gritGain)
    gritGain.connect(out)

    source.start(now)
    grit.start(now, Math.random() * ROLLING_GRIT_BUFFER_SECONDS)
    lapLfo.start(now)

    rolling = {
      source, roarFilter, roarGain, bodyFilter, bodyGain, lapGain, lapLfo, lapLfoGain, lapLfoFreqDepth,
      grit, gritFilter, gritGain,
    }
    return rolling
  }

  function setRolling(level: number, pitch: number): void {
    withAudio((context, out) => {
      const nodes = ensureRolling(context, out)
      const now = context.currentTime
      const amount = clamp01(level)
      const p = clamp01(pitch)
      const freq = ROLLING_MIN_FREQ * Math.pow(ROLLING_MAX_FREQ / ROLLING_MIN_FREQ, p)
      nodes.roarGain.gain.setTargetAtTime(amount * 0.3, now, ROLLING_TIME_CONSTANT)
      nodes.bodyGain.gain.setTargetAtTime(amount * 0.8, now, ROLLING_TIME_CONSTANT)
      // The skitter stands out more as the ball slows and starts to chatter.
      nodes.gritGain.gain.setTargetAtTime(amount * 0.12 * (1.3 - 0.5 * p), now, ROLLING_TIME_CONSTANT)
      nodes.grit.playbackRate.setTargetAtTime(0.6 + 0.9 * p, now, ROLLING_TIME_CONSTANT)
      nodes.roarFilter.frequency.setTargetAtTime(freq, now, ROLLING_TIME_CONSTANT)
      nodes.lapLfoFreqDepth.gain.setTargetAtTime(freq * ROLLING_LAP_FREQ_DEPTH, now, ROLLING_TIME_CONSTANT)
      nodes.lapLfo.frequency.setTargetAtTime(
        Math.max(ROLLING_LAP_HZ_MIN, ROLLING_LAP_HZ_AT_FULL * p), now, ROLLING_TIME_CONSTANT,
      )
      // The crowd hushes while the ball rolls.
      if (ambience) {
        ambience.musicBus.gain.setTargetAtTime(1 - 0.6 * amount, now, AMBIENCE_HUSH_TIME_CONSTANT)
      }
    })
  }

  function dispose(): void {
    try {
      if (rolling) {
        rolling.source.stop()
        rolling.grit.stop()
        rolling.lapLfo.stop()
        for (const node of [
          rolling.source, rolling.roarFilter, rolling.roarGain, rolling.bodyFilter, rolling.bodyGain,
          rolling.lapGain, rolling.lapLfo, rolling.lapLfoGain, rolling.lapLfoFreqDepth,
          rolling.grit, rolling.gritFilter, rolling.gritGain,
        ]) node.disconnect()
      }
      if (ambience) {
        if (ambience.jingleTimeout !== null) clearTimeout(ambience.jingleTimeout)
        ambience.music.stop()
        ambience.musicBus.disconnect()
      }
      if (crowdBus) {
        crowdBus.input.disconnect()
        crowdBus.compressor.disconnect()
      }
      master?.disconnect()
      void ctx?.close()
    } catch { /* no-op: audio is optional */ } finally {
      rolling = null
      ambience = null
      crowdBus = null
      noiseBuffer = null
      ctx = null
      master = null
      unlocked = false
      lastPlayedAt.clear()
    }
  }

  return { play, setRolling, setMuted, resume, dispose }
}
