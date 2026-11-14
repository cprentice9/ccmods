/** The main turn Clawd floats for; null while the session is idle. */
export type StarfieldTurn = string | null

declare module 'claude-code' {
  interface PluginState {
    starfield: {
      turnId: StarfieldTurn
      /** The subagents running now, one mini astronaut each. */
      agents: string[]
    }
  }
}
