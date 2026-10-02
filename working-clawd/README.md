# working-clawd

While Claude works on a turn, Clawd walks above the prompt. He walks to one end, turns around and walks back. Every so often he stops to look around, wave or jump. He leaves when the turn ends, and the band goes away once no subagents are left running.

Each running subagent gets a smaller Clawd. It hops out of him when the subagent starts and walks beside him until the subagent finishes. Up to eight minis show at once.

## Where it draws

- **The Claude desktop app.** He walks the full width of the prompt box against a dark starry sky, in the moves the claude.dev blog animates him with.
- **Ghostty and kitty.** The same scene, sent as a picture through the kitty graphics protocol.
- **Other terminals.** A simpler Clawd in half-block characters walks back and forth. Above him go the checklist progress, the task in progress and the latest command.

It doesn't draw in editors that run Claude Code in their own agent panel, such as Zed.

## Install

```bash
claude plugin marketplace add cprentice9/byname
```

```bash
claude plugin install working-clawd@cprentice9
```

Start a new session after installing. It needs a Claude Code build that loads function-hook mods.

To update:

```bash
claude plugin marketplace update cprentice9
```

```bash
claude plugin update working-clawd@cprentice9
```

## Checking it

From the ccmods folder:

```bash
claude plugin validate working-clawd
```

```bash
claude plugin test working-clawd
```

## Credits

Clawd is Anthropic's mascot. The walking, turning, looking, waving and jumping frames are sampled from the animations on Anthropic's claude.dev blog.
