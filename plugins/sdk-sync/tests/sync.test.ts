import { expect, test } from 'claude-code/testing'
import { globToRegExp, isPublicApi, repoFromRemote } from '../hooks/sdk-map.ts'
import { contextFor, describeItem, isOpen } from '../hooks/register.ts'
import type { SyncItem } from '../hooks/register.ts'

test('globs', async () => {
  expect(globToRegExp('facade/**').test('facade/chat/chat-session.ts')).toBe(true)
  expect(globToRegExp('core/Avatar{,Controller}.ts').test('core/Avatar.ts')).toBe(true)
  expect(globToRegExp('core/Avatar{,Controller}.ts').test('core/AvatarController.ts')).toBe(true)
  expect(globToRegExp('core/Avatar{,Controller}.ts').test('core/AvatarRenderer.ts')).toBe(false)
  expect(globToRegExp('**/*.proto').test('driveningress/v2/driveningress.proto')).toBe(true)
  expect(globToRegExp('Facade/*.swift').test('Facade/Chat/ChatSession.swift')).toBe(false)
})

test('public API surfaces', async () => {
  expect(isPublicApi('web-sdk', 'facade/client.ts')).toBe(true)
  expect(isPublicApi('web-sdk', 'index.ts')).toBe(true)
  expect(isPublicApi('web-sdk', 'internal/foo.ts')).toBe(false)
  expect(isPublicApi('web-sdk', 'generated/driveningress.ts')).toBe(false)
  expect(isPublicApi('android-sdk', 'sdk/src/main/java/ai/spatialreal/android/facade/AvatarSession.kt')).toBe(true)
  expect(isPublicApi('android-sdk', 'sdk/src/main/java/ai/spatialreal/android/facade/ContainerRegistry.kt')).toBe(false)
  expect(isPublicApi('android-sdk', 'sdk/src/main/java/ai/spatialreal/android/model/Foo.java')).toBe(false)
  expect(isPublicApi('ios-sdk', 'Sources/SpatialRealSDK/Facade/AvatarSession.swift')).toBe(true)
  expect(isPublicApi('ios-sdk', 'Sources/SpatialRealSDK/Facade/Chat/DebugMic.swift')).toBe(false)
  expect(isPublicApi('ios-sdk', 'Sources/SpatialRealSDK/Internal/Foo.swift')).toBe(false)
  expect(isPublicApi('python-sdk', 'spatialreal/session.py')).toBe(true)
  expect(isPublicApi('python-sdk', 'spatialreal/environments.py')).toBe(false)
  expect(isPublicApi('shared-proto', 'cp/v1/sdk_agent.proto')).toBe(true)
  expect(isPublicApi('backend-ng', 'internal/x.go')).toBe(false)
})

test('repos are named by their remote', async () => {
  expect(repoFromRemote('https://github.com/SpatialReal-ai/web-sdk.git\n')).toBe('web-sdk')
  expect(repoFromRemote('git@github.com:SpatialReal-ai/backend-ng.git')).toBe('backend-ng')
})

test('the model is told who follows', async () => {
  const text = contextFor('web-sdk', 'facade/client.ts')
  expect(text).toContain('android-sdk')
  expect(text).toContain('ios-sdk')
  expect(text).toContain('spatialreal-docs')
  expect(text).toContain('SDK sync')
  expect(contextFor('shared-proto', 'cp/v1/x.proto')).toContain('MANUAL')
})

test('an item lists its targets and marks this repo', async () => {
  const item: SyncItem = {
    id: 'web-sdk-abcd1234', from: 'web-sdk', session: 's', files: ['facade/client.ts'], at: 0,
    summary: '新增 ChatSession.mute()', diff: '',
    targets: [
      { repo: 'android-sdk', why: 'facade port', paths: [], status: 'pending' },
      { repo: 'ios-sdk', why: 'facade port', paths: [], status: 'done' },
    ],
  }
  const text = describeItem(item, 'android-sdk', 30 * 60_000)
  expect(text).toContain('#1234')
  expect(text).toContain('⭐')
  expect(text).toContain('新增 ChatSession.mute()')
  expect(isOpen(item)).toBe(true)
  expect(isOpen({ ...item, targets: item.targets.map(t => ({ ...t, status: 'done' as const })) })).toBe(false)
})
