/** The main turn Clawd is working on; null while the session is idle. */
export type WorkingTurn = string | null

/** One task on Claude's checklist, as its TaskCreate and TaskUpdate calls left it. */
export type WorkingTask = {
  subject: string
  status: 'pending' | 'in_progress' | 'completed'
  /** What the task reads as while in progress ("Running tests"). */
  activeForm?: string
}

/** The checklist, by task id, in the order the tasks were made. */
export type WorkingTasks = Record<string, WorkingTask>

declare module 'claude-code' {
  interface PluginState {
    'working-clawd': {
      turnId: WorkingTurn
      /** The subagents running now, one mini Clawd each. */
      agents: string[]
      tasks: WorkingTasks
      /** The main loop's latest commands this turn, oldest first. */
      commands: string[]
    }
  }
}
