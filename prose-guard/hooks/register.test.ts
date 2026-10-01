import { describe, expect, test } from 'claude-code/testing'

const DASH = String.fromCharCode(0x2014)
const OK = { result: 'ok' } as any

// Answers every tool call beneath the plugin and gives the file a fixed body.
function engine(on: any, fileText: string | null = null) {
  on('tool.call', () => OK)
  on('fs.read', () => {
    if (fileText === null) throw new Error('missing')
    return { value: fileText }
  })
}

const call = ($: any, input: Record<string, unknown>) => $.tool.call(input)

// A model beneath the plugin streams `pieces` as one text block; returns the
// text the plugin passes on.
async function streamReply($: any, on: any, pieces: string[]) {
  on('turn.step', async function* (_$: any, e: any) {
    for (const text of pieces) yield { kind: 'text', index: 0, text }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  let text = ''
  for (let item = await stream.next(); !item.done; item = await stream.next()) {
    if (item.value.kind === 'text') text += item.value.text
  }
  return text
}

describe('em dashes in tool calls', () => {
  test('Write denies a new dash and passes when the count does not rise', async ($, on) => {
    engine(on, `a ${DASH} b`)
    expect((await call($, { tool: 'Write', file_path: 'x.ts', content: `a ${DASH} b ${DASH} c` })).deny).toContain('em dash')
    expect((await call($, { tool: 'Write', file_path: 'x.ts', content: `z ${DASH} y` })).deny).toBeUndefined()
  })

  test('Write to a new file counts every dash', async ($, on) => {
    engine(on)
    expect((await call($, { tool: 'Write', file_path: 'new.ts', content: `a ${DASH} b` })).deny).toContain('em dash')
  })

  test('Edit compares new_string against old_string', async ($, on) => {
    engine(on)
    expect((await call($, { tool: 'Edit', file_path: 'x.ts', old_string: 'a', new_string: DASH })).deny).toContain('em dash')
    expect((await call($, { tool: 'Edit', file_path: 'x.ts', old_string: DASH, new_string: `b ${DASH}` })).deny).toBeUndefined()
  })

  test('MultiEdit sums every edit', async ($, on) => {
    engine(on)
    const edits = [{ old_string: DASH, new_string: 'a' }, { old_string: 'b', new_string: DASH }]
    expect((await call($, { tool: 'MultiEdit', file_path: 'x.ts', edits })).deny).toBeUndefined()
    edits.push({ old_string: 'c', new_string: DASH })
    expect((await call($, { tool: 'MultiEdit', file_path: 'x.ts', edits })).deny).toContain('em dash')
  })

  test('NotebookEdit counts new_source', async ($, on) => {
    engine(on)
    expect((await call($, { tool: 'NotebookEdit', notebook_path: 'n.ipynb', new_source: DASH })).deny).toContain('em dash')
    expect((await call($, { tool: 'NotebookEdit', notebook_path: 'n.ipynb', new_source: 'x' })).deny).toBeUndefined()
  })

  test('Bash counts the command and the message gives the escape hint', async ($, on) => {
    engine(on)
    const denied = await call($, { tool: 'Bash', command: `echo ${DASH}` })
    expect(denied.deny).toContain("$'\\xe2\\x80\\x94'")
    expect((await call($, { tool: 'Bash', command: 'echo -' })).deny).toBeUndefined()
  })
})

describe('em dashes in the reply', () => {
  const stopBottom = (on: any, messages: unknown[] = []) => {
    on('classic.Stop', () => ({}))
    on('session.messages', () => ({ value: messages }))
  }

  test('blocks once and not on the rewrite', async ($, on) => {
    stopBottom(on)
    const first = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: `a ${DASH} b` })
    expect(first.block).toContain('em dash')
    const second = await $.classic.Stop({ stop_hook_active: true, last_assistant_message: `a ${DASH} b` })
    expect(second.block).toBeUndefined()
  })

  test('reads earlier assistant messages of the same turn only', async ($, on) => {
    const toolResult = { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: '1', text: 'x' }] }
    stopBottom(on, [
      { role: 'assistant', text: `old ${DASH}`, toolUses: [] },
      { role: 'user', text: 'next question', toolUses: [] },
      { role: 'assistant', text: `this turn ${DASH}`, toolUses: [] },
      toolResult,
      { role: 'assistant', text: 'done', toolUses: [] },
    ])
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'done' })).block).toContain('em dash')
  })

  test('passes a clean turn even when an earlier turn had a dash', async ($, on) => {
    stopBottom(on, [
      { role: 'assistant', text: `old ${DASH}`, toolUses: [] },
      { role: 'user', text: 'next question', toolUses: [] },
      { role: 'assistant', text: 'done', toolUses: [] },
    ])
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'done' })).block).toBeUndefined()
  })
})

describe('em dashes as the reply streams', () => {
  test('a spaced dash becomes a comma', async ($, on) => {
    expect(await streamReply($, on, [`a ${DASH} b`])).toBe('a, b')
  })

  test('a dash with no spaces becomes a comma', async ($, on) => {
    expect(await streamReply($, on, [`a${DASH}b`])).toBe('a, b')
  })

  test('a dash split across pieces becomes one comma', async ($, on) => {
    expect(await streamReply($, on, ['a ', DASH, ' b'])).toBe('a, b')
  })

  test('text without a dash streams unchanged', async ($, on) => {
    expect(await streamReply($, on, ['one ', 'two, ', 'three'])).toBe('one two, three')
  })
})

