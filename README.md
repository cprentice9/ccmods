# ccmods

Mods for Claude Code. Each folder is one plugin of function hooks.

| Mod | What it does |
| --- | --- |
| `prose-guard` | Refuses writes, shell commands and replies that add an em dash, and prose or commit messages that use British spelling. Its status line counts the em dashes it has blocked across all sessions. |
| `subagent-pane` | A pane listing each subagent with its type, model, effort, task and status. Refuses Haiku and a sixth coder running at once. |
| `stuck-detector` | When the same test command fails twice in a row, shows a toast and tells the model to ask for a second opinion. |
| `model-spend` | A status line with each model family's share of the session's spend and the total cost. |

## Loading a mod

For one session:

```bash
claude --plugin-dir ~/Documents/GitHub/ccmods/prose-guard
```

For every session, including ones the desktop app starts, list the folders in `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`, separated by `:`. Set `CLAUDE_CODE_PLUGIN_DIR_WATCH` to `1` in the same block, or a desktop session keeps the code it loaded at start and never picks up a change.

## Checking a mod

```bash
claude plugin validate prose-guard
```

```bash
claude plugin test prose-guard
```
