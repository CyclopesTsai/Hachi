import type { Messages } from '../zh-TW'
import type { DocSection } from '../zh-TW/docs'

const variables: DocSection = {
  title: 'Variables',
  note: 'get looks in runtime variables > Runner data row > environment > Collection; values are always stored as text (objects become JSON).',
  entries: [
    {
      api: 'hachi.variables.get(name) / set(name, value) / unset(name) / has(name) / toObject()',
      text: 'Runtime variables: they come first, disappear when the App quits, and are shared by all requests of the Workspace.',
      example: "const token = hachi.variables.get('token')\nhachi.variables.set('ts', Date.now())"
    },
    {
      api: 'hachi.environment.get / set / unset / has / toObject, .name',
      text: 'The selected environment; written to its file when the script ends (secret values still stay in .hachi-secrets.json only). set fails when no environment is selected.',
      example: "hachi.environment.set('requestedAt', new Date().toISOString())"
    },
    {
      api: 'hachi.collectionVariables.get / set / unset / has / toObject',
      text: 'Variables of the request’s Collection, written to collection.json.',
      example: "const base = hachi.collectionVariables.get('baseUrl')"
    },
    {
      api: 'hachi.variables.replaceIn(text)',
      text: 'Replaces the {{variables}} in a text with their current values.',
      example: "const url = hachi.variables.replaceIn('{{baseUrl}}/users')"
    },
    {
      api: 'hachi.iterationData.get(name) / has / toObject',
      text: 'This round’s row of the Collection Runner data file (CSV / JSON); empty without a data file.',
      example: "const user = hachi.iterationData.get('username')"
    }
  ]
}

const requests: DocSection = {
  title: 'Other requests and flow',
  note: 'Scripts can await directly. At most 20 requests per run; the total time (waits included) is set per Workspace, 30 seconds by default.',
  entries: [
    {
      api: 'await hachi.sendRequest(url | { url, method, headers, body })',
      text: 'Sends a request and waits for the response (not recorded in the history; {{variables}} are not replaced). An object body is sent as JSON. The response has status, headers, json(), text().',
      example:
        "const res = await hachi.sendRequest({\n  url: hachi.variables.replaceIn('{{baseUrl}}/login'),\n  method: 'POST',\n  body: { user: 'demo', password: 'secret' }\n})\nhachi.variables.set('token', res.json().token)"
    },
    {
      api: "await hachi.runRequest('Folder/Request name')",
      text: 'Sends a saved request (with its scripts, captures and assertions) and returns its response; the name path is within the same Collection, nested at most 3 deep.',
      example: "const login = await hachi.runRequest('Auth/Login')\nconsole.log(login.status)"
    },
    {
      api: 'hachi.setNextRequest(name | null)',
      text: 'Collection Runner only: runs the named request next; null ends this round.',
      example: "if (hachi.response.status === 401) hachi.setNextRequest('Login')"
    },
    {
      api: 'await hachi.sleep(ms), setTimeout(fn, ms)',
      text: 'Waits for a while (counted in the script time limit).',
      example: 'await hachi.sleep(500)'
    }
  ]
}

const tools: DocSection = {
  title: 'Tools',
  entries: [
    {
      api: 'CryptoJS',
      text: 'Hashes, HMAC, AES, Base64 and more (crypto-js); require("crypto-js") works too.',
      example:
        "const sig = CryptoJS.HmacSHA256(hachi.request.body ?? '', hachi.variables.get('secret')).toString()"
    },
    {
      api: 'btoa(text) / atob(base64)',
      text: 'Base64 encoding / decoding (Latin-1 text).',
      example: "const basic = 'Basic ' + btoa('user:password')"
    },
    {
      api: 'console.log / info / warn / error',
      text: 'Shown in the Console tab of the response area.',
      example: "console.log('token', hachi.variables.get('token'))"
    },
    {
      api: 'hachi.info.requestName / eventName / iteration / iterationCount',
      text: 'The current request’s name, the phase (prerequest / test), and the Runner round / number of rounds.',
      example: 'console.log(hachi.info.requestName, hachi.info.iteration)'
    }
  ]
}

const compat: DocSection = {
  title: 'Postman / Bruno compatibility',
  note: 'Imported scripts work as they are: the common pm.* and bru / req / res calls are available.',
  entries: [
    {
      api: 'pm.variables / pm.environment / pm.collectionVariables / pm.globals, pm.sendRequest, pm.test, pm.expect',
      text: 'Postman style (pm.globals maps to runtime variables); pm.expect is Chai style (to.equal, to.have.property…).',
      example:
        "pm.environment.set('token', pm.response.json().token)\npm.test('Status 200', () => pm.response.to.have.status(200))"
    },
    {
      api: 'bru.getVar / setVar, bru.getEnvVar / setEnvVar, req.setHeader, res.getStatus, test / expect',
      text: 'Bruno style.',
      example:
        "bru.setVar('token', res.body.token)\ntest('ok', () => expect(res.getStatus()).to.equal(200))"
    }
  ]
}

