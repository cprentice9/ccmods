import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs, Timer } from 'claude-code'

import type { StarfieldTurn } from '../types'

import { FRAMES, PALETTE, SEQ, SPRITE_FPS, SPRITE_HEIGHT, SPRITE_WIDTH } from './astronaut'

// The scene at the foot of claude.dev, behind the conversation: its field of
// dots with a crescent moon and a ringed planet, and Clawd the astronaut
// floating in it while Claude works. The sky is the desktop app's own dark
// gray, so the window keeps its color.
const SKY = '#191919'
const DOT = '#87867f'
const SKY_OPACITY = 0.7
const SCENE = 'starfield'

// The scene's own box. The app scales it to cover the window and crops the rest.
const WIDTH = 1600
const HEIGHT = 1000
// The page's numbers: the grid's spacing, the two sizes of a shape's dots, and
// how dense and how grainy the clouds of dots are.
const GRID = 9
const SMALL = 0.15 * GRID
const LARGE = 0.267 * GRID
const GRAIN = 12 * 0.7
const LOW = 0.62 - 0.34 * 0.42
const HIGH = LOW + 0.34 - 0.22 * 0.5
// The page picks a new sky on every load. This one is kept.
const SEED = 20261114

// The page's hash and its two noises: a number from 0 to 1 for a cell, the
// same smoothed between the corners of a coarser grid, and that again blended
// from one moment's layer to the next.
const hash = (x: number, y: number, n: number) => {
  let a = (0x165667b1 * x + 0x27d4eb2f * y + 69069 * n) | 0
  a = Math.imul(a ^ (a >>> 13), 0x4bf19f61)
  return ((a ^ (a >>> 16)) >>> 0) / 0x100000000
}
const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp = (t: number) => Math.max(0, Math.min(1, t))
const noise = (x: number, y: number, n: number, size: number) => {
  const gx = Math.floor(x / size)
  const gy = Math.floor(y / size)
  const fx = smooth(x / size - gx)
  const fy = smooth(y / size - gy)
  const top = hash(gx, gy, n) + (hash(gx + 1, gy, n) - hash(gx, gy, n)) * fx
  const bottom = hash(gx, gy + 1, n) + (hash(gx + 1, gy + 1, n) - hash(gx, gy + 1, n)) * fx
  return top + (bottom - top) * fy
}
const drifting = (x: number, y: number, n: number, size: number, time: number) => {
  const layer = Math.floor(time)
  const from = noise(x, y, n ^ Math.imul(layer, 0x9e3779b1), size)
  return from + (noise(x, y, n ^ Math.imul(layer + 1, 0x9e3779b1), size) - from) * smooth(time - layer)
}

// The moon and the planet, placed and sized as the page places them.
const SHORT = Math.min(WIDTH, HEIGHT)
const MOON = Math.min(Math.max(52, 0.115 * SHORT), 0.3 * SHORT)
const MOON_X = Math.max(0.14 * WIDTH, 1.1 * MOON)
const MOON_Y = Math.max(0.3 * HEIGHT, 1.1 * MOON)
const BITE = 0.92 * MOON
const BITE_X = MOON_X + 0.45 * MOON
const PLANET = Math.min(Math.max(60, 0.15 * SHORT), 0.19 * SHORT)
const PLANET_X = 0.8 * WIDTH
const PLANET_Y = HEIGHT - 0.66 * PLANET
const RING_LONG = 1.75 * PLANET
const RING_SHORT = 0.32 * PLANET
const TILT = { cos: 0.9492354180824408, sin: 0.31456656061611776 }

