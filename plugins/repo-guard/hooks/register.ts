import type { EngineInterface, Register } from 'claude-code'

// One shell segment: stops at ; & | and newlines so `git push && echo -f` is not a force push.
const SEG = '[^;&|\\n]*'

export const DANGER: ReadonlyArray<readonly [RegExp, string]> = [
  [new RegExp(`\\bgit\\s+push\\b${SEG}\\s(--force(?!-with-lease)|-f\\b|\\+\\S)`), 'force push (use --force-with-lease, or run it yourself)'],
  [new RegExp(`\\bgit\\s+push\\b${SEG}[\\s:](main|master)(\\s|$|[;&|])`), 'pushing straight to main/master'],
  [new RegExp(`\\bgit\\s+reset\\b${SEG}\\s--hard\\b`), 'git reset --hard throws away uncommitted work'],
  [new RegExp(`\\bgit\\s+clean\\b${SEG}\\s-[a-zA-Z]*f`), 'git clean -f deletes untracked files'],
  [new RegExp(`\\bgit\\s+(checkout|restore)\\b${SEG}\\s\\.(\\s|$|[;&|])`), 'discarding every uncommitted change'],
  [new RegExp(`\\bgit\\s+branch\\b${SEG}\\s-D\\b`), 'force-deleting a branch'],
  [new RegExp(`\\bgit\\s+stash\\s+(drop|clear)\\b`), 'dropping stashes'],
  [/\brm\s+-[a-zA-Z]*[rR][a-zA-Z]*\s+(\/|~|\$HOME)\/?(\s|$|\*)/, 'rm -r on / or your home directory'],
]

export function dangerOf(command: string): string | undefined {
  return DANGER.find(([re]) => re.test(command))?.[1]
}

const EDIT_TOOLS: readonly string[] = ['Edit', 'Write', 'NotebookEdit']
const isEditTool = (tool: string) => EDIT_TOOLS.includes(tool)
const basename = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path
const parent = (path: string) => path.replace(/\/[^/]*\/?$/, '') || '/'

let sessionRoot: string | null | undefined
const approved = new Set<string>()

/** The nearest folder above `path` holding .git, or null outside any repo. */
async function repoRoot($: EngineInterface, path: string): Promise<string | null> {
  for (let dir = parent(path); dir !== '/' && dir !== ''; dir = parent(dir)) {
    if (await $.fs.exists(`${dir}/.git`)) return dir
  }
  return null
}

async function ownRoot($: EngineInterface): Promise<string | null> {
  if (sessionRoot === undefined) {
    const cwd = await $.session.cwd()
    sessionRoot = await repoRoot($, `${cwd}/.`)
  }
  return sessionRoot
}

async function foreignRoot($: EngineInterface, input: unknown): Promise<string | null> {
  const args = input as { file_path?: string; notebook_path?: string }
  const path = args.file_path ?? args.notebook_path
  if (typeof path !== 'string' || !path.startsWith('/')) return null
  const root = await repoRoot($, path)
  if (root === null || approved.has(root) || root === (await ownRoot($))) return null
  return root
}

export const register: Register = on => {
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const command = (e.input as { command?: string }).command ?? ''
    const why = dangerOf(command)
    if (why === undefined) return next(e)
    $.ui.toast(`🛡 repo-guard blocked: ${why}`)
    return {
      decision: 'deny',
      reason: `repo-guard: blocked (${why}). If it is really needed, ask the user to run it themselves.`,
    }
  }).catch(($, e, next) => next(e))

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (!isEditTool(e.tool) || verdict.decision === 'deny') return verdict
    const root = await foreignRoot($, e.input)
    if (root === null) return verdict
    const own = await ownRoot($)
    return {
      decision: 'ask',
      reason: `repo-guard: this edits ${basename(root)}, a different repo from this session's ${own ? basename(own) : 'folder'}. Allow edits there?`,
    }
  }).catch(($, e, next) => next(e))

  // Once an edit in another repo has gone through, stop asking for that repo.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (!isEditTool(e.tool) || ran.deny !== undefined || ran.isError) return ran
    const root = await foreignRoot($, e).catch(() => null)
    if (root !== null) {
      approved.add(root)
      $.ui.toast(`🛡 Now editing another repo: ${basename(root)}`)
    }
    return ran
  })
}
