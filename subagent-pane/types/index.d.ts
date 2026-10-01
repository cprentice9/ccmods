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
  /** Tool calls the subagent has finished; each one redraws its detail view. */
  tools?: number
  /** Model responses the subagent has finished; each one redraws its detail view. */
  steps?: number
}

export type SubagentPaneState = {
  rows: SubagentPaneRow[]
  facts: Record<string, SubagentPaneFacts>
  /** The row whose detail view the pane shows; absent, the list. */
  selected?: string
}

declare module 'claude-code' {
  interface PluginState {
    'subagent-pane': { agents: SubagentPaneState }
  }
}
