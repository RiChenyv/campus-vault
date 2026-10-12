/**
 * 题库「一键全部删除」。
 *
 * ⚠️ 这个测试**必须用一次性账号**。
 * 上一版直接用主账号跑，结果把用户真实的 23 个题库文件连磁盘副本一起删了 ——
 * 而 clearAll 是硬删除（fs.rm，不进回收站），无法恢复。
 * 「清空」这类破坏性测试只要碰真实数据，迟早会删掉不该删的东西。
 *
 * 用一次性账号还有个额外好处：顺便验证了清空是**按用户隔离**的 ——
 * 主账号的文件必须一个都不少。
 *
 * 三条要点，缺一条都会出事：
 *  ① 界面上有入口，且有明确的确认关卡（不可逆操作不能一键就删）
 *  ② 数据库行删掉了
 *  ③ **磁盘文件也删掉了** —— 只删库的话磁盘越积越多，用户看不到也清不掉
 */

import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'

const API = 'http://127.0.0.1:5175/api'
const TMP = process.env.TEMP
const DATA_FILES = 'D:\\MyWeb\\server\\data\\files'
const port = 9267
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

const RUN = String(Date.now()).slice(-6)
const PW = 'Mv7$kQp9Lw'

const loginOf = async (account, password) =>
  (await (await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password }),
  })).headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')