describe('British spelling', () => {
  test('a .md write that adds British words denies with each American form', async ($, on) => {
    engine(on)
    const r = await call($, { tool: 'Write', file_path: 'README.md', content: 'The colour and behaviour were organised.' })
    expect(r.deny).toContain('colour -> color')
    expect(r.deny).toContain('behaviour -> behavior')
    expect(r.deny).toContain('organised -> organized')
  })

  test('a .ts write with British words passes', async ($, on) => {
    engine(on)
    expect((await call($, { tool: 'Write', file_path: 'a.ts', content: 'const colour = "grey"' })).deny).toBeUndefined()
  })

  test('a .md write that keeps existing British words passes', async ($, on) => {
    engine(on, 'Our colour.')
    expect((await call($, { tool: 'Write', file_path: 'a.md', content: 'Our colour, again.' })).deny).toBeUndefined()
  })

  test('Edit and MultiEdit on prose files deny added British words', async ($, on) => {
    engine(on)
    expect((await call($, { tool: 'Edit', file_path: 'a.txt', old_string: 'x', new_string: 'travelled' })).deny).toContain(
      'travelled -> traveled',
    )
    const edits = [{ old_string: 'a', new_string: 'Whilst' }]
    expect((await call($, { tool: 'MultiEdit', file_path: 'a.rst', edits })).deny).toContain('whilst -> while')
  })

  test('a git commit message with "behaviour" denies', async ($, on) => {
    engine(on)
    const r = await call($, { tool: 'Bash', command: 'git commit -m "Fix behaviour"' })
    expect(r.deny).toContain('behaviour -> behavior')
    expect((await call($, { tool: 'Bash', command: 'gh pr create --title "Centre it"' })).deny).toContain('centre -> center')
  })

  test('other shell commands with British words pass', async ($, on) => {
    engine(on)
    expect((await call($, { tool: 'Bash', command: 'grep colour src' })).deny).toBeUndefined()
  })

  test('the GitHub pull request tools check title and body', async ($, on) => {
    engine(on)
    const r = await call($, { tool: 'mcp__github__create_pull_request', title: 'Tidy', body: 'Cancelled the old colour.' })
    expect(r.deny).toContain('cancelled -> canceled')
    expect(r.deny).toContain('colour -> color')
  })

  test('the GitHub pull request tools refuse an em dash', async ($, on) => {
    engine(on)
    const dash = String.fromCharCode(0x2014)
    const r = await call($, { tool: 'mcp__github__update_pull_request', title: 'Tidy', body: `One${dash}two` })
    expect(r.deny).toContain('em dash')
  })

  test('words that only look British pass', async ($, on) => {
    engine(on)
    const content = 'A precise promise, otherwise a dialogue. The analyses of this programmer are judgement amongst peers.'
    expect((await call($, { tool: 'Write', file_path: 'a.md', content })).deny).toBeUndefined()
    expect((await call($, { tool: 'Bash', command: `git commit -m "${content}"` })).deny).toBeUndefined()
  })
})

describe('the blocked counter', () => {
  // A store that starts at `total`, and the status lines the plugin pins.
  const counter = (on: any, total: number) => {
    const store = new Map<string, unknown>([['emDashesBlocked', total]])
    const lines: (string | undefined)[] = []
    on('store.get', (_$: any, e: { key: string }) => ({ value: store.get(e.key) }))
    on('store.set', (_$: any, e: { key: string; value: unknown }) => {
      store.set(e.key, e.value)
      return { value: undefined }
    })
    on('ui.status', (_$: any, e: { text?: string }) => {
      lines.push(e.text)
      return { value: undefined }
    })
    return { store, lines }
  }

  test('counts dashes from refused calls and blocked replies', async ($, on) => {
    engine(on)
    on('classic.Stop', () => ({}))
    on('session.messages', () => ({ value: [] }))
    const { store, lines } = counter(on, 40)
    await call($, { tool: 'Edit', file_path: 'x.ts', old_string: 'a', new_string: `${DASH} ${DASH}` })
    await $.classic.Stop({ stop_hook_active: false, last_assistant_message: `a ${DASH} b` })
    expect(store.get('emDashesBlocked')).toBe(43)
    expect(lines.at(-1)).toBe('43 em dashes blocked')
  })

  test('counts dashes replaced in a streamed reply', async ($, on) => {
    const { store } = counter(on, 2)
    await streamReply($, on, [`a ${DASH} b `, `${DASH} c`])
    expect(store.get('emDashesBlocked')).toBe(4)
  })

  test('one dash reads in the singular', async ($, on) => {
    engine(on)
    const { lines } = counter(on, 0)
    await call($, { tool: 'Bash', command: `echo ${DASH}` })
    expect(lines.at(-1)).toBe('1 em dash blocked')
  })

  test('a store that fails shows a toast and the call is still denied', async ($, on) => {
    // No store hooks: the store call rejects, as a broken store would.
    engine(on)
    const toasts: string[] = []
    on('ui.toast', (_$: any, e: { text: string }) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    const r = await call($, { tool: 'Bash', command: `echo ${DASH}` })
    expect(r.deny).toContain('em dash')
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatch(/^Could not count the blocked em dash: /)
  })

  test('a call that passes counts nothing', async ($, on) => {
    engine(on)
    const { store, lines } = counter(on, 5)
    await call($, { tool: 'Edit', file_path: 'x.ts', old_string: DASH, new_string: DASH })
    expect(store.get('emDashesBlocked')).toBe(5)
    expect(lines).toEqual([])
  })

  test('shows the all-time count when a session starts', async ($, on) => {
    on('session.start', (_$: any, e: { cwd: string }) => ({ cwd: e.cwd }))
    const { lines } = counter(on, 7)
    await $.session.start({ cwd: '/tmp', surface: null, isInteractive: false })
    expect(lines).toEqual(['7 em dashes blocked'])
  })
})
