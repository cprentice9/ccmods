# ccmods

Mods for Claude Code. Each folder is one plugin of function hooks.

| Mod | What it does |
| --- | --- |
| `prose-guard` | Turns each em dash in a reply into a comma as the reply streams. Refuses writes and shell commands that add an em dash, and prose or commit messages that use British spelling. |
| `subagent-pane` | A pane listing each subagent with its type, model, effort, task and status. Selecting one shows its whole conversation. Refuses Haiku and a sixth coder running at once. |
| `working-clawd` | While Claude works on a turn, Clawd shows up above the prompt. In the desktop app he walks the length of the prompt box against a starry sky and stops now and then to look around, wave, jump or turn back, as on the claude.dev blog, with a smaller Clawd walking beside him for each running subagent. In the terminal he walks back and forth, with a mini Clawd for each running subagent and the current task and latest command above him. |
| `stuck-detector` | When the same test command fails twice in a row, shows a toast and tells the model to ask for a second opinion. |

## Loading a mod

For one session:

```bash
claude --plugin-dir ~/Documents/GitHub/ccmods/prose-guard
```

For every session, including ones the desktop app starts, set `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json` to `~/Documents/GitHub/ccmods`. Pointing at the parent folder loads every mod in it and works on every OS. A list of single mod folders needs `:` between them on the Mac and Linux and `;` on Windows. Set `CLAUDE_CODE_PLUGIN_DIR_WATCH` to `1` in the same block, or a desktop session keeps the code it loaded at start and never picks up a change.

## Checking a mod

```bash
claude plugin validate prose-guard
```

```bash
claude plugin test prose-guard
```
