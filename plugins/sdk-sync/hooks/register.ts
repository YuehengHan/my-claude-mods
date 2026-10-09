import type { EngineInterface, Register } from 'claude-code'

import { BASE_DIR, SDK_MAP, bareVersion, isPublicApi, isReleaseTag, mentions, repoFromRemote, versionPattern } from './sdk-map.ts'
import type { Target } from './sdk-map.ts'

// Nothing here acts while you work. It notices a new release tag, says so once,
// and on /release-check gathers the facts and asks Claude for a read-only audit.

export type Release = { tag: string; date: string }

export type TargetFacts = Target & {
  exists: boolean
  /** Commits touching `paths` on the default branch since the release. */
  commits: string[]
  pins: string[]
  /** Files under `paths` naming the released version, when it should. */
  versionHits: number | null
}

export type Facts = {
  repo: string
  path: string
  release: Release
  prev: Release | null
  apiFiles: string[]
  commits: string[]
  changelog: string | null
  targets: TargetFacts[]
}

const RELEASE_COMMAND =
  /\b(git\s+tag\s+(-a\s+)?v\d|git\s+push\b[^\n]*--tags|git\s+push\s+\S+\s+v\d|npm\s+publish|pnpm\s+publish|gh\s+release\s+create|gradlew\s+\S*publish|pod\s+trunk\s+push|twine\s+upload|uv\s+publish|hatch\s+publish)/

const KIND_LABEL: Record<Target['kind'], string> = {
  parity: '对齐端',
  docs: '文档',
  examples: '示例',
  consumer: '下游',
  release: '发布仓',
  codegen: '生成代码',
}

/** The signal the facts alone give; the audit decides for real. */
export function signal(t: TargetFacts, version: string): string {
  if (!t.exists) return '❔ 本地没有这个仓库'
  const notes: string[] = []
  if (t.commits.length === 0) notes.push('发版后没有相关提交')
  if (t.versionHits === 0) notes.push(`没提到 ${version}`)
  if (t.pins.length > 0 && !t.pins.some(p => mentions(p, version))) notes.push(`版本没跟到 ${version}`)
  return notes.length ? `⚠️ ${notes.join('，')}` : '🟢 发版后有更新'
}

export function changelogSection(text: string, version: string): string | null {
  const lines = text.split('\n')
  const start = lines.findIndex(l => /^##\s/.test(l) && mentions(l, version))
  if (start < 0) return null
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l))
  return lines.slice(start, end < 0 ? undefined : end).join('\n').trim().slice(0, 3000)
}

export function formatFacts(f: Facts): string {
  const v = bareVersion(f.release.tag)
  const lines = [
    `📦 ${f.repo} ${f.release.tag}（${f.release.date.slice(0, 10)}）${f.prev ? ` ← ${f.prev.tag}` : '（首个版本）'}`,
    `   公开 API 改动 ${f.apiFiles.length} 个文件 · ${f.commits.length} 个提交 · CHANGELOG ${f.changelog ? '✓' : `❌ 没有 ${v} 的条目`}`,
    '',
    ...f.targets.map(t => {
      const head = `   ${signal(t, v)}  ${t.repo}（${KIND_LABEL[t.kind]}）— ${t.why}`
      const pins = t.pins.slice(0, 3).map(p => `        📌 ${p}`)
      const last = t.commits[0] ? [`        ↳ ${t.commits[0]}${t.commits.length > 1 ? ` 等 ${t.commits.length} 个提交` : ''}`] : []
      return [head, ...pins, ...last].join('\n')
    }),
  ]
  return lines.join('\n')
}

