/**
 * 按标签页独立会话的测试。
 *
 * 背景：用户报告"两个窗口登录两个账号，其中一个刷新后变成另一个账号"。
 * 根因是 cookie 名固定（cv_sid）、一个域只有一份，B 登录会覆盖 A。
 *
 * 现在前端把会话令牌存进 sessionStorage（每标签页独立），
 * 请求带 Authorization 头，后端**优先认这个头**。
 *
 * 所以这个测试必须**模拟两个标签页各自持有不同令牌**，
 * 并且故意让 cookie 指向第三方 —— 只测"一个窗口能登录"是没用的，
 * 那样永远发现不了"cookie 悄悄覆盖了标签页的令牌"。
 */

import { spawn } from 'node:child_process'

const API = 'http://127.0.0.1:5175/api'
const TMP = process.env.TEMP
const port = 9255
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

/* ── 纯 HTTP 部分：标签页令牌 vs cookie 的优先级 ── */
const loginRaw = async (account, password) => {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password }),
  })
  const j = await r.json()
  return {
    cookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; '),
    sid: j.data?.sessionToken,
    user: j.data?.user,
  }
}

console.log('=== 准备两个账号的会话 ===')
const A = await loginRaw('admin', 'Cv-Dev-Only-2026')

/* 第二个账号用**临时注册**的，不依赖用户设的密码。
   测试结束会删掉。密码里刻意避开 012/abc/qwe 这类顺序字符 —— 服务端会拒。 */
