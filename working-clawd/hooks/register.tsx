import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { WorkingTask, WorkingTasks, WorkingTurn } from '../types'

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
// CSS pixels per cell of the desktop sprite, a little bigger than the app's own Clawd.
const CELL = 2
const working = atom({ plugin: 'working-clawd', key: 'turnId' } as const, null as WorkingTurn)
const agents = atom({ plugin: 'working-clawd', key: 'agents' } as const, [] as string[])
const tasks = atom({ plugin: 'working-clawd', key: 'tasks' } as const, {} as WorkingTasks)
const commands = atom({ plugin: 'working-clawd', key: 'commands' } as const, [] as string[])
const MAX_COMMANDS = 8
// Characters of the command ticker shown at once.
const TICKER = 40

const CLEAR = -1
const DEFAULT = 0x01000000
const ORANGE = 0xd77757
const LAPTOP = '#9a9c9f'
// The desktop Clawd, drawn the way the app's own one is: seen from the side,
// facing left, his head over his face with one eye (E, a hole), his front (F)
// and back (B) hands out in front of him over a laptop (g) whose lid tilts
// back and whose base sits on the ground; a pressed hand lands on its keys. His four legs
// bend a little at the knee. 28 cells by 14.
const SIDE = [
  '...........OOOOOOOOOOOOOOOO.',
  '...........OOOOOOOOOOOOOOOO.',
  '...........OOOOOOOOOOOOOOOO.',
  '.............OOOOOOEEOOOOOO.',
  '.............OOOOOOEEOOOOOO.',
  '.......FFBBOOOOOOOOOOOOOOOO.',
  '.......FFBBOOOOOOOOOOOOOOOO.',
  '.......FFBBOOOOOOOOOOOOOOOO.',
  'g......FFBBOOOOOOOOOOOOOOOO.',
  'gg.....FFBBOOOOOOOOOOOOOOOO.',
  '.gg....FFBBOOOOOOOOOOOOOOOO.',
  '..gg...FFBB.OO..OO..OO..OO..',
  '...ggg......OOO.OOO.OOO.OOO.',
  '....ggggggg..OO..OO..OO..OO.',
]
const SIDE_COLUMNS = SIDE[0]!.length
const SIDE_ROWS = SIDE.length
const MINI_SCALE = 0.6
const MINI_STEP = SIDE_COLUMNS * MINI_SCALE + 1
// The desktop drawing's width in cells: him and each mini to his left.
const sceneColumns = (minis: number) => SIDE_COLUMNS + Math.min(minis, MAX_MINIS) * MINI_STEP

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

// One Clawd at his laptop as SVG cells, scaled by `s` (a mini is smaller).
// His hands take turns pressing a cell down onto the keys as he types, and
// he blinks every 16th frame.
const clawdAtLaptop = (left: number, top: number, s: number, t: number) => {
  const orange = `#${ORANGE.toString(16)}`
  const pressed = mod(t, 2) === 0 ? 'F' : 'B'
  const cells: string[] = []
  SIDE.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.' || (ch === 'E' && mod(t, 16) !== 15)) return
    const dip = ch === pressed ? 1 : 0
    cells.push(`<rect x="${x}" y="${y + dip}" width="1.02" height="1.02" fill="${ch === 'g' ? LAPTOP : orange}"/>`)
  }))
  return `<g transform="translate(${left} ${top}) scale(${s})">${cells.join('')}</g>`
}

// A frame as SVG markup for the desktop app, a cell CELL CSS pixels square,
// with nothing behind him: Clawd at the right end, each mini in a row to his
// left at its own laptop, as many as fit, all typing in time.
export const svg = (t: number, columns: number, minis = 0, hasLeader = true) => {
  const seat = columns - SIDE_COLUMNS
  const parts = hasLeader ? [clawdAtLaptop(seat, 0, 1, t)] : []
  for (let i = 0; i < Math.min(minis, MAX_MINIS); i++) {
    const left = seat - MINI_STEP * (i + 1)
    if (left >= 0) parts.push(clawdAtLaptop(left, SIDE_ROWS * (1 - MINI_SCALE), MINI_SCALE, t))
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${columns * CELL}" height="${SIDE_ROWS * CELL}" `
    + `viewBox="0 0 ${columns} ${SIDE_ROWS}" preserveAspectRatio="xMaxYMax slice" shape-rendering="crispEdges">`
    + `${parts.join('')}</svg>`
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

// The ticker's window at frame t: the commands in a loop, one character
// further along each frame.
export const ticker = (list: string[], t: number) => {
  if (list.length === 0) return ''
  const loop = `${list.join('   ')}   `
  const from = mod(t, loop.length)
  return loop.repeat(Math.ceil((from + TICKER) / loop.length)).slice(from, from + TICKER)
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
  // Its other calls feed the command ticker as they start.
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
  // terminal draws cells; the desktop app, which has no Raster, an SVG.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const hasLeader = (await read($, working)) !== null
    const minis = (await read($, agents)).length
    const columns = Math.min(e.props.bodyColumns, MAX_COLUMNS)
    const isIdle = !hasLeader && minis === 0
    if (isIdle || e.props.hasSurvey || columns < MIN_COLUMNS) return next(e)
    const progress = checklist(await read($, tasks))
    const recent = await read($, commands)
    const { Box, Text } = $.ui.resolve(e)
    const task = progress && (
      <Text wrap="truncate">{progress.now ? `${progress.now}  ` : ''}<Text dimColor>{progress.count}</Text></Text>
    )
    if (e.surface === 'desktop') {
      band = { id: e.requestId, surface: e.surface, columns, minis, hasLeader }
      const { Svg } = $.ui.resolve(e)
      const scene = sceneColumns(minis)
      return (
        <Box flexDirection="row" justifyContent="flex-end" alignItems="flex-end" width={columns}>
          <Box flexShrink={1} marginRight={3}>
            <Text dimColor wrap="truncate">{ticker(recent, tick)}</Text>
          </Box>
          <Box flexShrink={1} marginRight={1}>{task}</Box>
          <Svg
            source={svg(tick, scene, minis, hasLeader)}
            width={scene * CELL}
            height={SIDE_ROWS * CELL}
            alt="Clawd typing on a laptop while Claude works"
          />
        </Box>
      )
    }
    if (e.surface !== 'terminal') return next(e)
    band = { id: e.requestId, surface: e.surface, columns, minis, hasLeader }
    const { Raster } = $.ui.resolve(e)
    const latest = recent.at(-1)
    return (
      <Box flexDirection="column">
        {(task || latest) && (
          <Box flexDirection="row">
            {latest && <Box flexShrink={1} marginRight={3}><Text dimColor wrap="truncate">{latest}</Text></Box>}
            {task}
          </Box>
        )}
        <Raster key={KEY} columns={columns} rows={ROWS} cells={frame(tick, columns, minis, hasLeader)} />
      </Box>
    )
  })
}
