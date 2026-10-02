/**
 * `<workspace>/environments/<slug>.json` and `<workspace>/.hachi-secrets.json`.
 * See docs/schema.md.
 */
import { z } from 'zod'
import { VARIABLES_MAX, itemNameSchema, variableSchema, type Variable } from './collection'
import type { VersionedFormat } from './versioned'

export const ENVIRONMENT_VERSION = 1

export const environmentFileSchema = z.looseObject({
  version: z.literal(ENVIRONMENT_VERSION),
  id: z.string().min(1),
  name: itemNameSchema,
  /** Values of secret variables are always "" here; the real value is in the secrets file. */
  variables: z.array(variableSchema).max(VARIABLES_MAX).default([])
})
export type EnvironmentFile = z.infer<typeof environmentFileSchema>

export const environmentFormat: VersionedFormat<typeof environmentFileSchema> = {
  name: 'environment file',
  currentVersion: ENVIRONMENT_VERSION,
  schema: environmentFileSchema
}

export const SECRETS_VERSION = 1

/** Secret values by owner id, then variable id. */
const secretMapSchema = z.record(z.string(), z.record(z.string(), z.string()))

export const secretsFileSchema = z.object({
  version: z.literal(SECRETS_VERSION),
  environments: secretMapSchema.default({}),
  collections: secretMapSchema.default({})
})
export type SecretsFile = z.infer<typeof secretsFileSchema>
export type SecretOwner = 'environments' | 'collections'

export const secretsFormat: VersionedFormat<typeof secretsFileSchema> = {
  name: '.hachi-secrets.json',
  currentVersion: SECRETS_VERSION,
  schema: secretsFileSchema
}

export function emptySecretsFile(): SecretsFile {
  return { version: SECRETS_VERSION, environments: {}, collections: {} }
}

/**
 * Splits variables into what may be committed (secret values blanked) and the
 * secret values by variable id.
 */
export function splitSecrets(variables: readonly Variable[]): {
  stored: Variable[]
  secrets: Record<string, string>
} {
  const secrets: Record<string, string> = {}
  const stored = variables.map((v) => {
    if (!v.secret) return v
    if (v.value !== '') secrets[v.id] = v.value
    return { ...v, value: '' }
  })
  return { stored, secrets }
}

/** Puts secret values back into variables read from a committed file. */
export function mergeSecrets(
  variables: readonly Variable[],
  secrets: Readonly<Record<string, string>> | undefined
): Variable[] {
  return variables.map((v) => (v.secret ? { ...v, value: secrets?.[v.id] ?? '' } : v))
}
