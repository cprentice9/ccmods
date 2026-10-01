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

// What a tool call was given: its main argument in full, or the whole input.
const describeInput = (input: unknown) => {
  const i = (input ?? {}) as Record<string, unknown>
  const what = [i.command, i.file_path, i.pattern, i.url, i.query, i.prompt, i.message, i.description].find(v => typeof v === 'string')
  return typeof what === 'string' ? what : JSON.stringify(i).slice(0, 2000)
}

type Block = { type: string; [field: string]: unknown }
type Call = { key: string; kind: 'call'; tool: string; what: string; result?: string; isError?: boolean }
type Entry = { key: string; kind: 'sent' | 'thinking' | 'words'; text: string } | Call

const RESULT_LINES = 6

const blockText = (content: unknown) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map(b => ((b as Block).type === 'text' ? String((b as Block).text) : '')).join('\n')
      : ''

// The subagent's conversation in order: what it was sent, its thinking and
// words, and each tool call with its result. System reminders are left out.
export const activity = (messages: { role: string; content: Block[] }[]) => {
  const entries: Entry[] = []
  const calls = new Map<string, Call>()
  messages.forEach((m, i) =>
    m.content.forEach((b, j) => {
      const key = `${i}-${j}`
      const text = typeof b.text === 'string' ? b.text.trim() : ''
      if (b.type === 'text' && text && !text.startsWith('<system-reminder>')) {
        entries.push({ key, kind: m.role === 'user' ? 'sent' : 'words', text })
      } else if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim()) {
        entries.push({ key, kind: 'thinking', text: b.thinking.trim() })
      } else if (b.type === 'tool_use') {
        const call: Call = { key, kind: 'call', tool: String(b.name), what: describeInput(b.input) }
        calls.set(String(b.id), call)
        entries.push(call)
      } else if (b.type === 'tool_result') {
        const call = calls.get(String(b.tool_use_id))
        if (call) {
          call.result = blockText(b.content).trim()
          if (b.is_error === true) call.isError = true
        }
      }
    }),
  )
  return entries
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
    const ran = yield* next(e)
    // Each finished response redraws the detail view with its thinking and words.
    if (agentId && (await read($, agents)).rows.some(row => row.agentId === agentId)) {
      await update($, agents, setFacts(agentId, f => ({ ...f, steps: (f.steps ?? 0) + 1 })))
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const { agentId } = e
    if (agentId) {
      const status = e.reason === 'answer' ? 'done' : 'failed'
      await update($, agents, setFacts(agentId, f => ({ ...f, status, durationMs: e.durationMs })))
    }
    return next(e)
  })

  // Counting a subagent's finished tool calls redraws its detail view.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const { agentId } = e
    if (agentId && (await read($, agents)).rows.some(row => row.agentId === agentId)) {
      await update($, agents, setFacts(agentId, f => ({ ...f, tools: (f.tools ?? 0) + 1 })))
    }
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const s = await read($, agents)
    const select = (id: string | undefined) => update($, agents, (t = EMPTY) => ({ ...t, selected: id }))

    // Status, type, model and effort on one line, elapsed time on the right.
    const header = (row: SubagentPaneRow) => {
      const facts = (row.agentId && s.facts[row.agentId]) || {}
      const status = facts.status ?? 'running'
      const color = status === 'done' ? 'green' : status === 'failed' ? 'red' : 'yellow'
      return (
        <Box flexDirection="row" justifyContent="space-between">
          <Text wrap="truncate">
            <Text color={color}>{status}</Text> <Text bold>{row.type}</Text>{' '}
            {row.model ? shortModel(row.model) : '...'} <Text dimColor={!facts.effort}>{facts.effort ?? 'effort ?'}</Text>
          </Text>
          {facts.durationMs !== undefined && <Text dimColor>{elapsed(facts.durationMs)}</Text>}
        </Box>
      )
    }

    const chosen = s.rows.find(row => row.id === s.selected)
    if (chosen) {
      // Everything the subagent was sent, thought, said and ran, newest last.
      // The pane body scrolls, so nothing is cut to fit.
      const conversation = chosen.agentId ? await $.session.messages({ agentId: chosen.agentId, as: 'api' }) : []
      const entries = Array.isArray(conversation) ? activity(conversation as { role: string; content: Block[] }[]) : []
      const tools = (chosen.agentId && s.facts[chosen.agentId]?.tools) || 0

      const draw = (entry: Entry) => {
        if (entry.kind === 'sent') {
          return (
            <Box key={entry.key} flexDirection="column" marginTop={1} borderStyle="single" borderColor="cyan" paddingX={1}>
              <Markdown text={entry.text.slice(0, 10_000)} />
            </Box>
          )
        }
        if (entry.kind !== 'call') {
          return (
            <Box key={entry.key} marginTop={1}>
              <Markdown text={entry.text.slice(0, 10_000)} dimColor={entry.kind === 'thinking'} />
            </Box>
          )
        }
        const lines = entry.result?.split('\n') ?? []
        const hidden = lines.length - RESULT_LINES
        return (
          <Box key={entry.key} flexDirection="column" marginTop={1}>
            <Text wrap="wrap"><Text bold>{entry.tool}</Text> {entry.what}</Text>
            {entry.result !== undefined && (
              <Box flexDirection="column" paddingLeft={2}>
                <Text wrap="wrap" color={entry.isError ? 'red' : undefined} dimColor={!entry.isError}>
                  {entry.result ? lines.slice(0, RESULT_LINES).join('\n') : 'No output.'}
                </Text>
                {hidden > 0 && <Text dimColor>{hidden} more {hidden === 1 ? 'line' : 'lines'}</Text>}
              </Box>
            )}
          </Box>
        )
      }

      return (
        <Box flexDirection="column" width={e.props.bodyColumns}>
          <Button key="back" plain dimColor onPress={() => select(undefined)}>Back to all subagents</Button>
          <Box flexDirection="column" marginTop={1}>
            {header(chosen)}
            <Text wrap="truncate">{chosen.description}</Text>
            <Text dimColor>{tools} {tools === 1 ? 'tool call' : 'tool calls'}</Text>
          </Box>
          {!Array.isArray(conversation) && <Box marginTop={1}><Text color="red" wrap="wrap">{conversation.deny}</Text></Box>}
          {Array.isArray(conversation) && entries.length === 0 && <Box marginTop={1}><Text dimColor>No activity yet.</Text></Box>}
          {entries.map(draw)}
        </Box>
      )
    }

    const running = s.rows.filter(row => isRunning(s, row)).length
    const room = Math.max(1, Math.floor(((e.viewport?.rows ?? 24) - 4) / 2))

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {s.rows.length === 0 ? (
          <Text dimColor>No subagents started in this session yet.</Text>
        ) : (
          <Text dimColor>{running} running, {s.rows.length} total. Select one to see its activity.</Text>
        )}
        {s.rows.slice(-room).map(row => (
          <Box key={`row-${row.id}`} flexDirection="column" marginTop={1}>
            {header(row)}
            <Button key={`open-${row.id}`} plain dimColor onPress={() => select(row.id)}>{row.description}</Button>
          </Box>
        ))}
      </Box>
    )
  })
}
