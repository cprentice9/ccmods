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
