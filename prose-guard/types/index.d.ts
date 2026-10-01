/** Em dashes blocked in this session. */
export type ProseGuardBlocked = number

declare module 'claude-code' {
  interface PluginState {
    'prose-guard': { blocked: ProseGuardBlocked }
  }
}
