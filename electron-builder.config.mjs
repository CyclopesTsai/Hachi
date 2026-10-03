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
 * first) plus their dependencies. Everything else in `dependencies` is bundled into the
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
    // Unsigned for now — see README "Code signing & notarization".
    identity: null
  },
  // Windows targets (planned): nsis (.exe) / msi
  win: {
    target: ['nsis'],
    artifactName: '${productName}-${version}-${arch}.${ext}'
  }
}
