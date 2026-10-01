import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { SubagentPaneFacts, SubagentPaneRow, SubagentPaneState } from '../types'

const PANE = 'subagents'
const TITLE = 'Subagents'
const MAX_CODERS = 5
const EMPTY: SubagentPaneState = { rows: [], facts: {} }
const agents = atom({ plugin: 'subagent-pane', key: 'agents' } as const, EMPTY)

const isRunning = (s: SubagentPaneState, row: SubagentPaneRow) =>
  !row.agentId || !s.facts[row.agentId]?.status

// "claude-opus-5-5[1m]" -> "Opus 5.5"; an id it cannot read is shown as given.
export const shortModel = (id: string) => {
  const words = (id.toLowerCase().split('claude-').pop() ?? id).replace(/\[.*\]/, '').split('-')
  const family = words.find(w => /^[a-z]+$/.test(w))
  const version = words.filter(w => /^\d{1,2}$/.test(w)).slice(0, 2).join('.')
  if (!family) return id
  return `${family[0].toUpperCase()}${family.slice(1)}${version ? ` ${version}` : ''}`
}

const elapsed = (ms: number) => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

const setFacts = (agentId: string, change: (f: SubagentPaneFacts) => SubagentPaneFacts) =>
  (s: SubagentPaneState = EMPTY) => ({
    ...s,
    facts: { ...s.facts, [agentId]: change(s.facts[agentId] ?? {}) },
  })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'subagents', description: 'Show the subagents of this session in a pane' })
    return next(e)
  })

  on('command.run', { command: 'subagents' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Subagents pane opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    if (/haiku/i.test(e.model ?? '')) {
      return { deny: `${$.plugin.name}: Haiku is not allowed for subagents here. Spawn it again with sonnet or opus.` }
    }

    // A plugin's own spawn may carry no tool_use_id, so each row gets its own id.
    const id = crypto.randomUUID()
    let isFull = false
    let isFirst = false
    await update($, agents, (s = EMPTY) => {
      const coders = s.rows.filter(row => row.type === 'coder' && isRunning(s, row)).length
      isFull = e.subagentType === 'coder' && coders >= MAX_CODERS
      isFirst = s.rows.length === 0
      if (isFull) return s
      return { ...s, rows: [...s.rows, { id, type: e.subagentType, description: e.description }] }
    })
    if (isFull) {
      return { deny: `${$.plugin.name}: ${MAX_CODERS} coder subagents are already running. Wait for one to finish, then spawn this one.` }
    }
    if (isFirst) void $.ui.open({ id: PANE, title: TITLE })

    const drop = () => update($, agents, (s = EMPTY) => ({ ...s, rows: s.rows.filter(row => row.id !== id) }))
    try {
      const ran = await next(e)
      if (ran.deny !== undefined || !ran.agentId) {
        await drop()
        return ran
      }
      await update($, agents, (s = EMPTY) => ({
        ...s,
        rows: s.rows.map(row => (row.id === id ? { ...row, agentId: ran.agentId, model: ran.model } : row)),
      }))
      return ran
    } catch (error) {
      await drop()
      throw error
    }
  })

  // The first request of a subagent's loop carries the effort it runs at.
  on('turn.step', async function* ($, e, next) {
    const { agentId, effort } = e
    if (agentId && (await read($, agents)).facts[agentId]?.effort === undefined) {
      await update($, agents, setFacts(agentId, f => ({ ...f, effort: f.effort ?? (effort === undefined ? 'none' : String(effort)) })))
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const { agentId } = e
    if (agentId) {
      const status = e.reason === 'answer' ? 'done' : 'failed'
      await update($, agents, setFacts(agentId, f => ({ ...f, status, durationMs: e.durationMs })))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, agents)
    const running = s.rows.filter(row => isRunning(s, row)).length
    const room = Math.max(1, Math.floor(((e.viewport?.rows ?? 24) - 4) / 2))

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {s.rows.length === 0 ? (
          <Text dimColor>No subagents started in this session yet.</Text>
        ) : (
          <Text dimColor>{running} running, {s.rows.length} total</Text>
        )}
        {s.rows.slice(-room).map(row => {
          const facts = (row.agentId && s.facts[row.agentId]) || {}
          const status = facts.status ?? 'running'
          const color = status === 'done' ? 'green' : status === 'failed' ? 'red' : 'yellow'
          return (
            <Box key={`row-${row.id}`} flexDirection="column" marginTop={1}>
              <Box flexDirection="row" justifyContent="space-between">
                <Text wrap="truncate">
                  <Text color={color}>{status}</Text> <Text bold>{row.type}</Text>{' '}
                  {row.model ? shortModel(row.model) : '...'} <Text dimColor={!facts.effort}>{facts.effort ?? 'effort ?'}</Text>
                </Text>
                {facts.durationMs !== undefined && <Text dimColor>{elapsed(facts.durationMs)}</Text>}
              </Box>
              <Text dimColor wrap="truncate">{row.description}</Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
