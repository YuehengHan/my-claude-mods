import type { EngineInterface, Register } from 'claude-code'

export type Pet = { name: string; xp: number; achievements: string[] }
type Mood = 'idle' | 'busy' | 'happy' | 'dizzy' | 'party' | 'asleep'

const KEY = 'pet'
const SLEEP_AFTER_MS = 15 * 60_000

const FACES: Record<Mood, string> = {
  idle: '(・ω・)',
  busy: '(•̀ᴗ•́)و',
  happy: '(^ω^)',
  dizzy: '(×_×)',
  party: '＼(^o^)／',
  asleep: '(-_-) zZ',
}

export const ACHIEVEMENTS: Record<string, string> = {
  hello: '👋 Hello world: first tool call together',
  streak10: '🔥 On a roll: 10 tool calls in a row without an error',
  streak50: '🌋 Unstoppable: 50 in a row without an error',
  green: '✅ Green: a test run passed',
  shipper: '📦 Shipper: made a git commit',
  owl: '🦉 Night owl: working between 1am and 5am',
  marathon: '🏃 Marathon: one turn ran over 10 minutes',
  phoenix: '🐦‍🔥 Phoenix: tests passed right after they failed',
  lv5: '⭐ Level 5',
  lv10: '🌟 Level 10',
}

/** Level n needs 25·n·(n+1) xp in total: 50, 150, 300, 500, ... */
export function levelOf(xp: number): { level: number; into: number; span: number } {
  let level = 1
  while (xp >= 25 * level * (level + 1)) level += 1
  const floor = 25 * (level - 1) * level
  return { level, into: xp - floor, span: 25 * level * (level + 1) - floor }
}

export function stageOf(level: number): string {
  return level >= 10 ? '🦅' : level >= 7 ? '🐔' : level >= 4 ? '🐥' : level >= 2 ? '🐣' : '🥚'
}

export function bar(into: number, span: number, width = 6): string {
  const full = Math.min(width, Math.floor((into / span) * width))
  return '▰'.repeat(full) + '▱'.repeat(width - full)
}

const isTestCommand = (c: string) =>
  /\b(test|tests|pytest|jest|vitest|mocha|gradle\w*\s+\S*test|go\s+test|cargo\s+test|xcodebuild\s+test)\b/.test(c)

let pet: Pet = { name: 'Mochi', xp: 0, achievements: [] }
let mood: Mood = 'idle'
let streak = 0
let lastActive = 0
let testsFailedLast = false

async function load($: EngineInterface): Promise<Pet> {
  const stored = (await $.store.get(KEY)) as Partial<Pet> | undefined
  return { name: stored?.name ?? 'Mochi', xp: stored?.xp ?? 0, achievements: stored?.achievements ?? [] }
}

let hideTimer: { cancel: () => void } | null = null

/** The pet keeps out of the status line except for news, shown for `ms`. */
function flash($: EngineInterface, ms = 20_000) {
  const { level, into, span } = levelOf(pet.xp)
  $.ui.status(`${stageOf(level)} ${pet.name} ${FACES[mood]}  Lv${level} ${bar(into, span)}${streak >= 5 ? `  🔥${streak}` : ''}`)
  hideTimer?.cancel()
  hideTimer = $.clock.after(ms, () => $.ui.status(undefined))
}

