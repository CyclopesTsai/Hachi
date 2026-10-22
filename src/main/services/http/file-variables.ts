/**
 * `{{$file:base64:<path>}}` (decision 134): reads the files a request refers to, before
 * variables are substituted. Files inside the Workspace folder are always readable;
 * files outside it only after the user trusted the Workspace for that (an imported
 * Collection could otherwise send e.g. ~/.ssh keys to its server).
 */
import { readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FILE_VARIABLE_MAX_BYTES, parseFileVariable } from '@shared/variables'
import { msg } from '@shared/i18n'

export interface FileAccess {
  /** The current Workspace folder (relative paths start here); null when none is open. */
  root: string | null
  /** The user allowed this Workspace to read files outside its folder. */
  trustedOutside: boolean
}

export type FileVariablesResult =
  | { ok: true; files: Map<string, string> }
  | { ok: false; code: 'FILE_NOT_FOUND' | 'FILE_ACCESS'; message: string; untrusted: string[] }

/** Absolute path of a $file path: `~` = home, relative = inside the Workspace folder. */
export function resolveFilePath(file: string, root: string | null): string | null {
  if (file === '~' || file.startsWith('~/') || file.startsWith('~\\')) {
    return path.join(os.homedir(), file.slice(1))
  }
  if (path.isAbsolute(file)) return path.normalize(file)
  return root ? path.resolve(root, file) : null
}

export function isInside(root: string | null, abs: string): boolean {
  if (!root) return false
  const rel = path.relative(path.resolve(root), abs)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export async function loadFileVariables(
  names: readonly string[],
  access: FileAccess
): Promise<FileVariablesResult> {
  const files = new Map<string, string>()
  const jobs: { name: string; abs: string }[] = []
  const untrusted: string[] = []
  for (const name of names) {
    const spec = parseFileVariable(name)
    if (!spec) {
      return fail('FILE_ACCESS', msg().httpMain.file.format(name))
    }
    if (!spec.supported) {
      return fail('FILE_ACCESS', msg().httpMain.file.unsupported(name, spec.format))
    }
    const abs = resolveFilePath(spec.path, access.root)
    if (!abs) return fail('FILE_ACCESS', msg().httpMain.file.noWorkspace(name))
    if (!isInside(access.root, abs) && !access.trustedOutside) untrusted.push(abs)
    jobs.push({ name, abs })
  }
  if (untrusted.length > 0) {
    return {
      ok: false,
      code: 'FILE_ACCESS',
      message: msg().httpMain.file.untrusted(untrusted),
      untrusted
    }
  }
  for (const { name, abs } of jobs) {
    let size: number
    try {
      const info = await stat(abs)
      if (!info.isFile()) return fail('FILE_NOT_FOUND', msg().httpMain.file.notFile(abs))
      size = info.size
    } catch {
      return fail('FILE_NOT_FOUND', msg().httpMain.file.notFound(abs))
    }
    if (size > FILE_VARIABLE_MAX_BYTES) {
      return fail(
        'FILE_ACCESS',
        msg().httpMain.file.tooLarge(FILE_VARIABLE_MAX_BYTES / 1024 / 1024, abs)
      )
    }
    files.set(name, (await readFile(abs)).toString('base64'))
  }
  return { ok: true, files }
}

function fail(code: 'FILE_NOT_FOUND' | 'FILE_ACCESS', message: string): FileVariablesResult {
  return { ok: false, code, message, untrusted: [] }
}
