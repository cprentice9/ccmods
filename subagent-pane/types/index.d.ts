/** One subagent as it was spawned. */
export type SubagentPaneRow = {
  id: string
  agentId?: string
  type: string
  description: string
  model?: string
}

/** What the subagent's own loop reported, keyed by its agentId. */
export type SubagentPaneFacts = {
  effort?: string
  status?: 'done' | 'failed'
  durationMs?: number
}

export type SubagentPaneState = {
  rows: SubagentPaneRow[]
  facts: Record<string, SubagentPaneFacts>
}

declare module 'claude-code' {
  interface PluginState {
    'subagent-pane': { agents: SubagentPaneState }
  }
}
