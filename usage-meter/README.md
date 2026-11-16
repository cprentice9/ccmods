# usage-meter

A row above the prompt with your plan limits and the session's context.

## What it shows

- 5-hour, Weekly and Fable weekly: how much of each plan limit you've used. A model's weekly row shows only when your plan has one.
- Context: how full this session's context window is.

Each meter is centered in an equal share of the row's width, a quarter with four. In the desktop app each percentage has a small meter beside it, drawn like the context meter in the app's environment menu. Terminals show the percentages alone.

## Where the numbers come from

In a terminal session the limits come from the same usage endpoint Claude Code reads for `/usage`. The mod asks the engine to attach your login to that one request, so the mod never sees your token.

The desktop app gives each session a login that can only call the model, and the endpoint refuses it. So in a desktop session the mod reads the limits from the desktop's own usage tool, `get_usage`, which reports the same windows as the app's usage card.

Either way it reads them when the session starts, when each turn ends, and every five minutes after that. Until the first reading arrives it tries once a minute. It never asks twice in 30 seconds, and a turn that ends inside that gap gets its reading when the gap is over.

Mid-turn, each model response also reports the 5-hour and weekly windows in its headers, a subagent's responses too. The API sends those headers before the response itself, so they leave out what that response cost and trail the app's card a little. The row lets them raise a meter but never lower one, and the reading at the end of the turn sets it to what the card shows. A model's weekly window isn't in the headers and waits for that reading. The context figure also comes from the engine after each response, not just at the end of the turn. A compaction is not a turn, and the engine has no figure for the compacted conversation until the next reply, so in between the row shows the estimate `/context` draws.

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
