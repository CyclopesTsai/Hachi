import type { Messages } from '../zh-TW'

export const tls: Messages['tls'] = {
  roles: { leaf: 'Site', root: 'Root', intermediate: 'Intermediate' },
  badges: {
    trustedRoot: 'Trusted root',
    fromStore: 'From the trust list',
    selfSigned: 'Self-signed, not trusted',
    expired: 'Expired',
    notYetValid: 'Not valid yet',
    badSignature: 'Signature does not match',
    hostMismatch: 'Wrong host name'
  },
  issuer: 'Issuer',
  validity: 'Valid',
  names: 'Names',
  heading: (summary) => `Certificate check: ${summary}`,
  chainSent: (hostPort) => `Chain sent by ${hostPort} (each is signed by the one below)`,
  missing: 'Missing: ',
  notSent: ' (not sent by the server)',
  notTrusted: ' (not in the trust list)',
  aia: (url) => `Download location in the certificate (AIA): ${url}`,
  verifyError: (error) => `Verification error: ${error}`,
  trustBadges: { pass: 'Trusted', fail: 'Not trusted', unsupported: 'N/A', error: 'Unknown' },
  checkBadges: { pass: 'OK', warn: 'Warning', fail: 'Fails', info: 'Note' },
  programBadges: { included: 'Included', 'not-included': 'Not included', restricted: 'Restricted' },
  ccadbTitle: 'Root programs (CCADB)',
  ccadbDate: (day) => `Data from ${day}`,
  retry: 'Retry',
  update: 'Update',
  ccadbNeedsNetwork: (error) =>
    `The CCADB data needs a network connection${error ? ` (${error})` : ''}`,
  ccadbStale: (error, day) => `Could not update (${error}); using the data from ${day}`,
  ccadbPrivacy: 'Only CCADB’s public lists of roots are downloaded; the checked URL is never sent.',
  insecureTitle: (scheme) =>
    `Unencrypted connection (${scheme}://): there is no certificate to check`,
  insecurePlain:
    'Data is sent in plain text and can be read or changed on the way (passwords, tokens and cookies included).',
  insecureApps: (scheme) =>
    `iOS / macOS apps block ${scheme}:// connections by default (App Transport Security) unless Info.plist has an exception; Android 9 and later block plain-text traffic by default too.`,
  insecureUse: (secure) => `Use ${secure} in production, then check the certificate again.`,
  platforms: 'Trusted by',
  advice: 'What to do',
  otherChecks: 'Other checks',
  chain: 'Certificate chain',
  chainHachi: (summary) => `Certificate chain (Hachi: ${summary})`,
  title: 'Certificate Check',
  notEncrypted: 'Not encrypted',
  readOnly: 'Only reads the certificates the server sends; no trust settings are changed',
  again: 'Check Again',
  checking:
    'Checking… (connects a few times and asks the operating system; may take a few seconds)',
  button: 'Certificate',
  buttonTitle: 'Check the server certificate: do Hachi, Mozilla, the OS and iOS trust it?'
}
