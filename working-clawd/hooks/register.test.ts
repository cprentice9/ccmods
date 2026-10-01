import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { frame, svg } from './register.tsx'

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
  let release = () => {}
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
  return { periods, blits, tick: () => release() }
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
  expect(drawn?.props.source).toBe(svg(0, 100, 0, true))
  await desktop.unmount()
  for (const ui of [await mount($, 'terminal', 20), await mount($, 'vscode')]) {
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  }
  await complete($, 't1')
})

test('the desktop scene: he sits at the right end behind a MacBook, minis to his left', () => {
  const source = svg(0, 30)
  expect(source).toContain('width="240" height="40" viewBox="0 0 30 5"')
  // The app's background behind him, so the band's box disappears.
  expect(source).toContain('<rect width="100%" height="100%" fill="#151515"/>')
  // His box is the last 17 columns: the top of his head starts at x 16, and
  // the right arm reaches the band's right edge.
  expect(source).toContain('<rect x="16" y="0" width="12" height="1" fill="#d77757"/>')
  expect(source).toContain('<rect x="28" y="2" width="2" height="1" fill="#d77757"/>')
  // The aluminum lid in front of him, with the apple at its center.
  expect(source).toContain('<rect x="17.5" y="2.2" width="8" height="2.8" fill="#b9bcc0" rx="0.25"/>')
  expect(source).toContain('<circle cx="21.5" cy="3.5" r="0.5" fill="#e4e6e8"/>')
  // His arms bob in turn: the left is up on even frames, the right on odd.
  expect(source).toContain('<rect x="14" y="1.5" width="2" height="1" fill="#d77757"/>')
  expect(svg(1, 30)).toContain('<rect x="28" y="1.5" width="2" height="1" fill="#d77757"/>')
  // He blinks every 16th frame: the eye row is one solid run.
  expect(svg(15, 30)).toContain('<rect x="16" y="1" width="12" height="1" fill="#d77757"/>')
  // Each mini is half size with its own laptop; one that does not fit is left out.
  const lids = (markup: string) => markup.split('fill="#b9bcc0" rx').length - 1
  expect(lids(svg(0, 30, 1))).toBe(2)
  expect(lids(svg(0, 30, 3))).toBe(2)
})
