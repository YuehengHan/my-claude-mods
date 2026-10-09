// The SpatialReal SDK graph for release checks: for each repo that ships
// releases (v* tags), its public API and who must follow a release. Repos are
// named by their GitHub remote and live under ~/<BASE_DIR>/<repo>.

export const BASE_DIR = 'Desktop/SpatialReal'

/**
 * - parity: a sibling SDK that must offer the same API
 * - docs: pages that document it
 * - examples: sample apps that pin its version
 * - consumer: a package that depends on it
 * - release: a distribution repo republishing it
 * - codegen: code generated or copied from it
 */
export type TargetKind = 'parity' | 'docs' | 'examples' | 'consumer' | 'release' | 'codegen'

export type Target = {
  repo: string
  kind: TargetKind
  /** What to verify there, in a few words. */
  why: string
  /** git pathspecs (glob) in that repo to look at. */
  paths: readonly string[]
  /** A POSIX ERE (git grep -E: no \\s, use [[:space:]]) for the line pinning the version. */
  pin?: string
  /** Whether the released version string should appear in `paths`. */
  mentionsVersion?: boolean
}

export type RepoSpec = {
  /** Public API, as globs relative to the repo root. */
  api: readonly string[]
  exclude?: readonly string[]
  /** In the repo itself, where the version and changelog live. */
  self: { version: string; changelog?: string }
  /** One line the auditor reads about this repo's role. */
  note: string
  targets: readonly Target[]
}

const ANDROID = 'sdk/src/main/java/ai/spatialreal/android'
const IOS = 'Sources/SpatialRealSDK'

