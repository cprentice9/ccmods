# usage-meter

A row above the prompt with your plan limits and the session's context.

## What it shows

- 5-hour, Weekly and Fable weekly: how much of each plan limit you've used. A model's weekly row shows only when your plan has one.
- Context: how full this session's context window is.

Each meter is centered in an equal share of the row's width, a quarter with four. In the desktop app each percentage has a small meter beside it, drawn like the context meter in the app's environment menu. Terminals show the percentages alone.

## Where the numbers come from

The limits come from the same usage endpoint Claude Code reads for `/usage`. The mod asks the engine to attach your login to that one request, so the mod never sees your token. It reads the endpoint when the session starts, when Claude Code notices a limit moved, and every five minutes, and never more than once in 30 seconds. The context figure comes from the engine after each turn.

With an API key, Bedrock, Vertex or a gateway there are no plan limits, so the row shows the context alone.

## Loading it

It isn't on a marketplace. Clone the repo and load the folder:

```bash
git clone https://github.com/cprentice9/ccmods.git
```

```bash
claude --plugin-dir ccmods/usage-meter
```

The ccmods README explains how to load it in every session, including desktop app sessions.

## Checking it

From the ccmods folder:

```bash
claude plugin validate usage-meter
```

```bash
claude plugin test usage-meter
```
