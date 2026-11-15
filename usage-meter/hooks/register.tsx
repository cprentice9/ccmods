import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { UsageMeter } from '../types'

// The endpoint Claude Code reads for /usage. The desktop gives its sessions a
// login that can only call the model, so there its own usage tool answers.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const USAGE_TOOL = 'mcp__ccd_session_mgmt__get_usage'
// Tries every minute until a reading arrives, then keeps it five minutes or
// until a limit moves, never asking twice in 30 seconds.
const POLL_MS = 60_000
const FRESH_MS = 5 * 60_000
const MIN_GAP_MS = 30_000
// The blue of the desktop app's own context meter.
const BLUE = '#2f7cf6'

const meters = atom({ plugin: 'usage-meter', key: 'meters' } as const, null)
const context = atom({ plugin: 'usage-meter', key: 'context' } as const, null)

type Limit = { kind: string; percent: number; scope?: { model?: { display_name?: string | null } | null } | null }

const label = (l: Limit) => {
  if (l.kind === 'session') return '5-hour'
  if (l.kind === 'weekly_all') return 'Weekly'
  const model = l.scope?.model?.display_name
  return l.kind === 'weekly_scoped' && model ? `${model} weekly` : null
}

// The desktop tool's labels: "5-hour limit", "Weekly · all models", "Weekly · Fable".
const toolLabel = (text: string) => {
  if (text.startsWith('5-hour')) return '5-hour'
  const model = /^Weekly · (.+)$/.exec(text)?.[1]
  return model === undefined ? null : model === 'all models' ? 'Weekly' : `${model} weekly`
}

// The app's meter: a gray rounded track with a blue fill inset by 2px that
// starts as a dot.
const pill = (percent: number) => {
  const fill = 6 + (Math.min(Math.max(percent, 0), 100) / 100) * 14
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="10" viewBox="0 0 24 10"><rect width="24" height="10" rx="5" fill="#8e8e93" fill-opacity="0.3"/><rect x="2" y="2" width="${fill}" height="6" rx="3" fill="${BLUE}"/></svg>`
}

async function readMeters($: EngineInterface): Promise<UsageMeter[]> {
  if ((await $.tool.list()).some(t => t.name === USAGE_TOOL)) {
    const r = await $.tool.call({ tool: USAGE_TOOL })
    const windows: { label: string; percentUsed: number }[] = (r.text ? JSON.parse(r.text).plan?.windows : undefined) ?? []
    return windows.flatMap(w => {
      const name = toolLabel(w.label)
      return name ? [{ label: name, percent: w.percentUsed }] : []
    })
  }
  // The engine sets the login header itself; the token never reaches the mod.
  const auth = await $.session.authorize()
  if (auth?.kind !== 'bearer') return []
  const r = await $.http.fetch(USAGE_URL, { auth: auth.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20' } })
  if (!r.ok) return []
  return ((JSON.parse(r.text).limits ?? []) as Limit[]).flatMap(l => {
    const name = label(l)
    return name ? [{ label: name, percent: l.percent }] : []
  })
}

let readAt = 0
let triedAt = 0
let timer: Timer | undefined

async function refresh($: EngineInterface, isForced = false) {
  const now = await $.clock.now()
  if (now - triedAt < MIN_GAP_MS || (!isForced && now - readAt < FRESH_MS)) return
  triedAt = now
  const next = await readMeters($)
  if (next.length === 0) return
  readAt = now
  await update($, meters, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const { context: c } = await $.session.usage()
    await update($, context, () => c.percent ?? null)
    await refresh($).catch(() => {})
    timer ??= $.clock.every(POLL_MS, () => {
      refresh($).catch(() => {})
    })
    return r
  })

  on('session.measure', async ($, e, next) => {
    const percent = e.context.percent
    if (percent !== undefined) await update($, context, () => percent)
    if (e.changed.includes('rateLimits')) await refresh($, true).catch(() => {})
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const limits = await read($, meters)
    const fill = await read($, context)
    if (e.props.hasSurvey || (limits === null && fill === null)) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const Svg = e.surface === 'desktop' ? $.ui.resolve(e).Svg : undefined
    const rows = [...(limits ?? []), ...(fill === null ? [] : [{ label: 'Context', percent: fill }])]
    // Each meter centered in an equal share of the row: a quarter with four.
    const share = `${100 / rows.length}%`
    const meter = (name: string, percent: number) => (
      <Box width={share} justifyContent="center" alignItems="center" gap="xs">
        <Text size="body">{name}</Text>
        <Text size="body" dimColor tabular>
          {Math.round(percent)}%
        </Text>
        {Svg && <Svg source={pill(percent)} width={24} height={10} alt={`${name} ${Math.round(percent)}% used`} />}
      </Box>
    )

    return (
      <Box width="100%" alignItems="center">
        {rows.map(m => meter(m.label, m.percent))}
      </Box>
    )
  })
}
