import { expect, test } from 'claude-code/testing'
import { JOKES, formatFortune, fortuneOf } from '../hooks/register.ts'

test('a day has one fortune', async () => {
  expect(fortuneOf('2026-10-9', 5)).toEqual(fortuneOf('2026-10-9', 5))
})

test('Friday never deploys', async () => {
  for (const day of ['2026-10-9', '2026-10-16', '2026-10-23', '2026-10-30']) {
    expect(fortuneOf(day, 5).bad).toContain('上线')
  }
})

test('the fortune reads well', async () => {
  const text = formatFortune(fortuneOf('2026-10-9', 5))
  expect(text).toContain('宜：')
  expect(text).toContain('忌：')
  expect(JOKES.length).toBeGreaterThan(20)
})
