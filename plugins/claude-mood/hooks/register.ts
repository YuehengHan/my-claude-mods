import type { EngineInterface, Register } from 'claude-code'

export type Tally = { reads: number; edits: number; runs: number; errors: number; agents: number }

const READ_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'LS']
const EDIT_TOOLS: readonly string[] = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']

const empty = (): Tally => ({ reads: 0, edits: 0, runs: 0, errors: 0, agents: 0 })

let tally: Tally = empty()
let current = ''

const isTest = (c: string) => /\b(test|tests|pytest|jest|vitest|go\s+test|cargo\s+test)\b/.test(c)

/** The mood while a turn runs: errors weigh most, then what the turn mostly does. */
export function workingMood(t: Tally, now: string): string {
  if (t.errors >= 5) return '😵‍💫 头晕了'
  if (t.errors >= 3) return '😤 有点烦躁'
  if (now === 'test') return '🧪 紧张地跑测试'
  if (now === 'agent' || t.agents >= 2) return '🧑‍🤝‍🧑 在摇人帮忙'
  if (t.edits >= 10 && t.errors === 0) return '🔥 手感火热'
  if (t.reads >= 15 && t.edits === 0) return '🧐 深度调研中'
  if (t.edits > 0 && t.edits >= t.reads) return '✍️ 奋笔疾书'
  if (t.reads > 0) return '🤔 在读代码'
  return '💭 思考中'
}

export function doneMood(t: Tally, reason: string, aborted: boolean): string {
  if (aborted) return '🫢 被打断了'
  if (reason !== 'answer') return '😭 挂了'
  if (t.errors >= 3) return '😮‍💨 磕磕绊绊，总算搞定'
  if (t.edits >= 10) return '😎 大干一场'
  if (t.edits === 0 && t.reads === 0 && t.runs === 0) return '😊 随口一答'
  return '😌 搞定'
}

export function counts(t: Tally): string {
  const parts = [
    t.reads ? `📖${t.reads}` : '',
    t.edits ? `✏️${t.edits}` : '',
    t.runs ? `⚡${t.runs}` : '',
    t.errors ? `💥${t.errors}` : '',
  ].filter(Boolean)
  return parts.length ? `  ${parts.join(' ')}` : ''
}

function show($: EngineInterface, mood: string) {
  $.ui.status(`${mood}${counts(tally)}`)
}

export const register: Register = on => {
  on('prompt.submit', ($, e, next) => {
    tally = empty()
    current = ''
    show($, workingMood(tally, current))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    current = tool === 'Agent' || tool === 'Task' ? 'agent' : e.tool === 'Bash' && isTest(e.command) ? 'test' : ''
    if (current === 'agent') tally.agents += 1
    show($, workingMood(tally, current))

    const ran = await next(e)
    if (ran.deny === undefined) {
      if (READ_TOOLS.includes(tool)) tally.reads += 1
      else if (EDIT_TOOLS.includes(tool)) tally.edits += 1
      else if (tool === 'Bash') tally.runs += 1
      if (ran.isError) tally.errors += 1
    }
    current = ''
    show($, workingMood(tally, current))
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) show($, doneMood(tally, e.reason, e.isAborted))
    return done
  })
}
