import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { WorkingTurn } from '../types'

const KEY = 'clawd'
const BIG = 18
const MINI = 8
// Frames each mini trails behind: even, so the minis hop in step with him.
const FOLLOW = 16
const SPACING = 10
const MAX_MINIS = 8
const MIN_COLUMNS = 24
const MAX_COLUMNS = 512
const HEIGHT = 6
const ROWS = HEIGHT / 2
const TICK_MS = 150
// CSS pixels per pixel of Clawd in the desktop app.
const PIXEL = 6
const working = atom({ plugin: 'working-clawd', key: 'turnId' } as const, null as WorkingTurn)
const agents = atom({ plugin: 'working-clawd', key: 'agents' } as const, [] as string[])

const CLEAR = -1
const DEFAULT = 0x01000000
const ORANGE = 0xd77757
const LID = 0x8a8f98
const GLOW = 0x7fb4ca
const BASE = 0xb4b8bf

// The desktop scene: Clawd seen from the side, facing left, typing on a
// laptop whose lid (g) tilts back with its screen's glow (c) on the inside,
// and its base (b) on the box. E is an eye, filled when he blinks. Each
// sprite lists the pixels of its hand on the keys and raised.
const SIDE_HEIGHT = 7
const SIDE = {
  rows: [
    '..........OOOOOO..',
    '........OOOOOOOOO.',
    '..g.....OEOOOOOOO.',
    '...gc...OOOOOOOOO.',
    '....gc..OOOOOOOOO.',
    '....bbbbbOOOOOOOO.',
    '.........O.O.O.O..',
  ],
  down: [[7, 4], [8, 5]],
  up: [[7, 3]],
}
const SIDE_MINI = {
  rows: [
    '..........',
    '..........',
    '......OOO.',
    '.g...OOOOO',
    '..gc.OEOOO',
    '..bbbbOOOO',
    '......O.O.',
  ],
  down: [[4, 4]],
  up: [[4, 3]],
}
const SIDE_COLORS: Record<string, number> = { O: ORANGE, g: LID, c: GLOW, b: BASE }

const mod = (n: number, m: number) => ((n % m) + m) % m

// Where the walk puts a sprite's center at frame t: one column per frame,
// turning around at each end, and which way it faces.
const path = (t: number, columns: number) => {
  const range = columns - BIG
  const step = mod(t, 2 * range)
  const center = BIG / 2 + (step <= range ? step : 2 * range - step)
  return { center, facing: step < range ? 1 : -1 }
}

// One frame's pixels, `columns` wide and HEIGHT tall. Clawd, drawn as the CLI
// logo draws him, walks the path; every other frame he hops, feet splayed, his
// eyes look the way he is walking, and he blinks every 16th frame. Each mini,
// one per running subagent, walks the same path a set number of frames behind,
// so they follow him around each turn and hop in step.
const pixels = (t: number, columns: number, minis: number, hasLeader: boolean) => {
  const px = new Int32Array(columns * HEIGHT).fill(CLEAR)
  const sprite = (at: number, width: number) => {
    const { center, facing } = path(at, columns)
    const left = center - width / 2
    const isHop = mod(at, 2) === 1
    const set = (x: number, y: number, color = ORANGE) => (px[y * columns + left + x] = color)
    return { facing, isHop, set }
  }

  for (let i = Math.min(minis, MAX_MINIS) - 1; i >= 0; i--) {
    const { isHop, set } = sprite(t - FOLLOW - SPACING * i, MINI)
    const top = isHop ? 1 : 2
    for (let row = 0; row < 3; row++) {
      for (let x = 1; x < 7; x++) set(x, top + row)
    }
    set(0, top + 2)
    set(7, top + 2)
    set(2, top + 1, CLEAR)
    set(5, top + 1, CLEAR)
    for (const x of [1, 6]) set(x, isHop ? 4 : 5)
    if (isHop) for (const x of [0, 7]) set(x, 5)
  }

  if (hasLeader) {
    const { facing, isHop, set } = sprite(t, BIG)
    const top = isHop ? 0 : 1
    for (let row = 0; row < 4; row++) {
      for (let x = 3; x < 15; x++) set(x, top + row)
    }
    for (const x of [1, 2, 15, 16]) set(x, top + 2)
    if (mod(t, 16) !== 15) {
      set(5 + facing, top + 1, CLEAR)
      set(12 + facing, top + 1, CLEAR)
    }
    // Legs start at the edges of his body; a hop splays the feet.
    for (const x of [3, 5, 12, 14]) set(x, isHop ? 4 : 5)
    if (isHop) for (const x of [2, 6, 11, 15]) set(x, 5)
  }
  return px
}

