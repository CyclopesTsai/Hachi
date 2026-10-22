/** Import / export dialogs and their reports. */
export const transfer = {
  formats: {
    postman: 'Postman Collection v2.1',
    'bruno-yaml': 'Bruno 資料夾（YAML）',
    bruno: 'Bruno 資料夾（.bru）',
    'openapi-html': 'OpenAPI 文件（HTML）',
    'openapi-json': 'OpenAPI 3.0（JSON）'
  },
  hints: {
    postman: '單一 JSON 檔，可匯入 Postman 或 Hachi',
    'bruno-yaml':
      'Bruno 3.1 起的預設格式（opencollection.yml），連同所有環境（機密變數只匯出名稱）',
    bruno: '舊版 Bruno 也能開（.bru 檔），連同所有環境（機密變數只匯出名稱）',
    'openapi-html': '可直接用瀏覽器開啟的 API 文件（內嵌 Redoc，離線可用）',
    'openapi-json': '給其他工具使用的 OpenAPI 規格檔'
  },
  curlTitle: '匯入 cURL',
  curlDescription:
    '貼上 cURL 指令（例如瀏覽器開發者工具的「Copy as cURL」），會開成未儲存的新分頁。',
  curlLabel: 'cURL 指令',
  import: '匯入',
  exportTitle: '匯出 Collection',
  format: '格式',
  environment: '伺服器網址與範例值使用的環境',
  noEnvironment: '不使用環境（只用 Collection 變數）',
  noSecrets: '機密變數的值不會寫進文件。',
  chooseFolder: '選擇資料夾…',
  export: '匯出…',
  brunoTitle: '匯入 Bruno Collection',
  brunoDescription: (folder: string, count: number) =>
    `「${folder}」裡有 ${count} 個 Collection，勾選要匯入的項目。環境會命名為「Collection 名稱 / 環境名稱」。`,
  selectAll: '全選',
  importCount: (n: number) => `匯入 ${n} 個`,
  dropTitle: '放開以匯入',
  dropHint:
    'Postman Collection / Environment、Bruno Collection（.json），或內容是 cURL 指令的文字檔（Bruno 資料夾請用「＋」→ 匯入 Bruno 資料夾…）',
  report: {
    createdCollection: (name: string) => `已建立 Collection「${name}」`,
    counts: (requests: number, folders: number, variables: number) =>
      `${requests} 個請求、${folders} 個資料夾、${variables} 個變數`,
    createdEnvironments: (names: string[]) =>
      `已建立環境：${names.map((n) => `「${n}」`).join('、')}`,
    createdEnvironment: (name: string) => `已建立環境「${name}」`,
    variables: (n: number) => `${n} 個變數`,
    failed: '匯入失敗',
    results: '匯入結果',
    done: '匯入完成',
    curlImported: '已匯入 cURL',
    openedAsDraft: '已開成未儲存的新分頁',
    noWebSocket: (names: string[]) =>
      `這個格式不支援 WebSocket，以下項目未匯出：${names.join('、')}`,
    unreadable: (names: string[]) => `以下項目的檔案無法讀取，未匯出：${names.join('、')}`,
    exported: '匯出完成',
    savedTo: (path: string) => `已儲存到 ${path}`,
    tooLarge: '檔案太大（上限 50 MB）',
    curlFile: 'cURL 已開成未儲存的新分頁',
    rest: (n: number) => `其餘 ${n} 個檔案`,
    tooMany: (max: number) => `一次最多匯入 ${max} 個檔案`
  }
}
