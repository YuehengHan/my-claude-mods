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
  /** The desktop app's id for the session (local_…), which a claude:// link opens. */
  hostId?: string
  /** The session's name in the desktop app's sidebar. */
  title?: string
  /** When its last turn ended, from the desktop app's record (survives restarts, unlike `since`). */
  activeAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'control-tower': {
      sessions: TowerEntry[]
      self: string
      now: number
      /** Session id → the `since` of the waiting you dismissed; a new wait shows again. */
      dismissed: Record<string, number>
    }
  }
}
