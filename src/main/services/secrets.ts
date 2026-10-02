/**
 * `<workspace>/.hachi-secrets.json`: values of secret variables, kept out of the
 * files that are committed (the file is in the Workspace's .gitignore).
 * A missing file means "no secrets"; a corrupt one is reported, never overwritten.
 */
import path from 'node:path'
import { isHachiError } from '@shared/errors'
import {
  emptySecretsFile,
  secretsFormat,
  type SecretOwner,
  type SecretsFile
} from '@shared/schemas/environment'
import { WORKSPACE_LAYOUT } from '@shared/schemas/workspace'
import { updateJsonAtomic } from './fs/atomic-write'
import { readVersionedJson } from './fs/json-file'

export function secretsPath(root: string): string {
  return path.join(root, WORKSPACE_LAYOUT.secretsFile)
}

export async function readSecrets(root: string): Promise<SecretsFile> {
  try {
    return await readVersionedJson(secretsPath(root), secretsFormat)
  } catch (error) {
    if (isHachiError(error) && error.code === 'NOT_FOUND') return emptySecretsFile()
    throw error
  }
}

/** Secret values of one environment / collection, by variable id. */
export async function getSecrets(
  root: string,
  owner: SecretOwner,
  id: string
): Promise<Record<string, string>> {
  return (await readSecrets(root))[owner][id] ?? {}
}

async function updateSecrets(root: string, mutate: (file: SecretsFile) => void): Promise<void> {
  await updateJsonAtomic(
    secretsPath(root),
    () => readSecrets(root),
    (file) => {
      mutate(file)
      return file
    }
  )
}

/** Replaces the secret values of one owner (an empty map removes the entry). */
export async function setSecrets(
  root: string,
  owner: SecretOwner,
  id: string,
  values: Record<string, string>
): Promise<void> {
  const empty = Object.keys(values).length === 0
  // Don't create the file just to record that there are no secrets.
  if (empty && !(await readSecrets(root))[owner][id]) return
  await updateSecrets(root, (file) => {
    if (empty) delete file[owner][id]
    else file[owner][id] = values
  })
}

/** Copies the secret values of a duplicated environment / collection to its new id. */
export async function copySecrets(
  root: string,
  owner: SecretOwner,
  fromId: string,
  toId: string
): Promise<void> {
  const values = await getSecrets(root, owner, fromId)
  if (Object.keys(values).length > 0) await setSecrets(root, owner, toId, { ...values })
}
