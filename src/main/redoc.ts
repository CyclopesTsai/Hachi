/**
 * The Redoc standalone bundle (MIT, decision 105) for OpenAPI HTML exports. Inlined at
 * build time into its own chunk, loaded only when a page is exported.
 */
export async function loadRedoc(): Promise<{ bundle: string; licenses: string }> {
  const [bundle, notices, license] = await Promise.all([
    import('redoc/bundles/redoc.standalone.js?raw'),
    import('redoc/bundles/redoc.standalone.js.LICENSE.txt?raw'),
    import('redoc/LICENSE?raw')
  ])
  return {
    bundle: bundle.default,
    licenses: `Redoc\n${license.default.trim()}\n\n${notices.default.trim()}`
  }
}
