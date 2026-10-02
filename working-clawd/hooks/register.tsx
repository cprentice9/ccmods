import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { WorkingTask, WorkingTasks, WorkingTurn } from '../types'

import { CLIP_HEIGHT, CLIP_WIDTH, CLIPS } from './clips'
import type { ClipName } from './clips'
import { encodePng } from './png'

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
// The clips' own rate, 12 frames a second; the terminal walker steps every
// other frame.
const TICK_MS = 83
// The desktop band, in CSS pixels: a half pixel of Clawd, and a rough width
// of one of the band's columns, which sets how fast he crosses it.
const HALF = 2.5
const COLUMN = 6
// The band shows the clips from this row down: the top of his raised arm in
// the wave. The jump rises higher, so it hops only as high as the wave.
const TOP = 9
// The minis' size next to Clawd.
const MINI_SCALE = 0.75
// The sky's colors, from the claude.dev page, and its clusters' dot spacing.
const SKY = '#151515'
const STAR = '#8c8c8c'
const GRID = 2.4
// Half pixels of sky drawn, wider than any window; the app cuts it to the band.
const SKY_WIDTH = 1000
const BAND_ROWS = CLIP_HEIGHT - TOP
const BAND_HEIGHT = BAND_ROWS * HALF
// The same scene in kitty and Ghostty, as a picture three rows tall, one
// image pixel to a half pixel. A cell is about twice as tall as it is wide,
// so each column takes half as many pixels as each row.
const PICTURE_ROWS = 3
const PICTURE_SCALE = 4
const pictureWidth = (columns: number) => Math.round((columns * BAND_ROWS) / PICTURE_ROWS / 2)
const working = atom({ plugin: 'working-clawd', key: 'turnId' } as const, null as WorkingTurn)
const agents = atom({ plugin: 'working-clawd', key: 'agents' } as const, [] as string[])
const tasks = atom({ plugin: 'working-clawd', key: 'tasks' } as const, {} as WorkingTasks)
const commands = atom({ plugin: 'working-clawd', key: 'commands' } as const, [] as string[])
const MAX_COMMANDS = 8

const CLEAR = -1
const DEFAULT = 0x01000000
const ORANGE = 0xd77757
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

// The checklist line: how many tasks are done, and the one in progress.
// Nothing while the list is empty.
export const checklist = (list: WorkingTasks) => {
  const all = Object.values(list)
  if (all.length === 0) return undefined
  const done = all.filter(task => task.status === 'completed').length
  const active = all.find(task => task.status === 'in_progress')
  return { count: `${done} of ${all.length}`, now: active && (active.activeForm ?? active.subject) }
}

// "Bash npm test", "Edit register.tsx": the tool and its main argument, a file
// by its name, cut to one short line.
export const describeCommand = (call: Record<string, unknown>) => {
  const main = [call.command, call.file_path, call.pattern, call.url, call.query, call.description]
    .find(v => typeof v === 'string') as string | undefined
  const what = main === undefined ? '' : main === call.file_path ? main.split('/').pop()! : main.split('\n')[0]!
  return `${String(call.tool)} ${what}`.trim().slice(0, 60)
}

// The desktop walker, as the claude.dev blog has him: he walks the band from
// end to end, turns at each end, and every so often stops to look around,
// wave, jump, or turn back. Walking and turning frames face right, so heading
// left draws them mirrored.
const decode = (frame: string) => frame.split('/').map(row => row.replace(/(\d*)(\D)/g, (_, n, cell) => cell.repeat(Number(n || 1))))
const FRAMES = Object.fromEntries(Object.entries(CLIPS).map(([name, clip]) => [name, clip.frames.map(decode)])) as Record<ClipName, string[][]>
const WALK_CYCLE = [2, 3, 4, 5, 6]
const ACTS: ClipName[] = ['looking', 'waving', 'jumping', 'turning']
const COLORS: Record<string, string> = { O: '#d97757', S: '#be684d', s: '#774635', d: '#553428' }

export type Walker = {
  x: number
  dir: 1 | -1
  clip: ClipName
  // The frame within the clip: for walking, steps taken; -1 is the turn from
  // facing front to the side.
  at: number
  // Steps until he stops to do something.
  until: number
}

export const startWalker = (): Walker => ({ x: 0, dir: 1, clip: 'walking', at: -1, until: 40 })

// The band's width in half pixels, from its width in columns.
const viewWidth = (columns: number) => Math.floor((columns * COLUMN) / HALF)

