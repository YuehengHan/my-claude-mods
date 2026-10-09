// The SpatialReal SDK graph: which files are each repo's public API, and which
// repos must follow when they change. Repos are named by their GitHub remote, so
// worktrees (backend-ng-m1-transcript) and submodules (clients/web-sdk) resolve
// to the repo they are a copy of.

export type Target = {
  repo: string
  /** Why this repo follows, in a few words. */
  why: string
  /** Where to look in that repo. */
  paths: readonly string[]
}

export type RepoSpec = {
  /** Public API, as globs relative to the repo root. */
  api: readonly string[]
  /** Inside `api`, but not public. */
  exclude?: readonly string[]
  /** Files in the repo itself to update alongside an API change. */
  selfChecks: readonly string[]
  /** One line the model reads about this repo's role. */
  note: string
  targets: readonly Target[]
}

const ANDROID = 'sdk/src/main/java/ai/spatialreal/android'
const IOS = 'Sources/SpatialRealSDK'

const SHARED_DOCS: Target = {
  repo: 'spatialreal-docs',
  why: 'cross-SDK pages',
  paths: [
    'resources/error-codes.mdx',
    'resources/client-error.mdx',
    'resources/migration-guide.mdx',
    'overview/changelog.mdx',
    'avatar-integration/host-mode/client.mdx',
  ],
}

