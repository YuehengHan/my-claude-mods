export type Joke = string

declare module 'claude-code' {
  interface PluginState {
    fortune: { joke: Joke }
  }
}
