import { expect, test } from 'claude-code/testing'
import { SPECIES, bar, levelOf, splitEmojis, stageOf, stagesOf } from '../hooks/register.ts'

test('levels need 50, 150, 300 ... xp', async () => {
  expect(levelOf(0)).toEqual({ level: 1, into: 0, span: 50 })
  expect(levelOf(49).level).toBe(1)
  expect(levelOf(50)).toEqual({ level: 2, into: 0, span: 100 })
  expect(levelOf(300).level).toBe(4)
})

test('the pet hatches and grows', async () => {
  expect(stageOf(1)).toBe('🥚')
  expect(stageOf(2)).toBe('🐣')
  expect(stageOf(4)).toBe('🐥')
  expect(stageOf(10)).toBe('🦅')
})

test('the xp bar fills', async () => {
  expect(bar(0, 50)).toBe('▱▱▱▱▱▱')
  expect(bar(25, 50)).toBe('▰▰▰▱▱▱')
  expect(bar(60, 50)).toBe('▰▰▰▰▰▰')
})

test('species and your own emojis', async () => {
  expect(stagesOf({})).toEqual(SPECIES.chick!.stages)
  expect(stageOf(4, stagesOf({ species: 'cat' }))).toBe('😺')
  expect(stagesOf({ custom: ['🦊'] })).toEqual(['🦊', '🦊', '🦊', '🦊', '🦊'])
  expect(stagesOf({ custom: ['🥚', '🦊'] })).toEqual(['🥚', '🥚', '🥚', '🦊', '🦊'])
  expect(stagesOf({ custom: ['1', '2', '3', '4', '5'] })).toEqual(['1', '2', '3', '4', '5'])
  expect(stagesOf({ species: 'nope' })).toEqual(SPECIES.chick!.stages)
  expect(splitEmojis('🦊 🐉')).toEqual(['🦊', '🐉'])
  expect(splitEmojis('🦊🐉👨‍💻')).toEqual(['🦊', '🐉', '👨‍💻'])
})
