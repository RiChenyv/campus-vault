/**
 * 头像不能依赖 cookie。
 *
 * 用户报告：`Cunriyang` 账号头像显示成空白圆。
 *
 * 根因：头像地址是裸的 `/api/files/<id>/raw`，被塞进 `<img src>`。
 * `<img>` **发不出 Authorization 头**，只能用 cookie ——
 * 而按标签页独立会话之后，cookie 未必是当前标签页的账号。
 * 于是服务端按归属校验返回 404，头像空白。
 *
 * 所以这个测试的核心不是"头像能显示"，而是：
 * **把 cookie 换成别人的账号之后，头像仍然要能显示。**
 * 只测"正常登录时头像可见"是查不出这个 bug 的 —— 那种情况本来就能过。
 */

import { spawn } from 'node:child_process'

const API = 'http://127.0.0.1:5175/api'
const TMP = process.env.TEMP
const port = 9268
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

const PW = 'Mv7$kQp9Lw'
const loginRaw = async (account, password) => {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password }),
  })
  const j = await r.json()
  return {
    sid: j.data?.sessionToken,
    setCookie: r.headers.getSetCookie?.() ?? [],
  }
}

/* ── 一次性账号 + 给它上传一张头像 ── */
const reg = await (await fetch(`${API}/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: PW, confirm: PW }),
})).json()
if (!reg.ok) { console.log('注册失败', JSON.stringify(reg.error)); process.exit(1) }
const ACC = reg.data.account
const guest = await loginRaw(ACC, PW)
const cookieOf = (l) => l.setCookie.map((c) => c.split(';')[0]).join('; ')
const guestCookie = cookieOf(guest)

// 一张 2x2 的红色 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
  'base64',
)
const form = new FormData()
form.append('files', new Blob([PNG]), 'avatar.png')
form.append('scope', 'avatar')
const up = await (await fetch(`${API}/files`, { method: 'POST', headers: { Cookie: guestCookie }, body: form })).json()
const avatarId = up.data.files[0].id
await fetch(`${API}/auth/profile`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: guestCookie },
  body: JSON.stringify({ avatarFileId: avatarId }),
})
console.log(`临时账号 ${ACC}，头像文件 ${avatarId.slice(0, 8)}…`)
console.log('')

console.log('')

/* ── 浏览器 ── */
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
  `--user-data-dir=${TMP}\\cv-avatar`, '--window-size=1600,1200', '--remote-debugging-port=' + port, 'about:blank'],
  { stdio: 'ignore', windowsHide: true })
const ws = new WebSocket(await connect())
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description || '').slice(0, 400))
  return r.result?.result?.value
}

/** 找出页面上所有头像 <img>，看它们加载成功没有 */
const avatarState = () => ev(`(function(){
  var imgs = Array.from(document.querySelectorAll('img')).filter(function(e){
    return /^blob:/.test(e.src) || /\\/api\\/files\\//.test(e.src) });
  return JSON.stringify(imgs.map(function(e){
    return { src: e.src.slice(0, 40), ok: e.complete && e.naturalWidth > 0, w: e.naturalWidth }
  }))
})()`)

await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(3000)
await ev(`fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ account:${JSON.stringify(ACC)}, password:${JSON.stringify(PW)} }) }).then(r=>r.status)`)
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(4500)

console.log('=== ① 正常情况下头像能显示 ===')
const normal = JSON.parse(await avatarState())
console.log('  ', JSON.stringify(normal))
check('页面上找到头像 <img>', normal.length > 0, `${normal.length} 个`)
check('头像用的是 blob: 地址（不是裸 URL）',
  normal.every((i) => i.src.startsWith('blob:')),
  normal.map((i) => i.src.slice(0, 24)).join(' | '))
check('头像加载成功', normal.some((i) => i.ok && i.w > 0), JSON.stringify(normal.map((i) => i.w)))

/* ── 关键场景：cookie 没了（等价于"cookie 指向了别的账号/被别的窗口覆盖"）──
   为什么用"删掉"而不是"换成管理员的"：
   Network.setCookie 只会**新增**一个域 cookie，原来的 host-only cookie 还在且优先匹配，
   对照实验就不成立了（上一版因此误得 200）。删掉则没有歧义：
   任何依赖 cookie 的请求必然 401。 */
console.log('')
console.log('=== ② 把 cv_sid cookie 删掉之后 ===')

await send('Network.enable')
/* host-only cookie 必须带 url 才能删掉，只给 name 是不生效的
   —— 少了这个参数，下面的对照实验会假通过 */
await send('Network.deleteCookies', { name: 'cv_sid', url: 'http://127.0.0.1:5174/' })
await sleep(400)

// 确认：不带 Authorization 头的请求现在应该认不出身份了
const meNoHeader = JSON.parse(await ev(`fetch('/api/auth/me')
  .then(r=>r.json()).then(j=>JSON.stringify({ok:j.ok, account:j.data&&j.data.user?j.data.user.account:null}))`))
console.log('  /auth/me（不带令牌头，只靠 cookie）:', JSON.stringify(meNoHeader))
check('cookie 删除后，裸 cookie 路径已认不出身份', meNoHeader.ok !== true, JSON.stringify(meNoHeader))

// 刷新：sessionStorage 里还是临时账号的令牌，cookie 是管理员的
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(4500)

const polluted = JSON.parse(await avatarState())
console.log('  ', JSON.stringify(polluted))
check('**cookie 指向别人时，头像仍然显示**',
  polluted.some((i) => i.ok && i.w > 0),
  JSON.stringify(polluted))

// 用**界面显示的账号名**判断身份，而不是自己发请求 —— 后者测的是我的 fetch
const shown = String(await ev(`document.body.innerText`))
check('页面显示的仍是临时账号（没被 cookie 带跑）', shown.includes(ACC), shown.slice(0, 80).replace(/\n/g, ' '))

/* ── 对照：裸 URL 在这种情况下确实会 404（证明这个测试有意义）── */
console.log('')
console.log('=== ③ 对照：直接请求裸 URL ===')
/* 必须 no-store：这个 URL 之前成功取过一次，浏览器会启发式缓存，
   裸 fetch 直接命中缓存返回 200 —— 对照实验就假通过了 */
const viaCookie = await ev(`fetch('/api/files/${avatarId}/raw', { credentials: 'include', cache: 'no-store' })
  .then(r => r.status).catch(() => -1)`)
console.log('  不带令牌头、只靠 cookie 请求头像 ->', viaCookie)
check('**裸 URL 在没有 cookie 时确实失败**（说明修复是必要的）', viaCookie !== 200, `HTTP ${viaCookie}`)

const viaHeader = await ev(`(function(){
  var sid = sessionStorage.getItem('cv.sid');
  return fetch('/api/files/${avatarId}/raw', { cache: 'no-store', headers: { Authorization: 'Bearer ' + sid } })
    .then(function(r){ return r.status }).catch(function(){ return -1 });
})()`)
console.log('  带上本标签页的令牌 ->', viaHeader)
check('带令牌能正常取到（修复走的就是这条路）', viaHeader === 200, `HTTP ${viaHeader}`)

/* ── 清理 ── */
const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync('D:/MyWeb/server/data/vault.db')
const u = db.prepare('SELECT id FROM users WHERE account = ?').get(ACC)
if (u) {
  const fs = db.prepare('SELECT store_path FROM files WHERE owner_id = ?').all(u.id)
  for (const t of ['profiles', 'sessions', 'courses', 'schedule_slots', 'import_tokens', 'import_log', 'activity_log'])
    { try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(u.id) } catch { /* 表结构不同 */ } }
  db.prepare('DELETE FROM files WHERE owner_id = ?').run(u.id)
  const { rm } = await import('node:fs/promises')
  const { resolve } = await import('node:path')
  for (const f of fs) {
    const abs = resolve('D:/MyWeb/server/data', f.store_path)
    if (abs.startsWith(resolve('D:/MyWeb/server/data'))) await rm(abs, { force: true }).catch(() => {})
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id)
  console.log('')
  console.log(`已清理临时账号 ${ACC}`)
}
db.close()

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