export const SDK_MAP: Record<string, RepoSpec> = {
  'web-sdk': {
    api: [
      'index.ts',
      'facade/**',
      'agent/**',
      'types/**',
      'core/Avatar{,Controller,SDK,Manager,View}.ts',
      'config/environments.ts',
      'audio/audio-context.ts',
      'vite.ts',
      'next.ts',
    ],
    selfChecks: ['CHANGELOG.md', 'README.md', 'docs/public-api-design.md'],
    note: 'Web SDK is the reference implementation; Android and iOS port its facade (docs/release-workflow.md: run the cross-SDK alignment check). Removed APIs must be kept and wrapped with deprecate() (utils/deprecation.ts).',
    targets: [
      { repo: 'android-sdk', why: 'facade port of Web', paths: [`${ANDROID}/facade/**`, `${ANDROID}/utils/Deprecation.kt`] },
      { repo: 'ios-sdk', why: 'facade port of Web', paths: [`${IOS}/Facade/**`, `${IOS}/Utils/Deprecation.swift`] },
      {
        repo: 'spatialreal-docs',
        why: 'Web SDK docs',
        paths: [
          'sdk-reference/web-sdk/api-reference.mdx',
          'sdk-reference/web-sdk/changelog.mdx',
          'avatar-integration/sdk-mode/web.mdx',
          'avatar-integration/livekit/web-client.mdx',
          'agent/quickstart.mdx',
        ],
      },
      SHARED_DOCS,
      {
        repo: 'spatialreal-examples',
        why: 'Web samples',
        paths: ['agent/web', 'avatar-integration/sdk-mode/web', 'avatar-integration/host-mode/client/web', 'avatar-integration/livekit/web-client'],
      },
      {
        repo: 'realtime_agent_framework',
        why: 'consumes web-sdk as submodule',
        paths: ['clients/web-sdk (bump)', 'app/web-client/src/spatial-web-avatar/use-spatial-web-avatar-host.ts', 'composer/src/server.ts'],
      },
    ],
  },

  'android-sdk': {
    api: [
      `${ANDROID}/{Avatar,AvatarController,AvatarSDK,AvatarView}.kt`,
      `${ANDROID}/facade/**`,
      `${ANDROID}/assets/{meta,AvatarManager}.kt`,
      `${ANDROID}/avatar/AvatarDataTypes.kt`,
      `${ANDROID}/performance/**`,
    ],
    exclude: [`${ANDROID}/facade/ContainerRegistry.kt`, `${ANDROID}/facade/chat/AndroidChatHost.kt`],
    selfChecks: ['CHANGELOG.md', 'gradle.properties (SDK_VERSION_NAME / SDK_VERSION_CODE on release)'],
    note: 'Android ports the Web facade; keep API shape, lifecycle/state semantics and error codes aligned with Web and iOS. A bugfix here means reviewing Web and iOS for the same class of issue.',
    targets: [
      { repo: 'web-sdk', why: 'reference impl: same change or parity check', paths: ['facade/**'] },
      { repo: 'ios-sdk', why: 'sibling port', paths: [`${IOS}/Facade/**`] },
      {
        repo: 'spatialreal-docs',
        why: 'Android SDK docs',
        paths: ['sdk-reference/android-sdk/api-reference.mdx', 'sdk-reference/android-sdk/changelog.mdx', 'avatar-integration/sdk-mode/android.mdx', 'snippets/android-sdk-install.mdx'],
      },
      SHARED_DOCS,
      { repo: 'spatialreal-examples', why: 'Android samples', paths: ['*/android', 'gradle/libs.versions.toml'] },
    ],
  },

  'ios-sdk': {
    api: [
      `${IOS}/{Avatar,AvatarController,AvatarManager,AvatarSDK,AvatarView}.swift`,
      `${IOS}/Facade/*.swift`,
      `${IOS}/Facade/Chat/**`,
      `${IOS}/Models/Config.swift`,
      `${IOS}/Performance/**`,
      `${IOS}/Services/{AvatarCache,AvatarLoadQueue}.swift`,
      `${IOS}/Utils/Logger.swift`,
    ],
    exclude: [`${IOS}/Facade/Chat/DebugMic.swift`],
    selfChecks: ['CHANGELOG.md ([Unreleased])', 'SpatialRealSDK.podspec (version on release)'],
    note: 'iOS ports the Web facade (CLAUDE.md: Web main is the reference; keep error codes, turn rules and close-code tables in step).',
    targets: [
      { repo: 'web-sdk', why: 'reference impl: same change or parity check', paths: ['facade/**'] },
      { repo: 'android-sdk', why: 'sibling port', paths: [`${ANDROID}/facade/**`] },
      { repo: 'ios-sdk-release', why: 'on release: url + checksum + version', paths: ['Package.swift', 'SpatialRealSDK.podspec', 'README.md'] },
      {
        repo: 'spatialreal-docs',
        why: 'iOS SDK docs',
        paths: ['sdk-reference/ios-sdk/api-reference.mdx', 'sdk-reference/ios-sdk/changelog.mdx', 'avatar-integration/sdk-mode/ios.mdx', 'snippets/ios-sdk-install.mdx'],
      },
      SHARED_DOCS,
      { repo: 'spatialreal-examples', why: 'iOS samples', paths: ['*/ios (project.pbxproj minimumVersion)'] },
    ],
  },

  'python-sdk': {
    api: ['spatialreal/{__init__,config,errors,events,logid,session,version}.py'],
    selfChecks: ['spatialreal/version.py (__version__ on release)'],
    note: 'Server-side host-mode SDK (PyPI spatialreal); livekit-plugins-spatialreal imports AvatarSession, LiveKitEgressConfig, Playback*, InterruptReason and new_avatar_session from it.',
    targets: [
      { repo: 'livekit-plugins-spatialreal', why: 'imports python-sdk', paths: ['livekit/plugins/spatialreal/avatar.py', 'pyproject.toml (spatialreal>= pin)'] },
      { repo: 'spatialreal-docs', why: 'Python SDK docs', paths: ['sdk-reference/python-sdk/python-sdk.mdx', 'avatar-integration/host-mode/server.mdx', 'avatar-integration/errors-and-recovery.mdx'] },
      { repo: 'spatialreal-examples', why: 'host-mode server sample', paths: ['avatar-integration/host-mode/server'] },
    ],
  },

  'livekit-plugins-spatialreal': {
    api: ['livekit/plugins/spatialreal/{__init__,avatar}.py'],
    selfChecks: ['livekit/plugins/spatialreal/version.py (__version__ on release)'],
    note: 'LiveKit Agents plugin (PyPI livekit-plugins-spatialreal).',
    targets: [
      { repo: 'spatialreal-docs', why: 'LiveKit agent docs', paths: ['avatar-integration/livekit/agent.mdx'] },
      { repo: 'spatialreal-examples', why: 'LiveKit agent sample', paths: ['avatar-integration/livekit/agent'] },
      { repo: 'playground-livekit-agent', why: 'uses AvatarSession', paths: ['agent.py', 'pyproject.toml'] },
    ],
  },

  'shared-proto': {
    api: ['**/*.proto'],
    selfChecks: ['a new tag vX.Y.Z (delivery is a tag)', 'after cp/v1 changes: backend-ng hack/check-proto-sync.sh'],
    note: 'The only place a contract is edited; delivery is a tag. web-sdk, python-sdk, backend-ng and inference-server regenerate from the tag automatically. android-sdk and ios-sdk do NOT: their proto code is hand-maintained and silently goes stale.',
    targets: [
      { repo: 'android-sdk', why: 'MANUAL: hand-committed generated Java', paths: [`${ANDROID}/model/**`] },
      { repo: 'ios-sdk', why: 'MANUAL: hand-patched Driving.pb.swift', paths: [`${IOS}/Services/Driving.pb.swift`] },
      { repo: 'inference-server', why: 'Flame subset of driveningress/v2: re-sync', paths: ['proto/driveningress/v2', 'generated/'] },
      { repo: 'backend-ng', why: 'auto codegen; cp/v1 needs check-proto-sync', paths: ['api/generated/', 'hack/check-proto-sync.sh'] },
      { repo: 'web-sdk', why: 'auto codegen on tag', paths: ['proto/', 'generated/'] },
      { repo: 'python-sdk', why: 'auto codegen on tag', paths: ['proto/', 'spatialreal/proto/generated/'] },
    ],
  },

  SPAvatarCore: {
    api: ['Core/include/**', 'Package.swift'],
    selfChecks: ['SPAvatarCore.podspec (version)', 'API_DOCUMENTATION.md'],
    note: 'The C core every client SDK embeds; binaries are copied by hand.',
    targets: [
      { repo: 'web-sdk', why: 'wasm/ from scripts/build_wasm.sh', paths: ['wasm/avatar_core_wasm.{js,wasm}'] },
      { repo: 'android-sdk', why: 'jniLibs from packaging/build_android.sh', paths: ['sdk/src/main/jniLibs/arm64-v8a/libavatar_core.so'] },
      { repo: 'ios-sdk', why: 'SwiftPM avatar-core dependency', paths: ['Package.swift'] },
    ],
  },
}

