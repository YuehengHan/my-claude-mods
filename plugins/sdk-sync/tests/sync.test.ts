import { expect, test } from 'claude-code/testing'
import { bareVersion, globToRegExp, isPublicApi, isReleaseTag, mentions, repoFromRemote } from '../hooks/sdk-map.ts'
import { auditPrompt, changelogSection, formatFacts, signal } from '../hooks/register.ts'
import type { Facts, TargetFacts } from '../hooks/register.ts'

test('globs and public API surfaces', async () => {
  expect(globToRegExp('core/Avatar{,Controller}.ts').test('core/AvatarController.ts')).toBe(true)
  expect(globToRegExp('Facade/*.swift').test('Facade/Chat/ChatSession.swift')).toBe(false)
  expect(isPublicApi('web-sdk', 'facade/client.ts')).toBe(true)
  expect(isPublicApi('web-sdk', 'internal/foo.ts')).toBe(false)
  expect(isPublicApi('android-sdk', 'sdk/src/main/java/ai/spatialreal/android/facade/ContainerRegistry.kt')).toBe(false)
  expect(isPublicApi('ios-sdk', 'Sources/SpatialRealSDK/Facade/Chat/DebugMic.swift')).toBe(false)
  expect(isPublicApi('python-sdk', 'spatialreal/session.py')).toBe(true)
  expect(isPublicApi('shared-proto', 'cp/v1/sdk_agent.proto')).toBe(true)
})

test('release tags', async () => {
  expect(isReleaseTag('v1.0.0-beta.3')).toBe(true)
  expect(isReleaseTag('v0.3.40')).toBe(true)
  expect(isReleaseTag('facade-pre-rebase')).toBe(false)
  expect(bareVersion('v1.0.0-beta3')).toBe('1.0.0-beta3')
  expect(repoFromRemote('git@github.com:SpatialReal-ai/web-sdk.git')).toBe('web-sdk')
})

test('changelog sections', async () => {
  const text = '# Changelog\n\n## [1.0.0-beta.2] - 2026-10-08\n- mute()\n\n## [1.0.0-beta.1]\n- first\n'
  expect(changelogSection(text, '1.0.0-beta.2')).toBe('## [1.0.0-beta.2] - 2026-10-08\n- mute()')
  expect(changelogSection(text, '1.0.0-beta.9')).toBeNull()
})

const t = (o: Partial<TargetFacts>): TargetFacts => ({
  repo: 'android-sdk', kind: 'parity', why: 'port', paths: [], exists: true, commits: ['abc 2026-10-09 add mute'], pins: [], versionHits: null, ...o,
})

test('signals from the facts', async () => {
  expect(signal(t({}), '1.0.0-beta.2')).toBe('🟢 发版后有更新')
  expect(signal(t({ commits: [] }), '1.0.0-beta.2')).toContain('发版后没有相关提交')
  expect(signal(t({ versionHits: 0 }), '1.0.0-beta.2')).toContain('没提到 1.0.0-beta.2')
  expect(signal(t({ pins: ['agent/web/package.json:10: "@spatialreal/web-sdk": "^1.0.0-beta.1",'] }), '1.0.0-beta.2')).toContain('版本没跟到')
  expect(signal(t({ exists: false }), 'x')).toContain('没有这个仓库')
})

test('the report and the audit prompt', async () => {
  const facts: Facts = {
    repo: 'web-sdk', path: '/x/web-sdk',
    release: { tag: 'v1.0.0-beta.2', date: '2026-10-08T10:00:00+08:00' },
    prev: { tag: 'v1.0.0-beta.1', date: '2026-09-29T10:00:00+08:00' },
    apiFiles: ['facade/chat/chat-session.ts'], commits: ['abc add mute'], changelog: null,
    targets: [t({}), t({ repo: 'spatialreal-docs', kind: 'docs', commits: [], versionHits: 0 })],
  }
  const report = formatFacts(facts)
  expect(report).toContain('web-sdk v1.0.0-beta.2')
  expect(report).toContain('❌ 没有 1.0.0-beta.2 的条目')
  const prompt = auditPrompt(facts)
  expect(prompt).toContain('Read-only')
  expect(prompt).toContain('Do NOT modify')
  expect(prompt).toContain('git -C "/x/web-sdk" diff v1.0.0-beta.1..v1.0.0-beta.2')
})

test('versions match as whole words', async () => {
  expect(mentions('## [1.0.0-beta39]', '1.0.0-beta3')).toBe(false)
  expect(mentions('## [1.0.0-beta3] — 2026-10-08', '1.0.0-beta3')).toBe(true)
  expect(mentions('spatialreal = "1.0.0-beta2"', '1.0.0-beta3')).toBe(false)
  expect(changelogSection('## [1.0.0-beta39]\n- old\n', '1.0.0-beta3')).toBeNull()
})
