import { expect, test } from 'claude-code/testing'
import { ago, arrange, bannerOf, guessNeed, nameOf, parseNeed, sessionLink } from '../hooks/register.tsx'
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

test('the banner lists only other sessions waiting for you', async () => {
  expect(bannerOf([s({ id: 'me', state: 'waiting' })], 'me', NOW)).toEqual([])
  const b = bannerOf(
    [
      s({ id: 'me', state: 'working' }),
      s({ id: 'a', repo: 'android-sdk', state: 'done' }),
      s({ id: 'b', repo: 'backend-ng', state: 'waiting', since: NOW - 120_000 }),
      s({ id: 'c', repo: 'ios-sdk', state: 'working' }),
      s({ id: 'd', repo: 'web-sdk', state: 'failed' }),
    ],
    'me',
    NOW,
  )
  expect(b).toEqual([{ id: 'b', hostId: undefined, since: NOW - 120_000, repo: 'backend-ng', age: '2m', icon: '✋', label: '在等你', what: '' }])
})

test('durations', async () => {
  expect(ago(42_000)).toBe('42s')
  expect(ago(5 * 60_000)).toBe('5m')
  expect(ago(90 * 60_000)).toBe('1h30m')
})

test('sessions are named by repo, with the branch in a worktree', async () => {
  expect(nameOf('https://github.com/SpatialReal-ai/backend-ng.git', 'backend-ng', 'main')).toBe('backend-ng')
  expect(nameOf('git@github.com:SpatialReal-ai/backend-ng.git', 'backend-sdk-error-codes-54b535', 'fix/error-codes')).toBe('backend-ng · fix/error-codes')
  expect(nameOf('', 'scratch', 'main')).toBe('scratch')
})

test('the banner says what each session wants', async () => {
  const b = bannerOf(
    [
      s({ id: 'a', repo: 'web-sdk', state: 'waiting', need: { kind: 'command', what: '/reload-plugins' } }),
      s({ id: 'b', repo: 'ios-sdk', state: 'waiting', need: { kind: 'decision', what: '选方案 A 还是 B' } }),
    ],
    'me',
    NOW,
  )
  expect(b.map(i => `${i.icon} ${i.repo} ${i.label}：${i.what}`)).toEqual([
    '⌨️ web-sdk 要你执行：/reload-plugins',
    '🤔 ios-sdk 等你决定：选方案 A 还是 B',
  ])
})

test("Haiku's verdict is read, and nonsense ignored", async () => {
  expect(parseNeed('{"kind":"command","what":"/reload-plugins"}')).toEqual({ kind: 'command', what: '/reload-plugins' })
  expect(parseNeed('好的：\n{"kind":"action","what":"Cmd+Q 重启 app"}')).toEqual({ kind: 'action', what: 'Cmd+Q 重启 app' })
  expect(parseNeed('{"kind":"none","what":""}')).toBeNull()
  expect(parseNeed('not json')).toBeNull()
})

test('without the model: a command to run, or a closing question', async () => {
  expect(guessNeed('改好了。请依次跑：\n```\n/reload-plugins\n```')).toEqual({ kind: 'command', what: '/reload-plugins' })
  expect(guessNeed('两个方案。\n要我按建议改一下 /task 吗？')).toEqual({ kind: 'question', what: '要我按建议改一下 /task 吗？' })
  expect(guessNeed('全部完成，测试通过。')).toBeNull()
})

test('only a desktop session id makes a link', async () => {
  expect(sessionLink('local_d5473dcf-9b27-43fa-8427-3e74b80204e2')).toBe('claude://code/continue?session=local_d5473dcf-9b27-43fa-8427-3e74b80204e2')
  expect(sessionLink(undefined)).toBeNull()
  expect(sessionLink('5f431199-ef67-436b-9e96-e8581a869130')).toBeNull()
  expect(sessionLink('local_x; rm -rf ~')).toBeNull()
})

test('a dismissed wait leaves the banner until the session waits again', async () => {
  const waiting = s({ id: 'b', repo: 'backend-ng', state: 'waiting', since: NOW - 60_000 })
  expect(bannerOf([waiting], 'me', NOW, { b: NOW - 60_000 })).toEqual([])
  // A new wait has a new since: it is back.
  expect(bannerOf([{ ...waiting, since: NOW - 5_000 }], 'me', NOW, { b: NOW - 60_000 }).map(i => i.repo)).toEqual(['backend-ng'])
})
