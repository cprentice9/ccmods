import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement, RenderSurface } from 'claude-code'

const USAGE_TOOL = 'mcp__ccd_session_mgmt__get_usage'

// The parts of the usage endpoint's answer the mod reads.
const BODY = {
  limits: [
    { kind: 'session', percent: 45, scope: null },
    { kind: 'weekly_all', percent: 28, scope: null },
    { kind: 'weekly_scoped', percent: 49, scope: { model: { id: null, display_name: 'Fable' }, surface: null } },
  ],
}

// The parts of the desktop usage tool's answer the mod reads.
const PLAN = {
  plan: {
    status: 'ok',
    windows: [
      { label: '5-hour limit', percentUsed: 57, resetsAt: '2026-11-15T03:30:00Z' },
      { label: 'Weekly · all models', percentUsed: 29, resetsAt: '2026-11-18T18:00:00Z' },
      { label: 'Weekly · Fable', percentUsed: 50, resetsAt: '2026-11-18T18:00:00Z' },
    ],
  },
}

// What the engine's compaction leaves.
const SUMMARY = { role: 'user' as const, text: 'Summary of the conversation so far.', toolUses: [] }

// Stands in for the engine beneath the plugin: each fetch answers with the
// next response, the last one repeating, and the desktop tool is listed only
// when `hasTool` says so. A test changes `context` to move the engine's figure;
// /context's estimate is always 30,000 tokens.
const engine = (on: On, responses: { status: number; text: string }[], hasTool = false) => {
  const fetched: { url: string; auth?: string }[] = []
  const context: { window: number; tokens?: number; percent?: number } = { window: 1_000_000, tokens: 110_000, percent: 11 }
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.compact', () => ({ messages: [SUMMARY] }))
  on('session.usage', (_$, e) => {
    const breakdown = e?.breakdown ? { breakdown: { totalTokens: 30_000 } as never } : {}
    return { value: { startedAt: 0, context: { ...context, ...breakdown }, rateLimits: [] } }
  })
  on('session.authorize', () => ({ value: { handle: 'h1', kind: 'bearer' } }))
  on('tool.list', () => ({ value: hasTool ? [{ name: USAGE_TOOL }] : [] }) as never)
  on('tool.call', { tool: USAGE_TOOL }, () => ({ result: PLAN, text: JSON.stringify(PLAN) }) as never)
  on('http.fetch', (_$, e) => {
    fetched.push({ url: e.url, auth: e.init?.auth })
    const response = responses[Math.min(fetched.length, responses.length) - 1]!
    return { value: { ...response, ok: response.status === 200, headers: {} } }
  })
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as RenderElement)
  return { fetched, clock, context }
}

const mount = ($: Engine, surface: RenderSurface) =>
  $.ui.mount({
    plugin: 'usage-meter',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10 } as never,
    viewport: { columns: 160, rows: 40 },
  })

const shows = async ($: Engine, words: string[]) => {
  const ui = await mount($, 'desktop')
  const found = await Promise.all(words.map(async w => (await ui.find({ type: 'Text', text: w }))?.text))
  await ui.unmount()
  return found
}

test('the band shows each limit and the context', async ($, on) => {
  const { fetched } = engine(on, [{ status: 200, text: JSON.stringify(BODY) }])
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

test('a desktop session reads the limits from the desktop usage tool', async ($, on) => {
  const { fetched } = engine(on, [{ status: 403, text: '' }], true)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(fetched).toEqual([])
  expect(await shows($, ['5-hour', '57%', 'Weekly', '29%', 'Fable weekly', '50%'])).toEqual(['5-hour', '57%', 'Weekly', '29%', 'Fable weekly', '50%'])
})

test('a refused first fetch is tried again a minute later', async ($, on) => {
  const { fetched, clock } = engine(on, [{ status: 401, text: '' }, { status: 200, text: JSON.stringify(BODY) }])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(await shows($, ['Context', '5-hour'])).toEqual(['Context', undefined])

  await clock.advance(60_000)
  expect(fetched.length).toBe(2)
  expect(await shows($, ['5-hour', '45%'])).toEqual(['5-hour', '45%'])
})

test('a compaction shows the new size before the next reply', async ($, on) => {
  const { clock, context } = engine(on, [{ status: 200, text: JSON.stringify(BODY) }])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] })

  // Until the compacted transcript lands, the engine still has the old figure.
  await clock.advance(250)
  expect(await shows($, ['11%'])).toEqual(['11%'])

  // Then it has none until the next reply, so the meter shows the estimate.
  delete context.tokens
  delete context.percent
  await clock.advance(250)
  expect(await shows($, ['Context', '3%'])).toEqual(['Context', '3%'])
})
