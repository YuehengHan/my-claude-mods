import type { EngineInterface, Register } from 'claude-code'

import { SDK_MAP, isPublicApi, repoFromRemote } from './sdk-map.ts'
import type { Target } from './sdk-map.ts'

export type SyncStatus = 'pending' | 'applying' | 'done' | 'skipped'
export type SyncTarget = Target & { status: SyncStatus }
export type SyncItem = {
  id: string
  from: string
  session: string
  files: string[]
  at: number
  summary: string
  diff: string
  targets: SyncTarget[]
}

const EDIT_TOOLS: readonly string[] = ['Edit', 'Write', 'NotebookEdit']
const MAX_DIFF = 40_000
/** Edits a session makes to the same repo within this window land in one item. */
const MERGE_WINDOW_MS = 3 * 3600_000

const STATUS_ICON: Record<SyncStatus, string> = { pending: '⬜', applying: '🔄', done: '✅', skipped: '➖' }

export const shortId = (id: string) => id.slice(-4)
export const isOpen = (item: SyncItem) => item.targets.some(t => t.status === 'pending' || t.status === 'applying')

/** What the model reads right after it edits a public API file. */
export function contextFor(repo: string, file: string): string {
  const spec = SDK_MAP[repo]
  if (spec === undefined) return ''
  const lines = [
    `[sdk-sync] ${file} is public API of ${repo}. ${spec.note}`,
    'Repos that likely need a matching change:',
    ...spec.targets.map(t => `- ${t.repo} (${t.why}): ${t.paths.join(', ')}`),
    `In ${repo} itself: ${spec.selfChecks.join('; ')}.`,
    'Do not edit those other repos unless the user asks. End your answer with a short "SDK sync" checklist: for each repo above, whether it needs the change and what exactly.',
  ]
  return lines.join('\n')
}

export function describeItem(item: SyncItem, mine: string | null, now: number): string {
  const age = Math.round((now - item.at) / 60_000)
  const when = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`
  const head = `#${shortId(item.id)}  ${item.from} · ${when} · ${item.files.length} file(s)`
  const summary = item.summary ? item.summary.split('\n').map(l => `    ${l}`) : []
  const targets = item.targets.map(
    t => `    ${STATUS_ICON[t.status]} ${t.repo}${t.repo === mine ? ' ⭐ (this repo)' : ''} — ${t.why}`,
  )
  return [head, ...summary, ...targets].join('\n')
}

let home = ''
let sessionId = ''
let myRepo: string | null = null
const rootRepo = new Map<string, string>()
const announced = new Set<string>()
let touched = new Map<string, { root: string; files: Set<string> }>()
let told = new Set<string>()

const parent = (path: string) => path.replace(/\/[^/]*\/?$/, '') || '/'
const basename = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path
const syncDir = () => `${home}/.claude/sdk-sync`

async function repoRoot($: EngineInterface, path: string): Promise<string | null> {
  for (let dir = parent(path); dir !== '/' && dir !== ''; dir = parent(dir)) {
    if (await $.fs.exists(`${dir}/.git`)) return dir
  }
  return null
}

async function repoName($: EngineInterface, root: string): Promise<string> {
  const known = rootRepo.get(root)
  if (known !== undefined) return known
  const r = await $.process.run(['git', '-C', root, 'remote', 'get-url', 'origin'], { timeoutMs: 5000 })
  const name = (r.exitCode === 0 && repoFromRemote(r.stdout)) || basename(root)
  rootRepo.set(root, name)
  return name
}

async function init($: EngineInterface) {
  home = (await $.env.get('HOME')) ?? ''
  sessionId = await $.session.id()
  const cwd = await $.session.cwd()
  const root = await repoRoot($, `${cwd}/.`)
  myRepo = root === null ? null : await repoName($, root)
}

async function loadItems($: EngineInterface): Promise<SyncItem[]> {
  const items: SyncItem[] = []
  for (const f of await $.fs.list(syncDir()).catch(() => [])) {
    if (!f.name.endsWith('.json')) continue
    try {
      items.push(JSON.parse(String(await $.fs.read(`${syncDir()}/${f.name}`))) as SyncItem)
    } catch {
      // Half-written: skip.
    }
  }
  return items.sort((a, b) => b.at - a.at)
}

