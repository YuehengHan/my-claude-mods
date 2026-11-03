import type { EngineInterface, Register } from 'claude-code'

import type { NeedKind, TowerEntry, TowerNeed, TowerState } from '../types'

const PANE = 'control-tower'
const SESSIONS = { plugin: 'control-tower', key: 'sessions' } as const
const SELF = { plugin: 'control-tower', key: 'self' } as const
const NOW = { plugin: 'control-tower', key: 'now' } as const
const DISMISSED = { plugin: 'control-tower', key: 'dismissed' } as const

/** Shared by every session, beside their own files: which waits you waved off. */
const DISMISSED_FILE = '_dismissed.json'

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

/** What a session is called: its desktop sidebar title, else its repo. */
export function nameShown(s: Pick<TowerEntry, 'title' | 'repo'>): string {
  return s.title?.trim() || s.repo
}

export type BannerItem = {
  id: string
  hostId?: string
  since: number
  repo: string
  age: string
  icon: string
  label: string
  what: string
}

/** Whether you waved off this very wait (a later one, with a new `since`, shows again). */
export const isDismissed = (s: TowerEntry, dismissed: Record<string, number>) => dismissed[s.id] === s.since

/** The banner: only the other sessions waiting for you, and what each wants. */
export function bannerOf(
  entries: readonly TowerEntry[],
  self: string,
  now: number,
  dismissed: Record<string, number> = {},
): BannerItem[] {
  return arrange(entries, now)
    .filter(s => s.id !== self && s.state === 'waiting' && !isDismissed(s, dismissed))
    .map(s => {
      const look = s.need ? NEED_LOOK[s.need.kind] : { icon: '✋', label: '在等你' }
      return {
        id: s.id,
        hostId: s.hostId,
        since: s.since,
        repo: nameShown(s),
        age: ago(now - s.since),
        icon: look.icon,
        label: look.label,
        what: s.need?.what ?? '',
      }
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

let metaPath: string | null | undefined

/** This session's file in the desktop app's store, found once: claude-code-sessions/<org>/<account>/<id>.json. */
async function findMeta($: EngineInterface, hostId: string): Promise<string | null> {
  const home = (await $.env.get('HOME')) ?? ''
  const base = `${home}/Library/Application Support/Claude/claude-code-sessions`
  for (const a of await $.fs.list(base).catch(() => [])) {
    if (a.kind !== 'dir') continue
    for (const b of await $.fs.list(`${base}/${a.name}`).catch(() => [])) {
      const path = `${base}/${a.name}/${b.name}/${hostId}.json`
      if (b.kind === 'dir' && (await $.fs.exists(path))) return path
    }
  }
  return null
}

/** The sidebar's name for this session, read afresh so a rename shows within a heartbeat. */
async function titleOf($: EngineInterface): Promise<string | undefined> {
  if (me?.hostId === undefined) return undefined
  if (metaPath === undefined) metaPath = await findMeta($, me.hostId).catch(() => null)
  if (metaPath === null) return undefined
  try {
    const title = (JSON.parse(String(await $.fs.read(metaPath))) as { title?: unknown }).title
    return typeof title === 'string' && title.trim() ? title.trim() : undefined
  } catch {
    return me.title
  }
}

async function save($: EngineInterface, patch: Partial<TowerEntry>) {
  if (me === null || dir === '') return
  const title = await titleOf($)
  if (title !== undefined) me = { ...me, title }
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
    if (!f.name.endsWith('.json') || f.name.startsWith('_') || now - f.mtimeMs > 86_400_000) continue
    try {
      found.push(JSON.parse(String(await $.fs.read(`${dir}/${f.name}`))) as TowerEntry)
    } catch {
      // A file mid-write: next scan.
    }
  }
  await $.state.set(SESSIONS, arrange(found, now))
  await $.state.set(NOW, now)
  await $.state.set(DISMISSED, await readDismissed($))
}

async function readDismissed($: EngineInterface): Promise<Record<string, number>> {
  try {
    return JSON.parse(String(await $.fs.read(`${dir}/${DISMISSED_FILE}`))) as Record<string, number>
  } catch {
    return {}
  }
}

/** Waves off one session's current wait, for every session's banner. */
async function dismiss($: EngineInterface, id: string, since: number) {
  if (dir === '') return
  const live = new Set((await $.state.get(SESSIONS)).value?.map(s => s.id) ?? [])
  const kept = Object.fromEntries(Object.entries(await readDismissed($)).filter(([k]) => live.has(k)))
  await $.fs.write(`${dir}/${DISMISSED_FILE}`, JSON.stringify({ ...kept, [id]: since }))
  await scan($)
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
    const { value: dismissed = {} } = await $.state.get(DISMISSED)
    const waiting = bannerOf(sessions, self, now, dismissed)
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
                <Text> </Text>
                <Button key={`done-${it.id}`} plain dimColor label="✓" onPress={() => dismiss($, it.id, it.since)} />
                <Text>{'   '}</Text>
              </Box>
            ) : (
              <Box>
                <Text color="warning">
                  {it.icon} {it.repo} {it.label}
                  {it.what ? `：${it.what}` : ''} {it.age}{' '}
                </Text>
                <Button key={`done-${it.id}`} plain dimColor label="✓" onPress={() => dismiss($, it.id, it.since)} />
                <Text>{'   '}</Text>
              </Box>
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
    const { value: dismissed = {} } = await $.state.get(DISMISSED)
    const width = Math.max(30, e.props.bodyColumns)
    const nameWidth = Math.min(28, Math.max(...sessions.map(s => nameShown(s).length), 8))

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
          return (
            <Box flexDirection="column" marginTop={1}>
              {s.id !== self && sessionLink(s.hostId) ? (
                <Button
                  key={`go-${s.id}`}
                  plain
                  label={`${look.icon} ${nameShown(s).padEnd(nameWidth)}  ${look.label} ${ago(now - s.since)}  ↗`}
                  onPress={() => openSession($, s.hostId)}
                />
              ) : (
                <Text wrap="truncate-end">
                  <Text color={look.color} bold>{look.icon} {nameShown(s).padEnd(nameWidth)}</Text>
                  <Text color={look.color}> {look.label} {ago(now - s.since)}</Text>
                  {s.id === self && <Text dimColor> (本会话)</Text>}
                </Text>
              )}
              {s.state === 'waiting' && s.id !== self && (
                <Box>
                  <Text color={isDismissed(s, dismissed) ? 'inactive' : 'warning'} wrap="truncate-end">
                    {'   '}
                    {s.need ? `${NEED_LOOK[s.need.kind].icon} ${NEED_LOOK[s.need.kind].label}` : '✋ 在等你'}
                    {s.need?.what ? `：${s.need.what}` : ''}
                    {isDismissed(s, dismissed) ? '（已忽略）' : '  '}
                  </Text>
                  {!isDismissed(s, dismissed) && (
                    <Button key={`done-${s.id}`} plain dimColor label="✓ 忽略" onPress={() => dismiss($, s.id, s.since)} />
                  )}
                </Box>
              )}
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