const sharedDocs = (sdk: string): Target => ({
  repo: 'spatialreal-docs',
  kind: 'docs',
  why: `cross-SDK pages still right for ${sdk}`,
  paths: ['resources/error-codes.mdx', 'resources/client-error.mdx', 'resources/migration-guide.mdx', 'overview/changelog.mdx'],
})

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
    self: { version: 'package.json → version', changelog: 'CHANGELOG.md' },
    note: 'Web SDK is the reference implementation; Android and iOS port its facade (release-workflow: run the cross-SDK alignment check; missing parity → implement or open tracked follow-ups). Removed APIs stay, wrapped with deprecate().',
    targets: [
      { repo: 'android-sdk', kind: 'parity', why: 'same facade API / semantics / error codes', paths: [`${ANDROID}/facade/**`, `${ANDROID}/*.kt`] },
      { repo: 'ios-sdk', kind: 'parity', why: 'same facade API / semantics / error codes', paths: [`${IOS}/Facade/**`, `${IOS}/*.swift`] },
      {
        repo: 'spatialreal-docs',
        kind: 'docs',
        why: 'Web API reference + changelog',
        paths: ['sdk-reference/web-sdk/**', 'avatar-integration/sdk-mode/web.mdx', 'avatar-integration/livekit/web-client.mdx', 'agent/quickstart.mdx'],
        mentionsVersion: true,
      },
      sharedDocs('Web'),
      {
        repo: 'spatialreal-examples',
        kind: 'examples',
        why: 'web samples on the new version / API',
        paths: ['agent/web/**', 'avatar-integration/sdk-mode/web/**', 'avatar-integration/host-mode/client/web/**', 'avatar-integration/livekit/web-client/**'],
        pin: '"@spatialreal/web-sdk"[[:space:]]*:',
      },
      { repo: 'realtime_agent_framework', kind: 'consumer', why: 'clients/web-sdk submodule bumped', paths: ['clients/web-sdk', '.gitmodules'] },
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
    self: { version: 'gradle.properties → SDK_VERSION_NAME / SDK_VERSION_CODE', changelog: 'CHANGELOG.md' },
    note: 'Android ports the Web facade; API shape, lifecycle/state semantics and error codes stay aligned with Web and iOS. A bugfix means reviewing Web and iOS for the same class of issue.',
    targets: [
      { repo: 'web-sdk', kind: 'parity', why: 'reference impl has the same API / fix', paths: ['facade/**', 'index.ts'] },
      { repo: 'ios-sdk', kind: 'parity', why: 'sibling port has the same API / fix', paths: [`${IOS}/Facade/**`, `${IOS}/*.swift`] },
      {
        repo: 'spatialreal-docs',
        kind: 'docs',
        why: 'Android API reference + changelog + install snippet',
        paths: ['sdk-reference/android-sdk/**', 'avatar-integration/sdk-mode/android.mdx', 'snippets/android-sdk-install.mdx'],
        mentionsVersion: true,
      },
      sharedDocs('Android'),
      { repo: 'spatialreal-examples', kind: 'examples', why: 'android samples on the new version', paths: ['**/libs.versions.toml'], pin: '^spatialreal[[:space:]]*=' },
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
    self: { version: 'SpatialRealSDK.podspec → spec.version', changelog: 'CHANGELOG.md' },
    note: 'iOS ports the Web facade (CLAUDE.md: Web main is the reference; keep error codes, turn rules and close-code tables in step).',
    targets: [
      { repo: 'web-sdk', kind: 'parity', why: 'reference impl has the same API / fix', paths: ['facade/**', 'index.ts'] },
      { repo: 'android-sdk', kind: 'parity', why: 'sibling port has the same API / fix', paths: [`${ANDROID}/facade/**`, `${ANDROID}/*.kt`] },
      {
        repo: 'ios-sdk-release',
        kind: 'release',
        why: 'binary republished: url + checksum + version in Package.swift, podspec, README',
        paths: ['Package.swift', 'SpatialRealSDK.podspec', 'README.md'],
        mentionsVersion: true,
      },
      {
        repo: 'spatialreal-docs',
        kind: 'docs',
        why: 'iOS API reference + changelog + install snippet',
        paths: ['sdk-reference/ios-sdk/**', 'avatar-integration/sdk-mode/ios.mdx', 'snippets/ios-sdk-install.mdx'],
        mentionsVersion: true,
      },
      sharedDocs('iOS'),
      { repo: 'spatialreal-examples', kind: 'examples', why: 'iOS samples on the new version', paths: ['**/project.pbxproj'], pin: 'minimumVersion' },
    ],
  },

  'python-sdk': {
    api: ['spatialreal/{__init__,config,errors,events,logid,session,version}.py'],
    self: { version: 'spatialreal/version.py → __version__' },
    note: 'Server-side host-mode SDK (PyPI spatialreal). livekit-plugins-spatialreal imports AvatarSession, LiveKitEgressConfig, Playback*, InterruptReason, new_avatar_session from it.',
    targets: [
      {
        repo: 'livekit-plugins-spatialreal',
        kind: 'consumer',
        why: 'still compatible; pin raised if it needs the new API',
        paths: ['livekit/plugins/spatialreal/**', 'pyproject.toml'],
        pin: 'spatialreal[<>=~]',
      },
      {
        repo: 'spatialreal-docs',
        kind: 'docs',
        why: 'Python SDK page + host-mode server guide',
        paths: ['sdk-reference/python-sdk/**', 'avatar-integration/host-mode/server.mdx', 'avatar-integration/errors-and-recovery.mdx'],
        mentionsVersion: true,
      },
      { repo: 'spatialreal-examples', kind: 'examples', why: 'host-mode server sample', paths: ['avatar-integration/host-mode/server/**'], pin: 'spatialreal[<>=~]' },
    ],
  },

  'livekit-plugins-spatialreal': {
    api: ['livekit/plugins/spatialreal/{__init__,avatar}.py'],
    self: { version: 'livekit/plugins/spatialreal/version.py → __version__' },
    note: 'LiveKit Agents plugin (PyPI livekit-plugins-spatialreal), built on python-sdk.',
    targets: [
      { repo: 'spatialreal-docs', kind: 'docs', why: 'LiveKit agent guide', paths: ['avatar-integration/livekit/agent.mdx'], mentionsVersion: true },
      {
        repo: 'spatialreal-examples',
        kind: 'examples',
        why: 'LiveKit agent sample',
        paths: ['avatar-integration/livekit/agent/**'],
        pin: 'livekit-plugins-spatialreal[<>=~]',
      },
      { repo: 'playground-livekit-agent', kind: 'consumer', why: 'playground agent', paths: ['pyproject.toml', 'agent.py'], pin: 'livekit-plugins-spatialreal[<>=~]' },
    ],
  },

  'shared-proto': {
    api: ['**/*.proto'],
    self: { version: 'git tag (delivery is a tag)' },
    note: 'The only place a contract is edited. web-sdk, python-sdk, backend-ng and inference-server regenerate from the tag automatically; android-sdk and ios-sdk do NOT (hand-maintained proto code that silently goes stale).',
    targets: [
      { repo: 'android-sdk', kind: 'codegen', why: 'MANUAL: hand-committed generated Java', paths: [`${ANDROID}/model/**`] },
      { repo: 'ios-sdk', kind: 'codegen', why: 'MANUAL: hand-patched Driving.pb.swift', paths: [`${IOS}/Services/Driving.pb.swift`] },
      { repo: 'web-sdk', kind: 'codegen', why: 'codegen PR from the tag merged', paths: ['proto/**', 'generated/**'] },
      { repo: 'python-sdk', kind: 'codegen', why: 'codegen PR merged (proto/SHARED_PROTO_COMMIT)', paths: ['proto/**', 'spatialreal/proto/generated/**'] },
      { repo: 'backend-ng', kind: 'codegen', why: 'codegen merged; cp/v1 → hack/check-proto-sync.sh', paths: ['api/generated/**'] },
      { repo: 'inference-server', kind: 'codegen', why: 'Flame subset of driveningress/v2 re-synced', paths: ['proto/**', 'generated/**'] },
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

/** Release tags only: v1.2.3, v1.0.0-beta.3, v1.0.0-beta3; not facade-pre-rebase. */
export function isReleaseTag(tag: string): boolean {
  return /^v\d+\.\d+/.test(tag)
}

/** v1.0.0-beta.3 → 1.0.0-beta.3, the form changelogs and pins use. */
export function bareVersion(tag: string): string {
  return tag.replace(/^v/, '')
}

/** A version as a whole word: 1.0.0-beta3 is not in 1.0.0-beta39. */
export function versionPattern(version: string): string {
  return `${version.replace(/[.+^$()|[\]\\*?{}]/g, '\\$&')}([^0-9A-Za-z.]|$)`
}

export function mentions(text: string, version: string): boolean {
  return new RegExp(versionPattern(version), 'm').test(text)
}
