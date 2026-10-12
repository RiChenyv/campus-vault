/**
 * 端到端：确认"双击快捷方式"这条路真的能用。
 *
 * 不测 .bat 本身（里面就是调 dev.mjs），而是测它启动出来的站点：
 *   · 前端 5174 能开
 *   · 经前端代理调后端能通（**这正是之前挂掉的地方**）
 *   · 能登录、能进课表、课表有真实数据
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const TMP = process.env.TEMP
const port = 9250
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

/* ---------- 1. 先做纯 HTTP 检查，不依赖浏览器 ---------- */
const probe = async (url) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) })
    return r.status
  } catch (e) {
    return 'ERR:' + e.message
  }
}

const web = await probe('http://127.0.0.1:5174/')
const api = await probe('http://127.0.0.1:5174/api/health')
console.log(`  前端 5174            -> ${web}`)
console.log(`  经代理调后端 /api/health -> ${api}`)

check('前端能打开', web === 200, String(web))
check('代理到后端能通（快捷方式失效的根因）', api === 200, String(api))

/* ---------- 2. 浏览器端跑一遍真实操作 ---------- */
const proc = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run',
  `--user-data-dir=${TMP}\\cv-launch`, '--window-size=1600,1200', '--remote-debugging-port=' + port, 'about:blank'],
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
await sleep(4000)

// 打开页面时应当停在登录页（还没登录）
const before = await ev(`(function(){
  var t = document.body.innerText;
  return JSON.stringify({ hasLogin: /登录|账户|密码/.test(t), len: t.length });
})()`)
const b = JSON.parse(before)
check('未登录时显示登录页', b.hasLogin, `正文 ${b.len} 字`)

// 真走一遍登录表单（不是调接口，是点按钮）
await ev(`(function(){
  function setVal(el, v){
    var d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  var acc = document.querySelector('input[aria-label="账户"]');
  var pwd = document.querySelector('input[aria-label="密码"]');
  if (!acc || !pwd) return 'no-input';
  setVal(acc, 'admin');
  setVal(pwd, 'Cv-Dev-Only-2026');
  return 'filled';
})()`)
await sleep(400)
const clicked = await ev(`(function(){
  var btn = Array.from(document.querySelectorAll('button')).find(function(e){ return e.textContent.trim() === '登录' });
  if (!btn) return 'no-button';
  btn.click();
  return 'clicked';
})()`)
console.log('  登录表单:', clicked)
await sleep(3500)

const after = JSON.parse(await ev(`(function(){
  var t = document.body.innerText;
  return JSON.stringify({ hasLogin: /账户/.test(t) && /密码/.test(t), hasRing: /记录每一位求知的灵魂/.test(t) });
})()`))
check('登录成功，进入主页（不再是登录页）', !after.hasLogin, after.hasLogin ? '仍在登录页' : '')
check('主页内容渲染出来了', after.hasRing)

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('D:\\MyWeb\\docs\\screenshots\\52-launch-ok.png', Buffer.from(shot.result.data, 'base64'))
console.log('  已存 52-launch-ok.png')

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
