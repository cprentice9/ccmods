import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOTE = /failed twice in a row\. Stop fixing and ask for a second opinion/

// Stands in for Bash beneath the plugin: commands listed in `failing` exit
// nonzero, everything else passes. Collects the toasts the plugin shows.
const setup = (on: On, failing: Set<string>) => {
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
  })
  on('tool.call', { tool: 'Bash' }, (_$, e) =>
    failing.has(e.command)
      ? { isError: true, result: 'Exit code 1', text: `Exit code 1\nFAILED ${e.command}` }
      : { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' },
  )
  return toasts
}

const bash = ($: Engine, command: string, agentId?: string) =>
  $.tool.call({ tool: 'Bash', command, ...(agentId ? { agentId } : {}) })

describe('stuck-detector', () => {
  test('one failure does nothing', async ($, on) => {
    const toasts = setup(on, new Set(['pytest -q']))
    const ran = await bash($, 'pytest -q')
    expect(ran.isError).toBe(true)
    expect(ran.context).toBeUndefined()
    expect(toasts).toEqual([])
  })

  test('two failures in a row toast and add the note', async ($, on) => {
    const toasts = setup(on, new Set(['npm test', 'npm  test']))
    await bash($, 'npm test')
    const ran = await bash($, 'npm  test')
    expect(ran.isError).toBe(true)
    expect(ran.text).toBe('Exit code 1\nFAILED npm  test')
    expect(ran.context?.join('\n')).toMatch(NOTE)
    expect(toasts).toEqual(['Failed twice in a row: npm test'])
  })

  test('the note comes from the userConfig option', { options: { note: 'Ask for help.' } }, async ($, on) => {
    setup(on, new Set(['cargo test']))
    await bash($, 'cargo test')
    const ran = await bash($, 'cargo test')
    expect(ran.context).toEqual(['Ask for help.'])
  })

  test('a pass between failures resets the count', async ($, on) => {
    const failing = new Set(['go test ./...'])
    const toasts = setup(on, failing)
    await bash($, 'go test ./...')
    failing.clear()
    await bash($, 'go test ./...')
    failing.add('go test ./...')
    const ran = await bash($, 'go test ./...')
    expect(ran.context).toBeUndefined()
    expect(toasts).toEqual([])
  })

  test('a third failure does not repeat the note', async ($, on) => {
    const toasts = setup(on, new Set(['cd app && uv run pytest']))
    await bash($, 'cd app && uv run pytest')
    await bash($, 'cd app && uv run pytest')
    const ran = await bash($, 'cd app && uv run pytest')
    expect(ran.context).toBeUndefined()
    expect(toasts.length).toBe(1)
  })

  test('different commands count separately', async ($, on) => {
    const toasts = setup(on, new Set(['pytest a.py', 'pytest b.py']))
    await bash($, 'pytest a.py')
    const ran = await bash($, 'pytest b.py')
    expect(ran.context).toBeUndefined()
    expect(toasts).toEqual([])
  })

  test('different agents count separately', async ($, on) => {
    const toasts = setup(on, new Set(['make test']))
    await bash($, 'make test')
    await bash($, 'make test', 'agent-1')
    expect(toasts).toEqual([])
    const ran = await bash($, 'make test', 'agent-1')
    expect(ran.context?.join('\n')).toMatch(NOTE)
    expect(toasts.length).toBe(1)
  })

  test('non-test commands are ignored', async ($, on) => {
    const toasts = setup(on, new Set(['ls missing', 'grep pytest notes.txt']))
    for (const command of ['ls missing', 'ls missing', 'grep pytest notes.txt', 'grep pytest notes.txt']) {
      const ran = await bash($, command)
      expect(ran.context).toBeUndefined()
    }
    expect(toasts).toEqual([])
  })
})
