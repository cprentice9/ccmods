import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { WorkingTurn } from '../types'

const KEY = 'clawd'
const WIDTH = 32
const HEIGHT = 8
const ROWS = HEIGHT / 2
const TICK_MS = 180
const working = atom({ plugin: 'working-clawd', key: 'turnId' } as const, null as WorkingTurn)

const CLEAR = -1
const DEFAULT = 0x01000000
const ORANGE = 0xd77757
const FRAME = 0x5c6370
const SCREEN = 0x1f2633
const BASE = 0xb4b8bf
const EDGE = 0x7d828c
const TEAL = 0x7fb4ca
const LAVENDER = 0xb4a7d6
const MUTED = 0x8a8f98

// Clawd as the CLI logo draws him: eyes are holes, arms are drawn per frame.
const BODY = [
  '...OOOOOOOOOOOO',
  '...OOEOOOOOOEOO',
  '...OOOOOOOOOOOO',
  '...OOOOOOOOOOOO',
  '....O.O....O.O.',
]

// Lines of code on the screen: an indent, then runs of colored pixels.
const CODE: [number, [number, number][]][] = [
  [0, [[3, LAVENDER], [6, TEAL]]],
  [1, [[4, ORANGE], [3, MUTED]]],
  [1, [[2, LAVENDER], [5, TEAL], [1, MUTED]]],
  [2, [[6, ORANGE]]],
  [1, [[3, TEAL], [4, MUTED]]],
  [0, [[1, LAVENDER]]],
  [0, [[5, ORANGE], [2, MUTED]]],
  [1, [[7, TEAL]]],
]
const LINE = 10

const linePixels = (i: number) => {
  const [indent, runs] = CODE[i % CODE.length]!
  const px: number[] = Array(indent).fill(SCREEN)
  for (const [n, color] of runs) px.push(...Array(n).fill(color), SCREEN)
  return px.slice(0, LINE)
}

// One frame as Raster cells. Each keystroke adds a pixel to the bottom line
// of the screen; a full line scrolls up. The arms take turns on the keys, and
// Clawd blinks every 16th frame.
export const frame = (t: number) => {
  const px = new Int32Array(WIDTH * HEIGHT).fill(CLEAR)
  const set = (x: number, y: number, color: number) => (px[y * WIDTH + x] = color)

  BODY.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === 'O' || (ch === 'E' && t % 16 === 15)) set(x, y + 3, ORANGE)
  }))
  const isLeftUp = t % 2 === 0
  set(2, 5, ORANGE)
  set(1, isLeftUp ? 5 : 6, ORANGE)
  set(15, 5, ORANGE)
  set(16, isLeftUp ? 6 : 5, ORANGE)

  for (let x = 20; x < WIDTH; x++) {
    set(x, 0, FRAME)
    set(x, 5, FRAME)
  }
  for (let y = 1; y < 5; y++) {
    set(20, y, FRAME)
    set(WIDTH - 1, y, FRAME)
    for (let x = 21; x < WIDTH - 1; x++) set(x, y, SCREEN)
  }
  const line = Math.floor(t / LINE)
  for (let row = 0; row < 4; row++) {
    const i = line - 3 + row
    if (i < 0) continue
    const code = linePixels(i).slice(0, row === 3 ? t % LINE : LINE)
    code.forEach((color, x) => set(21 + x, 1 + row, color))
  }
  for (let x = 17; x < WIDTH; x++) {
    set(x, 6, BASE)
    set(x, 7, EDGE)
  }

  // Two pixels per cell: the upper half block takes the top pixel as its
  // color and the bottom one as its background.
  const words = new Uint32Array(WIDTH * ROWS * 3)
  for (let row = 0; row < ROWS; row++) {
    for (let x = 0; x < WIDTH; x++) {
      const top = px[2 * row * WIDTH + x]!
      const bottom = px[(2 * row + 1) * WIDTH + x]!
      const cell = [0x20, DEFAULT, DEFAULT]
      if (top !== CLEAR) cell.splice(0, 3, 0x2580, top, bottom === CLEAR ? DEFAULT : bottom)
      else if (bottom !== CLEAR) cell.splice(0, 3, 0x2584, bottom, DEFAULT)
      words.set(cell, (row * WIDTH + x) * 3)
    }
  }
  return new Uint8Array(words.buffer).toBase64()
}

let timer: Timer | undefined
let tick = 0
let bandId: string | undefined

function start($: EngineInterface) {
  timer ??= $.clock.every(TICK_MS, () => {
    tick += 1
    // A frame that cannot be painted is skipped; the next one tries again.
    if (bandId) $.ui.blit({ requestId: bandId, key: KEY, cells: frame(tick) }).catch(() => {})
  })
}

function stop() {
  timer?.cancel()
  timer = undefined
}

export const register: Register = on => {
  // A reload in the middle of a turn picks the animation back up.
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    if (await read($, working)) start($)
    return r
  })

  on('turn.start', async ($, e, next) => {
    tick = 0
    await update($, working, () => e.turnId)
    start($)
    return next(e)
  })

  // Only the end of the main turn stops it, not a subagent's.
  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && e.turnId === (await read($, working))) {
      stop()
      await update($, working, () => null)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isWorking = (await read($, working)) !== null
    if (!isWorking || e.surface !== 'terminal' || e.props.hasSurvey || e.props.bodyColumns < WIDTH) return next(e)
    bandId = e.requestId
    const { Raster } = $.ui.resolve(e)
    return <Raster key={KEY} columns={WIDTH} rows={ROWS} cells={frame(tick)} />
  })
}
