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
// /context's estimate is always 30,000 tokens. `rateLimits` stands for the
// windows the last response's headers reported.
const engine = (on: On, responses: { status: number; text: string }[], hasTool = false) => {
  const fetched: { url: string; auth?: string }[] = []
  const context: { window: number; tokens?: number; percent?: number } = { window: 1_000_000, tokens: 110_000, percent: 11 }
  const rateLimits: { kind: string; percentUsed: number }[] = []
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.compact', () => ({ messages: [SUMMARY] }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.usage', (_$, e) => {
    const breakdown = e?.breakdown ? { breakdown: { totalTokens: 30_000 } as never } : {}
    return { value: { startedAt: 0, context: { ...context, ...breakdown }, rateLimits } }
  })
  on('session.authorize', () => ({ value: { handle: 'h1', kind: 'bearer' } }))
  on('tool.list', () => ({ value: hasTool ? [{ name: USAGE_TOOL }] : [] }) as never)
  on('tool.call', { tool: USAGE_TOOL }, () => ({ result: PLAN, text: JSON.stringify(PLAN) }) as never)
  on('http.fetch', (_$, e) => {
    fetched.push({ url: e.url, auth: e.init?.auth })
    const response = responses[Math.min(fetched.length, responses.length) - 1]!
    return { value: { ...response, ok: response.status === 200, headers: {} } }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  // Each response reports `step.output` output tokens.
  const step = { output: 0 }
  on('turn.step', async function* (_$: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use', usage: { model: 'claude-fable-5-2', output_tokens: step.output } }
  } as never)
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as RenderElement)
  return { fetched, clock, context, rateLimits, step }
}

const respond = async ($: Engine, turnId: string, index: number, agentId?: string) => {
  const stream = $.turn.step({ turnId, index, model: 'claude-fable-5-2', messageCount: 1, agentId })
  while (!(await stream.next()).done);
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

test('each response inside a turn moves the meters before the turn ends', async ($, on) => {
  const { clock, context, rateLimits } = engine(on, [{ status: 200, text: JSON.stringify(BODY) }])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  context.percent = 12
  rateLimits.push({ kind: 'five_hour', percentUsed: 46.4 }, { kind: 'seven_day', percentUsed: 29 })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-fable-5-2', messageCount: 1 })
  while (!(await stream.next()).done);
  await new Promise(r => setTimeout(r, 0))

  // The headers' windows replace the fetched ones; the model's weekly stays.
  expect(await shows($, ['12%', '46%', '29%', '49%'])).toEqual(['12%', '46%', '29%', '49%'])

  // Once the session has been quiet, the next fetch wins over the old headers.
  await clock.advance(5 * 60_000)
  expect(await shows($, ['45%', '28%'])).toEqual(['45%', '28%'])
})

test('a turn that ends inside the 30-second gap is read once the gap ends', async ($, on) => {
  const later = { limits: [{ kind: 'session', percent: 47, scope: null }, ...BODY.limits.slice(1)] }
  const { fetched, clock, rateLimits } = engine(on, [{ status: 200, text: JSON.stringify(BODY) }, { status: 200, text: JSON.stringify(later) }])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // Headers that trail the card never pull a meter down.
  rateLimits.push({ kind: 'five_hour', percentUsed: 44 })
  await clock.advance(10_000)
  await $.session.measure({ context: { window: 1_000_000, tokens: 110_000, percent: 11 }, rateLimits, changed: ['cost'] })
  expect(fetched.length).toBe(1)
  expect(await shows($, ['45%'])).toEqual(['45%'])

  await clock.advance(20_000)
  expect(fetched.length).toBe(2)
  expect(await shows($, ['47%'])).toEqual(['47%'])
})

test('Turn counts the output tokens of the latest turn, subagents included', async ($, on) => {
  const { step } = engine(on, [{ status: 200, text: JSON.stringify(BODY) }])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const spinner = async (surface: RenderSurface = 'desktop') => {
    const ui = await $.ui.mount({
      plugin: 'usage-meter',
      surface,
      component: 'Spinner',
      props: { word: 'Working', message: null, suffix: '…', mode: 'responding' },
      viewport: { columns: 160, rows: 40 },
    })
    // The count the mod draws after the engine's row, and its arrow's color.
    const arrow = await ui.find({ type: 'Text', text: '↓' })
    const count = (await ui.findAll({ type: 'Text' })).find(t => t.text?.endsWith(' tokens'))?.text
    await ui.unmount()
    return [arrow?.props.color, count]
  }

  // Nothing generated yet: the row is the engine's.
  await $.turn.start({ text: 'hi', turnId: 't1' })
  expect(await spinner()).toEqual([undefined, undefined])

  step.output = 800
  await respond($, 't1', 0)
  expect(await spinner()).toEqual(['claude', '800 tokens'])

  step.output = 3_450
  await respond($, 't1', 1)
  await $.turn.start({ text: 'go', turnId: 's1', agentId: 'a1' })
  step.output = 1_000
  await respond($, 's1', 0, 'a1')
  expect(await spinner()).toEqual(['claude', '5.3k tokens'])

  // The terminal's spinner counts tokens itself, and the bar has no Turn cell.
  expect(await spinner('terminal')).toEqual([undefined, undefined])
  expect(await shows($, ['Turn'])).toEqual([undefined])

  // The next main turn starts over.
  await $.turn.start({ text: 'again', turnId: 't2' })
  expect(await spinner()).toEqual([undefined, undefined])
})
