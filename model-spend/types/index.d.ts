export type ModelSpendFamily = 'Opus' | 'Sonnet' | 'Fable' | 'Haiku' | 'Other'

export type ModelSpendTokens = Partial<Record<ModelSpendFamily, number>>

declare module 'claude-code' {
  interface PluginState {
    'model-spend': { tokens: ModelSpendTokens }
  }
}