const limits: DocSection = {
  title: 'Limits',
  entries: [
    {
      api: 'Sandbox',
      text: 'Scripts run in their own sandbox: no file access, no process, no Node modules (require only offers crypto-js). Computing time is at most 5 seconds; the total time including waits is set per Workspace. Hachi asks whether to trust a Workspace’s scripts before running them the first time.',
      example: '// For the network, use hachi.sendRequest, not fetch'
    }
  ]
}

const editRequest: DocSection = {
  title: 'Change the request (Pre-request only)',
  note: '{{Variables}} are replaced after your changes, so variables set here apply to this request too.',
  entries: [
    {
      api: 'hachi.request.method / url',
      text: 'Read or change the method and URL (the URL as written, before variables are replaced).',
      example: "hachi.request.url = hachi.request.url + '?debug=1'"
    },
    {
      api: 'hachi.request.body',
      text: 'The text of a JSON / Raw body (null for other body modes); can be replaced entirely.',
      example:
        "const data = JSON.parse(hachi.request.body ?? '{}')\nhachi.request.body = JSON.stringify({ ...data, ts: Date.now() })"
    },
    {
      api: 'hachi.request.headers.get(name) / set(name, value) / add / remove(name) / has / toObject()',
      text: 'The request headers (case-insensitive).',
      example: "hachi.request.headers.set('X-Signature', sig)"
    }
  ]
}

const readResponse: DocSection = {
  title: 'Response',
  entries: [
    {
      api: 'hachi.response.status / statusText / time / size',
      text: 'Status code, status text, time (ms) and size (bytes).',
      example: "console.log(hachi.response.status, hachi.response.time + ' ms')"
    },
    {
      api: 'hachi.response.json() / text()',
      text: 'Parses JSON or gets the text; fails for responses over 10 MB or binary ones.',
      example: "const data = hachi.response.json()\nhachi.environment.set('token', data.token)"
    },
    {
      api: 'hachi.response.headers.get(name) / has(name) / toObject()',
      text: 'The response headers (case-insensitive).',
      example: "const type = hachi.response.headers.get('content-type')"
    },
    {
      api: 'hachi.request.method / url / headers',
      text: 'The request as it was sent (read-only).',
      example: "console.log(hachi.request.headers.get('authorization'))"
    }
  ]
}

const testing: DocSection = {
  title: 'Tests',
  note: 'Results appear in the Tests tab of the response area and count together with the assertions (the table of the Tests tab); in the Runner, any failure fails the row.',
  entries: [
    {
      api: 'hachi.test(name, fn)',
      text: 'One test: it fails when fn throws (or an expect does not hold).',
      example:
        "hachi.test('Status 200', () => {\n  hachi.expect(hachi.response.status).toBe(200)\n})"
    },
    {
      api: 'hachi.expect(x).toBe / toEqual / toContain / toHaveProperty / toHaveLength / toMatch / toBeGreaterThan / toBeLessThan / toBeTruthy / toBeDefined…, with .not to negate',
      text: 'Jest-style matchers.',
      example:
        "const data = hachi.response.json()\nhachi.test('has a user', () => {\n  hachi.expect(data).toHaveProperty('user.id')\n  hachi.expect(data.items).not.toHaveLength(0)\n})"
    }
  ]
}

export const docs: Messages['docs'] = {
  scriptTitle: 'Script API',
  scriptDescription:
    'JavaScript; await works directly. Pre-request runs before sending, Post-response after the response arrives and captures are done.',
  script: { variables, requests, tools, compat, limits, editRequest, readResponse, testing },
  variablesTitle: 'Variables',
  variablesDescription:
    'Write {{…}}; it is replaced when sending, and the editor content stays as it is.',
  variables: {
    title: 'Variables',
    note: 'Work in the URL, Params, Headers, Auth and Body. Order: runtime variables > Runner data row > environment > Collection.',
    api: '{{name}}',
    text: 'Replaced by the variable’s value; hover a variable to see where it comes from and edit it. Values can use variables too (up to 10 levels). Unknown variables are sent as they are and listed above the response.'
  },
  dynamic: {
    title: 'Dynamic variables',
    note: 'Each send (and each place they appear) gets a new value; a variable with the same name wins.'
  },
  file: {
    title: 'Files',
    api: '{{$file:base64:path}}',
    text: (mb) =>
      `Reads the file when sending and inserts it as base64 (e.g. an image), up to ${mb} MB per file. The path can be absolute, start with ~, or be relative to the Workspace folder (files inside the Workspace can be shared with git). Hachi asks before reading a file outside the Workspace the first time. Generated code (Code) does not include file contents.`
  }
}
