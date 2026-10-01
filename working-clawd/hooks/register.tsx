import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { WorkingTurn } from '../types'

const KEY = 'clawd'
const SPRITE = 18
const MIN_COLUMNS = 24
const MAX_COLUMNS = 512
const HEIGHT = 6
const ROWS = HEIGHT / 2
const TICK_MS = 150
const working = atom({ plugin: 'working-clawd', key: 'turnId' } as const, null as WorkingTurn)

const CLEAR = -1
const DEFAULT = 0x01000000
const ORANGE = 0xd77757

// One frame as Raster cells, `columns` wide. Clawd, drawn as the CLI logo
// draws him, walks one column per frame and turns around at each end. Every
// other frame he hops, feet splayed; his eyes look the way he is walking, and
// he blinks every 16th frame.
export const frame = (t: number, columns: number) => {
  const px = new Int32Array(columns * HEIGHT).fill(CLEAR)
  const range = columns - SPRITE
  const step = t % (2 * range)
  const left = step <= range ? step : 2 * range - step
  const facing = step < range ? 1 : -1
  const isHop = t % 2 === 1
  const top = isHop ? 0 : 1
  const set = (x: number, y: number, color = ORANGE) => (px[y * columns + left + x] = color)

  for (let row = 0; row < 4; row++) {
    for (let x = 3; x < 15; x++) set(x, top + row)
  }
  for (const x of [1, 2, 15, 16]) set(x, top + 2)
  if (t % 16 !== 15) {
    set(5 + facing, top + 1, CLEAR)
    set(12 + facing, top + 1, CLEAR)
  }
  for (const x of [4, 6, 11, 13]) set(x, isHop ? 4 : 5)
  if (isHop) for (const x of [3, 7, 10, 14]) set(x, 5)

  // Two pixels per cell: the upper half block takes the top pixel as its
  // color and the bottom one as its background.
  const words = new Uint32Array(columns * ROWS * 3)
  for (let row = 0; row < ROWS; row++) {
    for (let x = 0; x < columns; x++) {
      const upper = px[2 * row * columns + x]!
      const lower = px[(2 * row + 1) * columns + x]!
      const cell = [0x20, DEFAULT, DEFAULT]
      if (upper !== CLEAR) cell.splice(0, 3, 0x2580, upper, lower === CLEAR ? DEFAULT : lower)
      else if (lower !== CLEAR) cell.splice(0, 3, 0x2584, lower, DEFAULT)
      words.set(cell, (row * columns + x) * 3)
    }
  }
  return new Uint8Array(words.buffer).toBase64()
}

let timer: Timer | undefined
let tick = 0
let bandId: string | undefined
let bandColumns = 0

function start($: EngineInterface) {
  timer ??= $.clock.every(TICK_MS, () => {
    tick += 1
    // A frame that cannot be painted is skipped; the next one tries again.
    if (bandId) {
      $.ui.blit({ requestId: bandId, key: KEY, cells: frame(tick, bandColumns) }).catch(() => {})
    }
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

  // The band spans the window, so a resize redraws it at the new width.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isWorking = (await read($, working)) !== null
    const columns = Math.min(e.props.bodyColumns, MAX_COLUMNS)
    if (!isWorking || e.surface !== 'terminal' || e.props.hasSurvey || columns < MIN_COLUMNS) return next(e)
    bandId = e.requestId
    bandColumns = columns
    const { Raster } = $.ui.resolve(e)
    return <Raster key={KEY} columns={columns} rows={ROWS} cells={frame(tick, columns)} />
  })
}
