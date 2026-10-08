import { expect, test } from 'claude-code/testing'
import { formatDuration, snippet } from '../hooks/register.ts'

test('durations read as seconds, then minutes', async () => {
  expect(formatDuration(42_000)).toBe('42s')
  expect(formatDuration(133_000)).toBe('2m13s')
})

test('the prompt is cut to one short line', async () => {
  expect(snippet('fix the\n  websocket   reconnect')).toBe('fix the websocket reconnect')
  expect(snippet('x'.repeat(100), 10)).toBe('xxxxxxxxx…')
})
