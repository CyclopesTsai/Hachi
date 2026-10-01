/**
 * electron-builder configuration. App identity comes from src/shared/app-info.json
 * (single source of truth). Packaging is finalized in Phase 6.
 * @type {import('electron-builder').Configuration}
 */
import { readFileSync } from 'node:fs'

const info = JSON.parse(
  readFileSync(new URL('./src/shared/app-info.json', import.meta.url), 'utf8')
)

export default {
  appId: info.appId,
  productName: info.appName,
  copyright: info.copyright,
  directories: {
    output: 'release/${version}',
    buildResources: 'resources'
  },
  files: ['out/main/**', 'out/preload/**', 'out/renderer/**', 'package.json'],
  extraResources: [
    { from: 'LICENSE', to: 'LICENSE' },
    { from: 'out/THIRD_PARTY_LICENSES.txt', to: 'THIRD_PARTY_LICENSES.txt' }
  ],
  asar: true,
  mac: {
    category: 'public.app-category.developer-tools',
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
