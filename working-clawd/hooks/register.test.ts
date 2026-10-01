import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { frame } from './register.tsx'

const ORANGE = 0xd77757
const DEFAULT = 0x01000000

// Cell (x, row) of a frame as [codePoint, foreground, background].
const cell = (cells: string, x: number, row: number) => {
  const bytes = Uint8Array.fromBase64(cells)
  const words = new Uint32Array(bytes.buffer)
  return [...words.slice((row * 32 + x) * 3, (row * 32 + x) * 3 + 3)]
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

test('a frame is 32 by 4 cells of half blocks, with Clawd in orange', () => {
  const words = new Uint32Array(Uint8Array.fromBase64(frame(0)).buffer)
  expect(words.length).toBe(32 * 4 * 3)
  for (let i = 0; i < words.length; i += 3) expect([0x20, 0x2580, 0x2584]).toContain(words[i])
  // The top of Clawd's head, row 1: empty above, orange below.
  expect(cell(frame(0), 5, 1)).toEqual([0x2584, ORANGE, DEFAULT])
})

test('the arms take turns on the keys and each keystroke types a pixel', () => {
  // Right arm tip: down on the keys on even frames, up on odd ones.
  expect(cell(frame(0), 16, 3)).toEqual([0x2580, ORANGE, DEFAULT])
  expect(cell(frame(0), 16, 2)[0]).toBe(0x20)
  expect(cell(frame(1), 16, 2)).toEqual([0x2584, ORANGE, DEFAULT])
  // The first pixel of the bottom screen line appears on the first keystroke.
  expect(cell(frame(0), 21, 2)[1]).toBe(0x1f2633)
  expect(cell(frame(1), 21, 2)[1]).not.toBe(0x1f2633)
})

test('Clawd blinks every 16th frame', () => {
  // Left eye: a hole above the orange row, filled while blinking.
  expect(cell(frame(13), 5, 2)).toEqual([0x2584, ORANGE, DEFAULT])
  expect(cell(frame(15), 5, 2)).toEqual([0x2580, ORANGE, ORANGE])
})

test('the band shows Clawd only while a main turn runs', async ($, on) => {
  engine(on)
  let ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await complete($, 'sub-1', 'agent-1')
  ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
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
  expect(periods[0]).toBe(180)
  expect(blits).toEqual([frame(1)])
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
