import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { checklist, describeCommand, frame, status, svg, ticker } from './register.tsx'

const ORANGE = 0xd77757
const DEFAULT = 0x01000000

const COLUMNS = 30

// The words of a frame `COLUMNS` wide, and cell (x, row) of it as
// [codePoint, foreground, background].
const words = (cells: string) => new Uint32Array(Uint8Array.fromBase64(cells).buffer)
const cell = (cells: string, x: number, row: number) => {
  const i = (row * COLUMNS + x) * 3
  return [...words(cells).slice(i, i + 3)]
}
const cell60 = (cells: string, x: number, row: number) => {
  const i = (row * 60 + x) * 3
  return [...words(cells).slice(i, i + 3)]
}

// The leftmost column with any orange in it: the left hand of whoever is
// furthest left.
const leftmost = (cells: string, columns = COLUMNS) => {
  const w = words(cells)
  for (let x = 0; x < columns; x++) {
    for (let row = 0; row < 3; row++) {
      const i = (row * columns + x) * 3
      if (w[i + 1] === ORANGE || w[i + 2] === ORANGE) return x
    }
  }
  return -1
}

// Stands in for the engine beneath the plugin. The animation timer's first
// period waits for `tick()`; a second period is refused, which ends it.
const engine = (on: On) => {
  const periods: number[] = []
  const blits: string[] = []
  const clock = { now: 0 }
  let release = () => {}
  on('clock.now', () => ({ value: clock.now }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })
  // The engine's own band: an empty box.
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}))
  on('ui.blit', (_$, e) => {
    blits.push((e as { cells: string }).cells)
    return {}
  })
  on('clock.every', async (_$, e) => {
    periods.push(e.ms)
    if (periods.length > 1) throw new Error('one period is enough')
    await new Promise<void>(resolve => (release = resolve))
    return { value: undefined }
  })
  return { periods, blits, clock, tick: () => release() }
}

const mount = ($: Engine, surface: 'terminal' | 'desktop' | 'vscode', bodyColumns = 100) =>
  $.ui.mount({
    plugin: 'working-clawd',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, maxRows: 10, bodyColumns } as never,
    viewport: { columns: 120, rows: 40 },
  })

const complete = ($: Engine, turnId: string, agentId?: string) =>
  $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId, agentId, reason: 'answer' })

test('a frame spans the band in three rows of half blocks', () => {
  const w = words(frame(0, COLUMNS))
  expect(w.length).toBe(COLUMNS * 3 * 3)
  for (let i = 0; i < w.length; i += 3) expect([0x20, 0x2580, 0x2584]).toContain(w[i])
})

test('Clawd walks a column per frame and turns around at each end', () => {
  // His sprite is 18 wide, so in 30 columns he walks 12 each way.
  expect(leftmost(frame(0, COLUMNS))).toBe(1)
  expect(leftmost(frame(5, COLUMNS))).toBe(6)
  expect(leftmost(frame(12, COLUMNS))).toBe(13)
  expect(leftmost(frame(13, COLUMNS))).toBe(12)
  expect(leftmost(frame(24, COLUMNS))).toBe(1)
})

test('every other frame he hops with his feet splayed', () => {
  // The top of his head: one pixel down on a step, at the top on a hop.
  expect(cell(frame(0, COLUMNS), 7, 0)).toEqual([0x2584, ORANGE, DEFAULT])
  expect(cell(frame(1, COLUMNS), 8, 0)).toEqual([0x2580, ORANGE, ORANGE])
  // Standing, his outer left leg runs straight down from the edge of his body.
  expect(cell(frame(0, COLUMNS), 3, 2)).toEqual([0x2580, ORANGE, ORANGE])
  expect(cell(frame(0, COLUMNS), 4, 2)).toEqual([0x2580, ORANGE, DEFAULT])
  // Hopping, that foot splays out one pixel on the bottom row.
  expect(cell(frame(1, COLUMNS), 3, 2)).toEqual([0x2584, ORANGE, DEFAULT])
  expect(cell(frame(1, COLUMNS), 4, 2)).toEqual([0x2580, ORANGE, DEFAULT])
})

test('his eyes look the way he walks, and he blinks every 16th frame', () => {
  const eye = [0x2584, ORANGE, DEFAULT]
  // Walking right on frame 0: the eye sits one pixel right of the logo's.
  expect(cell(frame(0, COLUMNS), 6, 1)).toEqual(eye)
  expect(cell(frame(0, COLUMNS), 4, 1)).toEqual([0x2580, ORANGE, ORANGE])
  // Walking left on frame 14: one pixel left of it.
  expect(cell(frame(14, COLUMNS), 14, 1)).toEqual(eye)
  // Frames 13 and 15 are hops while walking left: open eye, then a blink.
  expect(cell(frame(13, COLUMNS), 15, 0)).toEqual([0x2580, ORANGE, DEFAULT])
  expect(cell(frame(15, COLUMNS), 13, 0)).toEqual([0x2580, ORANGE, ORANGE])
})

