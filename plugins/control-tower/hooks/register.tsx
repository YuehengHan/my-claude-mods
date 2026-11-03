import type { EngineInterface, Register } from 'claude-code'

import type { NeedKind, TowerEntry, TowerNeed, TowerState } from '../types'

const PANE = 'control-tower'
const SESSIONS = { plugin: 'control-tower', key: 'sessions' } as const
const SELF = { plugin: 'control-tower', key: 'self' } as const
const NOW = { plugin: 'control-tower', key: 'now' } as const

/** A session that has not written for this long has exited or crashed. */
const GONE_AFTER_MS = 90_000
const BEAT_MS = 15_000
const SCAN_MS = 5_000

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

export const NEED_LOOK: Record<NeedKind, { icon: string; label: string }> = {
  permission: { icon: '🔐', label: '等你批准' },
  question: { icon: '❓', label: '在问你' },
  decision: { icon: '🤔', label: '等你决定' },
  command: { icon: '⌨️', label: '要你执行' },
  action: { icon: '👉', label: '要你操作' },
}

export type BannerItem = { id: string; hostId?: string; repo: string; age: string; icon: string; label: string; what: string }

/** The banner: only the other sessions waiting for you, and what each wants. */
export function bannerOf(entries: readonly TowerEntry[], self: string, now: number): BannerItem[] {
  return arrange(entries, now)
    .filter(s => s.id !== self && s.state === 'waiting')
    .map(s => {
      const look = s.need ? NEED_LOOK[s.need.kind] : { icon: '✋', label: '在等你' }
      return { id: s.id, hostId: s.hostId, repo: s.repo, age: ago(now - s.since), icon: look.icon, label: look.label, what: s.need?.what ?? '' }
    })
}

const KINDS: readonly string[] = ['permission', 'question', 'decision', 'command', 'action']

/** Haiku's `{"kind": ..., "what": ...}` → a need, or null for `none` and anything unreadable. */
export function parseNeed(text: string): TowerNeed | null {
  const json = /\{[\s\S]*\}/.exec(text)?.[0]
  if (!json) return null
  try {
    const v = JSON.parse(json) as { kind?: unknown; what?: unknown }
    if (typeof v.kind !== 'string' || !KINDS.includes(v.kind)) return null
    return { kind: v.kind as NeedKind, what: oneLine(typeof v.what === 'string' ? v.what : '', 40) }
  } catch {
    return null
  }
}

/** Without the model: a command block it asks you to run, or a closing question. */
export function guessNeed(answer: string): TowerNeed | null {
  const block = /```(?:bash|sh|zsh|shell)?\n([^\n`]+)/.exec(answer)
  if (block && /请|跑|运行|执行|输入|run\b/i.test(answer)) return { kind: 'command', what: oneLine(block[1] ?? '', 40) }
  const tail = answer.trim().split('\n').filter(l => l.trim()).at(-1) ?? ''
  if (/[?？]\s*$/.test(tail)) return { kind: 'question', what: oneLine(tail, 40) }
  return null
}

const NEED_SYSTEM = [
  '你判断 AI 编程助手这一轮的最后一条回复，是不是在等用户亲自做某件事才能继续。',
  '只输出一行 JSON：{"kind":"…","what":"…"}。',
  'kind：command = 要用户运行命令（如 /reload-plugins、npm i、git push）；',
  'action = 要用户在电脑上操作（重启 app、登录授权、点按钮、去看效果）；',
  'decision = 给了选项要用户选或拍板；question = 问用户问题、要信息；',
  'none = 只是汇报结果，或只是客套的“有需要再说”。',
  'what：不超过 20 个字，说用户要做什么；是命令就直接写命令。',
].join('\n')

async function needOf($: EngineInterface, answer: string): Promise<TowerNeed | null> {
  if (answer.trim().length < 2) return null
  const reply = answer.length > 6000 ? answer.slice(-6000) : answer
  const r = await $.model
    .complete({ model: 'haiku', system: NEED_SYSTEM, prompt: reply, maxTokens: 120, timeoutMs: 15_000 })
    .catch(() => null)
  return r !== null && r.isAnswered ? parseNeed(r.text) : guessNeed(answer)
}

const HOST_ID = /^local_[A-Za-z0-9-]{1,64}$/

/** The desktop link that brings a session to the front; null where there is none to open. */
export function sessionLink(hostId: string | undefined): string | null {
  return hostId !== undefined && HOST_ID.test(hostId) ? `claude://code/continue?session=${hostId}` : null
}

/** Switches the desktop app to that session, as its own "continue" menu does. */
async function openSession($: EngineInterface, hostId: string | undefined) {
  const url = sessionLink(hostId)
  if (url === null) return
  await $.process.run(['open', url], { timeoutMs: 5000 }).catch(() => undefined)
}

const firstLine = (text: string) => oneLine(text.split('\n').find(l => l.trim()) ?? '')

/** A finished turn: done, then waiting if its last words ask something of you. */
async function settle($: EngineInterface, answer: string) {
  const need = await needOf($, answer)
  // You may have answered in the meantime: only a still-finished turn waits.
  if (need !== null && me?.state === 'done') await save($, { state: 'waiting', need })
}

let me: TowerEntry | null = null
let dir = ''

const basename = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path

/** `backend-ng`, or `backend-ng · fix/error-codes` in a worktree or a renamed checkout. */
export function nameOf(remote: string, folder: string, branch: string): string {
  const repo = remote.trim().replace(/\.git$/, '').split(/[/:]/).pop() || folder
  if (folder === repo || branch === '' || branch === 'HEAD') return repo
  return `${repo} · ${branch}`
}