function escape(text: string): string {
  return text.replace(/[.+^$()|[\]\\]/g, '\\$&')
}

/** `**` any depth, `*` within a segment, `{a,b}` alternatives. */
export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i] as string
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*'
      i += 1
      if (glob[i + 1] === '/') i += 1
    } else if (c === '*') {
      re += '[^/]*'
    } else if (c === '?') {
      re += '[^/]'
    } else if (c === '{') {
      const end = glob.indexOf('}', i)
      re += `(?:${glob.slice(i + 1, end).split(',').map(escape).join('|')})`
      i = end
    } else {
      re += escape(c)
    }
  }
  return new RegExp(`^${re}$`)
}

/** Whether `relPath` (relative to the repo root) is public API of `repo`. */
export function isPublicApi(repo: string, relPath: string): boolean {
  const spec = SDK_MAP[repo]
  if (spec === undefined) return false
  const hit = (globs: readonly string[] | undefined) => (globs ?? []).some(g => globToRegExp(g).test(relPath))
  return hit(spec.api) && !hit(spec.exclude)
}

/** `git@github.com:SpatialReal-ai/web-sdk.git` → `web-sdk`. */
export function repoFromRemote(url: string): string {
  return url.trim().replace(/\.git$/, '').split(/[/:]/).pop() ?? ''
}
