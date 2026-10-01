import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { ModelSpendFamily, ModelSpendUsd } from '../types'

const spend = atom({ plugin: 'model-spend', key: 'spend' } as const, {} as ModelSpendUsd)

const FAMILIES = ['Opus', 'Sonnet', 'Fable', 'Haiku'] as const

const familyOf = (model: string): ModelSpendFamily =>
  FAMILIES.find(name => model.toLowerCase().includes(name.toLowerCase())) ?? 'Other'

// List prices in dollars per million tokens: input, output, cache read. A model
// it does not know is priced as Opus. Cache writes are priced at the one-hour
// rate, twice the input price, since Claude Code caches for an hour.
const PRICES: Record<ModelSpendFamily, [input: number, output: number, cacheRead: number]> = {
  Opus: [4, 20, 0.2],
  Sonnet: [2, 10, 0.2],
  Fable: [10, 50, 0.25],
  Haiku: [1, 5, 0.1],
  Other: [4, 20, 0.2],
}

const priceOf = (family: ModelSpendFamily, u: ModelUsage): number => {
  const [input, output, cacheRead] = PRICES[family]

  return (
    u.input_tokens * input +
    u.output_tokens * output +
    u.cache_creation_input_tokens * input * 2 +
    u.cache_read_input_tokens * cacheRead
  ) / 1e6
}

const share = (part: number, all: number, isAlone: boolean): string => {
  const percent = (part / all) * 100

  if (percent < 1) {
    return '<1%'
  }

  return percent > 99 && !isAlone ? '>99%' : `${Math.round(percent)}%`
}

const draw = async ($: EngineInterface) => {
  const counts = Object.entries(await read($, spend)).filter(([, n]) => n > 0).sort(([, a], [, b]) => b - a)
  const all = counts.reduce((sum, [, n]) => sum + n, 0)

  if (all === 0) {
    $.ui.status(undefined)
    return
  }

  const parts = counts.map(([name, n]) => `${name} ${share(n, all, counts.length === 1)}`)
  const usd = (await $.session.usage()).cost?.usd

  if (usd !== undefined) {
    parts.push(`$${usd.toFixed(2)}`)
  }

  $.ui.status(parts.join(' · '))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await draw($)

    return r
  })

  // /clear starts the cost over, so the shares start over with it.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, spend, () => ({}))
      $.ui.status(undefined)
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)

    if (r.usage !== null) {
      const family = familyOf(r.usage.model)
      const usd = priceOf(family, r.usage)
      await update($, spend, t => ({ ...t, [family]: (t[family] ?? 0) + usd }))
      await draw($)
    }

    return r
  })
}
