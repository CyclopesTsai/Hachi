import type { Messages } from '../zh-TW'
import { plural } from './plural'

export const tlsCheck: Messages['tlsCheck'] = {
  timeout: 'Timed out',
  noName: '(no name)',
  invalidUrl: 'Invalid URL',
  cannotConnect: 'Could not connect to read the certificate chain',
  cannotReconnect: 'Could not connect again to read the certificate chain',
  proxyStatus: (status) => `The proxy answered ${status}`,
  verdicts: {
    noCert: 'The server sent no certificate',
    noCertAdvice: 'Check the URL and port (is it really HTTPS?).',
    hostname: (host) => `The certificate is not for “${host}”`,
    hostnameAdvice: (names) =>
      `It is valid for: ${names}. Check the host name in the URL, or have the server use a certificate that includes this name.`,
    expired: 'The certificate has expired',
    expiredAdvice: (name, date) =>
      `“${name}” was valid until ${date}. Have the server renew it, and check that this computer’s clock is right.`,
    notYetValid: 'The certificate is not valid yet',
    notYetValidAdvice: 'It only becomes valid in the future: check this computer’s date and time.',
    badSignature: 'The signatures of the chain do not match',
    badSignatureAdvice:
      'The server sends the certificates in the wrong order, or mixes in another one. Have the server set up its chain again (leaf → intermediate → root).',
    selfSigned: 'Self-signed certificate (not in the trust list)',
    selfSignedAdvice:
      'The server signed this certificate itself. For development, turn off SSL verification in the request’s Settings; in production use a certificate from a trusted CA, or add it to the system’s trusted certificates.',
    incomplete: 'Incomplete chain (the server left out an intermediate certificate)',
    incompleteAdvice: (last, missing) =>
      `The server only sends up to “${last}”, without “${missing}” that signed it. Have the server use the full chain (fullchain, e.g. Let's Encrypt’s fullchain.pem). Browsers may download the intermediate themselves and look fine, but most API clients do not.`,
    issuerUntrusted: (name) => `The issuer “${name}” is not in the trust list`,
    rootUntrusted: (name) => `The root “${name}” is not trusted`,
    untrustedAdvice: (missing) =>
      `${missing ? 'It may be a company or test CA, or the server may have left out an intermediate certificate. ' : 'This is usually a company or test CA. '}Add its root to the system’s trusted certificates (macOS Keychain / Windows certificate store) and restart Hachi, or turn off SSL verification in the request’s Settings.`,
    ok: 'The chain looks fine from here',
    okError: (error) =>
      `Error during verification: ${error}. Through a proxy, the proxy may have replaced the certificate.`,
    okRetry:
      'It may have been a passing problem (e.g. the certificate was just renewed); try again.',
    trusted: 'Hachi trusts this chain'
  },
  roles: { leaf: 'Site certificate', root: 'Root', intermediate: 'Intermediate' },
  unknown: 'unknown',
  sep: '; ',
  checks: {
    versions: 'TLS versions',
    supported: (list) => `Supports ${list}`,
    unsupported: (list) => `not ${list}`,
    untested: (list) => `could not test ${list}`,
    obsolete: (list) => `. ${list} are obsolete; turn them off on the server`,
    needs12: '. Clients today need at least TLS 1.2',
    ocsp: 'OCSP stapling',
    ocspYes: (bytes) =>
      `The server attaches revocation status to the handshake (OCSP response, ${bytes} bytes)`,
    ocspNo:
      'The server attaches no OCSP response. Connections still work; clients check revocation themselves when needed',
    sct: 'Certificate Transparency (SCT)',
    sctNone: 'The site certificate has no SCTs',
    sctCount: (n) => `The site certificate embeds ${plural(n, 'SCT')}`,
    sctRequired: (required, days) =>
      `Apple requires at least ${required} (valid for ${plural(days, 'day')})`,
    sctMac: (ok) => `the macOS CT check ${ok ? 'passes' : 'fails'}`,
    sctPrivate: 'company or test CAs need no SCTs',
    sctMaybe:
      'SCTs may also come in the handshake or the OCSP response (not visible here); without any, Apple rejects certificates from public CAs',
    rootSent: 'Root sent',
    rootSentYes: (name) =>
      `The server also sends the root “${name}”. Clients only use the roots in their own trust list, so it is useless and only makes every handshake bigger`,
    rootSentNo: 'No root is sent',
    expiry: 'Expiry',
    expiredOn: (name, date) => `“${name}” expired on ${date}`,
    expiresSoon: (role, name, days, date) =>
      `${role} “${name}” expires in ${plural(days, 'day')} (${date})`,
    validUntil: (date, days) =>
      `The site certificate is valid until ${date} (${plural(days, 'day')} left)`,
    appleValidity: 'Apple rule: validity',
    validityOld: (days) =>
      `Valid for ${plural(days, 'day')} (issued before 2020-09-01, so the 398-day limit does not apply)`,
    validityOk: (days, max) => `Valid for ${plural(days, 'day')} (at most ${max})`,
    validityLong: (days, max, privateCa) =>
      `Valid for ${plural(days, 'day')}, more than ${max}: Apple rejects such certificates from public CAs${privateCa ? ' (company or self-added CAs are exempt)' : ''}`,
    appleKey: 'Apple rule: key size',
    weakKey: (role, name, key) => `${role} “${name}” uses ${key}; RSA needs at least 2048 bits`,
    appleSignature: 'Apple rule: signature algorithm',
    weakSignature: (name, alg) => `“${name}” is signed with ${alg}, which is no longer accepted`,
    appleEku: 'Apple rule: Extended Key Usage',
    ekuOk: 'Includes serverAuth',
    beforeRule: 'Issued before 2019-07-01, so this does not apply',
    ekuMissingServerAuth: (list) => `No serverAuth (only ${list}); cannot be used for websites`,
    ekuNone: 'The site certificate has no Extended Key Usage, rejected since iOS 13 / macOS 10.15',
    appleSan: 'Apple rule: Subject Alternative Name',
    sanOk: (n) => `Names are in the Subject Alternative Name (${n})`,
    sanNone:
      'The domain is only in the CN, with no Subject Alternative Name, rejected since iOS 13 / macOS 10.15',
    appleRules: {
      'apple-validity': 'Validity',
      'apple-key': 'Key size',
      'apple-signature': 'Signature algorithm',
      'apple-eku': 'Extended Key Usage',
      'apple-san': 'Subject Alternative Name'
    }
  },
  programs: {
    labels: {
      apple: 'Apple (iOS, macOS)',
      chrome: 'Chrome',
      microsoft: 'Microsoft (Windows, Edge)',
      mozilla: 'Mozilla (Firefox)'
    },
    names: { apple: 'Apple', chrome: 'Chrome', microsoft: 'Microsoft', mozilla: 'Mozilla' },
    mozillaDistrust: (name, after, issued) =>
      `Mozilla does not trust site certificates from “${name}” issued after ${after} (this one: ${issued})`,
    mozillaDistrustNote: (name, after, issued) =>
      `Mozilla does not trust site certificates from “${name}” issued after ${after}; this one (${issued}) is not affected`,
    chromeSct: (name, when, earliest) =>
      `Chrome does not trust certificates from “${name}” logged (SCT) after ${when} (this one: ${earliest})`,
    chromeSctNote: (name, when, earliest) =>
      `Chrome does not trust certificates from “${name}” logged (SCT) after ${when}; this one (${earliest}) is not affected`,
    msNotBefore: (name, date, issued) =>
      `Microsoft does not trust site certificates from “${name}” issued after ${date} (this one: ${issued})`,
    msNotBeforeNote: (name, date) =>
      `Microsoft does not trust site certificates from “${name}” issued after ${date}; this one is not affected`,
    msDisabled: (name, date) => `Microsoft disabled “${name}” on ${date}`,
    msDisabledNote: (name, date) => `Microsoft disables “${name}” on ${date}`,
    msDisallowed: (name) => `Microsoft does not allow “${name}” for websites`,
    constraints: (text) => `Constraints: ${text}`,
    notIncluded: (root, program) => `“${root}” is not in ${program}’s list of roots`,
    aia: (names) =>
      `“${names.join('”, “')}” left out by the server reached the root after downloading via AIA`,
    badColumns: 'The CCADB report does not have the expected columns',
    badContent: 'The CCADB report does not have the expected content',
    downloadFailed: (reason) => `Could not download the CCADB data: ${reason}`
  },
  rows: {
    hachiClients: 'Hachi itself (bundled roots + certificates added on this computer)',
    mozilla: 'Node’s bundled roots (Mozilla)',
    mozillaClients: 'Firefox, Linux, most Node / Python tools',
    system: 'Operating system',
    systemError: (error) => `Could not run the system verification: ${error}`,
    systemNone:
      'This platform has no single system verifier (each program uses its own list of roots)',
    apple: 'iOS (guessed from Apple’s built-in roots)',
    appleClients: 'iPhone / iPad apps (URLSession), iOS Safari',
    notInApple: (name) => `“${name}” is not among Apple’s built-in roots`,
    appleMissing: (name) =>
      `The intermediate “${name}” is missing and cannot be downloaded from the certificate’s AIA URL`,
    appleRule: (rule, detail) => `${rule}: ${detail}`,
    appleAia: (names) =>
      `“${names.join('”, “')}” left out by the server is downloaded by the system (AIA)`
  },
  advice: {
    apple: (name) =>
      `macOS / iOS do not trust “${name}” → ask the CA for a root Apple trusts (or a cross-signed intermediate), or use another CA.`,
    windows: (name) =>
      `Windows does not trust “${name}” → ask the CA for a root Microsoft trusts (or a cross-signed intermediate), or use another CA.`,
    fullchain:
      'The server leaves out an intermediate certificate: operating systems download it and pass, but Hachi, Node, Python, Java, Android and other clients do not. Have the server send the full chain (fullchain).',
    localOnly: (name) =>
      `“${name}” is not in Mozilla’s list of roots, only in this computer’s trusted certificates (e.g. a company CA): programs on other computers, phones and servers will not trust it.`,
    programs: (programs, name) =>
      `${programs.join(', ')} do not include “${name}” → ask the CA for a root these platforms trust (or a cross-signed intermediate), or use another CA.`,
    restricted: (reasons) =>
      `${reasons.join('; ')} → ask the CA to reissue from another root, or use another CA.`,
    rules: {
      'apple-validity': 'Ask the CA to reissue a certificate valid for at most 398 days.',
      'apple-key': 'Reissue with an RSA key of at least 2048 bits, or an ECDSA key.',
      'apple-signature': 'Ask the CA to reissue with SHA-256 or stronger.',
      'apple-eku':
        'Ask the CA to reissue a certificate whose Extended Key Usage includes “serverAuth”.',
      'apple-san': 'Reissue with the domain in the Subject Alternative Name (not only in the CN).'
    }
  },
  system: {
    macLabel: 'This Mac (system verification)',
    macClients: 'Safari, macOS apps (URLSession), system curl',
    windowsLabel: 'This Windows PC (system verification)',
    windowsClients: 'Edge, Chrome, .NET / Windows apps',
    badHost: 'Cannot check this host name',
    cannotRun: (reason) => `Could not run the system verification: ${reason}`,
    cannotRead: 'Could not read the certificates',
    badOutput: 'Could not read the result of the system verification',
    failed: 'Verification failed',
    failedWith: (result) => `Verification failed: ${result}`,
    hostMismatch: 'Wrong host name',
    other: (key) => `Other problem (${key})`,
    reason: (text, cert) => `${text}: ${cert}`,
    darwin: {
      AnchorTrusted: 'The root is not trusted',
      MissingIntermediate:
        'Its issuer was not found (an intermediate is missing, or the root is not trusted)',
      SSLHostname: 'Wrong host name',
      TemporalValidity: 'Expired or not valid yet',
      OtherTrustValidityPeriod: 'Valid for longer than Apple allows (398 days)',
      ValidityPeriodMaximums: 'Valid for longer than Apple allows',
      ServerAuthEKU: 'Extended Key Usage lacks serverAuth (cannot be used for websites)',
      ExtendedKeyUsage: 'Extended Key Usage does not allow websites',
      KeyUsage: 'Key Usage does not allow websites',
      KeySize: 'Key too short (RSA needs at least 2048 bits)',
      WeakKeySize: 'Key too short (RSA needs at least 2048 bits)',
      WeakSignature: 'Weak signature algorithm (e.g. SHA-1)',
      SignatureHashAlgorithms: 'Weak signature algorithm (e.g. SHA-1)',
      SystemTrustedWeakHash: 'Weak signature algorithm (e.g. SHA-1)',
      CTRequired: 'Certificate Transparency records (SCTs) are missing',
      Revocation: 'The certificate has been revoked',
      BlackListedLeaf: 'Apple blocks this certificate',
      BlackListedKey: 'Apple blocks this key',
      GrayListedLeaf: 'Apple distrusts this certificate',
      GrayListedKey: 'Apple distrusts this key',
      BasicConstraints: 'Basic Constraints violated (not a CA, yet it issued certificates)',
      BasicConstraintsCA: 'Basic Constraints violated (not a CA, yet it issued certificates)',
      NameConstraints: 'Name Constraints violated',
      NonEmptySubject: 'The Subject field does not follow the rules',
      IdLinkage: 'The key identifiers of issuer and subject do not match',
      CriticalExtensions: 'Unknown critical extensions',
      ChainLength: 'The chain is too long'
    },
    win32: {
      UntrustedRoot: 'The root is not trusted',
      PartialChain:
        'Could not build a complete chain (an intermediate is missing, or the root is not trusted)',
      NotTimeValid: 'Expired or not valid yet',
      NotTimeNested: 'Validity is outside its issuer’s validity',
      NotSignatureValid: 'Invalid signature',
      NotValidForUsage: 'Its usage does not allow websites (serverAuth missing)',
      InvalidExtension: 'Invalid extension',
      Revoked: 'The certificate has been revoked',
      ExplicitDistrust: 'The system distrusts this certificate',
      HasWeakSignature: 'Weak signature algorithm (e.g. SHA-1)',
      InvalidBasicConstraints: 'Basic Constraints violated',
      InvalidNameConstraints: 'Name Constraints violated',
      HasNotPermittedNameConstraint: 'Name Constraints violated',
      HasExcludedNameConstraint: 'Name Constraints violated',
      HasNotSupportedCriticalExtension: 'Unknown critical extensions',
      Cyclic: 'The chain is circular',
      InvalidPolicyConstraints: 'Policy Constraints violated',
      NoIssuanceChainPolicy: 'A required certificate policy is missing'
    }
  }
}
