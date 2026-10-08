import type { EngineInterface, Register } from 'claude-code'

/** Turns shorter than this finish while you are still watching: no ping. */
const MIN_TURN_MS = 30_000

/**
 * One macOS system sound per kind of ping, so you can tell them apart without
 * looking. Any name in /System/Library/Sounds works: Basso Blow Bottle Frog
 * Funk Glass Hero Morse Ping Pop Purr Sosumi Submarine Tink.
 */
export const SOUNDS = {
  done: 'Glass',
  failed: 'Basso',
  needsYou: 'Submarine',
} as const

/** afplay volume: 1 is full, 0.3 a soft chime. */
export const VOLUME = 0.3

const basename = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

export function snippet(text: string, max = 60): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

let repoName = ''
let lastPrompt = ''

async function repo($: EngineInterface): Promise<string> {
  if (repoName) return repoName
  const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { timeoutMs: 5000 })
  repoName = basename(top.exitCode === 0 ? top.stdout.trim() : await $.session.cwd())
  return repoName
}

async function ping($: EngineInterface, title: string, body: string, sound: string) {
  // afplay plays even when Focus mode mutes notification sounds.
  void $.process.run(['afplay', '-v', String(VOLUME), `/System/Library/Sounds/${sound}.aiff`], { timeoutMs: 10_000 }).catch(() => undefined)
  // argv keeps quotes in the prompt text from breaking the AppleScript.
  await $.process
    .run(
      [
        'osascript',
        '-e', 'on run argv',
        '-e', 'display notification (item 2 of argv) with title (item 1 of argv)',
        '-e', 'end run',
        title,
        body,
      ],
      { timeoutMs: 5000 },
    )
    .catch(() => undefined)
}

export const register: Register = on => {
  on('prompt.submit', ($, e, next) => {
    lastPrompt = e.text
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || e.isAborted || e.durationMs < MIN_TURN_MS) return done

    const name = await repo($)
    const ok = e.reason === 'answer'
    void ping(
      $,
      `${ok ? '✅' : '❌'} ${name} · ${formatDuration(e.durationMs)}`,
      snippet(lastPrompt) || (ok ? 'Done' : 'Ended with an error'),
      ok ? SOUNDS.done : SOUNDS.failed,
    )
    return done
  })

  // Claude is blocked on you: a permission dialog or a question.
  on('classic.Notification', async ($, e, next) => {
    const ran = await next(e)
    if (e.notification_type === 'permission_prompt' || e.notification_type === 'elicitation_dialog') {
      const name = await repo($)
      void ping($, `✋ ${name} needs you`, snippet(e.message), SOUNDS.needsYou)
    }
    return ran
  })
}
