/** Certificate diagnosis and check, made in main (decisions 132 / 142, issue #7). */
export const tlsCheck = {
  timeout: '逾時',
  noName: '（沒有名稱）',
  invalidUrl: '網址無效',
  cannotConnect: '無法連線讀取憑證鏈',
  cannotReconnect: '無法再次連線讀取憑證鏈',
  proxyStatus: (status: number | undefined) => `Proxy 回應 ${status}`,
  verdicts: {
    noCert: '伺服器沒有送出憑證',
    noCertAdvice: '確認網址與連接埠是否正確（是否真的是 HTTPS）。',
    hostname: (host: string) => `憑證不是發給「${host}」的`,
    hostnameAdvice: (names: string) =>
      `憑證適用的名稱：${names}。請確認網址的主機名稱，或請伺服器換成包含這個名稱的憑證。`,
    expired: '憑證已過期',
    expiredAdvice: (name: string, date: string) =>
      `「${name}」的有效期限到 ${date}。請伺服器更新憑證，並確認這台電腦的時間正確。`,
    notYetValid: '憑證還沒生效',
    notYetValidAdvice: '憑證的生效時間在現在之後：請確認這台電腦的日期與時間是否正確。',
    badSignature: '憑證鏈的簽章對不上',
    badSignatureAdvice:
      '伺服器送出的憑證順序錯誤，或混入了別的憑證。請伺服器重新設定憑證鏈（leaf → 中繼 → 根）。',
    selfSigned: '自簽憑證（不在信任清單中）',
    selfSignedAdvice:
      '這個憑證是伺服器自己簽的。開發環境可在請求的 Settings 關閉 SSL 驗證；正式環境請改用受信任 CA 簽發的憑證，或把它加入系統的信任憑證。',
    incomplete: '憑證鏈不完整（伺服器少送了中繼憑證）',
    incompleteAdvice: (last: string, missing: string) =>
      `伺服器只送出到「${last}」，缺少簽發它的「${missing}」。請伺服器管理員改用完整的憑證鏈（fullchain，例如 Let's Encrypt 的 fullchain.pem）。瀏覽器可能會自動下載中繼憑證而看起來正常，但 API 用戶端多半不會。`,
    issuerUntrusted: (name: string) => `簽發者「${name}」不在信任清單中`,
    rootUntrusted: (name: string) => `根憑證「${name}」不受信任`,
    untrustedAdvice: (missing: boolean) =>
      `${missing ? '可能是公司內部或測試用的 CA，也可能是伺服器少送了一張中繼憑證。' : '這通常是公司內部或測試用的 CA。'}可把它的根憑證加入系統的信任憑證（macOS 鑰匙圈 / Windows 憑證存放區）後重新啟動 Hachi，或在請求的 Settings 關閉 SSL 驗證。`,
    ok: '在這裡看起來憑證鏈正常',
    okError: (error: string) => `驗證時的錯誤：${error}。若經過 Proxy，可能是 Proxy 換掉了憑證。`,
    okRetry: '可能只是暫時的問題（例如憑證剛更新），請再試一次。',
    trusted: 'Hachi 信任這個憑證鏈'
  },
  roles: { leaf: '網站憑證', root: '根憑證', intermediate: '中繼憑證' },
  unknown: '未知',
  sep: '；',
  checks: {
    versions: 'TLS 版本',
    supported: (list: string) => `支援 ${list}`,
    unsupported: (list: string) => `不支援 ${list}`,
    untested: (list: string) => `無法測試 ${list}`,
    obsolete: (list: string) => `。${list} 已淘汰，建議在伺服器關閉`,
    needs12: '。現在的用戶端至少需要 TLS 1.2',
    ocsp: 'OCSP Stapling',
    ocspYes: (bytes: number) => `伺服器在交握時附上了撤銷狀態（OCSP 回應 ${bytes} bytes）`,
    ocspNo: '伺服器沒有附上 OCSP 回應。不影響連線，用戶端需要時會自己查詢撤銷狀態',
    sct: 'Certificate Transparency（SCT）',
    sctNone: '網站憑證裡沒有 SCT',
    sctCount: (n: number) => `網站憑證內嵌 ${n} 個 SCT`,
    sctRequired: (required: number, days: number) =>
      `Apple 平台要求至少 ${required} 個（有效期 ${days} 天）`,
    sctMac: (ok: boolean) => `macOS 的 CT 檢查${ok ? '通過' : '未通過'}`,
    sctPrivate: '公司內部或測試用的 CA 不需要 SCT',
    sctMaybe:
      'SCT 也可能在交握或 OCSP 回應中送出（這裡看不到）；都沒有時 Apple 平台會拒絕公開 CA 簽發的憑證',
    rootSent: '多送根憑證',
    rootSentYes: (name: string) =>
      `伺服器連根憑證「${name}」也送出了。用戶端只用自己信任清單裡的根憑證，多送沒有用，只會讓每次交握變大`,
    rootSentNo: '沒有多送根憑證',
    expiry: '到期日',
    expiredOn: (name: string, date: string) => `「${name}」已在 ${date} 過期`,
    expiresSoon: (role: string, name: string, days: number, date: string) =>
      `${role}「${name}」剩 ${days} 天到期（${date}）`,
    validUntil: (date: string, days: number) => `網站憑證到 ${date}（剩 ${days} 天）`,
    appleValidity: 'Apple 要求：有效期',
    validityOld: (days: number) => `有效期 ${days} 天（2020-09-01 前簽發，不受 398 天的限制）`,
    validityOk: (days: number, max: number) => `有效期 ${days} 天（上限 ${max} 天）`,
    validityLong: (days: number, max: number, privateCa: boolean) =>
      `有效期 ${days} 天，超過 ${max} 天：公開 CA 簽發的這種憑證 Apple 平台會拒絕${privateCa ? '（公司內部或自行加入的 CA 不受此限）' : ''}`,
    appleKey: 'Apple 要求：金鑰長度',
    weakKey: (role: string, name: string, key: string) =>
      `${role}「${name}」是 ${key}，RSA 至少要 2048 位元`,
    appleSignature: 'Apple 要求：簽章演算法',
    weakSignature: (name: string, alg: string) => `「${name}」用 ${alg} 簽署，已不被接受`,
    appleEku: 'Apple 要求：Extended Key Usage',
    ekuOk: '包含 serverAuth',
    beforeRule: '2019-07-01 前簽發，不受此限',
    ekuMissingServerAuth: (list: string) => `沒有 serverAuth（只有 ${list}），不能用於網站`,
    ekuNone: '網站憑證沒有 Extended Key Usage，iOS 13 / macOS 10.15 起不接受',
    appleSan: 'Apple 要求：Subject Alternative Name',
    sanOk: (n: number) => `名稱寫在 Subject Alternative Name（${n} 個）`,
    sanNone: '網域只寫在 CN、沒有 Subject Alternative Name，iOS 13 / macOS 10.15 起不接受',
    /** The Apple rules, short, for the iOS row. */
    appleRules: {
      'apple-validity': '有效期',
      'apple-key': '金鑰長度',
      'apple-signature': '簽章演算法',
      'apple-eku': 'Extended Key Usage',
      'apple-san': 'Subject Alternative Name'
    } as Partial<Record<string, string>>
  },
  programs: {
    labels: {
      apple: 'Apple（iOS、macOS）',
      chrome: 'Chrome',
      microsoft: 'Microsoft（Windows、Edge）',
      mozilla: 'Mozilla（Firefox）'
    },
    names: { apple: 'Apple', chrome: 'Chrome', microsoft: 'Microsoft', mozilla: 'Mozilla' },
    mozillaDistrust: (name: string, after: string, issued: string) =>
      `Mozilla 不信任「${name}」在 ${after} 之後簽發的網站憑證（這張在 ${issued} 簽發）`,
    mozillaDistrustNote: (name: string, after: string, issued: string) =>
      `Mozilla 不信任「${name}」在 ${after} 之後簽發的網站憑證；這張在 ${issued} 簽發，不受影響`,
    chromeSct: (name: string, when: string, earliest: string) =>
      `Chrome 不信任「${name}」在 ${when} 之後才記錄（SCT）的憑證（這張在 ${earliest}）`,
    chromeSctNote: (name: string, when: string, earliest: string) =>
      `Chrome 不信任「${name}」在 ${when} 之後才記錄（SCT）的憑證；這張在 ${earliest}，不受影響`,
    msNotBefore: (name: string, date: string, issued: string) =>
      `Microsoft 不信任「${name}」在 ${date} 之後簽發的網站憑證（這張在 ${issued} 簽發）`,
    msNotBeforeNote: (name: string, date: string) =>
      `Microsoft 不信任「${name}」在 ${date} 之後簽發的網站憑證；這張不受影響`,
    msDisabled: (name: string, date: string) => `Microsoft 已在 ${date} 停用「${name}」`,
    msDisabledNote: (name: string, date: string) => `Microsoft 將在 ${date} 停用「${name}」`,
    msDisallowed: (name: string) => `Microsoft 不允許「${name}」用於網站`,
    constraints: (text: string) => `限制條件：${text}`,
    notIncluded: (root: string, program: string) => `「${root}」不在 ${program} 的根憑證清單中`,
    aia: (names: string[]) => `伺服器少送的「${names.join('」「')}」依 AIA 下載後才接到根憑證`,
    badColumns: 'CCADB 報表的欄位不符預期',
    badContent: 'CCADB 報表的內容不符預期',
    downloadFailed: (reason: string) => `無法下載 CCADB 資料：${reason}`
  },
  rows: {
    hachiClients: 'Hachi 本身（內建根憑證＋這台電腦加入的憑證）',
    mozilla: 'Node 內建根憑證（Mozilla）',
    mozillaClients: 'Firefox、Linux、多數 Node / Python 工具',
    system: '作業系統',
    systemError: (error: string) => `無法執行系統驗證：${error}`,
    systemNone: '這個平台沒有統一的系統驗證（各程式使用自己的根憑證清單）',
    apple: 'iOS（依 Apple 內建根憑證推測）',
    appleClients: 'iPhone / iPad App（URLSession）、iOS Safari',
    notInApple: (name: string) => `「${name}」不在 Apple 內建的根憑證中`,
    appleMissing: (name: string) => `少了中繼憑證「${name}」，也無法從憑證中的 AIA 網址下載`,
    appleRule: (rule: string, detail: string) => `${rule}：${detail}`,
    appleAia: (names: string[]) => `伺服器少送的「${names.join('」「')}」由系統自動下載（AIA）`
  },
  advice: {
    apple: (name: string) =>
      `macOS / iOS 不信任「${name}」→ 請 CA 提供 Apple 信任的根憑證（或交叉簽署的中繼憑證），或改用其他 CA。`,
    windows: (name: string) =>
      `Windows 不信任「${name}」→ 請 CA 提供 Microsoft 信任的根憑證（或交叉簽署的中繼憑證），或改用其他 CA。`,
    fullchain:
      '伺服器少送了中繼憑證：作業系統會自動下載補上所以通過，但 Hachi、Node、Python、Java、Android 等用戶端不會。請伺服器改用完整的憑證鏈（fullchain）。',
    localOnly: (name: string) =>
      `「${name}」不在 Mozilla 的根憑證清單中，只在這台電腦的信任憑證裡（例如公司內部的 CA）：其他電腦、手機與伺服器上的程式不會信任它。`,
    programs: (programs: string[], name: string) =>
      `${programs.join('、')} 沒有收錄「${name}」→ 請 CA 提供這些平台信任的根憑證（或交叉簽署的中繼憑證），或改用其他 CA。`,
    restricted: (reasons: string[]) =>
      `${reasons.join('；')} → 請 CA 改用其他根憑證重新簽發，或改用其他 CA。`,
    rules: {
      'apple-validity': '請 CA 重新簽發有效期不超過 398 天的憑證。',
      'apple-key': '請改用 RSA 2048 位元以上或 ECDSA 的金鑰重新簽發。',
      'apple-signature': '請 CA 改用 SHA-256 以上的簽章重新簽發。',
      'apple-eku': '請 CA 重新簽發包含 Extended Key Usage「serverAuth」的憑證。',
      'apple-san': '請把網域放進 Subject Alternative Name（不能只寫在 CN）重新簽發。'
    } as Partial<Record<string, string>>
  },
  system: {
    macLabel: '這台 Mac（系統驗證）',
    macClients: 'Safari、macOS App（URLSession）、系統 curl',
    windowsLabel: '這台 Windows（系統驗證）',
    windowsClients: 'Edge、Chrome、.NET / Windows App',
    badHost: '無法檢查這個主機名稱',
    cannotRun: (reason: string) => `無法執行系統驗證：${reason}`,
    cannotRead: '無法讀取憑證',
    badOutput: '無法讀取系統驗證的結果',
    failed: '驗證失敗',
    failedWith: (result: string) => `驗證失敗：${result}`,
    hostMismatch: '網域不符',
    other: (key: string) => `其他問題（${key}）`,
    reason: (text: string, cert: string) => `${text}：${cert}`,
    darwin: {
      AnchorTrusted: '根憑證不受信任',
      MissingIntermediate: '找不到簽發它的憑證（少了中繼憑證，或根憑證不受信任）',
      SSLHostname: '網域不符',
      TemporalValidity: '已過期或尚未生效',
      OtherTrustValidityPeriod: '有效期超過 Apple 的上限（398 天）',
      ValidityPeriodMaximums: '有效期超過 Apple 的上限',
      ServerAuthEKU: 'Extended Key Usage 沒有 serverAuth（不能用於網站）',
      ExtendedKeyUsage: 'Extended Key Usage 不允許用於網站',
      KeyUsage: 'Key Usage 不允許用於網站',
      KeySize: '金鑰長度不足（RSA 至少 2048 位元）',
      WeakKeySize: '金鑰長度不足（RSA 至少 2048 位元）',
      WeakSignature: '簽章演算法太弱（例如 SHA-1）',
      SignatureHashAlgorithms: '簽章演算法太弱（例如 SHA-1）',
      SystemTrustedWeakHash: '簽章演算法太弱（例如 SHA-1）',
      CTRequired: '缺少 Certificate Transparency 紀錄（SCT）',
      Revocation: '憑證已被撤銷',
      BlackListedLeaf: '憑證已被 Apple 封鎖',
      BlackListedKey: '金鑰已被 Apple 封鎖',
      GrayListedLeaf: '憑證被 Apple 列為不信任',
      GrayListedKey: '金鑰被 Apple 列為不信任',
      BasicConstraints: 'Basic Constraints 不符（不是 CA 卻簽發了憑證）',
      BasicConstraintsCA: 'Basic Constraints 不符（不是 CA 卻簽發了憑證）',
      NameConstraints: '違反 Name Constraints',
      NonEmptySubject: 'Subject 欄位不符規定',
      IdLinkage: '簽發者與被簽發者的金鑰識別碼對不上',
      CriticalExtensions: '有無法識別的關鍵擴充欄位',
      ChainLength: '憑證鏈太長'
    } as Partial<Record<string, string>>,
    win32: {
      UntrustedRoot: '根憑證不受信任',
      PartialChain: '無法建立完整的憑證鏈（少了中繼憑證，或根憑證不受信任）',
      NotTimeValid: '已過期或尚未生效',
      NotTimeNested: '有效期間不在簽發者的有效期間內',
      NotSignatureValid: '簽章無效',
      NotValidForUsage: '憑證用途不允許用於網站（缺少 serverAuth）',
      InvalidExtension: '擴充欄位無效',
      Revoked: '憑證已被撤銷',
      ExplicitDistrust: '憑證被系統設為不信任',
      HasWeakSignature: '簽章演算法太弱（例如 SHA-1）',
      InvalidBasicConstraints: 'Basic Constraints 不符',
      InvalidNameConstraints: '違反 Name Constraints',
      HasNotPermittedNameConstraint: '違反 Name Constraints',
      HasExcludedNameConstraint: '違反 Name Constraints',
      HasNotSupportedCriticalExtension: '有無法識別的關鍵擴充欄位',
      Cyclic: '憑證鏈形成循環',
      InvalidPolicyConstraints: '違反 Policy Constraints',
      NoIssuanceChainPolicy: '缺少必要的憑證政策'
    } as Partial<Record<string, string>>
  }
}