export function auditPrompt(f: Facts): string {
  const v = bareVersion(f.release.tag)
  const spec = SDK_MAP[f.repo]
  const range = f.prev ? `${f.prev.tag}..${f.release.tag}` : f.release.tag
  return [
    `[release-check] Read-only release audit: ${f.repo} ${f.release.tag} (released ${f.release.date.slice(0, 10)}${f.prev ? `, previous ${f.prev.tag}` : ''}).`,
    spec?.note ?? '',
    `Source repo: ${f.path}`,
    f.apiFiles.length
      ? `Public API files changed in ${range}:\n${f.apiFiles.map(x => `- ${x}`).join('\n')}\nSee them with: git -C "${f.path}" diff ${range} -- <file>`
      : `No public API files changed in ${range} (check behaviour/bugfix parity from the commits and CHANGELOG instead).`,
    `Commits in ${range}:\n${f.commits.slice(0, 30).join('\n') || '(none)'}`,
    f.changelog ? `CHANGELOG section for ${v}:\n${f.changelog}` : `CHANGELOG has NO section for ${v} — report that.`,
    'Facts gathered after `git fetch` (commits on each repo\'s default branch since the release date):',
    ...f.targets.map(t =>
      [
        `- ${t.repo} [${t.kind}] ${t.why}`,
        `  path: ${BASE_DIR}/${t.repo}; look at: ${t.paths.join(', ')}`,
        `  commits since release: ${t.commits.length ? t.commits.slice(0, 5).join(' | ') : 'none'}`,
        t.pins.length ? `  pins: ${t.pins.slice(0, 6).join(' | ')}` : '',
        t.versionHits !== null ? `  files mentioning ${v}: ${t.versionHits}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    [
      'Your job, for each target above:',
      '- parity: for every public API change and notable fix in this release, find the matching implementation in that SDK (name the symbol/file) or mark it missing.',
      '- docs: are the new/changed APIs documented and is there a changelog entry for this version?',
      '- examples / consumer / release: do they use this version (pins) and the current API (no removed/renamed calls)?',
      '- codegen: has the generated/copied code been updated to this tag?',
      'Read the default branch (origin/main) — `git -C <repo> show origin/main:<path>` — since local checkouts may be on other branches.',
      'Do NOT modify, commit or push anything. Use parallel subagents per target if it helps.',
      'Answer with one table — Target | Status (✅ done / ⚠️ partial / ❌ missing / ➖ n/a) | Evidence | What is left — then a short TODO list grouped by repo.',
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n')
}

let home = ''
let myRepo: string | null = null
let releasedThisTurn = false
let lastReminder = ''

const repoPath = (repo: string) => `${home}/${BASE_DIR}/${repo}`

async function git($: EngineInterface, repo: string, args: readonly string[], timeoutMs = 15_000): Promise<string> {
  const r = await $.process.run(['git', '-C', repoPath(repo), ...args], { timeoutMs }).catch(() => null)
  return r !== null && r.exitCode === 0 ? r.stdout : ''
}

async function init($: EngineInterface) {
  home = (await $.env.get('HOME')) ?? ''
  const r = await $.process.run(['git', 'remote', 'get-url', 'origin'], { timeoutMs: 5000 }).catch(() => null)
  myRepo = r !== null && r.exitCode === 0 ? repoFromRemote(r.stdout) : null
}

async function releases($: EngineInterface, repo: string): Promise<Release[]> {
  const out = await git($, repo, ['for-each-ref', '--sort=-creatordate', '--format=%(refname:short)|%(creatordate:iso-strict)', 'refs/tags'])
  return out
    .split('\n')
    .map(l => l.split('|'))
    .filter(([tag]) => tag !== undefined && isReleaseTag(tag))
    .map(([tag, date]) => ({ tag: tag as string, date: date ?? '' }))
}

async function defaultRef($: EngineInterface, repo: string): Promise<string> {
  return (await git($, repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim() || 'HEAD'
}

async function targetFacts($: EngineInterface, t: Target, since: string, version: string): Promise<TargetFacts> {
  const exists = (await git($, t.repo, ['rev-parse', '--git-dir'])).trim() !== ''
  if (!exists) return { ...t, exists, commits: [], pins: [], versionHits: null }
  const ref = await defaultRef($, t.repo)
  const specs = t.paths.map(p => `:(glob)${p}`)
  const log = await git($, t.repo, ['log', ref, `--since=${since}`, '--date=short', '--format=%h %ad %s', '--', ...specs])
  const pins = t.pin
    ? (await git($, t.repo, ['grep', '-n', '-E', t.pin, ref, '--', ...specs]))
        .split('\n')
        .filter(Boolean)
        .map(l => l.replace(`${ref}:`, '').replace(/\s+/g, ' ').trim())
    : []
  const hits = t.mentionsVersion
    ? (await git($, t.repo, ['grep', '-l', '-E', versionPattern(version), ref, '--', ...specs])).split('\n').filter(Boolean).length
    : null
  return { ...t, exists, commits: log.split('\n').filter(Boolean), pins, versionHits: hits }
}

async function gather($: EngineInterface, repo: string, tag?: string): Promise<Facts | string> {
  const spec = SDK_MAP[repo]
  if (spec === undefined) return `${repo} 不在 SDK 图里。可选：${Object.keys(SDK_MAP).join(', ')}`
  const repos = [...new Set([repo, ...spec.targets.map(t => t.repo)])]
  await Promise.all(repos.map(r => git($, r, ['fetch', '--quiet', '--tags', 'origin'], 30_000)))

  const all = await releases($, repo)
  const at = tag ? all.findIndex(r => r.tag === tag) : 0
  const release = all[at]
  if (release === undefined) return tag ? `${repo} 没有 tag ${tag}。` : `${repo} 还没有 v* 发版 tag。`
  const prev = all[at + 1] ?? null
  const range = prev ? `${prev.tag}..${release.tag}` : release.tag

  const changed = prev ? await git($, repo, ['diff', '--name-only', prev.tag, release.tag]) : ''
  const commits = await git($, repo, ['log', '--format=%h %s', range])
  const changelogText = spec.self.changelog ? await git($, repo, ['show', `${release.tag}:${spec.self.changelog}`]) : ''
  const version = bareVersion(release.tag)

  return {
    repo,
    path: repoPath(repo),
    release,
    prev,
    apiFiles: changed.split('\n').filter(f => f && isPublicApi(repo, f)),
    commits: commits.split('\n').filter(Boolean),
    changelog: spec.self.changelog ? changelogSection(changelogText, version) : null,
    targets: await Promise.all(spec.targets.map(t => targetFacts($, t, release.date, version))),
  }
}

/** Releases nobody has run /release-check on yet. A repo seen for the first time is just recorded. */
async function unchecked($: EngineInterface): Promise<{ repo: string; tag: string }[]> {
  const out: { repo: string; tag: string }[] = []
  for (const repo of Object.keys(SDK_MAP)) {
    const latest = (await releases($, repo))[0]
    if (latest === undefined) continue
    const checked = await $.store.get(`checked:${repo}`)
    if (checked === undefined) await $.store.set(`checked:${repo}`, latest.tag)
    else if (checked !== latest.tag) out.push({ repo, tag: latest.tag })
  }
  return out
}

async function remind($: EngineInterface) {
  const due = await unchecked($)
  const text = due.map(d => `${d.repo} ${d.tag}`).join('、')
  if (due.length === 0 || text === lastReminder) return
  lastReminder = text
  $.ui.toast(`📦 有新版本还没做发版核对：${text} → /release-check ${due[0]?.repo ?? ''}`, { timeoutMs: 12_000 })
}

async function runCheck($: EngineInterface, args: string): Promise<string> {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const factsOnly = words.includes('--facts')
  const [first, second] = words.filter(w => w !== '--facts')

  if (first === 'status' || (first === undefined && (myRepo === null || SDK_MAP[myRepo] === undefined))) {
    const rows: string[] = []
    for (const repo of Object.keys(SDK_MAP)) {
      const latest = (await releases($, repo))[0]
      const checked = await $.store.get(`checked:${repo}`)
      rows.push(
        latest
          ? `   ${checked === latest.tag ? '✅' : '📦'} ${repo.padEnd(28)} ${latest.tag.padEnd(16)} ${latest.date.slice(0, 10)}${checked === latest.tag ? '' : '  ← 未核对'}`
          : `   ➖ ${repo.padEnd(28)} (no v* tags)`,
      )
    }
    return ['🔗 SDK 发版核对状态（本地 tag）', ...rows, '', '/release-check <repo> [tag] [--facts]'].join('\n')
  }

  const repo = first ?? (myRepo as string)
  const facts = await gather($, repo, second)
  if (typeof facts === 'string') return facts
  await $.store.set(`checked:${repo}`, facts.release.tag)
  lastReminder = ''
  if (!factsOnly) {
    // Not awaited: the audit turn can start only after this command returns.
    void $.prompt.submit({ text: auditPrompt(facts) })
  }
  return `${formatFacts(facts)}\n\n${factsOnly ? '（只列事实；去掉 --facts 让 Claude 逐项核对）' : '🔍 已交给 Claude 做只读核对…'}`
}

function safely(work: Promise<unknown>) {
  return work.catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'release-check',
      description: '📦 After an SDK release: are the other SDKs, docs and examples caught up? (read-only)',
      argumentHint: '[repo|status] [tag] [--facts]',
    })
    await safely(init($))
    void safely(remind($))
    $.clock.every(10 * 60_000, () => void safely(remind($)))
    return next(e)
  })

  on('command.run', { command: 'release-check' }, async ($, e) => ({ text: await runCheck($, e.args) }))

  // Watch, never act: a release made in this session gets one reminder when the turn ends.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (RELEASE_COMMAND.test(e.command) && ran.deny === undefined && !ran.isError) releasedThisTurn = true
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && releasedThisTurn) {
      releasedThisTurn = false
      void safely(remind($))
    }
    return done
  })
}