/* ── 一次性账号 ── */
const reg = await (await fetch(`${API}/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: PW, confirm: PW }),
})).json()
if (!reg.ok) { console.log('注册临时账号失败:', JSON.stringify(reg.error)); process.exit(1) }
const TMP_ACCOUNT = reg.data.account
const guest = await loginOf(TMP_ACCOUNT, PW)
const owner = await loginOf('admin', 'Cv-Dev-Only-2026')

console.log(`临时账号 ${TMP_ACCOUNT}（测完删除）`)
console.log('')

const listOf = async (cookie, scope) =>
  (await (await fetch(`${API}/files?scope=${scope}`, { headers: { Cookie: cookie } })).json()).data.files

/** 主账号的题库 —— 全程必须一个不少 */
const ownerBefore = (await listOf(owner, 'qbank')).length
console.log('主账号题库文件数（全程不应变化）:', ownerBefore)
console.log('')

/** 用这个账号上传文件 */
async function upload(cookie, name, body, scope = 'qbank', folder = '') {
  const form = new FormData()
  form.append('files', new Blob([body]), name)
  form.append('scope', scope)
  if (folder) form.append('folder', folder)
  const r = await fetch(`${API}/files`, { method: 'POST', headers: { Cookie: cookie }, body: form })
  return (await r.json()).data?.files?.[0]
}

const fA = await upload(guest, `A-${RUN}.md`, '# A\n', 'qbank', `清空测试-${RUN}`)
const fB = await upload(guest, `B-${RUN}.txt`, 'B\n', 'qbank', `清空测试-${RUN}/子目录`)
// 灵感配图：验证清空题库不会顺手删掉别的范围
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const ideaFile = await upload(guest, `ping-${RUN}.png`, png, 'idea')

console.log('=== 准备 ===')
console.log('  题库文件:', [fA?.name, fB?.name].join(', '))
console.log('  灵感配图:', ideaFile?.name)
console.log('')

const diskExists = (id) => {
  try {
    return readdirSync(DATA_FILES, { recursive: true }).some((p) => String(p).includes(id))
  } catch {
    return false
  }
}
check('题库文件在磁盘上存在', diskExists(fA.id) && diskExists(fB.id))
check('灵感配图在磁盘上存在', diskExists(ideaFile.id))

/* ── 浏览器：用这个临时账号登录 ── */
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
  `--user-data-dir=${TMP}\\cv-clear`, '--window-size=1600,1200', '--remote-debugging-port=' + port, 'about:blank'],
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

await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(3000)
await ev(`fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ account:${JSON.stringify(TMP_ACCOUNT)}, password:${JSON.stringify(PW)} }) }).then(r=>r.status)`)
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(4000)
await ev(`(function(){var b=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim().indexOf('题库')===0);if(b)b.click();return 1})()`)
await sleep(2500)

console.log('')
console.log('=== ① 界面入口与确认关卡 ===')
check('有「清空题库」按钮', (await ev(`!!document.querySelector('[aria-label="清空题库"]')`)) === true)

const btnText = String(await ev(`(function(){var e=document.querySelector('[aria-label="清空题库"]');return e?e.textContent.trim():''})()`))
console.log('  按钮文字:', btnText)
check('按钮上标了会删多少个', /\d+\s*个文件/.test(btnText), btnText)

await ev(`document.querySelector('[aria-label="清空题库"]').click(); 1`)
await sleep(900)
const dialog = JSON.parse(await ev(`(function(){
  var d = document.querySelector('[role="dialog"]');
  return JSON.stringify({ open: !!d, text: d ? d.innerText.replace(/\\n/g, ' | ') : '' })
})()`))
console.log('  弹窗:', dialog.text.slice(0, 130))
check('点按钮先弹确认框（不是直接删）', dialog.open === true)
check('弹窗写明了会删多少个', /全部 \d+ 个文件/.test(dialog.text))
check('弹窗说明了不可撤销', /不可撤销/.test(dialog.text))

/* 取消 —— 数据必须一个不少 */
await ev(`document.querySelector('[aria-label="取消"]').click(); 1`)
await sleep(900)
check('点取消后什么都没删', (await listOf(guest, 'qbank')).length === 2, `${(await listOf(guest, 'qbank')).length} 个`)

/* ── ② 真正确认删除 ── */
console.log('')
console.log('=== ② 确认删除 ===')
await ev(`document.querySelector('[aria-label="清空题库"]').click(); 1`)
await sleep(800)
await ev(`(function(){
  var b = Array.from(document.querySelectorAll('[role="dialog"] button'))
    .find(function(e){ return (e.getAttribute('aria-label')||'').indexOf('删除全部') === 0 });
  if (b) b.click(); return 1 })()`)
await sleep(3500)

check('题库被清空了', (await listOf(guest, 'qbank')).length === 0, `${(await listOf(guest, 'qbank')).length} 个`)

/* ── ③ 磁盘也清了 ── */
console.log('')
console.log('=== ③ 磁盘文件 ===')
check('磁盘上的题库文件也删了', !diskExists(fA.id) && !diskExists(fB.id),
  diskExists(fA.id) ? 'A 还在' : diskExists(fB.id) ? 'B 还在' : '都清了')

/* ── ④ 不误伤 ── */
console.log('')
console.log('=== ④ 不误伤 ===')
check('灵感配图没被顺手删掉（数据库）', (await listOf(guest, 'idea')).some((f) => f.id === ideaFile.id))
check('灵感配图没被顺手删掉（磁盘）', diskExists(ideaFile.id))
check('**主账号的题库一个都没少**', (await listOf(owner, 'qbank')).length === ownerBefore,
  `${ownerBefore} -> ${(await listOf(owner, 'qbank')).length}`)

/* ── ⑤ 界面同步 ── */
const ui = JSON.parse(await ev(`(function(){
  var t = document.body.innerText;
  return JSON.stringify({
    btn: !!document.querySelector('[aria-label="清空题库"]'),
    empty: t.indexOf('题库还是空的') >= 0,
  })
})()`))
check('清空后按钮消失', ui.btn === false)
check('界面显示空状态', ui.empty === true)

/* ── 清理临时账号 ── */
const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync('D:/MyWeb/server/data/vault.db')
const u = db.prepare('SELECT id FROM users WHERE account = ?').get(TMP_ACCOUNT)
if (u) {
  for (const t of ['profiles', 'sessions', 'courses', 'schedule_slots', 'import_tokens', 'import_log', 'activity_log']) {
    try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(u.id) } catch { /* 表结构不同 */ }
  }
  // 这个账号的文件也要连磁盘一起清掉，别留孤儿
  const fs = db.prepare('SELECT id, store_path FROM files WHERE owner_id = ?').all(u.id)
  db.prepare('DELETE FROM files WHERE owner_id = ?').run(u.id)
  const { rm } = await import('node:fs/promises')
  const { resolve } = await import('node:path')
  for (const f of fs) {
    const abs = resolve('D:/MyWeb/server/data', f.store_path)
    if (abs.startsWith(resolve('D:/MyWeb/server/data'))) await rm(abs, { force: true }).catch(() => {})
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id)
  console.log('')
  console.log(`已删除临时账号 ${TMP_ACCOUNT} 及其 ${fs.length} 个文件`)
}
db.close()

console.log('')
console.log('主账号最终题库文件数:', (await listOf(owner, 'qbank')).length)
console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
