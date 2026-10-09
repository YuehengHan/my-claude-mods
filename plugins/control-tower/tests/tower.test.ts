import { expect, test } from 'claude-code/testing'
import { ago, arrange, headline } from '../hooks/register.tsx'
import type { TowerEntry } from '../types'

const NOW = 1_000_000_000
const s = (o: Partial<TowerEntry>): TowerEntry => ({
  id: 'x', repo: 'web-sdk', task: '', prompt: '', last: '', state: 'idle', since: NOW - 1000, updatedAt: NOW - 1000, ...o,
})

test('sessions needing you come first; gone ones drop out', async () => {
  const list = arrange(
    [
      s({ id: 'a', repo: 'android-sdk', state: 'done' }),
      s({ id: 'b', repo: 'backend-ng', state: 'waiting' }),
      s({ id: 'c', repo: 'ios-sdk', state: 'working' }),
      s({ id: 'd', repo: 'dead', state: 'working', updatedAt: NOW - 120_000 }),
      s({ id: 'e', repo: 'closed', state: 'ended' }),
    ],
    NOW,
  )
  expect(list.map(x => x.repo)).toEqual(['backend-ng', 'ios-sdk', 'android-sdk'])
})

test('the status line speaks only of other sessions', async () => {
  expect(headline([s({ id: 'me', state: 'waiting' })], 'me', NOW)).toBeUndefined()
  expect(headline([s({ id: 'b', repo: 'backend-ng', state: 'waiting' })], 'me', NOW)).toBe('🗼 ✋ backend-ng 在等你')
  expect(headline([s({ id: 'a', repo: 'android-sdk', state: 'done' })], 'me', NOW)).toBe('🗼 ✅ android-sdk 完成了')
  expect(headline([s({ id: 'a', state: 'done', since: NOW - 10 * 60_000 })], 'me', NOW)).toBeUndefined()
})

test('durations', async () => {
  expect(ago(42_000)).toBe('42s')
  expect(ago(5 * 60_000)).toBe('5m')
  expect(ago(90 * 60_000)).toBe('1h30m')
})
