import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnUsage } from 'claude-code'

type Usage = Partial<TurnUsage> & { model: string }

// Hooks beneath the plugin that stand for the engine: they record each
// status line and answer the session's cost.
const world = (on: On, usd?: number) => {
  const lines: (string | undefined)[] = []

  on('ui.status', ($, e) => {
    lines.push(e.text)

    return { value: undefined }
  })
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [], cost: usd === undefined ? undefined : { usd } },
  }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: pending.shift() ?? null }
  })

  const pending: (TurnUsage | null)[] = []

  return { lines, pending }
}

const usage = (u: Usage): TurnUsage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  ...u,
})

const step = async ($: Engine, pending: (TurnUsage | null)[], u: TurnUsage | null, agentId?: string) => {
  pending.push(u)
  const stream = $.turn.step({ turnId: 't1', index: 0, model: u?.model ?? 'claude-opus-5-5', messageCount: 1, agentId })

  let item = await stream.next()

  while (item.done !== true) {
    item = await stream.next()
  }

  return item.value
}

describe('model-spend', () => {
  test('maps real model ids to their families', async ($, on) => {
    const { lines, pending } = world(on)
    await step($, pending, usage({ model: 'claude-opus-5-5', output_tokens: 5000 }))
    await step($, pending, usage({ model: 'claude-sonnet-5-5', output_tokens: 3000 }))
    await step($, pending, usage({ model: 'claude-fable-5-1', output_tokens: 1000 }))
    await step($, pending, usage({ model: 'claude-haiku-4-5-20251001', output_tokens: 600 }))
    await step($, pending, usage({ model: 'some-other-model', output_tokens: 400 }))

    expect(lines.at(-1)).toBe('Opus 5k 50% · Sonnet 3k 30% · Fable 1k 10% · Haiku 600 6% · Other 400 4%')
  })

  test('sums input, output and both cache fields', async ($, on) => {
    const { lines, pending } = world(on)
    await step($, pending, usage({
      model: 'claude-opus-5-5',
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 300,
      cache_read_input_tokens: 400,
    }))

    expect(lines.at(-1)).toBe('Opus 1k 100%')
  })

  test('counts subagent steps with the main loop', async ($, on) => {
    const { lines, pending } = world(on)
    await step($, pending, usage({ model: 'claude-opus-5-5', output_tokens: 700 }))
    await step($, pending, usage({ model: 'claude-sonnet-5-5', output_tokens: 200 }), 'agent-1')
    await step($, pending, usage({ model: 'claude-opus-5-5', output_tokens: 100 }), 'agent-2')

    expect(lines.at(-1)).toBe('Opus 800 80% · Sonnet 200 20%')
  })

  test('orders by size, uses compact counts and shows small shares as <1%', async ($, on) => {
    const { lines, pending } = world(on)
    await step($, pending, usage({ model: 'claude-fable-5-1', cache_read_input_tokens: 9_960 }))
    await step($, pending, usage({ model: 'claude-opus-5-5', cache_read_input_tokens: 1_234_567 }))
    await step($, pending, usage({ model: 'claude-sonnet-5-5', cache_read_input_tokens: 340_000 }))

    expect(lines.at(-1)).toBe('Opus 1.2M 78% · Sonnet 340k 21% · Fable 10k <1%')
  })

  test('shows >99% beside a share under 1%', async ($, on) => {
    const { lines, pending } = world(on)
    await step($, pending, usage({ model: 'claude-opus-5-5', output_tokens: 999_960 }))
    await step($, pending, usage({ model: 'claude-haiku-4-5', output_tokens: 40 }))

    expect(lines.at(-1)).toBe('Opus 1M >99% · Haiku 40 <1%')
  })

  test('adds the session cost when the host has one', async ($, on) => {
    const { lines, pending } = world(on, 4.123)
    await step($, pending, usage({ model: 'claude-opus-5-5', output_tokens: 1500 }))

    expect(lines.at(-1)).toBe('Opus 1.5k 100% · $4.12')
  })

  // A plugin above model-spend that logs how its turn.step hook settled.
  const observer = {
    name: 'observer',
    tier: 'prepend' as const,
    register: (on: On) => {
      on('turn.step', async function* ($, e, next) {
        const r = yield* next(e)

        for (const t of next.trace.filter(t => t.plugin === 'model-spend')) {
          $.ui.log(t.outcome)
        }

        return r
      })
    },
  }

  test('ignores a step with null usage', { plugins: [observer] }, async ($, on) => {
    const { lines, pending } = world(on, 1)
    const outcomes: string[] = []
    on('ui.log', ($, e) => {
      outcomes.push(e.text)

      return { value: undefined }
    })
    const r = await step($, pending, null)

    expect(r.usage).toBe(null)
    expect(lines).toEqual([])
    expect(outcomes).toEqual(['returned'])
  })

  test('redraws the kept totals on session start', async ($, on) => {
    const { lines, pending } = world(on, 0.5)
    await step($, pending, usage({ model: 'claude-sonnet-5-5', output_tokens: 2000 }))
    lines.length = 0
    await $.session.start({ cwd: '/tmp', surface: null, isInteractive: false })

    expect(lines).toEqual(['Sonnet 2k 100% · $0.50'])
  })

  test('clears the line on session start before any tokens', async ($, on) => {
    const { lines } = world(on, 0)
    await $.session.start({ cwd: '/tmp', surface: null, isInteractive: false })

    expect(lines).toEqual([undefined])
  })
})