// His next frame. `t` picks the next stop and act, so the walk repeats
// differently each time without any randomness to test around.
export const stepWalker = (w: Walker, width: number, t: number): Walker => {
  const right = Math.max(0, width - CLIP_WIDTH)
  if (w.clip !== 'walking') {
    if (w.at + 1 < CLIPS[w.clip].seq.length) return { ...w, at: w.at + 1 }
    const dir = w.clip === 'turning' ? (-w.dir as 1 | -1) : w.dir
    return { ...w, dir, clip: 'walking', at: -1, until: 30 + mod(t * 37, 90) }
  }
  const x = Math.min(right, Math.max(0, w.x + w.dir))
  const atEnd = (w.dir > 0 && x >= right) || (w.dir < 0 && x <= 0)
  if (atEnd) return { ...w, x, clip: 'turning', at: 0 }
  if (w.until <= 0) return { ...w, x, clip: ACTS[mod(t, ACTS.length)]!, at: 0 }
  return { ...w, x, at: w.at + 1, until: w.until - 1 }
}

// His frame as rows of cells, mirrored when he faces left.
export const walkerFrame = (w: Walker) => {
  const index = w.clip === 'walking' ? (w.at < 0 ? 1 : WALK_CYCLE[mod(w.at, WALK_CYCLE.length)]!) : CLIPS[w.clip].seq[w.at]!
  const rows = FRAMES[w.clip][index]!
  return w.dir < 0 ? rows.map(row => [...row].reverse().join('')) : rows
}

// His frame's rows from TOP down, BAND_ROWS of them. A frame that reaches
// higher (the jump) is moved down to fit.
const bandRows = (w: Walker) => {
  const rows = walkerFrame(w)
  const lift = Math.max(0, TOP - rows.findIndex(row => /[^.]/.test(row)))
  return Array.from({ length: BAND_ROWS }, (_, y) => rows[y + TOP - lift] ?? '')
}

// A pose's shape, from his left edge: a path for each color through that
// color's runs in each row, his eyes left as holes.
const posePaths = (rows: string[]) => {
  const runs: Record<string, string> = {}
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const cell = row[x]!
      if (!COLORS[cell]) continue
      let end = x
      while (row[end + 1] === cell) end++
      const w = end - x + 1
      runs[cell] = `${runs[cell] ?? ''}M${x} ${y}h${w}v1h-${w}z`
      x = end
    }
  })
  return Object.entries(runs).map(([cell, d]) => `<path fill="${COLORS[cell]}" d="${d}"/>`).join('')
}

// A number from 0 to 1 that depends only on `n`, so the sky stays the same
// from frame to frame.
const hash = (n: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  x ^= x >>> 16
  return (x >>> 0) / 2 ** 32
}
const round = (n: number) => Math.round(n * 10) / 10

// The stars behind him, `width` half pixels wide: single stars, and clusters
// of dots on a grid that thin out toward their edges.
const stars = (width: number) => {
  const dots: { x: number; y: number; r: number; opacity: number }[] = []
  for (let i = 0; i < width / 5; i++) {
    const r = round(0.3 + 0.3 * hash(i * 3 + 2))
    const opacity = round(0.3 + 0.5 * hash(i * 3 + 3))
    dots.push({ x: round(hash(i * 3) * width), y: round(hash(i * 3 + 1) * BAND_ROWS), r, opacity })
  }
  for (let i = 0; i < Math.max(1, width / 80); i++) {
    const seed = 1000 + i * 5
    const cx = hash(seed) * width
    const cy = hash(seed + 1) * BAND_ROWS
    const size = 3 + 4 * hash(seed + 2)
    for (let gx = Math.ceil((cx - size) / GRID); gx * GRID <= cx + size; gx++) {
      for (let gy = Math.ceil((cy - size) / GRID); gy * GRID <= cy + size; gy++) {
        const far = Math.hypot(gx * GRID - cx, gy * GRID - cy) / size
        if (far >= 1 || gx < 0 || gy < 0 || gx * GRID > width || gy * GRID > BAND_ROWS || hash(seed + gx * 131 + gy * 7) < 0.3 + far / 2) continue
        dots.push({ x: round(gx * GRID), y: round(gy * GRID), r: round(0.7 * (1 - far / 2)), opacity: 0.5 })
      }
    }
  }
  return dots
}

