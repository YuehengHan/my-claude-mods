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
