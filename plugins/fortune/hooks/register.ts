import type { EngineInterface, Register } from 'claude-code'

export const JOKES: readonly string[] = [
  '程序员最讨厌的两件事：写文档，和别人不写文档。',
  '代码能跑就别动它——跑不起来也别动，可能是它在思考。',
  '“这个 bug 很简单” —— 三天前的我',
  '世界上只有 10 种人：懂二进制的和不懂的。',
  '我的代码没有 bug，只有未被文档化的特性。',
  '删库跑路前，记得先 git push。',
  'It works on my machine. 那就把你的机器发给用户。',
  '两个难题：缓存失效、命名，以及差一错误。',
  '注释写着“临时方案”，git blame 显示 2019 年。',
  '产品经理：这个需求很简单，就加个按钮。',
  '递归的定义：见“递归”。',
  '周五下午的 deploy，周六早上的 incident。',
  '我不是在摸鱼，我在等 Claude 编译我的想法。',
  'TODO: 写完这个 TODO。',
  '测试全绿的那一刻，人生达到了巅峰。',
  'Claude 正在读你三年前写的代码，请保持冷静。',
  '最好的代码是没写的代码，其次是 Claude 写的代码。',
  'merge conflict 是两个平行宇宙在争夺现实。',
  'console.log 是最朴实无华的调试器。',
  '“我就改一行” —— 改动 47 个文件',
  '有些 bug 只在演示的时候出现，这叫观察者效应。',
  '先让它跑起来，再让它跑对，最后让它跑快。然后重写。',
  'Ctrl+C Ctrl+V 是生产力，Ctrl+Z 是后悔药。',
  '真正的全栈：从 CSS 居中到 GPU 显存爆炸。',
  '没有什么问题是重启解决不了的，如果有，就重启两次。',
  'README 写着“开箱即用”，箱子是焊死的。',
  'AI 不会取代程序员，但会取代不用 AI 的程序员（和他们的周末加班）。',
  '数字人会眨眼了，我的眼睛还在 debug。',
]

const GOOD: readonly string[] = [
  '重构', '写测试', '提 PR', '删死代码', '更新文档', '升级依赖', '和产品经理喝咖啡',
  'code review', '早点下班', '写 CHANGELOG', '对齐四端 SDK', '清理 TODO', '跑 benchmark', '补类型',
]
const BAD: readonly string[] = [
  '上线', 'force push', '改 shared-proto', '周会发言', '相信“很简单”', '直接改 main',
  '跳过测试', '半夜部署', '改别人的代码不说', '“顺手”改一下', '升级大版本', '动生产数据库',
]
const LANGS: readonly string[] = ['TypeScript', 'Kotlin', 'Swift', 'Python', 'Go', 'C++', 'Rust', 'SQL', 'Bash', 'Protobuf']

/** A small stable hash so a day's fortune is the same all day, in every session. */
export function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function pick<T>(list: readonly T[], seed: number, n: number): T[] {
  const out: T[] = []
  for (let i = 0; out.length < n && i < list.length * 4; i += 1) {
    const item = list[hash(`${seed}:${i}`) % list.length] as T
    if (!out.includes(item)) out.push(item)
  }
  return out
}

export type Fortune = { stars: number; good: string[]; bad: string[]; lang: string; hour: number }

export function fortuneOf(day: string, weekday: number): Fortune {
  const seed = hash(day)
  const good = pick(GOOD, seed, 2)
  const bad = pick(BAD, seed + 1, 2)
  // Friday never deploys.
  if (weekday === 5 && !bad.includes('上线')) bad[0] = '上线'
  return {
    stars: 1 + (seed % 5),
    good,
    bad,
    lang: LANGS[seed % LANGS.length] as string,
    hour: 9 + (seed % 12),
  }
}

export function formatFortune(f: Fortune): string {
  return [
    `🔮 今日运势 ${'★'.repeat(f.stars)}${'☆'.repeat(5 - f.stars)}`,
    `   宜：${f.good.join('、')}`,
    `   忌：${f.bad.join('、')}`,
    `   幸运语言：${f.lang} · 幸运 commit 时间：${f.hour}:00`,
  ].join('\n')
}

let rotation: { cancel: () => void } | null = null
let lastFortuneDay = ''

