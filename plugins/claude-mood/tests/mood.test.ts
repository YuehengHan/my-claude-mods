import { expect, test } from 'claude-code/testing'
import { counts, doneMood, workingMood } from '../hooks/register.ts'

const t = (o: Partial<{ reads: number; edits: number; runs: number; errors: number; agents: number }>) => ({
  reads: 0, edits: 0, runs: 0, errors: 0, agents: 0, ...o,
})

test('errors outweigh everything else', async () => {
  expect(workingMood(t({ edits: 20, errors: 5 }), '')).toBe('😵‍💫 头晕了')
  expect(workingMood(t({ errors: 3 }), 'test')).toBe('😤 有点烦躁')
})

test('the mood follows what the turn mostly does', async () => {
  expect(workingMood(t({}), '')).toBe('💭 思考中')
  expect(workingMood(t({ reads: 3 }), '')).toBe('🤔 在读代码')
  expect(workingMood(t({ reads: 20 }), '')).toBe('🧐 深度调研中')
  expect(workingMood(t({ reads: 2, edits: 4 }), '')).toBe('✍️ 奋笔疾书')
  expect(workingMood(t({ edits: 12 }), '')).toBe('🔥 手感火热')
  expect(workingMood(t({}), 'test')).toBe('🧪 紧张地跑测试')
})

test('how a turn ended', async () => {
  expect(doneMood(t({ reads: 1 }), 'answer', false)).toBe('😌 搞定')
  expect(doneMood(t({}), 'answer', false)).toBe('😊 随口一答')
  expect(doneMood(t({ errors: 4 }), 'answer', false)).toBe('😮‍💨 磕磕绊绊，总算搞定')
  expect(doneMood(t({}), 'error', false)).toBe('😭 挂了')
  expect(doneMood(t({}), 'aborted', true)).toBe('🫢 被打断了')
  expect(counts(t({ reads: 3, errors: 1 }))).toBe('  📖3 💥1')
})
