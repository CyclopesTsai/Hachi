/** Content of the help windows: 「可用的 API」 (Scripts) and 「可用的變數」 (Body). */

export interface DocEntry {
  /** The call, e.g. `hachi.variables.get(name)`. */
  api: string
  text: string
  example: string
}

export interface DocSection {
  title: string
  note?: string
  entries: DocEntry[]
}

const variables: DocSection = {
  title: '變數',
  note: 'get 依「暫存變數 > Runner 資料列 > 環境 > Collection」取值；值一律存成文字（物件會轉成 JSON）。',
  entries: [
    {
      api: 'hachi.variables.get(name) / set(name, value) / unset(name) / has(name) / toObject()',
      text: '暫存變數：優先順序最高，App 關閉就消失，同一個 Workspace 的所有請求共用。',
      example: "const token = hachi.variables.get('token')\nhachi.variables.set('ts', Date.now())"
    },
    {
      api: 'hachi.environment.get / set / unset / has / toObject、.name',
      text: '目前選擇的環境；腳本結束後寫入環境檔（機密變數的值仍只存在 .hachi-secrets.json）。沒有選環境時 set 會出錯。',
      example: "hachi.environment.set('requestedAt', new Date().toISOString())"
    },
    {
      api: 'hachi.collectionVariables.get / set / unset / has / toObject',
      text: '這個請求所在 Collection 的變數，寫入 collection.json。',
      example: "const base = hachi.collectionVariables.get('baseUrl')"
    },
    {
      api: 'hachi.variables.replaceIn(text)',
      text: '把文字中的 {{變數}} 換成目前的值。',
      example: "const url = hachi.variables.replaceIn('{{baseUrl}}/users')"
    },
    {
      api: 'hachi.iterationData.get(name) / has / toObject',
      text: 'Collection Runner 資料檔（CSV / JSON）這一輪的那一列；沒有資料檔時是空的。',
      example: "const user = hachi.iterationData.get('username')"
    }
  ]
}

const requests: DocSection = {
  title: '送出其他請求與流程',
  note: '腳本可以直接 await。每次執行最多送出 20 個請求；總時間（含等待）依 Workspace 設定，預設 30 秒。',
  entries: [
    {
      api: 'await hachi.sendRequest(url | { url, method, headers, body })',
      text: '送出一個請求並等待回應（不記錄在歷史、不替換 {{變數}}）。body 是物件時以 JSON 送出。回應有 status、headers、json()、text()。',
      example:
        "const res = await hachi.sendRequest({\n  url: hachi.variables.replaceIn('{{baseUrl}}/login'),\n  method: 'POST',\n  body: { user: 'demo', password: 'secret' }\n})\nhachi.variables.set('token', res.json().token)"
    },
    {
      api: "await hachi.runRequest('資料夾/請求名稱')",
      text: '用已儲存的請求（含它的腳本、擷取與斷言）送出並回傳回應；名稱路徑在同一個 Collection 內，最多巢狀 3 層。',
      example: "const login = await hachi.runRequest('Auth/Login')\nconsole.log(login.status)"
    },
    {
      api: 'hachi.setNextRequest(name | null)',
      text: '只在 Collection Runner 中有效：接著執行指定名稱的請求；null 結束這一輪。',
      example: "if (hachi.response.status === 401) hachi.setNextRequest('Login')"
    },
    {
      api: 'await hachi.sleep(ms)、setTimeout(fn, ms)',
      text: '等待一段時間（算在腳本總時間內）。',
      example: 'await hachi.sleep(500)'
    }
  ]
}

const tools: DocSection = {
  title: '工具',
  entries: [
    {
      api: 'CryptoJS',
      text: '雜湊、HMAC、AES、Base64 等（crypto-js），也可以 require("crypto-js")。',
      example:
        "const sig = CryptoJS.HmacSHA256(hachi.request.body ?? '', hachi.variables.get('secret')).toString()"
    },
    {
      api: 'btoa(text) / atob(base64)',
      text: 'Base64 編碼 / 解碼（Latin-1 文字）。',
      example: "const basic = 'Basic ' + btoa('user:password')"
    },
    {
      api: 'console.log / info / warn / error',
      text: '輸出顯示在回應區的 Console 分頁。',
      example: "console.log('token', hachi.variables.get('token'))"
    },
    {
      api: 'hachi.info.requestName / eventName / iteration / iterationCount',
      text: '目前的請求名稱、階段（prerequest / test），以及 Runner 的第幾輪 / 總輪數。',
      example: 'console.log(hachi.info.requestName, hachi.info.iteration)'
    }
  ]
}

const compat: DocSection = {
  title: 'Postman / Bruno 相容',
  note: '匯入的腳本不用改寫：常用的 pm.* 與 bru / req / res 都可以使用。',
  entries: [
    {
      api: 'pm.variables / pm.environment / pm.collectionVariables / pm.globals、pm.sendRequest、pm.test、pm.expect',
      text: 'Postman 的寫法（pm.globals 對應暫存變數）；pm.expect 是 Chai 風格（to.equal、to.have.property…）。',
      example:
        "pm.environment.set('token', pm.response.json().token)\npm.test('狀態碼 200', () => pm.response.to.have.status(200))"
    },
    {
      api: 'bru.getVar / setVar、bru.getEnvVar / setEnvVar、req.setHeader、res.getStatus、test / expect',
      text: 'Bruno 的寫法。',
      example:
        "bru.setVar('token', res.body.token)\ntest('ok', () => expect(res.getStatus()).to.equal(200))"
    }
  ]
}