test('a mini per subagent follows his path a set distance behind', () => {
  // In 60 columns at frame 30 he walks right with his left hand at 31. The
  // first mini walks where he was 16 frames ago, the second 10 frames later.
  expect(leftmost(frame(30, 60), 60)).toBe(31)
  expect(leftmost(frame(30, 60, 1), 60)).toBe(19)
  expect(leftmost(frame(30, 60, 2), 60)).toBe(9)
})

test('the minis hop in step with him, and walk on their own when he is idle', () => {
  // Frame 31 is a hop: the first mini's head rises to the top row of pixels.
  expect(cell60(frame(31, 60, 1), 22, 0)).toEqual([0x2584, ORANGE, DEFAULT])
  expect(cell60(frame(30, 60, 1), 21, 0)).toEqual([0x20, DEFAULT, DEFAULT])
  // Without him, only the mini is drawn.
  expect(leftmost(frame(30, 60, 1, false), 60)).toBe(19)
  expect(cell60(frame(30, 60, 1, false), 35, 1)).toEqual([0x20, DEFAULT, DEFAULT])
})

test('the band shows a mini while a subagent runs, and again when it resumes', async ($, on) => {
  engine(on)
  await $.agent.spawn({ prompt: 'Go.', description: 'task', subagentType: 'helper' })
  let ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  await ui.unmount()

  await complete($, 't-a1', 'a1')
  ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()

  for await (const _ of $.turn.step({ turnId: 't-a1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'a1' })) {
    // Drain the stream so the step completes.
  }
  ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  await ui.unmount()
  await complete($, 't-a1', 'a1')
})

test('the band shows Clawd only while a main turn runs', async ($, on) => {
  engine(on)
  let ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await complete($, 'sub-1', 'agent-1')
  ui = await mount($, 'terminal')
  expect((await ui.find({ type: 'Raster' }))?.props).toMatchObject({ columns: 100, rows: 3 })
  await ui.unmount()

  await complete($, 't1')
  ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

test('each tick of the timer repaints the band with the next frame', async ($, on) => {
  const { periods, blits, tick } = engine(on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const ui = await mount($, 'terminal')
  tick()
  for (let i = 0; i < 50 && blits.length === 0; i++) await Promise.resolve()
  expect(periods[0]).toBe(150)
  expect(blits).toEqual([frame(1, 100)])
  await ui.unmount()
  await complete($, 't1')
})

test('the desktop app draws him as an SVG; a narrow terminal and the editor draw nothing', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const desktop = await mount($, 'desktop')
  const drawn = await desktop.find({ type: 'Svg' })
  expect(drawn?.props).toMatchObject({ source: svg(0, 28, 0, true), width: 56, height: 28 })
  await desktop.unmount()
  for (const ui of [await mount($, 'terminal', 20), await mount($, 'vscode')]) {
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  }
  await complete($, 't1')
})

test('the desktop scene: he sits at the right end at his laptop, minis to his left', () => {
  const cell = (markup: string, x: number, y: number) =>
    markup.match(new RegExp(`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="(#[0-9a-f]{6})"/>`))?.[1]
  const source = svg(0, 40)
  // Scaled by its height and anchored right, with nothing behind him.
  expect(source).toContain('width="80" height="28" viewBox="0 0 40 14" preserveAspectRatio="xMaxYMax slice"')
  expect(source).toContain('<g transform="translate(12 0) scale(1)">')
  // The top of his head, his eye as a hole, and his laptop's base.
  expect(cell(source, 11, 0)).toBe('#d77757')
  expect(cell(source, 19, 3)).toBeUndefined()
  expect(cell(source, 4, 13)).toBe('#9a9c9f')
  // His legs stand in two pairs with a gap between, each foot a step back.
  expect(cell(source, 12, 11)).toBe('#d77757')
  expect(cell(source, 14, 11)).toBeUndefined()
  expect(cell(source, 15, 11)).toBe('#d77757')
  for (const x of [17, 18, 19, 20]) expect(cell(source, x, 11)).toBeUndefined()
  expect(cell(source, 21, 11)).toBe('#d77757')
  expect(cell(source, 12, 13)).toBeUndefined()
  expect(cell(source, 13, 13)).toBe('#d77757')
  // He blinks every 16th frame.
  expect(cell(svg(15, 40), 19, 3)).toBe('#d77757')
  // His hands circle half a turn apart: on frame 0 one is up and the other
  // presses the laptop's base; on frame 1 both swing to the middle.
  expect(cell(source, 8, 6)).toBe('#d77757')
  expect(cell(source, 8, 12)).toBe('#d77757')
  expect(cell(source, 8, 9)).toBeUndefined()
  expect(cell(svg(1, 40), 7, 9)).toBe('#d77757')
  expect(cell(svg(1, 40), 8, 12)).toBeUndefined()
  expect(cell(svg(2, 40), 8, 12)).toBe('#d77757')
  // Each mini is smaller with its own laptop; one that does not fit is left out.
  const sprites = (markup: string) => markup.split('<g transform').length - 1
  expect(sprites(svg(0, 40, 1))).toBe(1)
  expect(sprites(svg(0, 60, 1))).toBe(2)
  expect(sprites(svg(0, 60, 3))).toBe(2)
  expect(sprites(svg(0, 70, 3))).toBe(3)
})

test('the checklist line counts done tasks and names the one in progress', () => {
  expect(checklist({})).toBeUndefined()
  expect(checklist({
    1: { subject: 'Draw the hands', status: 'completed' },
    2: { subject: 'Add the checklist', status: 'in_progress', activeForm: 'Adding the checklist' },
    3: { subject: 'Push', status: 'pending' },
  })).toEqual({ count: '1 of 3', now: 'Adding the checklist' })
  expect(checklist({ 1: { subject: 'Push', status: 'in_progress' } })?.now).toBe('Push')
})

test("the band follows the main loop's task list, not a subagent's", async ($, on) => {
  engine(on)
  let next = 0
  on('tool.call', (_$, e) => {
    const call = e as unknown as Record<string, any>
    return call.tool === 'TaskCreate'
      ? { result: { task: { id: String(++next), subject: call.subject } }, text: 'ok' }
      : { result: { success: true, taskId: call.taskId, updatedFields: [] }, text: 'ok' }
  })
  const call = (input: Record<string, unknown>) => $.tool.call(input as never)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await call({ tool: 'TaskCreate', subject: 'Draw the hands', description: 'x', activeForm: 'Drawing the hands' })
  await call({ tool: 'TaskCreate', subject: 'Add the checklist', description: 'x' })
  await call({ tool: 'TaskCreate', subject: 'Not mine', description: 'x', agentId: 'a1' })
  await call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
  await call({ tool: 'Bash', command: 'npm test' })

  // Desktop: the task, then the app's status beside him, the command ticker
  // to the left of both.
  let ui = await mount($, 'desktop')
  expect(await ui.find({ type: 'Text', text: 'Drawing the hands' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /0s \u00b7 Working$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Bash npm test {3}/ })).toBeDefined()
  await ui.unmount()

  await call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await call({ tool: 'TaskUpdate', taskId: '2', status: 'deleted' })
  ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /^1 of 1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Bash npm test' })).toBeDefined()
  await ui.unmount()
  await complete($, 't1')
})

test('commands read as the tool and its main argument, and the ticker scrolls them', () => {
  expect(describeCommand({ tool: 'Bash', command: 'npm test\n--verbose' })).toBe('Bash npm test')
  expect(describeCommand({ tool: 'Edit', file_path: '/src/hooks/register.tsx' })).toBe('Edit register.tsx')
  expect(describeCommand({ tool: 'TaskList' })).toBe('TaskList')
  expect(ticker([], 0)).toBe('')
  // One character further along each frame, looping back to the start.
  expect(ticker(['Bash a', 'Read b'], 0)).toBe('Bash a   Read b   Bash a   Read b   Bash')
  expect(ticker(['Bash a', 'Read b'], 1)).toBe('ash a   Read b   Bash a   Read b   Bash ')
  expect(ticker(['Bash a', 'Read b'], 18)).toBe(ticker(['Bash a', 'Read b'], 0))
  // The band hands it its own width.
  expect(ticker(['Bash a'], 0, 100)).toHaveLength(100)
})

test("the app's spinner status shows just left of him: elapsed time and what it is doing", async ($, on) => {
  expect(status(20, { word: 'Working', message: null, mode: 'thinking' })).toBe('20s \u00b7 Thinking')
  expect(status(3, { word: 'Creating notes.md', message: null, mode: 'tool-use' })).toBe('3s \u00b7 Creating notes.md')
  expect(status(0)).toBe('0s \u00b7 Working')

  const { clock } = engine(on)
  clock.now = 1_000
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const spinner = await $.ui.mount({
    plugin: 'working-clawd',
    surface: 'desktop',
    component: 'Spinner',
    props: { word: 'Working', message: null, suffix: '\u2026', mode: 'thinking' } as never,
    viewport: { columns: 120, rows: 40 },
  })
  await spinner.unmount()
  clock.now = 21_400
  const ui = await mount($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /^\u2022 {2} 20s \u00b7 Thinking$/ })).toBeDefined()
  await ui.unmount()
  await complete($, 't1')
})
