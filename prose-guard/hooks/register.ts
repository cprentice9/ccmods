import type { EngineInterface, Register } from 'claude-code'

// The em dashes blocked across all sessions, kept in the store.
const ALL_TIME = 'emDashesBlocked'

const drawCount = async ($: EngineInterface) => {
  const total = Number((await $.store.get(ALL_TIME)) ?? 0)
  if (total > 0) $.ui.status(`${total} ${total === 1 ? 'em dash' : 'em dashes'} blocked`)
}

// A counter that fails must never let a dash through, so its errors stop here
// and show as a toast.
const tally = async ($: EngineInterface, dashes: number) => {
  try {
    await $.store.set(ALL_TIME, Number((await $.store.get(ALL_TIME)) ?? 0) + dashes)
    await drawCount($)
  } catch (error) {
    $.ui.toast(`Could not count the blocked em dash: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const DASH = String.fromCharCode(0x2014)
const countDashes = (s: unknown) => (typeof s === 'string' ? s.split(DASH).length - 1 : 0)
const SPACED_DASH = new RegExp(`[ \\t]*${DASH}[ \\t]*`, 'g')
const TRAILING_DASH = new RegExp(`[ \\t${DASH}]+$`)

const DASH_DENY =
  'This adds an em dash. Rewrite it with periods or commas. ' +
  "To match the character in a shell command, write it as an escape such as $'\\xe2\\x80\\x94'."

const REPLY_BLOCK =
  'Your reply contained an em dash. Send the reply again, rewritten with periods or commas and no em dashes.'

// British spelling -> American spelling, one entry per inflected form.
const BRITISH = new Map<string, string>()
const add = (uk: string, us: string) => BRITISH.set(uk, us)

for (const w of ['colour', 'behaviour', 'favour', 'honour', 'labour', 'neighbour', 'flavour', 'humour', 'rumour', 'harbour'])
  for (const end of ['', 's', 'ed', 'ing', 'er', 'ers', 'able', 'al', 'ful', 'hood', 'ite', 'ites'])
    add(w + end, w.replace('our', 'or') + end)

for (const w of ['centre', 'theatre', 'metre', 'litre', 'fibre'])
  for (const [uk, us] of [['re', 'er'], ['res', 'ers'], ['red', 'ered'], ['ring', 'ering']])
    add(w.slice(0, -2) + uk, w.slice(0, -2) + us)

for (const stem of [
  'organis', 'recognis', 'realis', 'apologis', 'prioritis', 'summaris', 'optimis', 'initialis', 'serialis',
  'normalis', 'customis', 'minimis', 'maximis', 'categoris', 'finalis', 'utilis', 'authoris', 'emphasis',
  'standardis', 'synchronis', 'visualis',
])
  for (const end of ['e', 'es', 'ed', 'ing', 'er', 'ers', 'able', 'ation', 'ations'])
    add(stem + end, stem.slice(0, -1) + 'z' + end)

// "analyses" is left out: it is also the plural of "analysis".
for (const end of ['e', 'ed', 'ing', 'er', 'ers']) add('analys' + end, 'analyz' + end)

for (const stem of ['cancel', 'travel', 'model', 'label', 'level', 'signal', 'fuel'])
  for (const end of ['ed', 'ing', 'er', 'ers']) add(stem + 'l' + end, stem + end)

for (const w of ['licence', 'defence', 'offence', 'pretence']) {
  add(w, w.slice(0, -2) + 'se')
  add(w + 's', w.slice(0, -2) + 'ses')
}

for (const [uk, us] of [
  ['grey', 'gray'], ['greys', 'grays'], ['greyed', 'grayed'], ['greying', 'graying'], ['greyer', 'grayer'], ['greyish', 'grayish'],
  ['catalogue', 'catalog'], ['catalogues', 'catalogs'], ['catalogued', 'cataloged'], ['cataloguing', 'cataloging'],
  ['programme', 'program'], ['programmes', 'programs'],
  ['aluminium', 'aluminum'], ['whilst', 'while'], ['ageing', 'aging'],
  ['artefact', 'artifact'], ['artefacts', 'artifacts'],
  ['cheque', 'check'], ['cheques', 'checks'],
  ['tyre', 'tire'], ['tyres', 'tires'],
  ['manoeuvre', 'maneuver'], ['manoeuvres', 'maneuvers'], ['manoeuvred', 'maneuvered'], ['manoeuvring', 'maneuvering'],
  ['sceptic', 'skeptic'], ['sceptics', 'skeptics'], ['sceptical', 'skeptical'], ['scepticism', 'skepticism'],
])
  add(uk, us)

const britishCounts = (s: unknown) => {
  const counts = new Map<string, number>()
  if (typeof s !== 'string') return counts
  for (const word of s.toLowerCase().match(/[a-z]+/g) ?? [])
    if (BRITISH.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1)
  return counts
}

// British words whose count rises from the old texts to the new ones.
const addedBritish = (pairs: [unknown, unknown][]) => {
  const delta = new Map<string, number>()
  for (const [oldText, newText] of pairs) {
    for (const [w, n] of britishCounts(newText)) delta.set(w, (delta.get(w) ?? 0) + n)
    for (const [w, n] of britishCounts(oldText)) delta.set(w, (delta.get(w) ?? 0) - n)
  }
  return [...delta].filter(([, n]) => n > 0).map(([w]) => w)
}

const britishDeny = (words: string[]) =>
  'This adds British spelling. Use American spelling: ' +
  words.map(w => `${w} -> ${BRITISH.get(w)}`).join(', ') + '.'

const PROSE_FILE = /\.(md|mdx|markdown|txt|rst)$/i
const COMMIT_OR_PR = /\bgit\s+(?:-[Cc]\s+\S+\s+)*commit\b|\bgh\s+pr\s+(?:create|edit)\b/
const PR_TOOLS = ['mcp__github__create_pull_request', 'mcp__github__update_pull_request']

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await drawCount($).catch(() => {})
    return r
  })

  on('tool.call', async ($, e, next) => {
    // MultiEdit and the GitHub tools may not be in this build's typed tool list.
    const t = e as unknown as Record<string, any>
    let dashes = 0
    let british: string[] = []
    switch (t.tool) {
      case 'Write': {
        const before = await $.fs.read(t.file_path).catch(() => '')
        dashes = countDashes(t.content) - countDashes(before)
        if (PROSE_FILE.test(t.file_path)) british = addedBritish([[before, t.content]])
        break
      }
      case 'Edit':
        dashes = countDashes(t.new_string) - countDashes(t.old_string)
        if (PROSE_FILE.test(t.file_path)) british = addedBritish([[t.old_string, t.new_string]])
        break
      case 'MultiEdit': {
        const edits: { old_string?: string; new_string?: string }[] = t.edits ?? []
        dashes = edits.reduce((n, x) => n + countDashes(x.new_string) - countDashes(x.old_string), 0)
        if (PROSE_FILE.test(t.file_path)) british = addedBritish(edits.map(x => [x.old_string, x.new_string]))
        break
      }
      case 'NotebookEdit':
        dashes = countDashes(t.new_source)
        break
      case 'Bash':
        dashes = countDashes(t.command)
        if (COMMIT_OR_PR.test(t.command ?? '')) british = addedBritish([['', t.command]])
        break
      default:
        if (PR_TOOLS.includes(t.tool)) {
          dashes = countDashes(t.title) + countDashes(t.body)
          british = addedBritish([['', t.title], ['', t.body]])
        }
    }
    const reasons = []
    if (dashes > 0) reasons.push(DASH_DENY)
    if (british.length > 0) reasons.push(britishDeny(british))
    if (dashes > 0) await tally($, dashes)
    return reasons.length > 0 ? { deny: reasons.join(' ') } : next(e)
  })

  // Each em dash in a reply becomes a comma as the reply streams, so none is
  // drawn or recorded. Thinking gets the same rewrite, since the app shows it
  // as progress notes; the engine still records the signed original. A
  // piece's trailing spaces and dashes wait for the next piece of the same
  // block, since the rest of the dash may arrive there.
  on('turn.step', async function* ($, e, next) {
    let held = ''
    let heldIndex = -1
    let dashes = 0
    for await (const c of next(e)) {
      if (c.kind !== 'text' && c.kind !== 'thinking') {
        yield c
        continue
      }
      const joined = (c.index === heldIndex ? held : '') + c.text
      held = joined.match(TRAILING_DASH)?.[0] ?? ''
      heldIndex = c.index
      const text = joined.slice(0, joined.length - held.length)
      dashes += countDashes(text)
      yield { ...c, text: text.replace(SPACED_DASH, ', ') }
    }
    if (dashes > 0) await tally($, dashes)
  })

  // Stop is the one event that can send a finished reply back to the model.
  // The stream above leaves no dash for it to find; it stays as a backstop.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    // One rewrite per reply, so a stubborn dash cannot loop forever.
    if (e.stop_hook_active || result.block !== undefined) return result
    const dashes = countDashes(await turnText($, e.last_assistant_message))
    if (dashes === 0) return result
    await tally($, dashes)
    return { ...result, block: REPLY_BLOCK }
  })
}

// Text of every assistant message since the last real user message, plus the
// final reply, which the transcript may not hold yet.
async function turnText($: { session: { messages: () => Promise<unknown> } }, last: string | undefined) {
  const texts = [last ?? '']
  const messages = (await $.session.messages()) as { role: string; text: string; toolResults?: unknown[] }[]
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.role === 'user') {
      if (!m.toolResults?.length) break
    } else texts.push(m.text)
  }
  return texts.join('\n')
}