// What the cell in column `c`, row `r`, centered on (x, y), belongs to: 2 a
// large dot of a shape, 1 a small one, 0 the clear space kept around a shape,
// -1 open sky.
const shape = (x: number, y: number, c: number, r: number) => {
  const moon = Math.hypot(x - MOON_X, y - MOON_Y)
  if (moon < MOON) {
    const bite = Math.hypot(x - BITE_X, y - MOON_Y)
    if (bite >= BITE) {
      const isDeep = MOON - moon > Math.max(0.12 * MOON, 0.9 * GRID) && bite - BITE > Math.max(0.18 * BITE, 0.9 * GRID)
      return isDeep ? 2 : 1
    }
  }
  if (moon < 2.2 * MOON) {
    const far = moon / MOON
    if (far < 1.4 || hash(c, r, 12295 ^ SEED) > smooth(clamp((far - 1.4) / 0.8))) return 0
  }
  const dx = x - PLANET_X
  const dy = y - PLANET_Y
  const planet = Math.hypot(dx, dy)
  const along = TILT.cos * dx + TILT.sin * dy
  const across = -TILT.sin * dx + TILT.cos * dy
  const ring = Math.hypot(along / RING_LONG, across / RING_SHORT)
  const isRing = ring > 0.8 && ring < 1.2
  const ringDot = () => {
    const end = Math.abs(along) / RING_LONG
    if (end > 0.9 && hash(c, r, 37191 ^ SEED) < ((end - 0.9) / 0.1) * 0.9) return 0
    return Math.abs(ring - 1) < 0.16 ? 2 : 1
  }
  // The near half of the ring passes in front of the planet.
  if (isRing && across > 0) {
    const dot = ringDot()
    if (dot) return dot
  }
  if (across > 0 && planet < PLANET && ring > 0.66 && ring < 1.34) return 0
  if (planet < PLANET) {
    const edge = 1 - planet / PLANET
    if (edge < 0.05 && hash(c, r, 1812 ^ SEED) > Math.pow(edge / 0.05, 1.4)) return 0
    if (PLANET - planet < Math.max(0.1 * PLANET, 0.9 * GRID)) return 1
    const light = 0.5 * (-(dx / PLANET) * 0.28 - (dy / PLANET) * 0.82) + 0.5 + (drifting(c, r, 2458 ^ SEED, 3.1, 0) - 0.5) * 0.35
    return light < 0.18 ? 0 : light > 0.82 ? 2 : 1
  }
  if (isRing) {
    const dot = ringDot()
    if (dot) return dot
  }
  const near = Math.min(planet / (1.18 * PLANET), ring / 1.24)
  return near < 1.32 && (near < 1 || hash(c, r, 30634 ^ SEED) > smooth(clamp((near - 1) / 0.32))) ? 0 : -1
}

// The radius of the open sky's dot at a cell at `time`, 0 for none: a lone
// star, or a dot of a cloud, larger toward the cloud's middle. The clouds are
// streaks one way or another by where they are.
const cloud = (c: number, r: number, time: number) => {
  const kind = noise(c, r, 273 ^ SEED, GRAIN)
  const weight = drifting(c, r, 546 ^ SEED, 0.63 * GRAIN, 0.5 * time)
  const streak =
    kind < 0.38 ? drifting(c / 9, r / 1.3, 819 ^ SEED, 1, time)
    : kind < 0.52 ? drifting(c / 1.3, r / 9, 1092 ^ SEED, 1, time)
    : kind < 0.62 ? drifting((c + r) / 7, (c - r) / 1.4, 1365 ^ SEED, 1, time)
    : drifting(c, r, 1638 ^ SEED, 2.6, time)
  const depth = (0.74 * streak + 0.2 * hash(c, r, 2184 ^ SEED)) * (0.12 + 1.15 * Math.pow(weight, 1.5))
  const star = hash(c, r, 1911 ^ SEED)
  if (depth < LOW) return star > 0.988 ? SMALL * (0.7 + 25 * (star - 0.988)) : 0
  const full = smooth(Math.min(1, (depth - LOW) / (HIGH - LOW)))
  const radius = 0.6 + (LARGE - 0.6) * full + (star > 0.9985 ? 1.2 * (0.5 + 0.5 * full) : 0)
  return radius < 0.45 ? 0 : radius
}