// A frame as Raster cells for the terminal. Two pixels per cell: the upper
// half block takes the top pixel as its color and the bottom one as its
// background.
export const frame = (t: number, columns: number, minis = 0, hasLeader = true) => {
  const px = pixels(t, columns, minis, hasLeader)
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

// The desktop scene's pixels: Clawd sits at the right end of the box, typing,
// with each mini in a row to his left at its own laptop, as many as fit.
// Hands go down on even frames, in time; the screens' glow flickers, and he
// blinks every 16th frame.
const sidePixels = (t: number, columns: number, minis: number, hasLeader: boolean) => {
  const px = new Int32Array(columns * SIDE_HEIGHT).fill(CLEAR)
  const put = (sprite: typeof SIDE, left: number) => {
    if (left < 0) return
    sprite.rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === 'E' && mod(t, 16) === 15) ch = 'O'
      if (ch === 'c' && mod(t, 3) === 2) return
      const color = SIDE_COLORS[ch]
      if (color !== undefined) px[y * columns + left + x] = color
    }))
    for (const [x, y] of mod(t, 2) === 0 ? sprite.down : sprite.up) px[y! * columns + left + x!] = ORANGE
  }
  const seat = columns - SIDE.rows[0]!.length
  if (hasLeader) put(SIDE, seat)
  const width = SIDE_MINI.rows[0]!.length + 1
  for (let i = 0; i < Math.min(minis, MAX_MINIS); i++) put(SIDE_MINI, seat - width * (i + 1))
  return px
}

// A frame as SVG markup for the desktop app: each row's runs of one color as
// rectangles, a pixel PIXEL CSS pixels square.
export const svg = (t: number, columns: number, minis = 0, hasLeader = true) => {
  const px = sidePixels(t, columns, minis, hasLeader)
  const rects: string[] = []
  for (let y = 0; y < SIDE_HEIGHT; y++) {
    for (let x = 0; x < columns; x++) {
      const color = px[y * columns + x]!
      if (color === CLEAR) continue
      let end = x
      while (end + 1 < columns && px[y * columns + end + 1] === color) end++
      const fill = `#${color.toString(16).padStart(6, '0')}`
      rects.push(`<rect x="${x}" y="${y}" width="${end - x + 1}" height="1" fill="${fill}"/>`)
      x = end
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${columns * PIXEL}" height="${SIDE_HEIGHT * PIXEL}" `
    + `viewBox="0 0 ${columns} ${SIDE_HEIGHT}" shape-rendering="crispEdges">${rects.join('')}</svg>`
}

// What the band last drew, for the timer's repaints between draws.
let timer: Timer | undefined
let tick = 0
let band: { id: string; surface: string; columns: number; minis: number; hasLeader: boolean } | undefined

function start($: EngineInterface) {
  timer ??= $.clock.every(TICK_MS, () => {
    tick += 1
    if (!band) return
    // The desktop app redraws the SVG; the terminal repaints its cells in
    // place. A frame that cannot be painted is skipped and the next one tries.
    if (band.surface === 'desktop') {
      $.ui.invalidate('ui.render')
    } else {
      const cells = frame(tick, band.columns, band.minis, band.hasLeader)
      $.ui.blit({ requestId: band.id, key: KEY, cells }).catch(() => {})
    }
  })
}

function stop() {
  timer?.cancel()
  timer = undefined
}

export const register: Register = on => {
  // A reload while anything works picks the animation back up.
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    if ((await read($, working)) || (await read($, agents)).length > 0) start($)
    return r
  })

  on('turn.start', async ($, e, next) => {
    if (!timer) tick = 0
    await update($, working, () => e.turnId)
    start($)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    const { agentId } = ran
    if (agentId) {
      await update($, agents, a => (a.includes(agentId) ? a : [...a, agentId]))
      start($)
    }
    return ran
  })

  // A step from a subagent that already finished means it resumed.
  on('turn.step', async function* ($, e, next) {
    const { agentId } = e
    if (agentId && !(await read($, agents)).includes(agentId)) {
      await update($, agents, a => (a.includes(agentId) ? a : [...a, agentId]))
      start($)
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const { agentId } = e
    if (agentId) {
      await update($, agents, a => a.filter(id => id !== agentId))
    } else if (e.turnId === (await read($, working))) {
      await update($, working, () => null)
    }
    if (!(await read($, working)) && (await read($, agents)).length === 0) stop()
    return next(e)
  })

  // The band spans the window, so a resize redraws it at the new width. The
  // terminal draws cells; the desktop app, which has no Raster, an SVG.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const hasLeader = (await read($, working)) !== null
    const minis = (await read($, agents)).length
    const columns = Math.min(e.props.bodyColumns, MAX_COLUMNS)
    const isIdle = !hasLeader && minis === 0
    if (isIdle || e.props.hasSurvey || columns < MIN_COLUMNS) return next(e)
    if (e.surface === 'desktop') {
      band = { id: e.requestId, surface: e.surface, columns, minis, hasLeader }
      const { Svg } = $.ui.resolve(e)
      return <Svg source={svg(tick, columns, minis, hasLeader)} alt="Clawd walking while Claude works" />
    }
    if (e.surface !== 'terminal') return next(e)
    band = { id: e.requestId, surface: e.surface, columns, minis, hasLeader }
    const { Raster } = $.ui.resolve(e)
    return <Raster key={KEY} columns={columns} rows={ROWS} cells={frame(tick, columns, minis, hasLeader)} />
  })
}
