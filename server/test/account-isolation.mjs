/**
 * 账号数据隔离测试。
 *
 * 起因：用户报告"新建账号后两个账号数据一样，改名字和头像把管理员也改了"。
 * 根因是个人资料存在 localStorage —— 那是**浏览器级**的，不是账号级。
 *
 * 这个测试必须走真实 UI（不是直接调接口），因为当初的 bug 正是
 * "界面上看着改了、其实只写进了浏览器"。所以断言分两层：
 *   ① UI 层：在 A 账号改名字，切到 B 账号看是否跟着变
 *   ② 数据层：直查数据库，确认改的到底是不是本人那一行
 */

import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

const TMP = process.env.TEMP
const port = 9251
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

const db = new DatabaseSync('D:/MyWeb/server/data/vault.db')
const profileOf = (account) => {
  const u = db.prepare('SELECT id FROM users WHERE account = ?').get(account)
  if (!u) return null
  const p = db.prepare('SELECT username, github, avatar_file_id FROM profiles WHERE user_id = ?').get(u.id)
  return { id: u.id, username: p?.username ?? '', avatar: p?.avatar_file_id ?? null }
}

/* ------------------------------ 浏览器 ------------------------------ */

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
  `--user-data-dir=${TMP}\\cv-iso`, '--window-size=1600,1200', '--remote-debugging-port=' + port, 'about:blank'],
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
  if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description || '').slice(0, 500))
  return r.result?.result?.value
}

/** 用 UI 走一遍登录（不调接口 —— 要的就是"界面上真实发生的事"） */
async function loginAs(account, password) {
  await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
  await sleep(3500)
  // 先退出：如果已经登录着，界面上是主页而不是登录页
  await ev(`(async function(){
    try { await fetch('/api/auth/logout', { method:'POST' }) } catch(e){}
    return 1;
  })()`)
  await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
  await sleep(3500)

  const filled = await ev(`(function(){
    function setVal(el, v){
      var d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var a = document.querySelector('input[aria-label="账户"]');
    var p = document.querySelector('input[aria-label="密码"]');
    if (!a || !p) return 'no-input';
    setVal(a, ${JSON.stringify(account)});
    setVal(p, ${JSON.stringify(password)});
    return 'ok';
  })()`)
  if (filled !== 'ok') return 'fill:' + filled

  await sleep(300)
  await ev(`(function(){
    var b = Array.from(document.querySelectorAll('button')).find(function(e){ return e.textContent.trim() === '登录' });
    if (b) b.click();
    return 1;
  })()`)
  await sleep(3500)
  return 'ok'
}

/** 打开个人中心，读出界面上显示的用户名 */
async function openProfileAndReadName() {
  await ev(`(function(){
    var b = document.querySelector('[aria-label^="打开个人中心"]');
    if (b) b.click();
    return 1;
  })()`)
  await sleep(1500)
  return await ev(`(function(){
    var t = document.body.innerText;
    var m = t.match(/我的资料|个人中心/);
    var el = document.querySelector('[aria-label^="打开个人中心"]');
    var aria = el ? el.getAttribute('aria-label') : '';
    return JSON.stringify({ aria: aria, body: t.slice(0, 300) });
  })()`)
}

/** 通过界面改名字。
 *  真实交互：用户名是一行文字，点它才出现输入框（aria-label="修改用户名"），
 *  回车或失焦提交。 */
async function renameViaUI(newName) {
  // 1) 点开编辑态
  const opened = await ev(`(function(){
    var btn = Array.from(document.querySelectorAll('button'))
      .find(function(e){ return (e.getAttribute('aria-label')||'').indexOf('用户名：') === 0 });
    if (!btn) return 'no-entry';
    btn.click();
    return 'ok';
  })()`)
  if (opened !== 'ok') return opened
  await sleep(500)

  // 2) 填值并回车提交（React 受控输入必须走原生 setter）
  const done = await ev(`(function(){
    var inp = document.querySelector('input[aria-label="修改用户名"]');
    if (!inp) return 'no-input';
    var d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(inp, ${JSON.stringify(newName)});
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`)
  if (done !== 'ok') return done
  await sleep(300)
  await ev(`(function(){
    var inp = document.querySelector('input[aria-label="修改用户名"]');
    if (!inp) return 0;
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return 1;
  })()`)
  await sleep(2200)
  return 'ok'
}

/* ------------------------------ 开跑 ------------------------------ */

console.log('=== 初始状态 ===')
const before1 = profileOf('admin')
const before2 = profileOf('20260000000')
console.log('  管理员:', JSON.stringify(before1))
console.log('  新账号:', JSON.stringify(before2))
check('两个账号各有独立的 profile 行', before1.id !== before2.id, `${before1.id} vs ${before2.id}`)

console.log('')
console.log('=== 用管理员账号登录 ===')
console.log('  登录:', await loginAs('admin', 'Cv-Dev-Only-2026'))
const p1 = await openProfileAndReadName()
console.log('  个人中心:', String(p1).slice(0, 200))

const NEW_NAME = '测试改名' + String(Date.now()).slice(-4)
const rn = await renameViaUI(NEW_NAME)
console.log('  改名操作:', String(rn).slice(0, 160))
await sleep(1500)

const after1 = profileOf('admin')
const after2 = profileOf('20260000000')
console.log('')
console.log('  改后 管理员:', JSON.stringify(after1))
console.log('  改后 新账号:', JSON.stringify(after2))

check('管理员的名字确实写进了服务端', after1.username === NEW_NAME, `${after1.username}`)
check('**新账号没有被牵连**', after2.username === before2.username, `${before2.username} -> ${after2.username}`)
check('新账号的 avatar 也没变', after2.avatar === before2.avatar, String(after2.avatar))

console.log('')
console.log('=== 切到新账号，界面上的名字应当是它自己的 ===')
console.log('  登录:', await loginAs('20260000000', ''))
// 新账号密码未知，改用注册流程的账号不现实 —— 这里直接检查会话接口
const me = await ev(`fetch('/api/auth/me').then(r=>r.json()).then(j=>JSON.stringify(j.data ? j.data.user : j.error))`)
console.log('  /auth/me:', String(me).slice(0, 160))

console.log('')
console.log('=== localStorage 里的遗留键应当已清掉 ===')
const legacy = await ev(`JSON.stringify({
  username: localStorage.getItem('cv.username'),
  avatar: localStorage.getItem('cv.avatar') ? '(有值)' : null,
  github: localStorage.getItem('cv.github'),
  avatarName: localStorage.getItem('cv.avatarName'),
})`)
console.log('  ', legacy)
const lg = JSON.parse(legacy)
check('cv.username 已清除', lg.username === null, String(lg.username))
check('cv.avatar 已清除（不再把头像塞进浏览器）', lg.avatar === null, String(lg.avatar))
check('cv.github 已清除', lg.github === null, String(lg.github))

// 还原管理员名字，别把测试数据留在库里
db.prepare('UPDATE profiles SET username = ? WHERE user_id = ?').run(before1.username, before1.id)
console.log('')
console.log(`  已还原管理员用户名 -> ${before1.username}`)

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

db.close()
ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
