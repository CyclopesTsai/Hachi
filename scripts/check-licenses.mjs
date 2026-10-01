#!/usr/bin/env node
/**
 * License audit for everything that ships inside the app.
 *
 * Walks the full transitive tree of `dependencies` in package.json (devDependencies
 * are build tools and are not distributed) and fails if any package uses a license
 * outside the permissive allow-list below — Hachi is MIT licensed and must not
 * pull in copyleft (GPL/LGPL/AGPL/MPL/EPL…) or unknown licenses.
 *
 *   node scripts/check-licenses.mjs           # audit only
 *   node scripts/check-licenses.mjs --write   # also write out/THIRD_PARTY_LICENSES.txt
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Unlicense',
  'Zlib'
])

/**
 * devDependencies whose code still ends up in the shipped bundle
 * (Tailwind's preflight/base CSS is emitted into the app stylesheet).
 */
const BUNDLED_DEV_DEPENDENCIES = ['tailwindcss']

const root = path.resolve(import.meta.dirname, '..')

/** Evaluates a simple SPDX expression: "A OR B" passes if any passes, "A AND B" needs all. */
function isAllowed(expression) {
  const expr = expression.replace(/[()]/g, ' ').trim()
  if (/\sOR\s/i.test(expr)) return expr.split(/\s+OR\s+/i).some(isAllowed)
  if (/\sAND\s/i.test(expr)) return expr.split(/\s+AND\s+/i).every(isAllowed)
  return ALLOWED.has(expr)
}

function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ')
  return 'UNKNOWN'
}

/** Node module resolution for `<name>/package.json`, starting at `fromDir`. */
function findPackageDir(name, fromDir) {
  let dir = fromDir
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name)
    if (existsSync(path.join(candidate, 'package.json'))) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

async function licenseText(dir) {
  const files = await readdir(dir)
  const file = files.find((f) => /^(licen[sc]e|copying)(\.|$)/i.test(f))
  return file ? (await readFile(path.join(dir, file), 'utf8')).trim() : null
}

const rootPkg = await readJson(path.join(root, 'package.json'))
const seen = new Map()
const queue = [...Object.keys(rootPkg.dependencies ?? {}), ...BUNDLED_DEV_DEPENDENCIES].map(
  (name) => ({
    name,
    from: root,
    optional: false
  })
)

while (queue.length > 0) {
  const { name, from, optional } = queue.shift()
  const dir = findPackageDir(name, from)
  if (!dir) {
    if (!optional) throw new Error(`Cannot resolve dependency "${name}" from ${from}`)
    continue // optional / platform-specific dependency not installed on this machine
  }
  if (seen.has(dir)) continue
  const pkg = await readJson(path.join(dir, 'package.json'))
  seen.set(dir, { name: pkg.name, version: pkg.version, license: licenseOf(pkg), dir })
  for (const dep of Object.keys(pkg.dependencies ?? {}))
    queue.push({ name: dep, from: dir, optional: false })
  for (const dep of Object.keys(pkg.optionalDependencies ?? {}))
    queue.push({ name: dep, from: dir, optional: true })
  // Peer dependencies can end up in the bundle too; audit them whenever they are installed.
  for (const dep of Object.keys(pkg.peerDependencies ?? {})) {
    queue.push({ name: dep, from: dir, optional: true })
  }
}

const packages = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
const violations = packages.filter((p) => !isAllowed(p.license))
const byLicense = new Map()
for (const p of packages) byLicense.set(p.license, (byLicense.get(p.license) ?? 0) + 1)

console.log(`Audited ${packages.length} production packages:`)
for (const [license, count] of [...byLicense].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${license.padEnd(28)} ${count}`)
}

if (process.argv.includes('--write')) {
  const sections = []
  for (const p of packages) {
    const text = (await licenseText(p.dir)) ?? `License: ${p.license} (no license file in package)`
    sections.push(`${p.name}@${p.version} — ${p.license}\n${'-'.repeat(72)}\n${text}\n`)
  }
  const outDir = path.join(root, 'out')
  await mkdir(outDir, { recursive: true })
  const header =
    'Hachi includes the following third-party software.\n' +
    'Electron / Chromium notices are shipped separately by Electron (LICENSES.chromium.html).\n\n'
  await writeFile(path.join(outDir, 'THIRD_PARTY_LICENSES.txt'), header + sections.join('\n'))
  console.log('Wrote out/THIRD_PARTY_LICENSES.txt')
}

if (violations.length > 0) {
  console.error('\nLicenses not on the allow-list:')
  for (const v of violations) console.error(`  ${v.name}@${v.version}: ${v.license}`)
  process.exit(1)
}
console.log('\nAll production dependency licenses are compatible with MIT.')
