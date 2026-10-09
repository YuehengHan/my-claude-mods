import type { Register } from 'claude-code'

/** Answers shorter than this are their own TL;DR. */
export const MIN_CHARS = 400
const MODEL = 'haiku'

const SYSTEM = [
  'You write the one-line TL;DR shown under a coding assistant\'s reply.',
  'Say what was done and how it ended (fixed? tests green? waiting on the user? blocked?).',
  'Write in the same language as the reply. At most 40 Chinese characters or 25 English words.',
  'Output only the line: no prefix, no quotes, no markdown.',
].join(' ')

export function needsTldr(answer: string): boolean {
  return answer.trim().length >= MIN_CHARS
}

export function clean(text: string): string {
  return text
    .replace(/^\s*(tl;?dr[:：]?\s*)/i, '')
    .replace(/^["'“”「」]+|["'“”「」]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || e.isAborted || e.reason !== 'answer' || !needsTldr(e.answer)) return done

    const reply = e.answer.length > 8000 ? `${e.answer.slice(0, 4000)}\n…\n${e.answer.slice(-4000)}` : e.answer
    const r = await $.model.complete({ model: MODEL, system: SYSTEM, prompt: reply, maxTokens: 120, timeoutMs: 10_000 })
    if (!r.isAnswered) return done
    const line = clean(r.text)
    return line ? { ...done, text: `💡 TL;DR：${line}` } : done
  })
}
