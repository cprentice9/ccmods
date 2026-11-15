/** One plan limit as the usage endpoint reports it. */
export type UsageMeter = { label: string; percent: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': {
      /** The plan limits; null before the first reading. */
      meters: UsageMeter[] | null
      /** The context window's fill, 0 to 100; null before the first response. */
      context: number | null
    }
  }
}