// On the page the clouds change shape without end. Here they pass back and
// forth between two moments of that: a dot both moments share stays, and the
// rest fade from one moment's to the other's.
const MOMENTS = [0, 2]
const size = (radius: number) => Math.round(radius * 20) / 10

// Every dot of one size goes into one path as a zero-length line with round
// caps, about ten characters a dot.
const dots = () => {
  const layers = [new Map<number, string>(), new Map<number, string>(), new Map<number, string>()]
  const add = (layer: number, width: number, x: number, y: number) => {
    if (width > 0) layers[layer]!.set(width, `${layers[layer]!.get(width) ?? ''}M${x} ${y}h0`)
  }
  for (let r = 0, y = ((HEIGHT % GRID) + GRID) / 2; y < HEIGHT; r++, y += GRID) {
    for (let c = 0, x = ((WIDTH % GRID) + GRID) / 2; x < WIDTH; c++, x += GRID) {
      const kind = shape(x, y, c, r)
      // The sky thins toward the top of the window.
      if (kind === 0 || (kind < 0 && hash(c, r, 170 ^ SEED) > 1.15 * (0.2 + (y / HEIGHT) * 0.8))) continue
      if (kind > 0) {
        add(0, size(kind === 2 ? LARGE : SMALL), x, y)
        continue
      }
      const [first, second] = MOMENTS.map(time => size(cloud(c, r, time))) as [number, number]
      if (first === second) add(0, first, x, y)
      else {
        add(1, first, x, y)
        add(2, second, x, y)
      }
    }
  }
  const [still, first, second] = layers.map(layer => [...layer].map(([width, d]) => `<path d="${d}" stroke-width="${width}"/>`).join(''))
  return `${still}<g class="first">${first}</g><g class="second">${second}</g>`
}

// A frame's shape: a path for each color through that color's runs in each row.
const decode = (frame: string) => frame.split('/').map(row => row.replace(/(\d*)(\D)/g, (_, n, cell) => cell.repeat(Number(n || 1))))
const framePaths = (rows: string[]) => {
  const runs: Record<string, string> = {}
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const cell = row[x]!
      if (!PALETTE[cell]) continue
      let end = x
      while (row[end + 1] === cell) end++
      const w = end - x + 1
      runs[cell] = `${runs[cell] ?? ''}M${x} ${y}h${w}v1h-${w}z`
      x = end
    }
  })
  return Object.entries(runs).map(([cell, d]) => `<path fill="${PALETTE[cell]}" stroke="${PALETTE[cell]}" d="${d}"/>`).join('')
}

// His frames side by side in a strip that a window his size shows one of at a
// time, and the strip's place for each frame of the loop.
// No `shape-rendering="crispEdges"` here: with it anywhere in a scene, the
// desktop app holds every animation in the scene still. A hairline stroke in
// each cell's own color closes the seams that smoothing leaves between colors.
const strip = () =>
  `<g id="strip" stroke-width="0.08">${FRAMES.map((frame, i) => `<g transform="translate(${i * SPRITE_WIDTH} 0)">${framePaths(decode(frame))}</g>`).join('')}</g>`
const LOOP_SECONDS = SEQ.length / SPRITE_FPS
const POSES = SEQ.map(frame => -frame * SPRITE_WIDTH).join(';')

// One scene unit to a pixel of his times this, as on the page, and a mini
// beside him.
const PIXEL = 2.7
const MINI_SCALE = 0.6
export const MAX_MINIS = 8

// Where each astronaut floats about: seat 0 is Clawd's, where the page has
// him, and the rest are the minis', around the edges.
const HOMES = [[0.5, 0.58], [0.2, 0.3], [0.8, 0.32], [0.26, 0.76], [0.66, 0.2], [0.12, 0.56], [0.88, 0.6], [0.38, 0.18], [0.6, 0.84]] as const

