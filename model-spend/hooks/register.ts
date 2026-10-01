import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ModelSpendFamily, ModelSpendTokens } from '../types'

const tokens = atom({ plugin: 'model-spend', key: 'tokens' } as const, {} as ModelSpendTokens)

const FAMILIES = ['Opus', 'Sonnet', 'Fable', 'Haiku'] as const

const familyOf = (model: string): ModelSpendFamily =>
  FAMILIES.find(name => model.toLowerCase().includes(name.toLowerCase())) ?? 'Other'

// 950 stays 950; 1,234 is 1.2k; 340,000 is 340k; 999,960 is 1M.
const compact = (n: number): string => {
  if (n < 1000) {
    return String(n)
  }

  for (const [size, unit] of [[1e3, 'k'], [1e6, 'M'], [1e9, 'B']] as const) {
    const v = n / size
    const shown = v < 9.95 ? Math.round(v * 10) / 10 : Math.round(v)

    if (shown < 1000 || unit === 'B') {
      return `${shown}${unit}`
    }
  }

  return String(n)
}

const share = (part: number, all: number, isAlone: boolean): string => {
  const percent = (part / all) * 100

  if (percent < 1) {
    return '<1%'
  }

  return percent > 99 && !isAlone ? '>99%' : `${Math.round(percent)}%`
}

const draw = async ($: EngineInterface) => {
  const counts = Object.entries(await read($, tokens)).filter(([, n]) => n > 0).sort(([, a], [, b]) => b - a)
  const all = counts.reduce((sum, [, n]) => sum + n, 0)

  if (all === 0) {
    $.ui.status(undefined)
    return
  }

  const parts = counts.map(([name, n]) => `${name} ${compact(n)} ${share(n, all, counts.length === 1)}`)
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

  // /clear starts the cost over, so the token totals start over with it.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, tokens, () => ({}))
      $.ui.status(undefined)
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)

    if (r.usage !== null) {
      const u = r.usage
      const spent = u.input_tokens + u.output_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens
      const family = familyOf(u.model)
      await update($, tokens, t => ({ ...t, [family]: (t[family] ?? 0) + spent }))
      await draw($)
    }

    return r
  })
}
