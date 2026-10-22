/** Script runtime (main, utility process and the QuickJS sandbox). */
export const scriptMain = {
  engine: {
    interrupted: (seconds: number) => `腳本執行超過 ${seconds} 秒，已中止`,
    memory: (mb: number) => `腳本使用的記憶體超過上限（${mb} MB）`,
    stackOverflow: '腳本遞迴太深（堆疊溢位）',
    atLine: (line: string) => `（第 ${line} 行）`,
    noHost: '這裡不能從腳本送出請求',
    maxRequests: (max: number) => `每次執行最多送出 ${max} 個請求`,
    pendingForever: '腳本在等待一個永遠不會完成的 Promise',
    totalTimeout: (seconds: number) => `腳本總時間超過 ${seconds} 秒（含等待請求），已中止`
  },
  host: {
    noAnswer: '腳本沒有回應，已中止',
    cannotRun: (error: string) => `無法執行腳本：${error}`,
    unknownError: '未知錯誤',
    exited: '腳本程序意外結束',
    restarted: '腳本程序已重新啟動'
  },
  /**
   * Texts of the sandbox prelude: plain strings (they cross into QuickJS as JSON),
   * `{0}` is replaced by the prelude.
   */
  sandbox: {
    invalidPath: '無效的路徑：{0}',
    truncated: '…（已截斷）',
    tooManyLogs: '輸出太多，後面的 console 訊息已省略',
    noEnvironment: '目前沒有選擇環境，無法設定環境變數',
    noCollection: '這個請求不在 Collection 中，無法設定 Collection 變數',
    tooManyChanges: '變數變更太多（上限 {0}）',
    emptyName: '變數名稱不能是空白',
    valueTooLong: '變數值太長（上限 1 MB）：{0}',
    readOnlyRequest: 'Post-response 腳本不能修改請求',
    bodyNotEditable: '只有 JSON / Raw Body 可以在腳本中修改',
    noResponse: 'Pre-request 腳本中還沒有回應',
    cannotReadBody: '無法讀取回應內容',
    sendRequestSpec: 'sendRequest 需要網址或請求設定',
    sendRequestFormdata: 'sendRequest 不支援 formdata Body',
    sendRequestBody: '回應不是文字或太大，腳本無法讀取',
    unsupported: 'Hachi 不支援 {0}',
    skipped: '略過測試：{0}',
    btoaLatin1: 'btoa: 只接受 Latin-1 字元',
    atobInvalid: 'atob: 不是有效的 Base64',
    requireUnsupported: "Hachi 不支援 require('{0}')（只有 crypto-js）",
    legacyFalse: 'tests["{0}"] 為 false'
  }
}
