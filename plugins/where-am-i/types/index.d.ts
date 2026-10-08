export type RepoInfo = {
  name: string
  branch: string | null
  dirty: number
  ahead: number
  behind: number
}

declare module 'claude-code' {
  interface PluginState {
    'where-am-i': { repo: RepoInfo | null; task: string }
  }
}