// Re-read before writing so several sessions feeding the same pet don't lose xp.
async function gain($: EngineInterface, xp: number, unlock: string[] = []) {
  const before = levelOf(pet.xp).level
  const fresh = await load($)
  const newOnes = unlock.filter(a => !fresh.achievements.includes(a))
  pet = { ...fresh, xp: fresh.xp + xp, achievements: [...fresh.achievements, ...newOnes] }
  const after = levelOf(pet.xp).level
  if (after >= 5 && !pet.achievements.includes('lv5')) newOnes.push('lv5'), pet.achievements.push('lv5')
  if (after >= 10 && !pet.achievements.includes('lv10')) newOnes.push('lv10'), pet.achievements.push('lv10')
  await $.store.set(KEY, pet)

  for (const a of newOnes) $.ui.toast(`🏆 ${ACHIEVEMENTS[a]}`, { timeoutMs: 6000 })
  if (after > before) {
    $.ui.toast(`🎉 ${pet.name} reached level ${after}! ${stageOf(after)}`, { timeoutMs: 6000 })
    void $.process.run(['afplay', '-v', '0.05', '/System/Library/Sounds/Hero.aiff'], { timeoutMs: 10_000 }).catch(() => undefined)
    mood = 'party'
  }
  if (newOnes.length > 0 || after > before) flash($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    pet = await load($)
    lastActive = await $.clock.now()
    await $.command.register({
      name: 'pet',
      description: 'See your pet and its achievements; `/pet name <name>` renames it',
      argumentHint: '[name <new name>]',
      immediate: true,
    })
    $.clock.every(60_000, () => {
      void $.clock.now().then(now => {
        if (mood !== 'asleep' && now - lastActive > SLEEP_AFTER_MS) mood = 'asleep'
      })
    })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const now = await $.clock.now()
    const wasAsleep = mood === 'asleep'
    lastActive = now
    mood = 'busy'
    if (wasAsleep) {
      mood = 'happy'
      flash($, 8000)
    }
    const hour = new Date(now).getHours()
    if (hour >= 1 && hour < 5) void gain($, 0, ['owl'])
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined || ran.deny !== undefined) return ran
    lastActive = await $.clock.now()

    if (ran.isError) {
      streak = 0
      if (e.tool === 'Bash' && isTestCommand(e.command)) testsFailedLast = true
      mood = 'dizzy'
      flash($, 8000)
      return ran
    }

    streak += 1
    const unlock = ['hello']
    let xp = 1
    if (streak === 10) unlock.push('streak10')
    if (streak === 50) unlock.push('streak50')
    if (e.tool === 'Bash' && isTestCommand(e.command)) {
      xp += 5
      unlock.push('green')
      if (testsFailedLast) unlock.push('phoenix')
      testsFailedLast = false
      mood = 'party'
    } else if (e.tool === 'Bash' && /\bgit\s+commit\b/.test(e.command)) {
      xp += 5
      unlock.push('shipper')
      mood = 'happy'
    } else {
      mood = 'busy'
    }
    void gain($, xp, unlock)
    if ([10, 25, 50, 100].includes(streak)) flash($, 10_000)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || e.isAborted) return done
    void gain($, 3, e.durationMs > 10 * 60_000 ? ['marathon'] : [])
    mood = e.reason === 'answer' ? (mood === 'dizzy' ? 'idle' : 'happy') : 'dizzy'
    return done
  })

  on('command.run', { command: 'pet' }, async ($, e) => {
    const m = /^(?:re)?name\s+(.+)$/.exec(e.args.trim())
    pet = await load($)
    if (m) {
      pet = { ...pet, name: (m[1] ?? '').trim().slice(0, 20) || pet.name }
      await $.store.set(KEY, pet)
      flash($, 8000)
      return { text: `Your pet is now called ${pet.name} ${FACES.happy}` }
    }
    const { level, into, span } = levelOf(pet.xp)
    const got = Object.keys(ACHIEVEMENTS)
      .map(k => (pet.achievements.includes(k) ? `  ${ACHIEVEMENTS[k]}` : '  🔒 ???'))
      .join('\n')
    return {
      text: [
        `${stageOf(level)} ${pet.name} ${FACES[mood]}`,
        `Level ${level} · ${pet.xp} xp (${into}/${span} to the next) · streak ${streak}`,
        `Achievements ${pet.achievements.length}/${Object.keys(ACHIEVEMENTS).length}:`,
        got,
      ].join('\n'),
    }
  })
}