const TMP_PW = 'Mv7$kQp9Lw'
const reg = await fetch(`${API}/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: TMP_PW, confirm: TMP_PW }),
}).then((r) => r.json())

let B = reg.ok ? await loginRaw(reg.data.account, TMP_PW) : null
if (!B?.sid) {
  console.log('  !! 临时账号注册/登录失败:', JSON.stringify(reg.error ?? {}).slice(0, 120))
  process.exit(1)
}
const tmpAccount = reg.data.account
console.log(`  A = ${A.user?.account}   sid=${String(A.sid).slice(0, 12)}…`)
console.log(`  B = ${B.user?.account}（临时）  sid=${String(B.sid).slice(0, 12)}…`)

check('登录接口返回了 sessionToken', !!A.sid && !!B.sid, `${String(A.sid).slice(0, 8)} / ${String(B.sid).slice(0, 8)}`)
check('两个账号的会话令牌不同', A.sid !== B.sid)

const meWith = async (headers) => {
  const r = await fetch(`${API}/auth/me`, { headers })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, account: j.data?.user?.account, sid: j.data?.sessionToken }
}

console.log('')
console.log('=== 核心场景：cookie 指向 A，但标签页令牌是 B ===')
const mixed = await meWith({ Cookie: A.cookie, Authorization: `Bearer ${B.sid}` })
console.log(`  /auth/me -> ${mixed.status}  ${mixed.account}`)
check('**标签页令牌优先于 cookie**（应返回 B）', mixed.account === B.user.account, String(mixed.account))

console.log('')
console.log('=== 对照：只带 cookie（新标签页继承用）===')
const cookieOnly = await meWith({ Cookie: A.cookie })
check('只带 cookie 时返回 cookie 对应的账号', cookieOnly.account === A.user.account, String(cookieOnly.account))

console.log('')
console.log('=== 对照：只带令牌（cookie 已被别的账号覆盖）===')
const tokenOnly = await meWith({ Authorization: `Bearer ${A.sid}` })
check('只带令牌也能认出账号（不依赖 cookie）', tokenOnly.account === A.user.account, String(tokenOnly.account))

console.log('')
console.log('=== /auth/me 会回传令牌，供新标签页继承 ===')
check('回传的令牌 = 本次请求用的令牌', cookieOnly.sid === A.sid, String(cookieOnly.sid).slice(0, 12))
check('带令牌请求时也回传同一份', tokenOnly.sid === A.sid)

console.log('')
console.log('=== 作废的令牌应当被拒绝（且**不能回退到 cookie**）===')
// HTTP 头必须是 latin1，这里不能用中文
const dead = await meWith({ Authorization: 'Bearer deadbeefdeadbeefdeadbeefdeadbeef', Cookie: A.cookie })
console.log(`  无效令牌 + 有效 cookie -> ${dead.status} ${dead.account ?? ''}`)
check('无效标签页令牌不会回退到 cookie（防止串号）', dead.status !== 200, `HTTP ${dead.status}`)

/* ── 浏览器部分：验证 sessionStorage 真的是每标签页独立的 ── */
console.log('')
console.log('=== 浏览器：验证 sessionStorage 的标签页隔离 ===')

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const l = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
      const p = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (p) return p.webSocketDebuggerUrl
    } catch { /* retry */ }
    await sleep(250)
  }
  throw new Error('CDP 超时')
}

const proc = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run',
  `--user-data-dir=${TMP}\\cv-tab`, '--window-size=1200,900', '--remote-debugging-port=' + port, 'about:blank'],
  { stdio: 'ignore', windowsHide: true })

const ws1 = new WebSocket(await connect())
await new Promise((r) => ws1.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
ws1.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send1 = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws1.send(JSON.stringify({ id: i, method, params })) })
const ev1 = async (expr) => {
  const r = await send1('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}

await send1('Page.enable'); await send1('Runtime.enable')
await send1('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(3500)

// 标签页 1：写入一个令牌
await ev1(`sessionStorage.setItem('cv.sid', ${JSON.stringify(A.sid)}); 1`)
const tab1 = await ev1(`sessionStorage.getItem('cv.sid')`)

// 新开一个标签页，检查 sessionStorage 是否独立
const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
  .then((r) => r.json()).catch(() => null)

if (created?.webSocketDebuggerUrl) {
  const ws2 = new WebSocket(created.webSocketDebuggerUrl)
  await new Promise((r) => ws2.addEventListener('open', r, { once: true }))
  let id2 = 10000
  const pend2 = new Map()
  ws2.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pend2.has(m.id)) { pend2.get(m.id)(m); pend2.delete(m.id) }
  })
  const send2 = (method, params = {}) =>
    new Promise((res) => { const i = ++id2; pend2.set(i, res); ws2.send(JSON.stringify({ id: i, method, params })) })
  const ev2 = async (expr) => {
    const r = await send2('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    return r.result?.result?.value
  }
  await send2('Page.enable'); await send2('Runtime.enable')
  await send2('Page.navigate', { url: 'http://127.0.0.1:5174/' })
  await sleep(3000)

  const tab2 = await ev2(`sessionStorage.getItem('cv.sid')`)
  const cookieIn2 = await ev2(`document.cookie`)
  console.log(`  标签页1 sessionStorage: ${String(tab1).slice(0, 14)}…`)
  console.log(`  标签页2 sessionStorage: ${tab2 === null ? '(空 —— 符合预期)' : String(tab2).slice(0, 14) + '…'}`)
  console.log(`  标签页2 能读到的 document.cookie: ${JSON.stringify(cookieIn2)}（httpOnly 的 cv_sid 读不到）`)

  check('sessionStorage 是新标签页独立的', tab2 === null, tab2 === null ? '' : '标签页2 竟然读到了标签页1 的值')

  // 标签页2 登录临时账号，不影响标签页1
  await ev2(`fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
    credentials:'include', body: JSON.stringify({ account:${JSON.stringify(tmpAccount)}, password:${JSON.stringify(TMP_PW)} }) })
    .then(r=>r.json()).then(j=>{ if(j.data && j.data.sessionToken) sessionStorage.setItem('cv.sid', j.data.sessionToken); return 1 })`)
  await sleep(1500)

  const tab1After = await ev1(`sessionStorage.getItem('cv.sid')`)
  const tab2After = await ev2(`sessionStorage.getItem('cv.sid')`)
  console.log('')
  console.log(`  标签页2 登录临时账号之后：`)
  console.log(`    标签页1 的令牌: ${String(tab1After).slice(0, 14)}…`)
  console.log(`    标签页2 的令牌: ${String(tab2After).slice(0, 14)}…`)

  check('标签页1 的令牌**没有**被标签页2 的登录改掉', tab1After === A.sid, tab1After === A.sid ? '' : '被覆盖了')
  /* 注意：不能拿它跟 B.sid 比 —— 登录会**新建**一个会话，
     所以标签页2 拿到的是全新令牌，和它上一次登录的令牌本来就不同。 */
  check('标签页2 拿到了一个非空的、属于自己的令牌',
    typeof tab2After === 'string' && tab2After.length > 20, String(tab2After).slice(0, 14))
  check('两个标签页的令牌不同', tab1After !== tab2After)

  // 再确认：标签页2 的令牌确实指向临时账号
  const who2 = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${tab2After}` } })
    .then((r) => r.json()).catch(() => ({}))
  check('标签页2 的令牌指向临时账号', who2.data?.user?.account === tmpAccount, String(who2.data?.user?.account))

  // 标签页1 的令牌仍指向 A（服务端没被"最后一次登录"影响）
  const who1 = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${tab1After}` } })
    .then((r) => r.json()).catch(() => ({}))
  check('标签页1 的令牌仍指向 A', who1.data?.user?.account === A.user.account, String(who1.data?.user?.account))

  ws2.close()
} else {
  check('能新开标签页', false, 'CDP 新建标签页失败')
}

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

/* 清理临时账号 */
try {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync('D:/MyWeb/server/data/vault.db')
  const u = db.prepare('SELECT id FROM users WHERE account = ?').get(tmpAccount)
  if (u) {
    for (const t of ['profiles', 'sessions', 'courses', 'schedule_slots', 'import_tokens', 'import_log', 'activity_log']) {
      try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(u.id) } catch { /* 表结构不同，跳过 */ }
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id)
    console.log(`已删除临时账号 ${tmpAccount}`)
  }
  db.close()
} catch (e) {
  console.log('清理临时账号失败:', e.message)
}

ws1.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