export const starfield = (width: number) =>
  stars(width).map(d => `<circle cx="${d.x}" cy="${d.y}" r="${d.r}" fill="${STAR}" opacity="${d.opacity}"/>`).join('')

// The sky: a dark fill and its stars, built once.
let sky: string | undefined
const skyMarkup = () => (sky ??= `<rect width="100%" height="100%" fill="${SKY}"/><g transform="scale(${HALF})">${starfield(SKY_WIDTH)}</g>`)
export const skySvg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${BAND_HEIGHT}">${skyMarkup()}</svg>`

// The desktop draws the band as one SVG that animates itself: the sky, and
// each walker's walk worked out ahead from stepWalker a frame a tick. The mod
// sends it again only when the band changes. A new image every frame grew
// the app's memory without end.

// The most markup an Svg takes, and about what each frame of a walk costs.
// The sky, the poses and the rest leave the walks the remainder: Clawd a
// loop of up to four minutes, the minis the rest between them.
const MAX_SOURCE = 131072
const TICK_CHARS = 18
const POSE_CHARS = 30000
const LEADER_TICKS = 3000
export const miniTicks = (minis: number) =>
  Math.floor(((MAX_SOURCE - skyMarkup().length - POSE_CHARS) / TICK_CHARS - LEADER_TICKS) / Math.max(1, minis))

// Back where he starts: at the left end, facing right, about to walk.
const isHome = (w: Walker) => w.clip === 'walking' && w.at === -1 && w.x === 0 && w.dir === 1

export type Walk = { intro: Walker[]; loop: Walker[] }

// His walk from `w` at tick `t`, at most `ticks` frames: the frames until he
// first gets home, then the most laps from home back home. With no lap that
// fits, the frames he has, so he jumps back to the start of them each time.
export const planWalk = (w: Walker, width: number, t: number, ticks: number): Walk => {
  const frames = [w]
  const homes: number[] = []
  for (let i = 1; i <= ticks; i++) {
    w = stepWalker(w, width, t + i)
    if (isHome(w)) homes.push(i)
    frames.push(w)
  }
  const home = isHome(frames[0]!) ? 0 : homes[0]
  const cut = homes.at(-1)
  if (home === undefined || cut === undefined || cut <= home) return { intro: [], loop: frames.slice(0, ticks) }
  return { intro: frames.slice(0, home), loop: frames.slice(home, cut) }
}

// The poses the band's walkers take, each once, side by side in a strip that
// a window his size shows one of at a time. Facing left, a pose is drawn
// mirrored.
const poseStrip = () => {
  const poses = new Map<string, number>()
  const slots = new Map<string, number>()
  const defs: string[] = []
  const strip: string[] = []
  const slot = (w: Walker) => {
    const rows = bandRows({ ...w, dir: 1 })
    const key = rows.join('/')
    if (!poses.has(key)) {
      defs.push(`<g id="p${poses.size}">${posePaths(rows)}</g>`)
      poses.set(key, poses.size)
    }
    const pose = poses.get(key)!
    const name = `${pose} ${w.dir}`
    if (!slots.has(name)) {
      const left = slots.size * CLIP_WIDTH
      strip.push(w.dir > 0
        ? `<use href="#p${pose}" x="${left}"/>`
        : `<use href="#p${pose}" transform="translate(${left + CLIP_WIDTH} 0) scale(-1 1)"/>`)
      slots.set(name, slots.size)
    }
    return slots.get(name)!
  }
  return { slot, defs: () => `<defs>${defs.join('')}<g id="strip">${strip.join('')}</g></defs>` }
}

export type Walking = { walk: Walk; scale: number; elapsed: number }

