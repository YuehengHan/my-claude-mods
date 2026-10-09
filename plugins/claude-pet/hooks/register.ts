import type { EngineInterface, Register } from 'claude-code'

export type Pet = {
  name: string
  xp: number
  achievements: string[]
  /** A key of SPECIES; absent means chick. */
  species?: string
  /** Your own emojis: one for every stage, or one per stage in order. */
  custom?: string[]
}
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

/** Five stages each, reached at levels 1, 2, 4, 7 and 10. */
export const SPECIES: Record<string, { label: string; stages: readonly string[] }> = {
  chick: { label: '小鸡', stages: ['🥚', '🐣', '🐥', '🐔', '🦅'] },
  cat: { label: '猫', stages: ['🥚', '🐱', '😺', '🐈', '🦁'] },
  dog: { label: '狗', stages: ['🥚', '🐶', '🐕', '🦮', '🐺'] },
  dragon: { label: '龙', stages: ['🥚', '🦎', '🐊', '🐉', '🐲'] },
  dino: { label: '恐龙', stages: ['🥚', '🦎', '🦕', '🦖', '☄️'] },
  ocean: { label: '海洋', stages: ['🥚', '🐟', '🐠', '🐬', '🐳'] },
  bug: { label: '虫虫', stages: ['🥚', '🐛', '🐌', '🐞', '🦋'] },
  plant: { label: '植物', stages: ['🌰', '🌱', '🌿', '🪴', '🌳'] },
  robot: { label: '机器人', stages: ['🔩', '⚙️', '🤖', '🦾', '🛸'] },
  moon: { label: '月亮', stages: ['🌑', '🌒', '🌓', '🌔', '🌕'] },
}

export function stagesOf(pet: Pick<Pet, 'species' | 'custom'>): readonly string[] {
  const custom = pet.custom ?? []
  if (custom.length > 0) {
    // Spread 1–5 emojis over the five stages: one emoji is the whole life.
    return [0, 1, 2, 3, 4].map(i => custom[Math.floor((i * custom.length) / 5)] as string)
  }
  return (SPECIES[pet.species ?? 'chick'] ?? SPECIES.chick)!.stages
}

export function stageOf(level: number, stages: readonly string[] = SPECIES.chick!.stages): string {
  const i = level >= 10 ? 4 : level >= 7 ? 3 : level >= 4 ? 2 : level >= 2 ? 1 : 0
  return stages[i] ?? stages[stages.length - 1] ?? '🥚'
}

/** `🦊🐉` or `🦊 🐉` → ['🦊', '🐉'], whole emojis (ZWJ sequences, flags) kept together. */
export function splitEmojis(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (t: string) => Iterable<{ segment: string }> } }).Segmenter
  if (words.length !== 1 || Seg === undefined) return words.slice(0, 5)
  return [...new Seg(undefined, { granularity: 'grapheme' }).segment(words[0] as string)].map(g => g.segment).slice(0, 5)
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
  return {
    name: stored?.name ?? 'Mochi',
    xp: stored?.xp ?? 0,
    achievements: stored?.achievements ?? [],
    species: stored?.species,
    custom: stored?.custom,
  }
}

let hideTimer: { cancel: () => void } | null = null

/** The pet keeps out of the status line except for news, shown for `ms`. */
function flash($: EngineInterface, ms = 20_000) {
  const { level, into, span } = levelOf(pet.xp)
  $.ui.status(`${stageOf(level, stagesOf(pet))} ${pet.name} ${FACES[mood]}  Lv${level} ${bar(into, span)}${streak >= 5 ? `  🔥${streak}` : ''}`)
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
    $.ui.toast(`🎉 ${pet.name} reached level ${after}! ${stageOf(after, stagesOf(pet))}`, { timeoutMs: 6000 })
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
      description: 'Your pet: stats and achievements; rename it, pick a species or your own emojis',
      argumentHint: '[name <name> | species [<kind>] | emoji <emoji…> | emoji reset]',
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
    const args = e.args.trim()
    pet = await load($)
    const save = async (next: Pet, text: string) => {
      pet = next
      await $.store.set(KEY, pet)
      flash($, 8000)
      return { text }
    }

    const named = /^(?:re)?name\s+(.+)$/.exec(args)
    if (named) return save({ ...pet, name: (named[1] ?? '').trim().slice(0, 20) || pet.name }, `Your pet is now called ${(named[1] ?? '').trim().slice(0, 20) || pet.name} ${FACES.happy}`)

    const kind = /^species(?:\s+(\S+))?$/.exec(args)
    if (kind) {
      const want = kind[1]
      if (want === undefined || SPECIES[want] === undefined) {
        const current = pet.custom?.length ? '' : pet.species ?? 'chick'
        const list = Object.entries(SPECIES).map(
          ([key, s]) => `  ${key === current ? '▸' : ' '} ${key.padEnd(8)} ${s.stages.join(' → ')}  ${s.label}`,
        )
        return { text: [`${want ? `No species "${want}". ` : ''}Pick one with /pet species <kind>:`, ...list, '', 'Or your own: /pet emoji 🦊  ·  /pet emoji 🥚 🐣 🦊 🐺 🐉'].join('\n') }
      }
      const { level } = levelOf(pet.xp)
      const next = { ...pet, species: want, custom: undefined }
      return save(next, `${pet.name} is now a ${SPECIES[want]!.label}: ${stageOf(level, stagesOf(next))}  (${SPECIES[want]!.stages.join(' → ')})`)
    }

    const emoji = /^emoji\s+(.+)$/.exec(args)
    if (emoji) {
      if (emoji[1]?.trim() === 'reset') return save({ ...pet, custom: undefined }, `${pet.name} is back to its species.`)
      const custom = splitEmojis(emoji[1] ?? '')
      if (custom.length === 0) return { text: 'Usage: /pet emoji 🦊   or   /pet emoji 🥚 🐣 🦊 🐺 🐉' }
      const next = { ...pet, custom }
      return save(next, `${pet.name}'s stages: ${stagesOf(next).join(' → ')}`)
    }

    const { level, into, span } = levelOf(pet.xp)
    const stages = stagesOf(pet)
    const got = Object.keys(ACHIEVEMENTS)
      .map(k => (pet.achievements.includes(k) ? `  ${ACHIEVEMENTS[k]}` : '  🔒 ???'))
      .join('\n')
    return {
      text: [
        `${stageOf(level, stages)} ${pet.name} ${FACES[mood]}`,
        `Level ${level} · ${pet.xp} xp (${into}/${span} to the next) · streak ${streak}`,
        `Growth: ${stages.map((s, i) => (s === stageOf(level, stages) && [1, 2, 4, 7, 10][i]! <= level ? `[${s}]` : s)).join(' → ')}`,
        `Achievements ${pet.achievements.length}/${Object.keys(ACHIEVEMENTS).length}:`,
        got,
        '',
        '/pet name <name> · /pet species · /pet emoji <emoji…>',
      ].join('\n'),
    }
  })
}
