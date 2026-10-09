export type TowerState = 'working' | 'waiting' | 'done' | 'failed' | 'idle' | 'ended'

export type TowerEntry = {
  id: string
  repo: string
  task: string
  prompt: string
  last: string
  state: TowerState
  since: number
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'control-tower': { sessions: TowerEntry[]; self: string; now: number }
  }
}
