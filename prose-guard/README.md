# prose-guard

Keeps em dashes out of everything Claude writes, and British spelling out of prose, commit messages and pull requests.

## What it does

- **Replies.** Each em dash in a reply turns into a comma as the reply streams, so you never see one. Thinking gets the same rewrite. If a dash still gets through, the mod sends the reply back once and asks for a rewrite.
- **Edits and shell commands.** A Write, Edit, MultiEdit or NotebookEdit that adds an em dash is refused, and so is a Bash command that contains one. The refusal tells Claude to use periods or commas instead. Edits that keep or remove existing dashes pass.
- **British spelling.** Writes and edits to Markdown, MDX, text and reStructuredText files are refused when they add a British spelling, and so are `git commit`, `gh pr create` and `gh pr edit` commands and the GitHub MCP pull request tools. The refusal lists each word with its American spelling. The list covers the common -our, -re, -ise and doubled-l forms and a few dozen other words, all in `hooks/register.ts`. Code files are left alone, so identifiers and stored values never trip it.

## Loading it

It isn't on a marketplace. Clone the repo and load the folder:

```bash
git clone https://github.com/cprentice9/ccmods.git
```

```bash
claude --plugin-dir ccmods/prose-guard
```

The ccmods README explains how to load it in every session, including desktop app sessions.

## Checking it

From the ccmods folder:

```bash
claude plugin validate prose-guard
```

```bash
claude plugin test prose-guard
```
