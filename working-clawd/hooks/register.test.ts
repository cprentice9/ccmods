import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { frame } from './register.tsx'

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

// The leftmost column with any orange in it: where Clawd's left hand is.
const leftmost = (cells: string) => {
  const w = words(cells)
  for (let x = 0; x < COLUMNS; x++) {
    for (let row = 0; row < 3; row++) {
      const i = (row * COLUMNS + x) * 3
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

const mount = ($: Engine, surface: 'terminal' | 'desktop', bodyColumns = 100) =>
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
  // A splayed foot on the bottom row while hopping.
  expect(cell(frame(1, COLUMNS), 4, 2)).toEqual([0x2584, ORANGE, DEFAULT])
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

test('the band stays out of the desktop app and a narrow terminal', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  for (const ui of [await mount($, 'desktop'), await mount($, 'terminal', 20)]) {
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    await ui.unmount()
  }
  await complete($, 't1')
})
