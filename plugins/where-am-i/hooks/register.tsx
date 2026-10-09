import type { EngineInterface, Register } from 'claude-code'

import type { RepoInfo } from '../types'

const REPO = { plugin: 'where-am-i', key: 'repo' } as const
const TASK = { plugin: 'where-am-i', key: 'task' } as const

const basename = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path

export function parseStatus(out: string): Omit<RepoInfo, 'name'> {
  let branch: string | null = null
  let ahead = 0
  let behind = 0
  let dirty = 0
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim()
      branch = head === '(detached)' ? 'detached' : head
    } else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) {
        ahead = Number(m[1])
        behind = Number(m[2])
      }
    } else if (line.trim() !== '' && !line.startsWith('#')) {
      dirty += 1
    }
  }
  return { branch, dirty, ahead, behind }
}

async function refresh($: EngineInterface) {
  const cwd = await $.session.cwd()
  const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { timeoutMs: 5000 })
  if (top.exitCode !== 0) {
    await $.state.set(REPO, { name: basename(cwd), branch: null, dirty: 0, ahead: 0, behind: 0 })
    return
  }
  const status = await $.process.run(['git', 'status', '--porcelain=v2', '--branch'], { timeoutMs: 5000 })
  const info: RepoInfo = { name: basename(top.stdout.trim()), ...parseStatus(status.stdout) }
  await $.state.set(REPO, info)
}

function refreshQuietly($: EngineInterface) {
  return refresh($).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'task',
      description: "Name this session's task: shown above the prompt and in /tower, so you know what each session is for; empty clears it",
      argumentHint: '[what this session is doing]',
      immediate: true,
    })
    void refreshQuietly($)
    // Catch branch switches and commits made outside Claude (your own terminal).
    $.clock.every(20_000, () => void refreshQuietly($))
    return next(e)
  })

  on('command.run', { command: 'task' }, async ($, e) => {
    const text = e.args.trim()
    await $.state.set(TASK, text)
    return { text: text ? `🎯 Task: ${text}` : 'Task cleared.' }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) void refreshQuietly($)
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (/\bgit\b/.test(e.command)) void refreshQuietly($)
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { value: info = null } = await $.state.get(REPO)
    if (e.props.hasSurvey || info === null) return next(e)
    // Other mods' rows (control-tower) go beneath this one.
    const rest = await next(e)
    const { value: current = '' } = await $.state.get(TASK)
    const { Box, Text } = $.ui.resolve(e)

    const sync =
      (info.ahead ? ` ↑${info.ahead}` : '') + (info.behind ? ` ↓${info.behind}` : '')

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap">
          <Text bold color="claude">📁 {info.name}</Text>
          {info.branch !== null && (
            <Text color={info.branch === 'main' || info.branch === 'master' ? 'warning' : 'suggestion'}>
              {'  '}🌿 {info.branch}
              {sync}
            </Text>
          )}
          {info.branch !== null && (
            <Text color={info.dirty ? 'warning' : 'success'}>
              {'  '}
              {info.dirty ? `± ${info.dirty} changed` : '✓ clean'}
            </Text>
          )}
          <Text dimColor={!current}>
            {'  '}🎯 {current || '/task to name this task'}
          </Text>
        </Box>
        {rest}
      </Box>
    )
  })
}