// One walker at `scale`, `elapsed` milliseconds into his walk. Three discrete
// animations of `x` play it: how far along the band he is, the same share of
// his own width back, so he spans it end to end without knowing its pixels,
// and which pose of the strip shows through his window.
const walkerMarkup = ({ walk, scale, elapsed }: Walking, width: number, slot: (w: Walker) => number) => {
  const span = Math.max(1, Math.floor(width / scale) - CLIP_WIDTH)
  const introMs = walk.intro.length * TICK_MS
  const loopMs = walk.loop.length * TICK_MS
  const parts = elapsed < introMs
    ? [{ frames: walk.intro, begin: -elapsed, repeat: false }, { frames: walk.loop, begin: introMs - elapsed, repeat: true }]
    : [{ frames: walk.loop, begin: -((elapsed - introMs) % loopMs), repeat: true }]
  const animate = (value: (w: Walker) => string | number) => parts.map(p =>
    `<animate attributeName="x" calcMode="discrete" values="${p.frames.map(value).join(';')}" dur="${p.frames.length * TICK_MS}ms" begin="${p.begin}ms"`
    + `${p.repeat ? ' repeatCount="indefinite"' : ' fill="freeze"'}/>`).join('')
  const along = (w: Walker) => w.x / span
  return `<svg overflow="visible">${animate(w => `${round(along(w) * 100)}%`)}`
    + `<g transform="translate(0 ${BAND_HEIGHT * (1 - scale)}) scale(${HALF * scale})" shape-rendering="crispEdges">`
    + `<svg width="${CLIP_WIDTH}" height="${BAND_ROWS}">${animate(w => round(-along(w) * CLIP_WIDTH))}`
    + `<svg overflow="visible">${animate(w => -slot(w) * CLIP_WIDTH)}<use href="#strip"/></svg></svg></g></svg>`
}

// The band as one SVG as wide as the app makes it: the sky, then each walker
// in turn, so the last stands in front.
export const bandSvg = (walkers: Walking[], width: number) => {
  const { slot, defs } = poseStrip()
  const bodies = walkers.map(w => walkerMarkup(w, width, slot)).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${BAND_HEIGHT}">${defs()}${skyMarkup()}${bodies}</svg>`
}

// A new mini hops out of Clawd and heads off the other way.
const spawnMini = (leader: Walker, i: number): Walker => ({
  x: Math.round(leader.x / MINI_SCALE),
  dir: (i % 2 ? leader.dir : -leader.dir) as 1 | -1,
  clip: 'jumping',
  at: 0,
  until: 0,
})

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const SKY_RGB = rgb(SKY)
const STAR_RGB = rgb(STAR)
const CELL_RGB = Object.fromEntries(Object.entries(COLORS).map(([cell, hex]) => [cell, rgb(hex)]))

// The sky as RGBA pixels, `width` by BAND_ROWS, each star one pixel mixed
// into the dark at its opacity.
const skyPixels = (width: number) => {
  const px = new Uint8Array(width * BAND_ROWS * 4)
  for (let i = 0; i < px.length; i += 4) px.set([...SKY_RGB, 255], i)
  for (const d of stars(width)) {
    const x = Math.floor(d.x)
    const y = Math.floor(d.y)
    if (x >= width || y >= BAND_ROWS) continue
    px.set(SKY_RGB.map((c, k) => Math.round(c + (STAR_RGB[k]! - c) * d.opacity)), (y * width + x) * 4)
  }
  return px
}
const skies = new Map<number, Uint8Array>()

// One walker painted into `px` at `scale`, standing on the bottom edge, each
// pixel taking the frame cell under it.
const paint = (px: Uint8Array, width: number, w: Walker, scale: number) => {
  const rows = bandRows(w)
  const tall = Math.round(BAND_ROWS * scale)
  const left = Math.round(w.x * scale)
  for (let ty = 0; ty < tall; ty++) {
    const row = rows[Math.floor(ty / scale)]!
    for (let tx = 0; tx < Math.round(CLIP_WIDTH * scale); tx++) {
      const color = CELL_RGB[row[Math.floor(tx / scale)] ?? '.']
      const x = left + tx
      if (color && x < width) px.set(color, ((BAND_ROWS - tall + ty) * width + x) * 4)
    }
  }
}

// The band as RGBA pixels for kitty and Ghostty, `width` wide: the sky, the
// minis, and Clawd in front, as the desktop draws them.
const scene = (w: Walker | null, width: number, minis: Walker[]) => {
  if (!skies.has(width)) skies.set(width, skyPixels(width))
  const px = skies.get(width)!.slice()
  for (const m of minis) paint(px, width, m, MINI_SCALE)
  if (w) paint(px, width, w, 1)
  return px
}

export const picture = (w: Walker | null, width: number, minis: Walker[] = []) =>
  ({ rgba: scene(w, width, minis).toBase64(), width, height: BAND_ROWS })

// What the Image shows: the scene as a PNG PICTURE_SCALE times larger, or as
// large as the 4096 pixel limit allows, so the terminal barely stretches it.
export const pictureSource = (w: Walker | null, width: number, minis: Walker[] = []) =>
  ({ png: encodePng(scene(w, width, minis), width, BAND_ROWS, Math.max(1, Math.min(PICTURE_SCALE, Math.floor(4096 / width)))) })