// The page floats him about his home on two slow waves each way, and bobs him.
// Each is a group that swings from one end of its wave to the other and back:
// its name, its axis, how far it reaches, and the seconds one way takes.
const WAVES = [
  ['x1', 'X', 0.028 * WIDTH, Math.PI / 0.45],
  ['x2', 'X', 0.018 * WIDTH, Math.PI / 0.19],
  ['y1', 'Y', 0.045 * HEIGHT, Math.PI / 0.62],
  ['y2', 'Y', 0.03 * HEIGHT, Math.PI / 0.27],
  ['bob', 'Y', 4, Math.PI / 1.1],
] as const

// The clouds fade by CSS, with motion on unless the system asks for less, as
// the app's own example scenes have it.
const STYLE = `<style>
.first{animation:fade 14s ease-in-out infinite alternate}
.second{opacity:0;animation:fade 14s ease-in-out infinite alternate-reverse}
@keyframes fade{from{opacity:1}to{opacity:0}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}
</style>`

// The sky, built once: the fill, the dots, and Clawd's frames for the
// astronauts to use.
let built: string | undefined
const sky = () =>
  (built ??=
    STYLE +
    `<defs>${strip()}</defs>` +
    `<rect width="100%" height="100%" fill="${SKY}"/>` +
    `<g fill="none" stroke="${DOT}" stroke-linecap="round" opacity="${SKY_OPACITY}">${dots()}</g>`)

// One astronaut in its seat, `elapsed` milliseconds into the float, so a
// redraw picks each one up where it was. Each seat is a while further in, so
// no two move together. The astronauts move by SMIL, as working-clawd's band
// does: the app can hold a scene's CSS animation still.
const astronaut = (seat: number, elapsed: number) => {
  const [x, y] = HOMES[seat]!
  const begin = `begin="-${Math.round(elapsed / 100) / 10 + seat * 37}s" repeatCount="indefinite"`
  const inner =
    `<g transform="scale(${PIXEL}) translate(${-SPRITE_WIDTH / 2} ${-SPRITE_HEIGHT / 2})">` +
    `<svg width="${SPRITE_WIDTH}" height="${SPRITE_HEIGHT}"><svg overflow="visible">` +
    `<animate attributeName="x" calcMode="discrete" values="${POSES}" dur="${Math.round(LOOP_SECONDS * 1000)}ms" ${begin}/>` +
    `<use href="#strip"/></svg></svg></g>`
  const wave = (body: string, [, axis, reach, seconds]: (typeof WAVES)[number]) => {
    const end = (sign: number) => (axis === 'X' ? `${sign * Math.round(reach)} 0` : `0 ${sign * Math.round(reach)}`)
    return (
      `<g><animateTransform attributeName="transform" type="translate" values="${end(-1)};${end(1)};${end(-1)}" keyTimes="0;0.5;1" ` +
      `calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" dur="${Math.round(seconds * 200) / 100}s" ${begin}/>${body}</g>`
    )
  }
  return `<g transform="translate(${x * WIDTH} ${y * HEIGHT}) scale(${seat === 0 ? 1 : MINI_SCALE})">${WAVES.reduce(wave, inner)}</g>`
}

// The whole scene as one SVG: the sky, the minis in their seats, and Clawd
// while the main turn runs.
export const scene = (hasLeader = false, minis: number[] = [], elapsed = 0) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">` +
  sky() +
  [...minis, ...(hasLeader ? [0] : [])].map(seat => astronaut(seat, elapsed)).join('') +
  `</svg>`

// The app's own colors stay. Its panels sit over the sky as clear glass in the
// sky's gray, so the dots stay sharp and dim behind the words.
const LOOK: ThemeSetArgs = {
  backdrop: { scene: SCENE, glass: { blur: 0, tint: SKY, opacity: 0.55 } },
  overrideColorScheme: 'dark',
}

// What is working, kept as working-clawd keeps it: the main turn, and each
// running subagent.
const working = atom({ plugin: 'starfield', key: 'turnId' } as const, null as StarfieldTurn)
const agents = atom({ plugin: 'starfield', key: 'agents' } as const, [] as string[])
const LIVE = ['pending', 'running']
const SYNC_MS = 2000

