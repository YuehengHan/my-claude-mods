import { expect, test } from 'claude-code/testing'
import { dangerOf } from '../hooks/register.ts'

test('destructive git commands are caught', async () => {
  for (const c of [
    'git push --force',
    'git push -f origin feat/x',
    'git push origin +feat/x',
    'git push origin main',
    'git push origin HEAD:master',
    'git reset --hard HEAD~3',
    'git clean -fd',
    'git checkout .',
    'git restore .',
    'git branch -D old',
    'git stash clear',
    'rm -rf ~',
    'rm -rf / ',
  ]) {
    expect(dangerOf(c)).toBeDefined()
  }
})

test('everyday git is left alone', async () => {
  for (const c of [
    'git push',
    'git push --force-with-lease origin feat/x',
    'git push origin fix-main-bug',
    'git push && echo -f',
    'git reset HEAD~1',
    'git checkout feat/x',
    'git checkout -- src/a.ts',
    'git branch -d merged',
    'rm -rf node_modules',
    'rm -rf ./dist',
  ]) {
    expect(dangerOf(c)).toBeUndefined()
  }
})

test('the engine refuses a force push through the guard', async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' }))
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'git push --force origin main' } })
  expect(verdict.decision).toBe('deny')
  const ok = await $.tool.check({ tool: 'Bash', input: { command: 'git status' } })
  expect(ok.decision).toBe('allow')
})
