/**
 * JavaScript evaluated inside the QuickJS sandbox before the user's script. It defines
 * the script API (`hachi.*`, the `pm.*` subset of decision 72, `console`, `btoa` / `atob`)
 * on top of a JSON snapshot (`__hachiInput`); nothing outside the sandbox is reachable.
 * `__hachiFinish()` returns what the script did (logs, tests, variable changes, request).
 *
 * Keep it ES2020 and self-contained: it is plain text to QuickJS, not compiled by Vite.
 */
export const PRELUDE = String.raw`
(function () {
  'use strict'
  var input = JSON.parse(globalThis.__hachiInput)
  delete globalThis.__hachiInput
  var L = input.limits
  var phase = input.phase
  var logs = []
  var tests = []
  var changes = []
  var hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k) }

  // ---- helpers -------------------------------------------------------------
  function typeOf(v) {
    if (v === null) return 'null'
    if (Array.isArray(v)) return 'array'
    return typeof v
  }
  function fmt(v) {
    if (typeof v === 'string') return JSON.stringify(v)
    if (v === undefined) return 'undefined'
    if (typeof v === 'function') return '[Function]'
    try { var s = JSON.stringify(v); return s === undefined ? String(v) : s } catch (e) { return String(v) }
  }
  function short(s) { return s.length > 200 ? s.slice(0, 200) + '…' : s }
  function deepEqual(a, b) {
    if (Object.is(a, b)) return true
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
    if (Array.isArray(a) !== Array.isArray(b)) return false
    var ka = Object.keys(a), kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    for (var i = 0; i < ka.length; i++) {
      if (!hasOwn(b, ka[i]) || !deepEqual(a[ka[i]], b[ka[i]])) return false
    }
    return true
  }
  function toText(v) {
    if (v === undefined || v === null) return ''
    if (typeof v === 'string') return v
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v)
  }
  function parsePath(path) {
    var rest = String(path).trim(), parts = [], m
    if (rest.charAt(0) === '$') rest = rest.slice(1)
    while (rest !== '') {
      if (rest.charAt(0) === '.') { rest = rest.slice(1); continue }
      if ((m = /^\[\s*(\d+)\s*\]/.exec(rest))) { parts.push(Number(m[1])); rest = rest.slice(m[0].length); continue }
      if ((m = /^\[\s*(["'])((?:\\.|(?!\1).)*)\1\s*\]/.exec(rest))) { parts.push(m[2]); rest = rest.slice(m[0].length); continue }
      m = /^[^.[]+/.exec(rest)
      if (!m) throw new Error('無效的路徑：' + path)
      parts.push(m[0]); rest = rest.slice(m[0].length)
    }
    return parts
  }
  function getPath(obj, path) {
    var parts = typeof path === 'string' ? parsePath(path) : [path], cur = obj
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || typeof cur !== 'object' || !hasOwn(cur, parts[i])) return { found: false }
      cur = cur[parts[i]]
    }
    return { found: true, value: cur }
  }

  function AssertionError(message) { this.name = 'AssertionError'; this.message = message }
  AssertionError.prototype = Object.create(Error.prototype)
  AssertionError.prototype.constructor = AssertionError
  function errorText(e) {
    if (e && typeof e === 'object' && 'message' in e) return String(e.message)
    return String(e)
  }

  // ---- console ---------------------------------------------------------------
  function logger(level) {
    return function () {
      if (logs.length >= L.logs) return
      var parts = []
      for (var i = 0; i < arguments.length; i++) {
        var a = arguments[i]
        parts.push(typeof a === 'string' ? a : fmt(a))
      }
      var text = parts.join(' ')
      if (text.length > L.logText) text = text.slice(0, L.logText) + '…（已截斷）'
      logs.push({ level: level, text: text })
      if (logs.length === L.logs) logs.push({ level: 'warn', text: '輸出太多，後面的 console 訊息已省略' })
    }
  }
  globalThis.console = {
    log: logger('log'), info: logger('info'), debug: logger('log'),
    warn: logger('warn'), error: logger('error')
  }

  // ---- variables -------------------------------------------------------------
  var scopes = {
    runtime: Object.assign({}, input.variables.runtime),
    environment: input.variables.environment ? Object.assign({}, input.variables.environment) : null,
    collection: input.variables.collection ? Object.assign({}, input.variables.collection) : null
  }
  var MISSING = {
    environment: '目前沒有選擇環境，無法設定環境變數',
    collection: '這個請求不在 Collection 中，無法設定 Collection 變數'
  }
  function record(scope, key, value) {
    if (changes.length >= L.changes) throw new Error('變數變更太多（上限 ' + L.changes + '）')
    changes.push({ scope: scope, name: key, value: value })
  }
  function makeScope(scope) {
    return {
      get: function (key) {
        var s = scopes[scope]
        return s && hasOwn(s, String(key)) ? s[String(key)] : undefined
      },
      has: function (key) { var s = scopes[scope]; return !!s && hasOwn(s, String(key)) },
      set: function (key, value) {
        key = String(key)
        if (key.trim() === '') throw new Error('變數名稱不能是空白')
        if (scopes[scope] === null) throw new Error(MISSING[scope])
        var text = toText(value)
        if (text.length > L.value) throw new Error('變數值太長（上限 1 MB）：' + key)
        scopes[scope][key] = text
        record(scope, key, text)
      },
      unset: function (key) {
        key = String(key)
        if (scopes[scope] === null) throw new Error(MISSING[scope])
        if (!hasOwn(scopes[scope], key)) return
        delete scopes[scope][key]
        record(scope, key, null)
      },
      toObject: function () { return Object.assign({}, scopes[scope] || {}) }
    }
  }
  var runtimeScope = makeScope('runtime')
  var environmentScope = makeScope('environment')
  var collectionScope = makeScope('collection')
  environmentScope.name = input.info.environmentName
  collectionScope.name = input.info.collectionName

  // Data-file row of a Collection Runner round (read-only), between runtime and environment.
  var dataRow = input.iterationData || null
  var iterationData = {
    get: function (key) { return dataRow && hasOwn(dataRow, String(key)) ? dataRow[String(key)] : undefined },
    has: function (key) { return !!dataRow && hasOwn(dataRow, String(key)) },
    toObject: function () { return Object.assign({}, dataRow || {}) },
    toJSON: function () { return Object.assign({}, dataRow || {}) }
  }
  function lookup(key) {
    key = String(key)
    if (hasOwn(scopes.runtime, key)) return scopes.runtime[key]
    if (dataRow && hasOwn(dataRow, key)) return dataRow[key]
    var order = ['environment', 'collection']
    for (var i = 0; i < order.length; i++) {
      var s = scopes[order[i]]
      if (s && hasOwn(s, key)) return s[key]
    }
    return undefined
  }
  function replaceIn(text) {
    var depth = 0
    var out = String(text)
    while (depth++ < 10 && /\{\{[^{}]+\}\}/.test(out)) {
      var next = out.replace(/\{\{([^{}]+)\}\}/g, function (whole, name) {
        var v = lookup(name.trim())
        return v === undefined ? whole : v
      })
      if (next === out) break
      out = next
    }
    return out
  }
  var variables = {
    get: lookup,
    has: function (key) { return lookup(key) !== undefined },
    set: runtimeScope.set,
    unset: runtimeScope.unset,
    replaceIn: replaceIn,
    toObject: function () {
      return Object.assign({}, scopes.collection || {}, scopes.environment || {}, dataRow || {}, scopes.runtime)
    }
  }

  // ---- request ---------------------------------------------------------------
  var req = input.request
  var requestChanged = false
  function editable() {
    if (phase !== 'preRequest') throw new Error('Post-response 腳本不能修改請求')
    requestChanged = true
  }
  function headerKV(nameOrObj, value) {
    if (nameOrObj && typeof nameOrObj === 'object') return [String(nameOrObj.key), toText(nameOrObj.value)]
    return [String(nameOrObj), toText(value)]
  }
  function headerList(list, writable) {
    var find = function (name) {
      var lower = String(name).toLowerCase()
      for (var i = 0; i < list.length; i++) if (list[i][0].toLowerCase() === lower) return i
      return -1
    }
    var api = {
      get: function (name) { var i = find(name); return i < 0 ? undefined : list[i][1] },
      has: function (name) { return find(name) >= 0 },
      toObject: function () {
        var o = {}
        for (var i = 0; i < list.length; i++) o[list[i][0]] = list[i][1]
        return o
      },
      all: function () { return list.map(function (h) { return { key: h[0], value: h[1] } }) },
      each: function (fn) { api.all().forEach(fn) }
    }
    if (writable) {
      api.set = function (name, value) {
        editable()
        var kv = headerKV(name, value), i = find(kv[0])
        if (i < 0) list.push(kv)
        else list[i] = kv
      }
      api.upsert = api.set
      api.add = function (name, value) { editable(); list.push(headerKV(name, value)) }
      api.remove = function (name) {
        editable()
        var lower = String(name && typeof name === 'object' ? name.key : name).toLowerCase()
        for (var i = list.length - 1; i >= 0; i--) if (list[i][0].toLowerCase() === lower) list.splice(i, 1)
      }
    } else {
      api.set = api.upsert = api.add = api.remove = function () { editable() }
    }
    return api
  }
  var requestHeaders = headerList(req.headers, phase === 'preRequest')
  function setBody(text) {
    editable()
    if (req.body === null) throw new Error('只有 JSON / Raw Body 可以在腳本中修改')
    req.body = toText(text)
  }
  var hachiRequest = {
    headers: requestHeaders,
    get method() { return req.method },
    set method(v) { editable(); req.method = String(v).toUpperCase() },
    get url() { return req.url },
    set url(v) { editable(); req.url = String(v) },
    get body() { return req.body },
    set body(v) { setBody(v) }
  }
  var pmUrl = {
    toString: function () { return req.url },
    update: function (u) { editable(); req.url = String(u) },
    getQueryString: function () { var q = req.url.indexOf('?'); return q < 0 ? '' : req.url.slice(q + 1) }
  }
  var pmBody = {
    get mode() { return req.body === null ? 'none' : 'raw' },
    get raw() { return req.body === null ? undefined : req.body },
    set raw(v) { setBody(v) },
    update: function (v) { setBody(v && typeof v === 'object' ? v.raw : v) },
    toString: function () { return req.body === null ? '' : req.body }
  }
  var pmRequest = {
    headers: requestHeaders,
    body: pmBody,
    get method() { return req.method },
    set method(v) { editable(); req.method = String(v).toUpperCase() },
    get url() { return pmUrl },
    set url(v) { editable(); req.url = String(v) },
    addHeader: function (h) { requestHeaders.add(h) },
    removeHeader: function (n) { requestHeaders.remove(n) },
    upsertHeader: function (h) { requestHeaders.set(h) }
  }

  // ---- response --------------------------------------------------------------
  var res = input.response
  function noResponse() { throw new Error('Pre-request 腳本中還沒有回應') }
  function bodyText() {
    if (!res) noResponse()
    if (res.body === null) throw new Error(res.bodyUnavailable || '無法讀取回應內容')
    return res.body
  }
  var responseHeaders = res ? headerList(res.headers, false) : null
  var hachiResponse = res
    ? {
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
        time: res.timeMs,
        size: res.sizeBytes,
        text: bodyText,
        json: function () { return JSON.parse(bodyText()) }
      }
    : null

  // ---- tests and expectations ------------------------------------------------
  function test(name, fn) {
    name = String(name)
    try {
      if (typeof fn === 'function') fn()
      tests.push({ name: name, passed: true })
    } catch (e) {
      tests.push({ name: name, passed: false, error: errorText(e) })
    }
  }

  // Jest-style: hachi.expect(x).toBe(1), .not.toContain(…)
  function matchers(actual, negate) {
    function check(pass, message) {
      if (negate ? pass : !pass) throw new AssertionError('expected ' + short(fmt(actual)) + (negate ? ' not ' : ' ') + message)
    }
    var m = {
      toBe: function (e) { check(Object.is(actual, e), 'to be ' + short(fmt(e))) },
      toEqual: function (e) { check(deepEqual(actual, e), 'to equal ' + short(fmt(e))) },
      toStrictEqual: function (e) { check(deepEqual(actual, e), 'to equal ' + short(fmt(e))) },
      toBeTruthy: function () { check(!!actual, 'to be truthy') },
      toBeFalsy: function () { check(!actual, 'to be falsy') },
      toBeNull: function () { check(actual === null, 'to be null') },
      toBeUndefined: function () { check(actual === undefined, 'to be undefined') },
      toBeDefined: function () { check(actual !== undefined, 'to be defined') },
      toBeNaN: function () { check(Number.isNaN(actual), 'to be NaN') },
      toContain: function (item) {
        var pass = typeof actual === 'string' ? actual.indexOf(String(item)) >= 0
          : Array.isArray(actual) ? actual.indexOf(item) >= 0 : false
        check(pass, 'to contain ' + short(fmt(item)))
      },
      toContainEqual: function (item) {
        check(Array.isArray(actual) && actual.some(function (x) { return deepEqual(x, item) }), 'to contain equal ' + short(fmt(item)))
      },
      toHaveLength: function (n) { check(actual != null && actual.length === n, 'to have length ' + n) },
      toHaveProperty: function (path, value) {
        var found = actual != null && typeof actual === 'object' ? getPath(actual, path) : { found: false }
        var pass = found.found && (arguments.length < 2 || deepEqual(found.value, value))
        check(pass, 'to have property ' + path + (arguments.length < 2 ? '' : ' = ' + short(fmt(value))))
      },
      toMatch: function (re) {
        var r = re instanceof RegExp ? re : new RegExp(String(re))
        check(typeof actual === 'string' && r.test(actual), 'to match ' + String(r))
      },
      toBeGreaterThan: function (n) { check(actual > n, 'to be greater than ' + n) },
      toBeGreaterThanOrEqual: function (n) { check(actual >= n, 'to be greater than or equal to ' + n) },
      toBeLessThan: function (n) { check(actual < n, 'to be less than ' + n) },
      toBeLessThanOrEqual: function (n) { check(actual <= n, 'to be less than or equal to ' + n) },
      toBeTypeOf: function (t) { check(typeOf(actual) === t, 'to be of type ' + t) },
      toBeOneOf: function (list) {
        check(Array.isArray(list) && list.some(function (x) { return deepEqual(x, actual) }), 'to be one of ' + short(fmt(list)))
      }
    }
    Object.defineProperty(m, 'not', { get: function () { return matchers(actual, !negate) } })
    return m
  }
  function hachiExpect(actual) { return matchers(actual, false) }

  // Chai-style (pm.expect): expect(x).to.be.an('array').that.is.not.empty
  function Assertion(obj) { this._obj = obj; this._not = false; this._deep = false; this._nested = false; this._any = false }
  var chainWords = ['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'same', 'but', 'does', 'still', 'also', 'own']
  chainWords.forEach(function (w) {
    Object.defineProperty(Assertion.prototype, w, { get: function () { return this } })
  })
  var flags = { not: '_not', deep: '_deep', nested: '_nested', any: '_any', all: null }
  Object.keys(flags).forEach(function (f) {
    Object.defineProperty(Assertion.prototype, f, {
      get: function () {
        if (f === 'not') this._not = !this._not
        else if (flags[f]) this[flags[f]] = true
        return this
      }
    })
  })
  Assertion.prototype._check = function (pass, message) {
    if (this._not ? pass : !pass) {
      throw new AssertionError('expected ' + short(fmt(this._obj)) + (this._not ? ' not ' : ' ') + message)
    }
    return this
  }
  var props = {
    ok: function (o) { return [!!o, 'to be truthy'] },
    true: function (o) { return [o === true, 'to be true'] },
    false: function (o) { return [o === false, 'to be false'] },
    null: function (o) { return [o === null, 'to be null'] },
    undefined: function (o) { return [o === undefined, 'to be undefined'] },
    NaN: function (o) { return [Number.isNaN(o), 'to be NaN'] },
    exist: function (o) { return [o !== null && o !== undefined, 'to exist'] },
    empty: function (o) {
      var empty = typeof o === 'string' || Array.isArray(o) ? o.length === 0
        : o && typeof o === 'object' ? Object.keys(o).length === 0 : false
      return [empty, 'to be empty']
    },
    finite: function (o) { return [Number.isFinite(o), 'to be finite'] }
  }
  Object.keys(props).forEach(function (p) {
    Object.defineProperty(Assertion.prototype, p, {
      get: function () { var r = props[p](this._obj); return this._check(r[0], r[1]) }
    })
  })
  var A = Assertion.prototype
  A.equal = A.equals = A.eq = function (v) {
    return this._check(this._deep ? deepEqual(this._obj, v) : this._obj === v, (this._deep ? 'to deeply equal ' : 'to equal ') + short(fmt(v)))
  }
  A.eql = A.eqls = function (v) { return this._check(deepEqual(this._obj, v), 'to deeply equal ' + short(fmt(v))) }
  A.above = A.gt = A.greaterThan = function (n) { return this._check(this._obj > n, 'to be above ' + n) }
  A.least = A.gte = A.greaterThanOrEqual = function (n) { return this._check(this._obj >= n, 'to be at least ' + n) }
  A.below = A.lt = A.lessThan = function (n) { return this._check(this._obj < n, 'to be below ' + n) }
  A.most = A.lte = A.lessThanOrEqual = function (n) { return this._check(this._obj <= n, 'to be at most ' + n) }
  A.within = function (a, b) { return this._check(this._obj >= a && this._obj <= b, 'to be within ' + a + '..' + b) }
  A.closeTo = A.approximately = function (n, d) { return this._check(Math.abs(this._obj - n) <= d, 'to be close to ' + n + ' +/- ' + d) }
  A.a = A.an = function (type) { return this._check(typeOf(this._obj) === String(type).toLowerCase(), 'to be a ' + type) }
  A.include = A.includes = A.contain = A.contains = function (v) {
    var o = this._obj, deep = this._deep, pass
    if (typeof o === 'string') pass = o.indexOf(String(v)) >= 0
    else if (Array.isArray(o)) pass = o.some(function (x) { return deep ? deepEqual(x, v) : x === v })
    else if (o && typeof o === 'object' && v && typeof v === 'object') {
      pass = Object.keys(v).every(function (k) { return hasOwn(o, k) && (deep ? deepEqual(o[k], v[k]) : o[k] === v[k]) })
    } else pass = false
    return this._check(pass, 'to include ' + short(fmt(v)))
  }
  A.property = function (name, value) {
    var o = this._obj
    var found = o !== null && o !== undefined && typeof o === 'object'
      ? (this._nested ? getPath(o, name) : (hasOwn(o, name) ? { found: true, value: o[name] } : { found: false }))
      : { found: false }
    var pass = found.found && (arguments.length < 2 || (this._deep ? deepEqual(found.value, value) : found.value === value))
    this._check(pass, 'to have property ' + JSON.stringify(String(name)) + (arguments.length < 2 ? '' : ' of ' + short(fmt(value))))
    if (found.found && !this._not) { var next = new Assertion(found.value); return next }
    return this
  }
  A.lengthOf = A.length = function (n) {
    return this._check(this._obj != null && this._obj.length === n, 'to have length ' + n)
  }
  A.match = A.matches = function (re) {
    var r = re instanceof RegExp ? re : new RegExp(String(re))
    return this._check(r.test(String(this._obj)), 'to match ' + String(r))
  }
  A.string = function (s) { return this._check(typeof this._obj === 'string' && this._obj.indexOf(s) >= 0, 'to contain string ' + JSON.stringify(s)) }
  A.oneOf = function (list) {
    var o = this._obj
    return this._check(list.some(function (x) { return deepEqual(x, o) }), 'to be one of ' + short(fmt(list)))
  }
  A.members = function (list) {
    var o = this._obj
    var pass = Array.isArray(o) && o.length === list.length && list.every(function (x) { return o.some(function (y) { return deepEqual(x, y) }) })
    return this._check(pass, 'to have the same members as ' + short(fmt(list)))
  }
  A.keys = A.key = function () {
    var wanted = Array.isArray(arguments[0]) ? arguments[0] : Array.prototype.slice.call(arguments)
    var actualKeys = this._obj && typeof this._obj === 'object' ? Object.keys(this._obj) : []
    var o = this._obj
    var pass = this._any
      ? wanted.some(function (k) { return hasOwn(o, k) })
      : wanted.length === actualKeys.length && wanted.every(function (k) { return hasOwn(o, k) })
    return this._check(pass, 'to have keys ' + short(fmt(wanted)))
  }
  A.satisfy = A.satisfies = function (fn) { return this._check(!!fn(this._obj), 'to satisfy the given function') }
  A.instanceOf = A.instanceof = function (C) { return this._check(this._obj instanceof C, 'to be an instance of ' + (C && C.name)) }
  // pm.expect(pm.response).to.have.status(200) and friends.
  A.status = function (code) {
    var r = this._obj
    return this._check(r && (typeof code === 'number' ? r.code === code : r.status === code), 'to have status ' + code)
  }
  A.header = function (name, value) {
    var h = this._obj && this._obj.headers
    var has = !!h && h.has(name)
    return this._check(has && (arguments.length < 2 || h.get(name) === value), 'to have header ' + name)
  }
  function chaiExpect(v) { return new Assertion(v) }
  chaiExpect.fail = function (message) { throw new AssertionError(message || 'expect.fail()') }

  // ---- Postman compatibility (pm.*) --------------------------------------------
  var pmResponse = null
  if (res) {
    var statusName = res.statusText
    pmResponse = {
      code: res.status,
      status: statusName,
      reason: function () { return statusName },
      responseTime: res.timeMs,
      responseSize: res.sizeBytes,
      headers: responseHeaders,
      text: bodyText,
      json: function () { return JSON.parse(bodyText()) }
    }
    var range = function (from, to) { return res.status >= from && res.status <= to }
    var be = {}
    var beChecks = {
      ok: [range(200, 299), '2xx'], success: [range(200, 299), '2xx'], info: [range(100, 199), '1xx'],
      redirection: [range(300, 399), '3xx'], clientError: [range(400, 499), '4xx'],
      serverError: [range(500, 599), '5xx'], error: [range(400, 599), '4xx / 5xx'],
      accepted: [res.status === 202, '202'], badRequest: [res.status === 400, '400'],
      unauthorized: [res.status === 401, '401'], forbidden: [res.status === 403, '403'],
      notFound: [res.status === 404, '404'], rateLimited: [res.status === 429, '429']
    }
    Object.keys(beChecks).forEach(function (k) {
      Object.defineProperty(be, k, {
        get: function () {
          if (!beChecks[k][0]) throw new AssertionError('expected response to be ' + beChecks[k][1] + ' but got ' + res.status)
          return true
        }
      })
    })
    pmResponse.to = {
      be: be,
      have: {
        status: function (code) { chaiExpect(pmResponse).to.have.status(code) },
        header: function (name, value) {
          if (arguments.length < 2) chaiExpect(pmResponse).to.have.header(name)
          else chaiExpect(pmResponse).to.have.header(name, value)
        },
        body: function (text) {
          if (arguments.length === 0) { if (bodyText() === '') throw new AssertionError('expected response to have a body') }
          else if (bodyText() !== text) throw new AssertionError('expected response body to equal ' + short(fmt(text)))
        },
        jsonBody: function (path, value) {
          var body = JSON.parse(bodyText())
          if (arguments.length === 0) return
          var found = getPath(body, path)
          if (!found.found || (arguments.length > 1 && !deepEqual(found.value, value))) {
            throw new AssertionError('expected response to have JSON property ' + path)
          }
        }
      }
    }
    pmResponse.to.not = {
      have: {
        status: function (code) { chaiExpect(pmResponse).to.not.have.status(code) },
        header: function (name) { chaiExpect(pmResponse).to.not.have.header(name) }
      }
    }
  }
  function unsupported(name) {
    return function () { throw new Error('Hachi 不支援 ' + name) }
  }
  var pmTest = function (name, fn) { test(name, fn); return pm }
  pmTest.skip = function (name) { logger('info')('略過測試：' + name); return pm }
  var pm = {
    info: {
      requestName: input.info.requestName,
      eventName: phase === 'preRequest' ? 'prerequest' : 'test',
      iteration: input.info.iteration,
      iterationCount: input.info.iterationCount
    },
    variables: variables,
    environment: environmentScope,
    collectionVariables: collectionScope,
    globals: runtimeScope,
    iterationData: iterationData,
    request: pmRequest,
    response: pmResponse,
    test: pmTest,
    expect: chaiExpect,
    sendRequest: unsupported('pm.sendRequest'),
    setNextRequest: unsupported('pm.setNextRequest')
  }
  Object.defineProperty(pm, 'cookies', { get: unsupported('pm.cookies') })
  Object.defineProperty(pm, 'vault', { get: unsupported('pm.vault') })

  // Legacy Postman globals (old "tests[...]" scripts).
  var legacyTests = {}
  var postman = {
    setEnvironmentVariable: function (k, v) { environmentScope.set(k, v) },
    getEnvironmentVariable: function (k) { return environmentScope.get(k) },
    clearEnvironmentVariable: function (k) { environmentScope.unset(k) },
    setGlobalVariable: function (k, v) { runtimeScope.set(k, v) },
    getGlobalVariable: function (k) { return runtimeScope.get(k) },
    clearGlobalVariable: function (k) { runtimeScope.unset(k) },
    getResponseHeader: function (name) { return responseHeaders ? responseHeaders.get(name) : undefined },
    setNextRequest: unsupported('postman.setNextRequest')
  }

  // ---- Bruno compatibility (bru / req / res, decision 104) -----------------------
  function parsedOrText(text) {
    try { return JSON.parse(text) } catch (e) { return text }
  }
  var bru = {
    getEnvName: function () { return input.info.environmentName },
    getEnvVar: environmentScope.get,
    setEnvVar: environmentScope.set,
    hasEnvVar: environmentScope.has,
    deleteEnvVar: environmentScope.unset,
    getVar: runtimeScope.get,
    setVar: runtimeScope.set,
    hasVar: runtimeScope.has,
    deleteVar: runtimeScope.unset,
    getGlobalEnvVar: runtimeScope.get,
    setGlobalEnvVar: runtimeScope.set,
    getCollectionVar: collectionScope.get,
    getCollectionName: function () { return input.info.collectionName },
    getRequestVar: lookup,
    getFolderVar: lookup,
    interpolate: function (v) { return typeof v === 'string' ? replaceIn(v) : v },
    sleep: function () { logger('warn')('Hachi 的腳本是同步執行，bru.sleep() 不會等待') },
    getProcessEnv: unsupported('bru.getProcessEnv'),
    sendRequest: unsupported('bru.sendRequest'),
    runRequest: unsupported('bru.runRequest'),
    setNextRequest: unsupported('bru.setNextRequest')
  }
  Object.defineProperty(bru, 'runner', { get: unsupported('bru.runner') })
  Object.defineProperty(bru, 'cookies', { get: unsupported('bru.cookies') })

  var brunoReq = {
    getName: function () { return input.info.requestName },
    getUrl: function () { return req.url },
    setUrl: function (u) { editable(); req.url = String(u) },
    getMethod: function () { return req.method },
    setMethod: function (m) { editable(); req.method = String(m).toUpperCase() },
    getHeader: function (name) { return requestHeaders.get(name) },
    getHeaders: function () { return requestHeaders.toObject() },
    setHeader: function (name, value) { requestHeaders.set(name, value) },
    setHeaders: function (obj) {
      Object.keys(obj || {}).forEach(function (k) { requestHeaders.set(k, obj[k]) })
    },
    deleteHeader: function (name) { requestHeaders.remove(name) },
    getBody: function () { return req.body === null ? undefined : parsedOrText(req.body) },
    setBody: function (v) { setBody(v) },
    getTimeout: unsupported('req.getTimeout'),
    setTimeout: unsupported('req.setTimeout'),
    setMaxRedirects: unsupported('req.setMaxRedirects')
  }
  Object.defineProperty(brunoReq, 'url', { get: brunoReq.getUrl, set: brunoReq.setUrl })
  Object.defineProperty(brunoReq, 'method', { get: brunoReq.getMethod, set: brunoReq.setMethod })
  Object.defineProperty(brunoReq, 'headers', { get: brunoReq.getHeaders })
  Object.defineProperty(brunoReq, 'body', { get: brunoReq.getBody, set: brunoReq.setBody })

  // res is a function in Bruno: res('data.items[0].id') reads the JSON body.
  var brunoRes = null
  if (res) {
    var lowerHeaders = {}
    res.headers.forEach(function (h) { lowerHeaders[h[0].toLowerCase()] = h[1] })
    var resBody = function () {
      var text
      try { text = bodyText() } catch (e) { return undefined }
      return parsedOrText(text)
    }
    brunoRes = function (path) {
      var body = resBody()
      if (path === undefined || path === '') return body
      if (body === null || typeof body !== 'object') return undefined
      var found = getPath(body, String(path))
      return found.found ? found.value : undefined
    }
    brunoRes.getStatus = function () { return res.status }
    brunoRes.getStatusText = function () { return res.statusText }
    brunoRes.getHeader = function (name) { return lowerHeaders[String(name).toLowerCase()] }
    brunoRes.getHeaders = function () { return Object.assign({}, lowerHeaders) }
    brunoRes.getBody = resBody
    brunoRes.getResponseTime = function () { return res.timeMs }
    brunoRes.getSize = function () { return { body: res.sizeBytes, header: 0, total: res.sizeBytes } }
    brunoRes.status = res.status
    brunoRes.statusText = res.statusText
    brunoRes.headers = lowerHeaders
    brunoRes.responseTime = res.timeMs
    Object.defineProperty(brunoRes, 'body', { get: resBody })
  }

  // ---- base64 ------------------------------------------------------------------
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  function btoa(input) {
    var str = String(input), out = ''
    for (var i = 0; i < str.length; i += 3) {
      var a = str.charCodeAt(i), b = str.charCodeAt(i + 1), c = str.charCodeAt(i + 2)
      if (a > 255 || b > 255 || c > 255) throw new Error('btoa: 只接受 Latin-1 字元')
      var n = (a << 16) | ((b || 0) << 8) | (c || 0)
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < str.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < str.length ? B64[n & 63] : '=')
    }
    return out
  }
  function atob(input) {
    var str = String(input).replace(/[\s=]+/g, ''), out = '', bits = 0, value = 0
    for (var i = 0; i < str.length; i++) {
      var idx = B64.indexOf(str[i])
      if (idx < 0) throw new Error('atob: 不是有效的 Base64')
      value = (value << 6) | idx
      bits += 6
      if (bits >= 8) { bits -= 8; out += String.fromCharCode((value >> bits) & 255) }
    }
    return out
  }

  // ---- globals -------------------------------------------------------------------
  globalThis.hachi = {
    variables: variables,
    environment: environmentScope,
    collectionVariables: collectionScope,
    request: hachiRequest,
    response: hachiResponse,
    info: pm.info,
    iterationData: iterationData,
    test: test,
    expect: hachiExpect
  }
  globalThis.pm = pm
  globalThis.postman = postman
  globalThis.tests = legacyTests
  globalThis.bru = bru
  globalThis.req = brunoReq
  if (brunoRes) globalThis.res = brunoRes
  // Bruno tests: test('name', fn) with Chai's expect.
  globalThis.test = test
  globalThis.expect = chaiExpect
  globalThis.btoa = btoa
  globalThis.atob = atob
  globalThis.require = function (name) {
    if (name === 'crypto-js' && typeof globalThis.CryptoJS !== 'undefined') return globalThis.CryptoJS
    throw new Error("Hachi 不支援 require('" + name + "')（只有 crypto-js）")
  }
  if (res) {
    globalThis.responseCode = { code: res.status, name: res.statusText, detail: res.statusText }
    globalThis.responseTime = res.timeMs
    globalThis.responseHeaders = responseHeaders.toObject()
    Object.defineProperty(globalThis, 'responseBody', {
      get: function () { try { return bodyText() } catch (e) { return '' } }
    })
  }

  Object.defineProperty(globalThis, '__hachiFinish', {
    value: function () {
      Object.keys(legacyTests).forEach(function (k) {
        tests.push(legacyTests[k] ? { name: k, passed: true } : { name: k, passed: false, error: 'tests["' + k + '"] 為 false' })
      })
      return JSON.stringify({
        logs: logs,
        tests: tests,
        changes: changes,
        request: phase === 'preRequest' && requestChanged ? req : null
      })
    },
    writable: false,
    configurable: false
  })
})()
`
