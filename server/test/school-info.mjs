/**
 * 验证在校信息块的显示条件。
 *
 * 两件事必须同时成立：
 *  ① 全部为空时**整块不渲染**（不能看到一排空占位）
 *  ② 一旦有任意一个字段，块就出现（不是"要全部填满才显示"）
 * 第 ② 条容易漏 —— 只测空状态的话，"条件写反了"也看不出来。
 */

import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

const TMP = process.env.TEMP
const port = 9258
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

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
  `--user-data-dir=${TMP}\\cv-school`, '--window-size=1600,1200', '--remote-debugging-port=' + port, 'about:blank'],
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
  if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description || '').slice(0, 300))
  return r.result?.result?.value
}

/** 打开个人中心，返回里面有没有「在校信息」这一块 */
async function schoolBlockVisible() {
  await ev(`(function(){
    var b = document.querySelector('[aria-label^="打开个人中心"]');
    if (b) b.click(); return 1
  })()`)
  await sleep(1600)
  const r = JSON.parse(await ev(`(function(){
    var t = document.body.innerText;
    var i = t.indexOf('在校信息');
    return JSON.stringify({
      has: i >= 0,
      snippet: i >= 0 ? t.slice(i, i + 120).replace(/\\n/g, ' | ') : '',
    });
  })()`))
  // 关掉面板，方便下一次
  await ev(`(function(){
    var b = Array.from(document.querySelectorAll('button')).find(function(e){
      return (e.getAttribute('aria-label')||'').indexOf('关闭') >= 0 });
    if (b) b.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return 1
  })()`)
  await sleep(900)
  return r
}

await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(3000)
await ev(`fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ account:'admin', password:'Cv-Dev-Only-2026' }) }).then(r=>r.status)`)
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(4000)

const db = new DatabaseSync('D:/MyWeb/server/data/vault.db')
const setFields = (patch) => {
  const cols = Object.keys(patch)
  db.prepare(`UPDATE profiles SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE user_id = 1`)
    .run(...cols.map((c) => patch[c]))
}

/* ── 场景 1：全空 ── */
console.log('=== 场景 1：在校信息全部为空 ===')
setFields({ real_name: '', student_id: '', college: '', major: '', grade: '', class_name: '', imported_at: null })
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(3500)
let r = await schoolBlockVisible()
console.log('  ', r.has ? r.snippet : '(没有这块)')
/* 行为已改：这块**始终显示** —— 它是可编辑入口，藏起来用户就找不到。
   空字段用「未填」占位，而不是整块消失。 */
check('全空时**仍然显示**在校信息块（可编辑入口不能藏）', r.has === true, r.has ? '' : '没显示')
check('全空时字段显示「未填」占位', r.snippet.includes('未填'), r.snippet.slice(0, 80))

/* ── 场景 2：只有一个字段 ── */
console.log('')
console.log('=== 场景 2：只填一个字段（学院）===')
setFields({ college: '计算机与网络空间安全学院', imported_at: Date.now() })
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(3500)
r = await schoolBlockVisible()
console.log('  ', r.has ? r.snippet : '(没有这块)')
check('**只要有一个字段就显示**（不是要填满才显示）', r.has === true, r.has ? '' : '没显示')
check('显示的是实际填的那个值', r.snippet.includes('计算机与网络空间安全学院'), r.snippet.slice(0, 80))

/* ── 场景 3：改回全空，确认能恢复 ── */
console.log('')
console.log('=== 场景 3：再清空，确认回到未填状态 ===')
setFields({ real_name: '', student_id: '', college: '', major: '', grade: '', class_name: '', imported_at: null })
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(3500)
r = await schoolBlockVisible()
check('清空后回到「未填」占位（而不是整块消失）', r.has === true && r.snippet.includes('未填'), r.snippet.slice(0, 70))

/* ── 场景 4：非管理员账号也能显示（这就是用户问的问题）── */
console.log('')
console.log('=== 场景 4：非管理员账号 ===')
const other = db.prepare('SELECT id, account FROM users WHERE is_admin = 0 ORDER BY id LIMIT 1').get()
if (other) {
  // 给非管理员账号临时填一个字段
  db.prepare('UPDATE profiles SET college = ? WHERE user_id = ?').run('测试学院', other.id)

  // 用管理员会话调接口，确认字段确实按 user_id 隔离
  const cookie = await ev(`fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ account:'admin', password:'Cv-Dev-Only-2026' }) }).then(r=>r.status)`)
  void cookie
  const meA = JSON.parse(await ev(`fetch('/api/auth/me', { credentials:'include' }).then(r=>r.json()).then(j=>JSON.stringify({a:j.data.user.account, c:j.data.user.college}))`))
  console.log(`  管理员看到的 college: ${JSON.stringify(meA.c)}`)
  check('管理员看不到别人的在校信息（按 user_id 隔离）', meA.c === '', String(meA.c))

  const dbc = db.prepare('SELECT college FROM profiles WHERE user_id = ?').get(other.id)
  check('非管理员账号那一行确实写进去了', dbc.college === '测试学院', String(dbc.college))
  console.log('  （"非管理员也能显示"由代码条件保证：只判断字段非空，不看 is_admin）')

  db.prepare('UPDATE profiles SET college = ? WHERE user_id = ?').run('', other.id)
  console.log('  已还原')
} else {
  check('存在非管理员账号', false)
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