// A workflow's agents, from their agent.spawn to their turn.complete. The
// engine never lists them, so only their turn.complete ends their minis.
const workflowAgents = new Set<string>()
let timer: Timer | undefined
// What the scene draws, kept in the module so the hook that draws it reads no
// state and waits on nothing, as the app's own example scenes draw theirs:
// whether the main turn runs, each mini's seat, and how far into the float
// the astronauts were when that last changed.
let hasLeader = false
let minis: number[] = []
let since: number | undefined
let elapsed = 0
// Each subagent's seat, 1 to MAX_MINIS, kept while it runs so the others stay
// where they are when one finishes.
const seats = new Map<string, number>()

export const seat = (ids: string[]) => {
  for (const id of [...seats.keys()]) if (!ids.includes(id)) seats.delete(id)
  for (const id of ids) {
    if (seats.has(id)) continue
    const free = Array.from({ length: MAX_MINIS }, (_, i) => i + 1).find(n => ![...seats.values()].includes(n))
    if (free !== undefined) seats.set(id, free)
  }
  return [...seats.values()]
}

// Takes what is working into the module and has the scene drawn again.
async function show($: EngineInterface) {
  const now = await $.clock.now()
  since ??= now
  elapsed = now - since
  hasLeader = (await read($, working)) !== null
  minis = seat(await read($, agents))
  $.ui.invalidate('ui.render')
}

// Matches the minis to the agents the engine lists as working, plus any
// workflow agents, so one whose turn.complete went missing goes.
async function sync($: EngineInterface) {
  const live = [...(await $.agent.list()).filter(a => LIVE.includes(a.status)).map(a => a.id), ...workflowAgents]
  const mine = await read($, agents)
  if (mine.length === live.length && mine.every(id => live.includes(id))) return
  await update($, agents, a => [...a.filter(id => live.includes(id)), ...live.filter(id => !a.includes(id))])
  await settle($)
}

const start = ($: EngineInterface) => {
  timer ??= $.clock.every(SYNC_MS, () => {
    sync($).catch(() => {})
  })
}

// With nothing left working, the checks stop.
async function settle($: EngineInterface) {
  if (!(await read($, working)) && (await read($, agents)).length === 0) {
    timer?.cancel()
    timer = undefined
  }
  await show($)
}

export const register: Register = on => {
  // A reload while anything works picks the checks back up. One theme stands
  // at a time, so /starfield puts this one back after another mod's.
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'starfield', description: 'Show the starfield theme behind the conversation' })
    await $.theme.set(LOOK)
    if ((await read($, working)) || (await read($, agents)).length > 0) start($)
    await show($)

    return next(e)
  })

  on('command.run', { command: 'starfield' }, async $ => {
    const set = await $.theme.set(LOOK)

    return { text: set.isDrawn ? 'Starfield is on.' : `Starfield is set, but nothing draws it: ${set.reason}` }
  })

  on('turn.start', async ($, e, next) => {
    await update($, working, () => e.turnId)
    start($)
    await show($)

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    const { agentId } = ran
    if (agentId) {
      if (e.workflow) workflowAgents.add(agentId)
      await update($, agents, a => (a.includes(agentId) ? a : [...a, agentId]))
      start($)
      await show($)
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const { agentId } = e
    if (agentId) {
      workflowAgents.delete(agentId)
      await update($, agents, a => a.filter(id => id !== agentId))
    } else if (e.turnId === (await read($, working))) {
      await update($, working, () => null)
    }
    await settle($)

    return next(e)
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if (e.props.scene !== SCENE || (e.surface !== 'desktop' && e.surface !== 'mobile')) {
      return next(e)
    }

    const { Svg } = $.ui.resolve(e)
    const alt = hasLeader || minis.length > 0
      ? 'A night sky of dots with a crescent moon and a ringed planet, and Clawd floating in it in a space helmet'
      : 'A night sky of dots with a crescent moon and a ringed planet'

    return <Svg isInteractive alt={alt} source={scene(hasLeader, minis, elapsed)} />
  })
}
