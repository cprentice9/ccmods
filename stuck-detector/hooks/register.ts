import type { Register } from 'claude-code'

// Commands that run a test suite. Each is matched at the start of a shell
// segment, so `cd app && npm test` counts and `grep pytest notes.txt` does not.
const TEST_COMMANDS = [
  'pytest',
  'python -m pytest',
  'python3 -m pytest',
  'uv run pytest',
  'npm test',
  'npm run test',
  'pnpm test',
  'pnpm run test',
  'yarn test',
  'yarn run test',
  'bun test',
  'bun run test',
  'npx vitest',
  'npx jest',
  'vitest',
  'jest',
  'go test',
  'cargo test',
  'mix test',
  'rspec',
  'bundle exec rspec',
  'phpunit',
  'vendor/bin/phpunit',
  'dotnet test',
  'make test',
  'claude plugin test',
]

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

const TEST_PATTERN = new RegExp(
  `(?:^|[;&|(]\\s*)(?:\\w+=\\S*\\s+)*(?:${TEST_COMMANDS.map(c =>
    c.split(' ').map(escape).join('\\s+'),
  ).join('|')})(?=$|[\\s;&|)])`,
)

export const register: Register = (on, options) => {
  const failures = new Map<string, number>()

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const command = e.command.trim().replace(/\s+/g, ' ')
    if (ran.deny !== undefined || !TEST_PATTERN.test(command)) return ran

    const key = `${e.agentId ?? 'main'}\n${command}`
    if (ran.isError !== true) {
      failures.delete(key)
      return ran
    }

    const count = (failures.get(key) ?? 0) + 1
    failures.set(key, count)
    if (count !== 2) return ran

    // Name the test command itself, not a `cd somewhere &&` in front of it.
    const shown = command.slice(command.search(TEST_PATTERN)).replace(/^[;&|(\s]+/, '')
    const short = shown.length > 50 ? `${shown.slice(0, 49)}…` : shown
    $.ui.toast(`Failed twice in a row: ${short}`)
    return { ...ran, context: [...(ran.context ?? []), String(options.note)] }
  })
}
