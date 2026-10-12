/**
 * 删掉课表副标题后，检查留下的空 span / 残缺 aria-label 有没有把界面弄坏。
 * 断言的是"看起来正常"，所以既查 DOM 也截图。
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const TMP = process.env.TEMP
const port = 9249
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

const proc = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run',
  `--user-data-dir=${TMP}\\cv-del`, '--window-size=1600,1200', '--remote-debugging-port=' + port, 'about:blank'],
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

const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(3500)
await ev(`fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ account:'admin', password:'Cv-Dev-Only-2026' }) }).then(r=>r.status)`)
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(4000)

const info = JSON.parse(await ev(`(function(){
  var bad = [];
  // 残缺 aria-label：以冒号结尾
  document.querySelectorAll('[aria-label]').forEach(function(el){
    var a = el.getAttribute('aria-label') || '';
    if (/[：:]$/.test(a)) bad.push('aria:' + a);
  });
  // 空的副标题 span：textContent 为空但占据布局
  var emptySpans = 0;
  document.querySelectorAll('span').forEach(function(s){
    if (s.children.length === 0 && !(s.textContent||'').trim()){
      var r = s.getBoundingClientRect();
      if (r.width > 4 || r.height > 4) emptySpans++;
    }
  });
  var sched = Array.from(document.querySelectorAll('[aria-label]'))
    .map(function(e){ return e.getAttribute('aria-label') })
    .filter(function(a){ return /^我的课表/.test(a) });
  return JSON.stringify({ bad: bad, emptySpans: emptySpans, schedAria: sched });
})()`))

console.log('  残缺 aria-label:', JSON.stringify(info.bad))
console.log('  占据空间的空 span 数:', info.emptySpans)
console.log('  课表胶囊 aria:', JSON.stringify(info.schedAria))
console.log('')

check('没有以冒号结尾的残缺 aria-label', info.bad.length === 0, JSON.stringify(info.bad).slice(0, 120))
check('课表胶囊 aria-label 不含虚假数字', !/18 节课|周三最满/.test(JSON.stringify(info.schedAria)), JSON.stringify(info.schedAria))

/* 页面没报错 */
const errs = JSON.parse(await ev(`JSON.stringify(window.__errs || [])`))
check('控制台没有未捕获错误', errs.length === 0, JSON.stringify(errs).slice(0, 120))

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('D:\\MyWeb\\docs\\screenshots\\51-nav-after-delete.png', Buffer.from(shot.result.data, 'base64'))
console.log('')
console.log('  已存 51-nav-after-delete.png')

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
