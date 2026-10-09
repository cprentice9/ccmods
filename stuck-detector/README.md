# stuck-detector

Notices when Claude runs the same test command and it fails twice in a row, and tells Claude to stop and ask for a second opinion.

## What it does

After every Bash command, it checks whether the command ran a test suite: pytest, npm, pnpm, yarn or bun test, vitest, jest, go test, cargo test, rspec, phpunit, dotnet test, make test and a few more. It finds the test command anywhere in a chain, so `cd app && npm test` counts and `grep pytest notes.txt` doesn't.

On the second failure in a row of the same command, it does two things:

- Shows a toast naming the command.
- Adds a note to the command's result telling Claude to stop fixing and ask for a second opinion.

A pass resets the count. The main session and each subagent keep separate counts.

## The note

The note is the `note` option in `.claude-plugin/plugin.json`. The default asks Claude to brief the `second-opinion`, `second-opinion-sonnet` and `second-opinion-haiku` agents side by side, which are custom agent types running Fable 5.1, Sonnet 5.5 and Haiku 5.5 at high effort, the same as the pre-PR reviewers. If you don't have agents with those names, change the default to whatever you want Claude to do.

## Loading it

It isn't on a marketplace. Clone the repo and load the folder:

```bash
git clone https://github.com/cprentice9/ccmods.git
```

```bash
claude --plugin-dir ccmods/stuck-detector
```

The ccmods README explains how to load it in every session, including desktop app sessions.

## Checking it

From the ccmods folder:

```bash
claude plugin validate stuck-detector
```

```bash
claude plugin test stuck-detector
```
