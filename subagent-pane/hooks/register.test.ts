import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { shortModel } from './register.tsx'

const SURFACES = ['terminal', 'desktop'] as const

// Stands in for the engine beneath the plugin: each spawn starts agent a1, a2, ...
const engine = (on: On) => {
  const opened: string[] = []
  let count = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `a${++count}` }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.open', (_$, e) => (opened.push(e.id), { value: { isPlaced: true } }))
  return opened
}

const spawn = ($: Engine, subagentType: string, model?: string) =>
  $.agent.spawn({ prompt: 'Do the work.', description: `${subagentType} task`, subagentType, model })

const step = async ($: Engine, agentId: string, effort: 'low' | 'medium' | 'high') => {
  for await (const _ of $.turn.step({ turnId: `t-${agentId}`, index: 0, model: 'claude-opus-5-5', effort, messageCount: 1, agentId })) {
    // Drain the stream so the step completes.
  }
}

const complete = ($: Engine, agentId: string, reason: 'answer' | 'error') =>
  $.turn.complete({ answer: 'ok', durationMs: 75_000, isAborted: false, turnId: `t-${agentId}`, agentId, reason })

const mount = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({
    plugin: 'subagent-pane',
    surface,
    component: 'Pane',
    requestId: 'subagents',
    props: { title: 'Subagents', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
    viewport: { columns: 120, rows: 40 },
  })

test('a spawn adds a row with the resolved model, and effort and status fill in', async ($, on) => {
  const opened = engine(on)
  const { agentId } = await spawn($, 'helper', 'sonnet')
  expect(agentId).toBe('a1')
  expect(opened).toEqual(['subagents'])

  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: /running helper Opus 5\.5 effort \?/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'helper task' })).toBeDefined()
    await ui.unmount()
  }

  await step($, 'a1', 'medium')
  await step($, 'a1', 'high')
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: /running helper Opus 5\.5 medium/ })).toBeDefined()
    await ui.unmount()
  }

  await complete($, 'a1', 'answer')
  const b = await spawn($, 'coder')
  await complete($, b.agentId!, 'error')
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: /^done helper/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1m 15s' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^failed coder/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '0 running, 2 total' })).toBeDefined()
    await ui.unmount()
  }
  expect(opened).toEqual(['subagents'])
})

test('/subagents opens the pane', async ($, on) => {
  const opened = engine(on)
  const ran = await $.command.run({ command: 'subagents', args: '' } as never)
  expect(ran).toMatchObject({ text: 'Subagents pane opened.' })
  expect(opened).toEqual(['subagents'])
})

test('Haiku is refused by alias and by id', async ($, on) => {
  engine(on)
  expect((await spawn($, 'helper', 'haiku')).deny).toMatch(/Haiku is not allowed/)
  expect((await spawn($, 'helper', 'claude-HAIKU-4-5-20251001')).deny).toMatch(/Haiku is not allowed/)
  expect((await spawn($, 'helper', 'sonnet')).deny).toBeUndefined()
})

test('a sixth running coder is refused, and one is allowed after a coder finishes', async ($, on) => {
  engine(on)
  for (let i = 1; i <= 5; i++) expect((await spawn($, 'coder')).agentId).toBe(`a${i}`)
  expect((await spawn($, 'helper')).deny).toBeUndefined()
  expect((await spawn($, 'coder')).deny).toMatch(/5 coder subagents are already running/)

  await complete($, 'a3', 'answer')
  expect((await spawn($, 'coder')).deny).toBeUndefined()
  expect((await spawn($, 'coder')).deny).toMatch(/already running/)
})

test('model ids read as short names', () => {
  expect(shortModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(shortModel('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5')
  expect(shortModel('claude-fable-5-1')).toBe('Fable 5.1')
  expect(shortModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(shortModel('us.anthropic.claude-opus-4-1-20250805-v1:0')).toBe('Opus 4.1')
})
