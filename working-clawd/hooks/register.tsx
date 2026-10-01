import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { WorkingTask, WorkingTasks, WorkingTurn } from '../types'

import { CLIP_HEIGHT, CLIP_WIDTH, CLIPS } from './clips'
import type { ClipName } from './clips'

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
// The desktop band, in CSS pixels: a half pixel of Clawd, and a guess at one
// of the band's columns, to know how far he can walk.
const HALF = 1.5
const COLUMN = 8
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

// The band as SVG markup, `width` half pixels wide: each row's runs of one
// color as rectangles, his eyes left as holes.
export const walkerSvg = (w: Walker, width: number) => {
  const rects: string[] = []
  walkerFrame(w).forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const fill = COLORS[row[x]!]
      if (!fill) continue
      let end = x
      while (row[end + 1] === row[x]) end++
      rects.push(`<rect x="${w.x + x}" y="${y}" width="${end - x + 1}" height="1" fill="${fill}"/>`)
      x = end
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * HALF}" height="${CLIP_HEIGHT * HALF}" `
    + `viewBox="0 0 ${width} ${CLIP_HEIGHT}" shape-rendering="crispEdges">${rects.join('')}</svg>`
}

// What the band last drew, for the timer's repaints between draws.
let timer: Timer | undefined
let tick = 0
let band: { id: string; surface: string; columns: number; minis: number; hasLeader: boolean } | undefined
let walker = startWalker()

function start($: EngineInterface) {
  timer ??= $.clock.every(TICK_MS, () => {
    tick += 1
    if (!band) return
    // The desktop app redraws the SVG; the terminal repaints its cells in
    // place. A frame that cannot be painted is skipped and the next one tries.
    if (band.surface === 'desktop') {
      walker = stepWalker(walker, viewWidth(band.columns), tick)
      $.ui.invalidate('ui.render')
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
    if ((await read($, working)) || (await read($, agents)).length > 0) start($)
    return r
  })

  on('turn.start', async ($, e, next) => {
    if (!timer) tick = 0
    await update($, working, () => e.turnId)
    await update($, commands, () => [])
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

  // The main loop's TaskCreate and TaskUpdate calls keep the checklist.
  // Its other calls feed the latest-command line as they start.
  on('tool.call', async ($, e, next) => {
    const call = e as unknown as Record<string, any>
    if (!call.agentId && !/^(Task|TodoWrite|SubagentHandback)/.test(String(call.tool))) {
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
    if (!(await read($, working)) && (await read($, agents)).length === 0) stop()
    return next(e)
  })

  // The band spans the window, so a resize redraws it at the new width. The
  // terminal draws cells; the desktop app, which has no Raster, an SVG of
  // Clawd walking the band and nothing else.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const hasLeader = (await read($, working)) !== null
    const minis = (await read($, agents)).length
    const columns = Math.min(e.props.bodyColumns, MAX_COLUMNS)
    const isIdle = !hasLeader && minis === 0
    if (isIdle || e.props.hasSurvey || columns < MIN_COLUMNS) return next(e)
    if (e.surface === 'desktop') {
      if (!hasLeader) return next(e)
      band = { id: e.requestId, surface: e.surface, columns, minis, hasLeader }
      const { Svg } = $.ui.resolve(e)
      return (
        <Svg
          source={walkerSvg(walker, viewWidth(columns))}
          width={columns * COLUMN}
          height={CLIP_HEIGHT * HALF}
          alt="Clawd walking along the prompt box"
        />
      )
    }
    if (e.surface !== 'terminal') return next(e)
    band = { id: e.requestId, surface: e.surface, columns, minis, hasLeader }
    const progress = checklist(await read($, tasks))
    const latest = (await read($, commands)).at(-1)
    const { Box, Raster, Text } = $.ui.resolve(e)
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