async function saveItem($: EngineInterface, item: SyncItem) {
  await $.fs.write(`${syncDir()}/${item.id}.json`, JSON.stringify(item, null, 2))
}

async function diffOf($: EngineInterface, root: string, files: readonly string[]): Promise<string> {
  const work = await $.process.run(['git', '-C', root, 'diff', 'HEAD', '--', ...files], { timeoutMs: 10_000 })
  let diff = work.stdout
  if (diff.trim() === '') {
    // Already committed this turn: take the last commit touching them.
    const last = await $.process.run(['git', '-C', root, 'log', '-1', '-p', '--format=%h %s', '--', ...files], { timeoutMs: 10_000 })
    diff = last.stdout
  }
  return diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n… (diff cut at ${MAX_DIFF} chars)` : diff
}

async function summarize($: EngineInterface, repo: string, diff: string): Promise<string> {
  if (diff.trim() === '') return ''
  const r = await $.model.complete({
    model: 'haiku',
    system:
      'Summarize the public API changes in this SDK diff for engineers who must mirror them in sibling SDKs. ' +
      'At most 3 lines, one change per line (added / removed / renamed / signature / behavior), in Chinese, naming the exact symbols. No preamble.',
    prompt: `Repo: ${repo}\n\n${diff.slice(0, 12_000)}`,
    maxTokens: 300,
    timeoutMs: 20_000,
  })
  return r.isAnswered ? r.text.trim() : ''
}

/** Writes (or extends) the hand-off other sessions pick up. */
async function record($: EngineInterface, repo: string, root: string, files: readonly string[]): Promise<SyncItem | null> {
  const spec = SDK_MAP[repo]
  if (spec === undefined || files.length === 0) return null
  const now = await $.clock.now()
  const items = await loadItems($)
  const open = items.find(i => i.from === repo && i.session === sessionId && isOpen(i) && now - i.at < MERGE_WINDOW_MS)
  const allFiles = [...new Set([...(open?.files ?? []), ...files])]
  const diff = await diffOf($, root, allFiles)
  const item: SyncItem = open
    ? { ...open, files: allFiles, diff, at: now }
    : {
        id: `${repo}-${now.toString(36)}`,
        from: repo,
        session: sessionId,
        files: allFiles,
        at: now,
        summary: '',
        diff,
        targets: spec.targets.map(t => ({ ...t, status: 'pending' as const })),
      }
  item.summary = (await summarize($, repo, diff)) || item.summary
  await saveItem($, item)
  return item
}

/** Tells this session about other repos' changes it should follow. */
async function checkIncoming($: EngineInterface) {
  if (myRepo === null) return
  for (const item of await loadItems($)) {
    const mine = item.targets.find(t => t.repo === myRepo && t.status === 'pending')
    if (mine === undefined || item.from === myRepo || announced.has(item.id)) continue
    announced.add(item.id)
    const first = item.summary.split('\n')[0] ?? ''
    $.ui.toast(`📬 ${item.from} 改了公开 API${first ? `：${first}` : ''} — ${myRepo} 可能要跟进（/sync apply ${shortId(item.id)}）`, {
      timeoutMs: 15_000,
    })
  }
}

function applyPrompt(item: SyncItem, target: SyncTarget, repo: string): string {
  return [
    `[sdk-sync] Mirror a public API change from ${item.from} into this repo (${repo}).`,
    `Why ${repo} follows: ${target.why}. Look at: ${target.paths.join(', ')}.`,
    item.summary ? `Summary of the change:\n${item.summary}` : '',
    `Changed files in ${item.from}: ${item.files.join(', ')}`,
    'The diff:',
    '```diff',
    item.diff,
    '```',
    `Follow ${repo}'s own conventions (its CLAUDE.md / AGENTS.md), keep naming idiomatic for this language, update its CHANGELOG if it has one, and run its tests.`,
    'If this repo does not need the change after all, say so and why instead of editing.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

async function runSync($: EngineInterface, args: string): Promise<string> {
  const [verb = 'list', id = '', who = ''] = args.trim().split(/\s+/).filter(Boolean)
  const now = await $.clock.now()
  const items = await loadItems($)
  const find = (short: string) => items.find(i => shortId(i.id) === short.replace(/^#/, '') || i.id === short)

  if (verb === 'list' || verb === '') {
    const open = items.filter(isOpen)
    if (open.length === 0) return '🔗 Nothing to sync. Edits to an SDK\'s public API show up here.'
    return [`🔗 Open SDK syncs (${open.length})`, ...open.map(i => describeItem(i, myRepo, now))].join('\n\n') +
      '\n\n/sync apply <id> · /sync done <id> [repo] · /sync skip <id> [repo] · /sync check'
  }

  if (verb === 'check') {
    const cwd = await $.session.cwd()
    const root = await repoRoot($, `${cwd}/.`)
    if (root === null || myRepo === null) return 'Not inside a git repo.'
    if (SDK_MAP[myRepo] === undefined) return `${myRepo} has no public API in the SDK map.`
    const names = await $.process.run(['git', '-C', root, 'diff', 'HEAD', '--name-only'], { timeoutMs: 10_000 })
    const api = names.stdout.split('\n').filter(f => f && isPublicApi(myRepo as string, f))
    if (api.length === 0) return `✓ No uncommitted public API changes in ${myRepo}.`
    const item = await record($, myRepo, root, api)
    return item ? describeItem(item, myRepo, now) : 'Nothing recorded.'
  }

  const item = find(id)
  if (item === undefined) return `No sync #${id}. /sync lists them.`
  const repo = who || myRepo || ''
  const target = item.targets.find(t => t.repo === repo)
  if (target === undefined) return `#${shortId(item.id)} has no target ${repo || '(this repo)'}.`

  if (verb === 'apply') {
    if (repo !== myRepo) return `Run /sync apply in a session opened in ${repo}.`
    target.status = 'applying'
    await saveItem($, item)
    // Not awaited: the prompt starts only once this command has returned.
    void $.prompt.submit({ text: applyPrompt(item, target, repo) })
    return `🔄 Asking Claude to mirror ${item.from}'s change into ${repo}…`
  }
  if (verb === 'done' || verb === 'skip') {
    target.status = verb === 'done' ? 'done' : 'skipped'
    await saveItem($, item)
    return `${STATUS_ICON[target.status]} #${shortId(item.id)} ${repo}: ${target.status}`
  }
  return 'Usage: /sync [list|check|apply <id>|done <id> [repo]|skip <id> [repo]]'
}

function safely(work: Promise<unknown>) {
  return work.catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sync',
      description: '🔗 Public API changes waiting to be mirrored across SDKs, docs and examples',
      argumentHint: '[list|check|apply <id>|done <id> [repo]|skip <id> [repo]]',
    })
    await safely(init($))
    void safely(checkIncoming($))
    return next(e)
  })

  on('command.run', { command: 'sync' }, async ($, e) => ({ text: await runSync($, e.args) }))

  on('prompt.submit', ($, e, next) => {
    touched = new Map()
    told = new Set()
    void safely(checkIncoming($))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (!EDIT_TOOLS.includes(String(e.tool)) || ran.deny !== undefined || ran.isError) return ran
    const args = e as { file_path?: string; notebook_path?: string }
    const path = args.file_path ?? args.notebook_path
    if (typeof path !== 'string' || !path.startsWith('/')) return ran

    const root = await repoRoot($, path).catch(() => null)
    if (root === null) return ran
    const repo = await repoName($, root).catch(() => '')
    const rel = path.slice(root.length + 1)
    if (!isPublicApi(repo, rel)) return ran

    const seen = touched.get(repo) ?? { root, files: new Set<string>() }
    seen.files.add(rel)
    touched.set(repo, seen)
    if (told.has(repo)) return ran
    told.add(repo)
    return { ...ran, context: [...(ran.context ?? []), contextFor(repo, rel)] }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || touched.size === 0) return done
    const changes = [...touched.entries()]
    touched = new Map()
    for (const [repo, { root, files }] of changes) {
      const targets = [...new Set((SDK_MAP[repo]?.targets ?? []).map(t => t.repo))]
      $.ui.toast(`🔗 ${repo} 公开 API 有改动 → 待同步：${targets.join(', ')}（/sync）`, { timeoutMs: 10_000 })
      void safely(record($, repo, root, [...files]))
    }
    return done
  })
}
