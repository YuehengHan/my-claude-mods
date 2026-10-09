import type { EngineInterface, Register } from 'claude-code'

import type { TowerEntry, TowerState } from '../types'

const PANE = 'control-tower'
const SESSIONS = { plugin: 'control-tower', key: 'sessions' } as const
const SELF = { plugin: 'control-tower', key: 'self' } as const
const NOW = { plugin: 'control-tower', key: 'now' } as const

/** A session that has not written for this long has exited or crashed. */
const GONE_AFTER_MS = 90_000
const BEAT_MS = 15_000
const SCAN_MS = 5_000
/** Others' finished turns stay in the status line this long. */
const FRESH_DONE_MS = 3 * 60_000

export const ORDER: Record<TowerState, number> = { waiting: 0, failed: 1, working: 2, done: 3, idle: 4, ended: 5 }

export const LOOK: Record<TowerState, { icon: string; label: string; color: string }> = {
  waiting: { icon: '✋', label: '等你', color: 'warning' },
  failed: { icon: '❌', label: '出错', color: 'error' },
  working: { icon: '⏳', label: '在跑', color: 'suggestion' },
  done: { icon: '✅', label: '完成', color: 'success' },
  idle: { icon: '💤', label: '空闲', color: 'inactive' },
  ended: { icon: '⏹', label: '已关', color: 'inactive' },
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? `${m % 60}m` : ''}`
}

export function oneLine(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Live sessions, the ones needing you first. */
export function arrange(entries: readonly TowerEntry[], now: number): TowerEntry[] {
  return entries
    .filter(s => s.state !== 'ended' && now - s.updatedAt < GONE_AFTER_MS)
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.since - a.since)
}

/** The status line: only what another session needs you to know. */
export function headline(entries: readonly TowerEntry[], self: string, now: number): string | undefined {
  const others = arrange(entries, now).filter(s => s.id !== self)
  const waiting = others.filter(s => s.state === 'waiting').map(s => s.repo)
  if (waiting.length) return `🗼 ✋ ${waiting.join(', ')} 在等你`
  const failed = others.filter(s => s.state === 'failed' && now - s.since < FRESH_DONE_MS).map(s => s.repo)
  if (failed.length) return `🗼 ❌ ${failed.join(', ')} 出错了`
  const done = others.filter(s => s.state === 'done' && now - s.since < FRESH_DONE_MS).map(s => s.repo)
  if (done.length) return `🗼 ✅ ${done.join(', ')} 完成了`
  return undefined
}

let me: TowerEntry | null = null
let dir = ''

const basename = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path

async function init($: EngineInterface) {
  const home = (await $.env.get('HOME')) ?? ''
  dir = `${home}/.claude/control-tower`
  const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { timeoutMs: 5000 })
  const repo = basename(top.exitCode === 0 ? top.stdout.trim() : await $.session.cwd())
  const now = await $.clock.now()
  me = { id: await $.session.id(), repo, task: '', prompt: '', last: '', state: 'idle', since: now, updatedAt: now }
  await $.state.set(SELF, me.id)
  await save($, {})
}

async function save($: EngineInterface, patch: Partial<TowerEntry>) {
  if (me === null || dir === '') return
  const now = await $.clock.now()
  const stateChanged = patch.state !== undefined && patch.state !== me.state
  me = { ...me, ...patch, since: stateChanged ? now : me.since, updatedAt: now }
  await $.fs.write(`${dir}/${me.id}.json`, JSON.stringify(me))
  await scan($)
}

async function scan($: EngineInterface) {
  if (dir === '') return
  const now = await $.clock.now()
  const found: TowerEntry[] = []
  const files = await $.fs.list(dir).catch(() => [])
  for (const f of files) {
    // Files untouched for a day belong to long-gone sessions: skip without reading.
    if (!f.name.endsWith('.json') || now - f.mtimeMs > 86_400_000) continue
    try {
      found.push(JSON.parse(String(await $.fs.read(`${dir}/${f.name}`))) as TowerEntry)
    } catch {
      // A file mid-write: next scan.
    }
  }
  await $.state.set(SESSIONS, arrange(found, now))
  await $.state.set(NOW, now)
  $.ui.status(headline(found, me?.id ?? '', now))
}

function safely(work: Promise<unknown>) {
  return work.catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tower', description: '🗼 Every Claude session on this machine: working, waiting for you, done' })
    void safely(init($))
    $.clock.every(BEAT_MS, () => void safely(save($, {})))
    $.clock.every(SCAN_MS, () => void safely(scan($)))
    return next(e)
  })

  on('command.run', { command: 'tower' }, async $ => {
    await safely(scan($))
    await $.ui.open({ id: PANE, title: '🗼 Control tower' })
    return { text: 'Control tower opened.' }
  })

  // where-am-i's /task names the session here too.
  on('command.run', { command: 'task' }, ($, e, next) => {
    void safely(save($, { task: e.args.trim() }))
    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    void safely(save($, { state: 'working', prompt: oneLine(e.text) }))
    return next(e)
  })

  on('classic.Notification', async ($, e, next) => {
    const ran = await next(e)
    if (e.notification_type === 'permission_prompt' || e.notification_type === 'elicitation_dialog') {
      void safely(save($, { state: 'waiting' }))
    }
    return ran
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (me?.state === 'waiting') void safely(save($, { state: 'working' }))
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      const state: TowerState = e.isAborted ? 'idle' : e.reason === 'answer' ? 'done' : 'failed'
      void safely(save($, { state, last: oneLine(e.answer.split('\n').find(l => l.trim()) ?? '') }))
    }
    return done
  })

  on('classic.SessionEnd', async ($, e, next) => {
    await safely(save($, { state: 'ended' }))
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const { value: sessions = [] } = await $.state.get(SESSIONS)
    const { value: self = '' } = await $.state.get(SELF)
    const { value: now = 0 } = await $.state.get(NOW)
    const width = Math.max(30, e.props.bodyColumns)
    const repoWidth = Math.min(24, Math.max(...sessions.map(s => s.repo.length), 8))

    if (sessions.length === 0) {
      return <Text dimColor>No live sessions yet. Each one shows up after its first prompt.</Text>
    }

    const counts = (['waiting', 'working', 'done', 'failed'] as const)
      .map(st => [st, sessions.filter(s => s.state === st).length] as const)
      .filter(([, n]) => n > 0)
      .map(([st, n]) => `${LOOK[st].icon}${n}`)
      .join('  ')

    return (
      <Box flexDirection="column">
        <Text dimColor>{counts}</Text>
        {sessions.map(s => {
          const look = LOOK[s.state]
          const what = s.task || s.prompt || '—'
          return (
            <Box flexDirection="column" marginTop={1}>
              <Text wrap="truncate-end">
                <Text color={look.color} bold>{look.icon} {s.repo.padEnd(repoWidth)}</Text>
                <Text color={look.color}> {look.label} {ago(now - s.since)}</Text>
                {s.id === self && <Text dimColor> (本会话)</Text>}
              </Text>
              <Text wrap="truncate-end">   🎯 {oneLine(what, width - 6)}</Text>
              {s.last !== '' && s.state !== 'working' && (
                <Text dimColor wrap="truncate-end">   ↳ {oneLine(s.last, width - 6)}</Text>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