// What the band last drew, for the timer's repaints between draws.
let timer: Timer | undefined
let tick = 0
let band: { id: string; surface: string; columns: number; minis: number; hasLeader: boolean } | undefined
let walker = startWalker()
let followers: Walker[] = []
// Whether the terminal shows pictures (kitty, Ghostty), read at session start.
let hasPictures = false
// The desktop band: when the walk began, less the time the band sat idle, so
// a new turn picks his walk up where the last one left it; when the band went
// idle; when each mini hopped out; and the SVG as last drawn, so a redraw
// sends the same markup.
let since = 0
let idleAt = 0
let spawned: number[] = []
let drawn: { key: string; source: string } | undefined
let leaderWalk: { width: number; walk: Walk } | undefined

// The desktop band's SVG: the minis first, so Clawd stands in front. Each mini
// hops out of Clawd where his walk had him when it spawned.
const desktopBand = (columns: number, hasLeader: boolean, now: number) => {
  const width = viewWidth(columns)
  const key = `${since} ${width} ${hasLeader} ${spawned.join(' ')}`
  if (drawn?.key === key) return drawn.source
  if (leaderWalk?.width !== width) leaderWalk = { width, walk: planWalk(startWalker(), width, 0, LEADER_TICKS) }
  const { loop } = leaderWalk.walk
  const walkers: Walking[] = spawned.map((at, i) => {
    const t = Math.floor((at - since) / TICK_MS)
    const mini = spawnMini(loop[t % loop.length]!, i)
    const walk = planWalk(mini, Math.floor(width / MINI_SCALE), t + 7 * (i + 1), miniTicks(spawned.length))
    return { walk, scale: MINI_SCALE, elapsed: now - at }
  })
  if (hasLeader) walkers.push({ walk: leaderWalk.walk, scale: 1, elapsed: now - since })
  drawn = { key, source: bandSvg(walkers, width) }
  return drawn.source
}

