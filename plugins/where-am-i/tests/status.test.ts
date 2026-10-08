import { expect, test } from 'claude-code/testing'
import { parseStatus } from '../hooks/register.tsx'

test('reads branch, ahead/behind and dirty count from porcelain v2', async () => {
  const out = [
    '# branch.oid abc',
    '# branch.head feat/ws-reconnect',
    '# branch.upstream origin/feat/ws-reconnect',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 a b src/a.ts',
    '? new.txt',
    '',
  ].join('\n')
  expect(parseStatus(out)).toEqual({ branch: 'feat/ws-reconnect', dirty: 2, ahead: 2, behind: 1 })
})

test('a detached head and a clean tree', async () => {
  expect(parseStatus('# branch.head (detached)\n')).toEqual({ branch: 'detached', dirty: 0, ahead: 0, behind: 0 })
})
