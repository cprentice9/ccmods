/** The main turn Clawd is working on; null while the session is idle. */
export type WorkingTurn = string | null

declare module 'claude-code' {
  interface PluginState {
    'working-clawd': {
      turnId: WorkingTurn
      /** The subagents running now, one mini Clawd each. */
      agents: string[]
    }
  }
}