function start($: EngineInterface) {
  timer ??= $.clock.every(TICK_MS, () => {
    tick += 1
    // The desktop's walkers animate themselves. The terminal swaps its
    // picture or repaints its cells in place. A frame that cannot be painted
    // is skipped and the next one tries.
    if (band?.surface !== 'terminal') return
    if (hasPictures) {
      const width = pictureWidth(band.columns)
      if (band.hasLeader) walker = stepWalker(walker, width, tick)
      const count = Math.min(band.minis, MAX_MINIS)
      while (followers.length < count) followers.push(spawnMini(walker, followers.length))
      followers = followers.slice(0, count).map((m, i) => stepWalker(m, Math.floor(width / MINI_SCALE), tick + 7 * (i + 1)))
      const source = pictureSource(band.hasLeader ? walker : null, pictureWidth(band.columns), followers)
      $.ui.blit({ requestId: band.id, key: KEY, source }).catch(() => {})
    } else {
      const cells = frame(Math.floor(tick / 2), band.columns, band.minis, band.hasLeader)
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
    const term = await $.env.get('TERM').catch(() => undefined)
    hasPictures = /kitty|ghostty/.test(term ?? '')
    if ((await read($, working)) || (await read($, agents)).length > 0) start($)
    return r
  })

  on('turn.start', async ($, e, next) => {
    if (!timer) {
      tick = 0
      since += (await $.clock.now()) - idleAt
      spawned = []
    }
    await update($, working, () => e.turnId)
    await update($, commands, () => [])
    start($)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    const { agentId } = ran
    if (agentId) {
      await update($, agents, a => (a.includes(agentId) ? a : [...a, agentId]))
      start($)
      $.ui.invalidate('ui.render')
    }
    return ran
  })

  // The main loop's TaskCreate and TaskUpdate calls keep the checklist.
  // Its other calls feed the latest-command line as they start. A call from
  // a subagent that already finished means it resumed. That check sits here,
  // not on turn.step, which would pass every streamed chunk through the mod.
  on('tool.call', async ($, e, next) => {
    const call = e as unknown as Record<string, any>
    const agentId = call.agentId as string | undefined
    if (agentId && !(await read($, agents)).includes(agentId)) {
      await update($, agents, a => (a.includes(agentId) ? a : [...a, agentId]))
      start($)
      $.ui.invalidate('ui.render')
    }
    if (!agentId && !/^(Task|TodoWrite|SubagentHandback)/.test(String(call.tool))) {
      const line = describeCommand(call)
      await update($, commands, list => [...list, line].slice(-MAX_COMMANDS))
    }
    const ran = await next(e)
    const result = ran.result as Record<string, any> | undefined
    if (call.agentId || ran.isError) return ran
    if (call.tool === 'TaskCreate' && result?.task?.id) {
      const task: WorkingTask = { subject: String(result.task.subject), status: 'pending' }
      if (typeof call.activeForm === 'string') task.activeForm = call.activeForm
      await update($, tasks, list => ({ ...list, [String(result.task.id)]: task }))
    } else if (call.tool === 'TaskUpdate' && result?.success !== false) {
      const id = String(call.taskId)
      await update($, tasks, list => {
        const task = list[id]
        if (!task) return list
        if (call.status === 'deleted') {
          const { [id]: _, ...rest } = list
          return rest
        }
        const changed: WorkingTask = { ...task }
        if (typeof call.subject === 'string') changed.subject = call.subject
        if (typeof call.activeForm === 'string') changed.activeForm = call.activeForm
        if (call.status === 'pending' || call.status === 'in_progress' || call.status === 'completed') changed.status = call.status
        return { ...list, [id]: changed }
      })
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const { agentId } = e
    if (agentId) {
      await update($, agents, a => a.filter(id => id !== agentId))
    } else if (e.turnId === (await read($, working))) {
      await update($, working, () => null)
    }
    if (!(await read($, working)) && (await read($, agents)).length === 0) {
      stop()
      idleAt = await $.clock.now()
    }
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // The band spans the window, so a resize redraws it at the new width. The
  // terminal draws cells; the desktop app, which has no Raster, the sky and
  // an SVG for each walker, and nothing else.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const hasLeader = (await read($, working)) !== null
    const minis = (await read($, agents)).length
    const columns = Math.min(e.props.bodyColumns, MAX_COLUMNS)
    const isIdle = !hasLeader && minis === 0
    if (isIdle || e.props.hasSurvey || columns < MIN_COLUMNS) return next(e)
    if (e.surface === 'desktop') {
      band = { id: e.requestId, surface: e.surface, columns, minis, hasLeader }
      const now = await $.clock.now()
      while (spawned.length < Math.min(minis, MAX_MINIS)) spawned.push(now)
      spawned = spawned.slice(0, minis)
      const { Box, Svg } = $.ui.resolve(e)
      // The app paints a placed Box over everything before it. So the sky holds
      // the band's height, the sky color runs past the band's edges to cover
      // its padding, and the band's own SVG, its sky and walkers, goes on top.
      return (
        <Box position="relative" flexDirection="column">
          <Svg source={skySvg()} height={BAND_HEIGHT} alt="A starry sky" />
          <Box position="absolute" top={-2} left={-2} right={-2} bottom={-2} backgroundColor={SKY} />
          <Box position="absolute" top={0} left={0} right={0} bottom={0} flexDirection="column">
            <Svg source={desktopBand(columns, hasLeader, now)} height={BAND_HEIGHT} alt="Clawd walking along the prompt box" />
          </Box>
        </Box>
      )
    }
    if (e.surface !== 'terminal') return next(e)
    band = { id: e.requestId, surface: e.surface, columns, minis, hasLeader }
    const { Box, Image, Raster, Text } = $.ui.resolve(e)
    if (hasPictures) {
      const source = pictureSource(hasLeader ? walker : null, pictureWidth(columns), followers.slice(0, minis))
      return <Image key={KEY} source={source} columns={columns} rows={PICTURE_ROWS} alt="Clawd walking along the prompt" />
    }
    const progress = checklist(await read($, tasks))
    const latest = (await read($, commands)).at(-1)
    const task = progress && (
      <Text wrap="truncate">{progress.now ? `${progress.now}  ` : ''}<Text dimColor>{progress.count}</Text></Text>
    )
    return (
      <Box flexDirection="column">
        {(task || latest) && (
          <Box flexDirection="row">
            {latest && <Box flexShrink={1} marginRight={3}><Text dimColor wrap="truncate">{latest}</Text></Box>}
            {task}
          </Box>
        )}
        <Raster key={KEY} columns={columns} rows={ROWS} cells={frame(Math.floor(tick / 2), columns, minis, hasLeader)} />
      </Box>
    )
  })
}
