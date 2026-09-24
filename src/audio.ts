/** Synthesised casino roulette sound effects, entirely Web Audio, no asset files. */

import type { SoundName } from './game/types.ts'

const MASTER_GAIN = 0.5
const MUTE_RAMP_SECONDS = 0.03
const NOISE_BUFFER_SECONDS = 1
/** No voice re-triggers faster than this, so a burst of identical events doesn't clip together. */
const MIN_VOICE_INTERVAL_S = 0.025
/** Rolling loop's gain and filter frequency ease toward their targets with this time constant. */
const ROLLING_TIME_CONSTANT = 0.09
const ROLLING_MIN_FREQ = 700
const ROLLING_MAX_FREQ = 2600

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
  playTone(context, out, now + 0.3, 900, 0.06, 0.08 * amount, { type: 'triangle', endFreq: 1400, attack: 0.004 })
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
  refill: voiceRefill,
  denied: voiceDenied,
}

interface RollingNodes {
  source: AudioBufferSourceNode
  filter: BiquadFilterNode
  noiseGain: GainNode
  rumble: OscillatorNode
  rumbleGain: GainNode
}

export function createAudio(): GameAudio {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let noiseBuffer: AudioBuffer | null = null
  let rolling: RollingNodes | null = null
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

  function resume(): void {
    try {
      if (!ensureContext() || !ctx) return
      if (ctx.state === 'suspended') void ctx.resume()
      unlocked = true
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

  function play(name: SoundName, intensity = 1): void {
    withAudio((context, out) => {
      const now = context.currentTime
      const last = lastPlayedAt.get(name) ?? -Infinity
      if (now - last < MIN_VOICE_INTERVAL_S) return
      lastPlayedAt.set(name, now)
      VOICES[name](context, out, getNoiseBuffer(context), now, clamp01(intensity))
    })
  }

  /** Lazily builds the rolling-ball loop: filtered noise plus a faint low rumble, both silent until eased up. */
  function ensureRolling(context: AudioContext, out: GainNode): RollingNodes {
    if (rolling) return rolling
    const source = context.createBufferSource()
    source.buffer = getNoiseBuffer(context)
    source.loop = true
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = 0.9
    filter.frequency.value = ROLLING_MIN_FREQ
    const noiseGain = context.createGain()
    noiseGain.gain.value = 0
    source.connect(filter)
    filter.connect(noiseGain)
    noiseGain.connect(out)
    source.start(context.currentTime)

    const rumble = context.createOscillator()
    rumble.type = 'sine'
    rumble.frequency.value = 46
    const rumbleGain = context.createGain()
    rumbleGain.gain.value = 0
    rumble.connect(rumbleGain)
    rumbleGain.connect(out)
    rumble.start(context.currentTime)

    rolling = { source, filter, noiseGain, rumble, rumbleGain }
    return rolling
  }

  function setRolling(level: number, pitch: number): void {
    withAudio((context, out) => {
      const nodes = ensureRolling(context, out)
      const now = context.currentTime
      const amount = clamp01(level)
      const p = clamp01(pitch)
      const freq = ROLLING_MIN_FREQ * Math.pow(ROLLING_MAX_FREQ / ROLLING_MIN_FREQ, p)
      const target = amount * 0.35
      nodes.noiseGain.gain.setTargetAtTime(target, now, ROLLING_TIME_CONSTANT)
      nodes.rumbleGain.gain.setTargetAtTime(target * 0.4, now, ROLLING_TIME_CONSTANT)
      nodes.filter.frequency.setTargetAtTime(freq, now, ROLLING_TIME_CONSTANT)
    })
  }

  function dispose(): void {
    try {
      if (rolling) {
        rolling.source.stop()
        rolling.rumble.stop()
        rolling.source.disconnect()
        rolling.filter.disconnect()
        rolling.noiseGain.disconnect()
        rolling.rumble.disconnect()
        rolling.rumbleGain.disconnect()
      }
      master?.disconnect()
      void ctx?.close()
    } catch { /* no-op: audio is optional */ } finally {
      rolling = null
      noiseBuffer = null
      ctx = null
      master = null
      unlocked = false
      lastPlayedAt.clear()
    }
  }

  return { play, setRolling, setMuted, resume, dispose }
}
