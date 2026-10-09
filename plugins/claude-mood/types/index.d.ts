export type MoodLine = string

declare module 'claude-code' {
  interface PluginState {
    'claude-mood': { line: MoodLine }
  }
}
