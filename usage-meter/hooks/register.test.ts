import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement, RenderSurface } from 'claude-code'

// The parts of the usage endpoint's answer the mod reads.
const BODY = {
  limits: [
    { kind: 'session', percent: 45, scope: null },
    { kind: 'weekly_all', percent: 28, scope: null },
    { kind: 'weekly_scoped', percent: 49, scope: { model: { id: null, display_name: 'Fable' }, surface: null } },
  ],
}

// Stands in for the engine beneath the plugin.
const engine = (on: On, response: { status: number; text: string }) => {
  const fetched: { url: string; auth?: string }[] = []
  mock.clock(on, { now: 1_000_000 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, tokens: 110_000, percent: 11 }, rateLimits: [] } }))
  on('session.authorize', () => ({ value: { handle: 'h1', kind: 'bearer' } }))
  on('http.fetch', (_$, e) => {
    fetched.push({ url: e.url, auth: e.init?.auth })
    return { value: { ...response, ok: response.status === 200, headers: {} } }
  })
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as RenderElement)
  return fetched
}

const mount = ($: Engine, surface: RenderSurface) =>
  $.ui.mount({
    plugin: 'usage-meter',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10 } as never,
    viewport: { columns: 160, rows: 40 },
  })

test('the band shows each limit and the context', async ($, on) => {
  const fetched = engine(on, { status: 200, text: JSON.stringify(BODY) })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(fetched).toEqual([{ url: 'https://api.anthropic.com/api/oauth/usage', auth: 'h1' }])

  const ui = await mount($, 'desktop')
  for (const words of ['5-hour', '45%', 'Weekly', '28%', 'Fable weekly', '49%', 'Context', '11%']) {
    expect((await ui.find({ type: 'Text', text: words }))?.text).toBe(words)
  }
  expect((await ui.findAll({ type: 'Svg' })).length).toBe(4)
  // A full-width row of four meters, each centered in a quarter of it.
  const boxes = (await ui.findAll({ type: 'Box' })).filter(b => b.props.width !== undefined)
  expect(boxes.map(b => [b.props.width, b.props.justifyContent])).toEqual([['100%', undefined], ...Array(4).fill(['25%', 'center'])])
  await ui.unmount()

  const terminal = await mount($, 'terminal')
  expect((await terminal.find({ type: 'Text', text: '5-hour' }))?.text).toBe('5-hour')
  await terminal.unmount()
})

test('a refused fetch leaves the context alone in the band', async ($, on) => {
  engine(on, { status: 401, text: '' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await mount($, 'desktop')
  expect((await ui.find({ type: 'Text', text: 'Context' }))?.text).toBe('Context')
  expect(await ui.find({ type: 'Text', text: '5-hour' })).toBeUndefined()
  await ui.unmount()
})
