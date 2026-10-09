import { expect, test } from 'claude-code/testing'
import { clean, needsTldr } from '../hooks/register.ts'

test('short answers get no TL;DR', async () => {
  expect(needsTldr('好的。')).toBe(false)
  expect(needsTldr('x'.repeat(500))).toBe(true)
})

test('the model line is tidied', async () => {
  expect(clean('TL;DR: 修好了重连，测试全绿')).toBe('修好了重连，测试全绿')
  expect(clean('“修好了重连”')).toBe('修好了重连')
})

test('a long answer gets a line from the model beneath it', async ($, on) => {
  on('model.complete', () => ({
    value: { isAnswered: true, text: 'TL;DR：修好了重连', usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  }))
  on('turn.complete', () => ({ text: '' }))
  const r = await $.turn.complete({ answer: 'x'.repeat(600), durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer' })
  expect(r.text).toBe('💡 TL;DR：修好了重连')
})