async function today($: EngineInterface): Promise<{ day: string; weekday: number }> {
  const d = new Date(await $.clock.now())
  return { day: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`, weekday: d.getDay() }
}

const JOKE = { plugin: 'fortune', key: 'joke' } as const

/** Today's jokes for this repo, written by Haiku; the built-in ones until they arrive. */
let jokes: readonly string[] = JOKES
let generating: Promise<void> | null = null
/** Where today's jokes came from, for /fortune. */
let jokeSource = '内置笑话（还没生成）'

/** One joke per line from the model → a clean list; too few means use the built-ins. */
export function parseJokes(text: string): string[] {
  const lines = text
    .split('\n')
    .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, '').replace(/^["'“「]|["'”」]$/g, '').trim())
    .filter(l => l.length >= 4 && l.length <= 70)
  return [...new Set(lines)].slice(0, 30)
}

async function repoInfo($: EngineInterface): Promise<{ repo: string; files: string }> {
  const cwd = await $.session.cwd()
  const r = await $.process.run(['git', 'remote', 'get-url', 'origin'], { timeoutMs: 5000 }).catch(() => null)
  const remote = r !== null && r.exitCode === 0 ? r.stdout.trim() : ''
  const repo = remote.replace(/\.git$/, '').split(/[/:]/).pop() || cwd.split('/').pop() || 'code'
  const entries = await $.fs.list(cwd).catch(() => [])
  return { repo, files: entries.map(f => f.name).filter(n => !n.startsWith('.')).slice(0, 40).join(', ') }
}

/** Loads today's jokes for this repo, writing them with Haiku the first time any session asks. */
function loadJokes($: EngineInterface): Promise<void> {
  generating ??= writeJokes($).finally(() => {
    generating = null
  })
  return generating
}

async function writeJokes($: EngineInterface) {
  try {
    const { day } = await today($)
    const { repo, files } = await repoInfo($)
    const key = `jokes:${day}:${repo}`
    const cached = (await $.store.get(key)) as string[] | undefined
    if (cached && cached.length >= 5) {
      jokes = cached
      jokeSource = `${repo} · Haiku 今天编的 ${cached.length} 条`
      return
    }
    const r = await $.model.complete({
      model: 'haiku',
      system:
        '你给程序员写冷笑话，显示在 AI 编程助手干活时的转圈提示后面。' +
        '每行一条，共 20 条，每条不超过 35 个字，中文为主，可以夹英文术语。' +
        '要贴合这个仓库的技术栈和日常（构建、依赖、调试、发版、code review、AI 写代码），好笑但不刻薄，不要重复梗。' +
        '只输出笑话本身：不要编号、不要引号、不要解释。',
      prompt: `仓库：${repo}\n顶层文件：${files}\n日期：${day}`,
      maxTokens: 1500,
      timeoutMs: 30_000,
    })
    if (!r.isAnswered) {
      jokeSource = `内置笑话（Haiku 没回：${r.reason}${'status' in r && r.status ? ` ${r.status}` : ''}）`
      return
    }
    const fresh = parseJokes(r.text)
    if (fresh.length < 5) {
      jokeSource = `内置笑话（Haiku 只给了 ${fresh.length} 条能用的）`
      return
    }
    jokes = fresh
    jokeSource = `${repo} · Haiku 今天编的 ${fresh.length} 条`
    await $.store.set(key, fresh)
    // Yesterday's batches are no use: keep the store small.
    for (const k of await $.store.keys()) {
      if (k.startsWith('jokes:') && !k.startsWith(`jokes:${day}:`)) await $.store.delete(k)
    }
  } catch (err) {
    jokeSource = `内置笑话（出错：${String(err).slice(0, 120)}）`
  }
}

async function joke($: EngineInterface) {
  const n = Math.floor((await $.clock.now()) / 10_000)
  await $.state.set(JOKE, `🎲 ${jokes[hash(String(n)) % jokes.length]}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'fortune', description: '🔮 Today\'s coding fortune', immediate: true })
    lastFortuneDay = String((await $.store.get('lastFortuneDay')) ?? '')
    void loadJokes($)
    return next(e)
  })

  on('command.run', { command: 'fortune' }, async $ => {
    const { day, weekday } = await today($)
    await loadJokes($)
    return { text: `${formatFortune(fortuneOf(day, weekday))}\n   今日笑话：${jokeSource}` }
  })

  on('prompt.submit', async ($, e, next) => {
    // The day's first prompt, across all sessions, gets the fortune.
    const { day, weekday } = await today($)
    if (day !== lastFortuneDay) {
      lastFortuneDay = day
      await $.store.set('lastFortuneDay', day)
      $.ui.toast(formatFortune(fortuneOf(day, weekday)), { timeoutMs: 10_000 })
    }
    // A session left open past midnight picks up the new day's batch.
    void loadJokes($)
    rotation?.cancel()
    void joke($)
    rotation = $.clock.every(10_000, () => void joke($))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      rotation?.cancel()
      rotation = null
      await $.state.set(JOKE, '')
    }
    return next(e)
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const { value: line = '' } = await $.state.get(JOKE)
    if (line === '') return next(e)
    // After the spinner's own words, never in their place.
    return next({ ...e, props: { ...e.props, suffix: `…  ${line}` } })
  })
}
