/**
 * electron-builder configuration. App identity comes from src/shared/app-info.json
 * (single source of truth). Packaging is finalized in Phase 6.
 * @type {import('electron-builder').Configuration}
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'

const info = JSON.parse(
  readFileSync(new URL('./src/shared/app-info.json', import.meta.url), 'utf8')
)

/**
 * Packages the main process loads at runtime: bare imports in out/main (run `npm run build`
 * first; out/main/raw/ holds inlined text, not code) plus their dependencies. Everything else in `dependencies` is bundled into the
 * renderer by Vite, so its node_modules copy is left out of app.asar.
 */
function mainRuntimePackages() {
  const builtins = new Set([...builtinModules, 'electron'])
  const specifier =
    /(?:from\s*|import\s*\(\s*|require\s*\(\s*|resolve\s*\(\s*)['"]([^'"./$][^'"]*)['"]/g
  const keep = new Set()
  const queue = []
  const add = (name) => {
    if (keep.has(name) || builtins.has(name) || name.startsWith('node:')) return
    keep.add(name)
    queue.push(name)
  }
  const outDir = path.join(import.meta.dirname, 'out', 'main')
  for (const file of readdirSync(outDir).filter((f) => f.endsWith('.js'))) {
    for (const m of readFileSync(path.join(outDir, file), 'utf8').matchAll(specifier)) {
      const parts = m[1].split('/')
      add(m[1].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0])
    }
  }
  while (queue.length > 0) {
    const manifest = path.join(import.meta.dirname, 'node_modules', queue.shift(), 'package.json')
    if (!existsSync(manifest)) continue
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) add(dep)
  }
  return keep
}

const keep = mainRuntimePackages()
/** Every installed package the main process does not need (dev tools are skipped anyway). */
function unusedPackages() {
  const root = path.join(import.meta.dirname, 'node_modules')
  return readdirSync(root)
    .filter((name) => !name.startsWith('.'))
    .flatMap((name) =>
      name.startsWith('@')
        ? readdirSync(path.join(root, name)).map((sub) => `${name}/${sub}`)
        : [name]
    )
    .filter((name) => !keep.has(name))
}

/**
 * macOS signing (decision 124): with a Developer ID certificate (CSC_LINK, e.g. a repository
 * secret in GitHub Actions) the app is signed with the hardened runtime and notarized when
 * Apple credentials are set (APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, or
 * APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID). Without a certificate: ad-hoc.
 */
const developerId = Boolean(process.env.CSC_LINK || process.env.CSC_NAME)

export default {
  appId: info.appId,
  productName: info.appName,
  copyright: info.copyright,
  directories: {
    output: 'release/${version}',
    // build/icon.png: placeholder icon from scripts/make-icon.mjs (replace with the real one).
    buildResources: 'build'
  },
  files: [
    'out/main/**',
    'out/preload/**',
    'out/renderer/**',
    'package.json',
    ...unusedPackages().map((name) => `!node_modules/${name}{,/**}`)
  ],
  extraResources: [
    { from: 'LICENSE', to: 'LICENSE' },
    { from: 'out/THIRD_PARTY_LICENSES.txt', to: 'THIRD_PARTY_LICENSES.txt' }
  ],
  asar: true,
  mac: {
    category: 'public.app-category.developer-tools',
    icon: 'build/icon.png',
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    artifactName: '${productName}-${version}-${arch}.${ext}',
    ...(developerId
      ? {
          // Developer ID: electron-builder picks the certificate from CSC_LINK, signs with
          // the hardened runtime (required for notarization) and notarizes.
          hardenedRuntime: true,
          entitlements: 'build/entitlements.mac.plist',
          entitlementsInherit: 'build/entitlements.mac.plist'
        }
      : {
          // Ad-hoc signature ("-"): the whole bundle is re-signed consistently. With `null`
          // the app kept Electron's own (now invalid) signature and macOS reported
          // downloaded copies as "damaged" on Apple Silicon.
          identity: '-',
          // With an ad-hoc signature the hardened runtime's library validation would reject
          // Electron's frameworks.
          hardenedRuntime: false
        })
  },
  // Windows (decision 123): x64 installer + portable exe, unsigned for now (SmartScreen
  // asks "More info → Run anyway"). The .ico is made from build/icon.png.
  win: {
    icon: 'build/icon.png',
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] }
    ]
  },
  nsis: {
    // Per-user install (no administrator), the user may pick the folder.
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    artifactName: '${productName}-${version}-setup-${arch}.${ext}'
  },
  portable: {
    artifactName: '${productName}-${version}-portable-${arch}.${ext}'
  }
}