async function displayName($: EngineInterface): Promise<string> {
  const run = async (args: string[]) => {
    const r = await $.process.run(['git', ...args], { timeoutMs: 5000 }).catch(() => null)
    return r !== null && r.exitCode === 0 ? r.stdout.trim() : ''
  }
  const top = await run(['rev-parse', '--show-toplevel'])
  if (top === '') return basename(await $.session.cwd())
  return nameOf(await run(['remote', 'get-url', 'origin']), basename(top), await run(['rev-parse', '--abbrev-ref', 'HEAD']))
}

async function init($: EngineInterface) {
  const home = (await $.env.get('HOME')) ?? ''
  dir = `${home}/.claude/control-tower`
  const repo = await displayName($)
  const now = await $.clock.now()
  const hostId = (await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')) || undefined
  me = { id: await $.session.id(), hostId, repo, task: '', prompt: '', last: '', state: 'idle', since: now, updatedAt: now }
  await $.state.set(SELF, me.id)
  await save($, {})
  // A session reopened after a night's work: did its last answer leave you something to do?
  const last = (await $.session.messages().catch(() => [])).at(-1)
  if (last?.role === 'assistant' && last.text.trim() !== '') {
    await save($, { state: 'done', last: firstLine(last.text) })
    await settle($, last.text)
  }
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
    void safely(save($, { state: 'working', prompt: oneLine(e.text), need: undefined }))
    return next(e)
  })

  on('classic.Notification', async ($, e, next) => {
    const ran = await next(e)
    if (e.notification_type === 'permission_prompt') {
      void safely(save($, { state: 'waiting', need: { kind: 'permission', what: oneLine(e.message, 40) } }))
    } else if (e.notification_type === 'elicitation_dialog') {
      void safely(save($, { state: 'waiting', need: { kind: 'question', what: oneLine(e.message, 40) } }))
    }
    return ran
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (me?.state === 'waiting') void safely(save($, { state: 'working', need: undefined }))
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      const state: TowerState = e.isAborted ? 'idle' : e.reason === 'answer' ? 'done' : 'failed'
      const answer = e.answer
      void safely(save($, { state, last: firstLine(answer), need: undefined }).then(() => (state === 'done' ? settle($, answer) : undefined)))
    }
    return done
  })

  on('classic.SessionEnd', async ($, e, next) => {
    await safely(save($, { state: 'ended' }))
    return next(e)
  })

  // A row under where-am-i's, only while another session waits for you, saying for what.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (e.props.hasSurvey) return rest
    const { value: sessions = [] } = await $.state.get(SESSIONS)
    const { value: self = '' } = await $.state.get(SELF)
    const { value: now = 0 } = await $.state.get(NOW)
    const waiting = bannerOf(sessions, self, now)
    if (waiting.length === 0) return rest
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {rest}
        <Box flexDirection="row" flexWrap="wrap">
          {waiting.map(it =>
            sessionLink(it.hostId) ? (
              <Box>
                <Button
                  key={`go-${it.id}`}
                  plain
                  label={`${it.icon} ${it.repo} ${it.label}${it.what ? `：${it.what}` : ''} ${it.age}`}
                  onPress={() => openSession($, it.hostId)}
                />
                <Text>{'   '}</Text>
              </Box>
            ) : (
              <Text color="warning">
                {it.icon} {it.repo} {it.label}
                {it.what ? `：${it.what}` : ''} {it.age}
                {'   '}
              </Text>
            ),
          )}
          <Button key="tower" label="tower" plain onPress={() => $.ui.open({ id: PANE, title: '🗼 Control tower' })} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const { value: sessions = [] } = await $.state.get(SESSIONS)
    const { value: self = '' } = await $.state.get(SELF)
    const { value: now = 0 } = await $.state.get(NOW)
    const width = Math.max(30, e.props.bodyColumns)
    const repoWidth = Math.min(24, Math.max(...sessions.map(s => s.repo.length), 8))

    if (sessions.length === 0) {
      return <Text dimColor>No live sessions yet. Each one shows up after its first prompt.</Text>
    }

    const hint = sessions.some(s => s.id !== self && sessionLink(s.hostId)) ? '  ·  点会话名跳过去' : ''
    const counts = (['waiting', 'working', 'done', 'failed'] as const)
      .map(st => [st, sessions.filter(s => s.state === st).length] as const)
      .filter(([, n]) => n > 0)
      .map(([st, n]) => `${LOOK[st].icon}${n}`)
      .join('  ')

    return (
      <Box flexDirection="column">
        <Text dimColor>
          {counts}
          {hint}
        </Text>
        {sessions.map(s => {
          const look = LOOK[s.state]
          const what = s.task || s.prompt || '—'
          return (
            <Box flexDirection="column" marginTop={1}>
              {s.id !== self && sessionLink(s.hostId) ? (
                <Button
                  key={`go-${s.id}`}
                  plain
                  label={`${look.icon} ${s.repo.padEnd(repoWidth)}  ${look.label} ${ago(now - s.since)}  ↗`}
                  onPress={() => openSession($, s.hostId)}
                />
              ) : (
                <Text wrap="truncate-end">
                  <Text color={look.color} bold>{look.icon} {s.repo.padEnd(repoWidth)}</Text>
                  <Text color={look.color}> {look.label} {ago(now - s.since)}</Text>
                  {s.id === self && <Text dimColor> (本会话)</Text>}
                </Text>
              )}
              {s.state === 'waiting' && s.need && (
                <Text color="warning" wrap="truncate-end">
                  {'   '}
                  {NEED_LOOK[s.need.kind].icon} {NEED_LOOK[s.need.kind].label}
                  {s.need.what ? `：${s.need.what}` : ''}
                </Text>
              )}
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