const limits: DocSection = {
  title: '限制',
  entries: [
    {
      api: '沙箱',
      text: '腳本在獨立的沙箱中執行：沒有檔案存取、process、Node 模組（require 只能用 crypto-js）。計算時間最多 5 秒，加上等待請求的總時間依 Workspace 設定。第一次執行某個 Workspace 的腳本前會詢問是否信任。',
      example: '// 需要網路時請用 hachi.sendRequest，不要用 fetch'
    }
  ]
}

const editRequest: DocSection = {
  title: '修改請求（只有 Pre-request 可以改）',
  note: '修改後才替換 {{變數}} 並送出，所以這裡設定的變數也會用在這個請求上。',
  entries: [
    {
      api: 'hachi.request.method / url',
      text: '讀取或修改方法與網址（網址仍是替換變數前的樣子）。',
      example: "hachi.request.url = hachi.request.url + '?debug=1'"
    },
    {
      api: 'hachi.request.body',
      text: 'JSON / Raw Body 的文字（其他 Body 模式為 null），可以整段改掉。',
      example:
        "const data = JSON.parse(hachi.request.body ?? '{}')\nhachi.request.body = JSON.stringify({ ...data, ts: Date.now() })"
    },
    {
      api: 'hachi.request.headers.get(name) / set(name, value) / add / remove(name) / has / toObject()',
      text: '請求的 Headers（不分大小寫）。',
      example: "hachi.request.headers.set('X-Signature', sig)"
    }
  ]
}

const readResponse: DocSection = {
  title: '回應',
  entries: [
    {
      api: 'hachi.response.status / statusText / time / size',
      text: '狀態碼、狀態文字、耗時（毫秒）、大小（bytes）。',
      example: "console.log(hachi.response.status, hachi.response.time + ' ms')"
    },
    {
      api: 'hachi.response.json() / text()',
      text: '解析 JSON 或取得文字；超過 10 MB 或二進位的回應會出錯。',
      example: "const data = hachi.response.json()\nhachi.environment.set('token', data.token)"
    },
    {
      api: 'hachi.response.headers.get(name) / has(name) / toObject()',
      text: '回應的 Headers（不分大小寫）。',
      example: "const type = hachi.response.headers.get('content-type')"
    },
    {
      api: 'hachi.request.method / url / headers',
      text: '實際送出的請求（唯讀）。',
      example: "console.log(hachi.request.headers.get('authorization'))"
    }
  ]
}

const testing: DocSection = {
  title: '測試',
  note: '結果顯示在回應區的 Tests 分頁，和斷言（Tests 頁籤的表格）一起計算通過數；在 Runner 中有失敗就算這一列失敗。',
  entries: [
    {
      api: 'hachi.test(name, fn)',
      text: '一項測試：fn 中丟出錯誤（或 expect 不符）就算失敗。',
      example:
        "hachi.test('狀態碼 200', () => {\n  hachi.expect(hachi.response.status).toBe(200)\n})"
    },
    {
      api: 'hachi.expect(x).toBe / toEqual / toContain / toHaveProperty / toHaveLength / toMatch / toBeGreaterThan / toBeLessThan / toBeTruthy / toBeDefined…，加 .not 反向',
      text: 'Jest 風格的比對。',
      example:
        "const data = hachi.response.json()\nhachi.test('有使用者', () => {\n  hachi.expect(data).toHaveProperty('user.id')\n  hachi.expect(data.items).not.toHaveLength(0)\n})"
    }
  ]
}

export const docs = {
  scriptTitle: '腳本可用的 API',
  scriptDescription:
    'JavaScript，可以直接使用 await。Pre-request 在發送前執行，Post-response 在收到回應、擷取變數之後執行。',
  script: { variables, requests, tools, compat, limits, editRequest, readResponse, testing },
  variablesTitle: '可用的變數',
  variablesDescription: '寫成 {{…}}，送出時才替換；編輯器中的內容不會改變。',
  variables: {
    title: '變數',
    note: '可以用在網址、Params、Headers、Auth 與 Body。優先順序：暫存變數 > Runner 資料列 > 環境 > Collection。',
    api: '{{名稱}}',
    text: '換成變數的值；滑鼠移到變數上可以看到來源並直接修改。變數的值裡也可以再用變數（最多 10 層）。找不到的變數照原樣送出，並列在回應上方。'
  },
  dynamic: {
    title: '動態變數',
    note: '每次送出（每個出現的位置）都產生新的值；有同名的變數時以變數為準。'
  },
  file: {
    title: '檔案',
    api: '{{$file:base64:路徑}}',
    text: (mb: number) =>
      `送出時讀取檔案並換成 base64（例如圖片），單檔上限 ${mb} MB。路徑可以是絕對路徑、~ 開頭，或相對於 Workspace 資料夾（放在 Workspace 中可以跟著 git 分享）。Workspace 以外的檔案第一次送出時會詢問是否允許。程式碼產生（Code）不會放入檔案內容。`
  }
}
