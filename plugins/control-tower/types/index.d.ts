export type TowerState = 'working' | 'waiting' | 'done' | 'failed' | 'idle' | 'ended'

/** What a waiting session wants from you. */
export type NeedKind = 'permission' | 'question' | 'decision' | 'command' | 'action'

export type TowerNeed = { kind: NeedKind; what: string }

export type TowerEntry = {
  id: string
  repo: string
  task: string
  prompt: string
  last: string
  state: TowerState
  since: number
  updatedAt: number
  need?: TowerNeed
}

declare module 'claude-code' {
  interface PluginState {
    'control-tower': { sessions: TowerEntry[]; self: string; now: number }
  }
}
