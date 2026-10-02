import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { checklist, describeCommand, frame, starfield, startWalker, stepWalker, walkerFrame, walkerSvg } from './register.tsx'
import type { Walker } from './register.tsx'

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
  expect(periods[0]).toBe(83)
  // The terminal walker steps every other frame of the 12 a second.
  expect(blits).toEqual([frame(0, 100)])
  await ui.unmount()
  await complete($, 't1')
})

test('the desktop app draws him walking as an SVG; a narrow terminal and the editor draw nothing', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const desktop = await mount($, 'desktop')
  const drawn = await desktop.find({ type: 'Svg' })
  // 100 columns of about 6 CSS pixels is 240 half pixels of 2.5 to walk.
  expect(drawn?.props).toMatchObject({ source: walkerSvg(startWalker(), 240), height: 52.5 })
  expect(drawn?.props.width).toBeUndefined()
  expect(await desktop.find({ type: 'Text' })).toBeUndefined()
  await desktop.unmount()
  for (const ui of [await mount($, 'terminal', 20), await mount($, 'vscode')]) {
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  }
  await complete($, 't1')
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

  // The terminal shows the latest command and the task above the walker.
  let ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /^Drawing the hands {2}0 of 2$/ })).toBeDefined()
  await ui.unmount()

  await call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await call({ tool: 'TaskUpdate', taskId: '2', status: 'deleted' })
  ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /^1 of 1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Bash npm test' })).toBeDefined()
  await ui.unmount()
  await complete($, 't1')
})

test('commands read as the tool and its main argument', () => {
  expect(describeCommand({ tool: 'Bash', command: 'npm test\n--verbose' })).toBe('Bash npm test')
  expect(describeCommand({ tool: 'Edit', file_path: '/src/hooks/register.tsx' })).toBe('Edit register.tsx')
  expect(describeCommand({ tool: 'TaskList' })).toBe('TaskList')
})

// Steps a walker `n` frames, starting at frame `t`.
const walk = (w: Walker, width: number, n: number, t = 0) => {
  for (let i = 0; i < n; i++) w = stepWalker(w, width, t + i)
  return w
}

test('he walks a half pixel a frame, turns at the right end, and walks back mirrored', () => {
  // 64 half pixels wide less his 24 leaves 40 to walk; no stop before then.
  let w: Walker = { ...startWalker(), until: 999 }
  w = walk(w, 64, 10)
  expect(w).toMatchObject({ x: 10, dir: 1, clip: 'walking' })
  w = walk(w, 64, 30)
  expect(w).toMatchObject({ x: 40, clip: 'turning', at: 0 })
  w = walk(w, 64, 29)
  expect(w).toMatchObject({ x: 40, dir: -1, clip: 'walking', at: -1 })
  w = walk({ ...w, until: 999 }, 64, 5)
  expect(w).toMatchObject({ x: 35, dir: -1 })
  // Facing left, his walking frame is the right-facing one mirrored.
  expect(walkerFrame(w)).toEqual(walkerFrame({ ...w, dir: 1 }).map(row => [...row].reverse().join('')))
})

test('after a stretch of walking he stops to look, wave, jump or turn, then walks on', () => {
  let w: Walker = { ...startWalker(), x: 10, until: 0 }
  expect(stepWalker(w, 200, 0).clip).toBe('looking')
  expect(stepWalker(w, 200, 1).clip).toBe('waving')
  expect(stepWalker(w, 200, 2).clip).toBe('jumping')
  expect(stepWalker(w, 200, 3).clip).toBe('turning')
  // Waving runs its 17 frames in place, then he walks on the same way.
  w = stepWalker(w, 200, 1)
  w = walk(w, 200, 17)
  expect(w).toMatchObject({ x: 11, dir: 1, clip: 'walking', at: -1 })
  expect(w.until).toBeGreaterThanOrEqual(30)
})

test('the SVG draws his frame where he stands, his eyes left as holes', () => {
  const w: Walker = { ...startWalker(), x: 7, clip: 'looking', at: 0 }
  const source = walkerSvg(w, 100)
  expect(source).toContain('width="100%" height="52.5"')
  // 7 of the 76 half pixels he can walk is 9.2% along, less 9.2% of his width.
  expect(source).toContain('<svg x="9.2%" overflow="visible"><g transform="translate(-5.5 0) scale(2.5)">')
  // The front frame: his body's top row runs 16 half pixels from x 4.
  expect(source).toContain('<rect x="4" y="5" width="16" height="1" fill="#d97757"/>')
  // Its eye row: body, two eye cells left empty, body again.
  expect(source).toContain('<rect x="4" y="7" width="2" height="1" fill="#d97757"/>')
  expect(source).toContain('<rect x="8" y="7" width="8" height="1" fill="#d97757"/>')
  expect(source).not.toContain('fill="#141413"')
})

test('minis stand a quarter smaller on the same line, behind Clawd, under the sky', () => {
  const mini: Walker = { ...startWalker(), x: 40 }
  const source = walkerSvg(startWalker(), 100, [mini])
  expect(source.indexOf('fill="#151515"')).toBeLessThan(source.indexOf('scale(1.875)'))
  expect(source).toContain('<svg x="36.7%" overflow="visible"><g transform="translate(-16.5 13.125) scale(1.875)">')
  expect(source.indexOf('scale(1.875)')).toBeLessThan(source.lastIndexOf('scale(2.5)'))
  // With no main turn, only the minis walk.
  expect(walkerSvg(null, 100, [mini]).match(/overflow="visible"/g)).toHaveLength(1)
})

test('the sky is the same every frame and stays inside the band', () => {
  expect(starfield(300)).toBe(starfield(300))
  for (const [, cx, cy] of starfield(300).matchAll(/cx="([\d.]+)" cy="([\d.]+)"/g)) {
    expect(Number(cx)).toBeLessThanOrEqual(300)
    expect(Number(cy)).toBeLessThanOrEqual(21)
  }
})
