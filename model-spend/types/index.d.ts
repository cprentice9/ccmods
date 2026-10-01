export type ModelSpendFamily = 'Opus' | 'Sonnet' | 'Fable' | 'Haiku' | 'Other'

/** Estimated dollars per family, priced from each call's token counts. */
export type ModelSpendUsd = Partial<Record<ModelSpendFamily, number>>

declare module 'claude-code' {
  interface PluginState {
    'model-spend': { spend: ModelSpendUsd }
  }
}
