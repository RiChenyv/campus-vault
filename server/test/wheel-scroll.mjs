/**
 * 滚轮：光标在文件内容上时，应该滚动内容，而不是翻页。
 *
 * 用户报告「查看 markdown 文件时下滚无反应，看不到完整内容」。
 *
 * 根因：翻页逻辑只把滚轮让给带 `.overflow-y-auto` 类名的容器，
 * 而文件查看器的内容区是 `overflow-auto`（横向也要能滚），类名对不上，
 * 于是滚轮被翻页吃掉。
 *
 * 所以这个测试必须**真的派发滚轮事件**并检查 scrollTop 有没有变 ——
 * 只看 DOM 结构是查不出来的（结构一直是对的）。
 */

import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

const API = 'http://127.0.0.1:5175/api'
const TMP = process.env.TEMP
const port = 9270
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

const RUN = String(Date.now()).slice(-6)
const PW = 'Mv7$kQp9Lw'

const login = async (a, p) => {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: a, password: p }),
  })
  const j = await r.json()
  return { cookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') }
}

const reg = await (await fetch(`${API}/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: PW, confirm: PW }),
})).json()
const ACC = reg.data.account
const guest = await login(ACC, PW)
console.log(`临时账号 ${ACC}`)
console.log('')

/* 传一个**足够长**的 markdown：内容必须超出可视区，否则没得滚，测不出问题 */
const lines = ['# 滚动测试', '']
for (let i = 1; i <= 120; i++) lines.push(`## 第 ${i} 节`, '', `这是第 ${i} 节的内容，用来把页面撑长。`, '')
const MD = lines.join('\n')

const f = new FormData()
f.append('files', new Blob([MD]), `长文档-${RUN}.md`)
f.append('scope', 'qbank')
const up = await (await fetch(`${API}/files`, {
  method: 'POST', headers: { Cookie: guest.cookie }, body: f,
})).json()
const file = up.data.files[0]
console.log(`已上传 ${file.name}（${Math.round(MD.length / 1024)} KB）`)
console.log('')

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
  `--user-data-dir=${TMP}\\cv-wheel`, '--window-size=1400,900', '--remote-debugging-port=' + port, 'about:blank'],
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

await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(3000)
await ev(`fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ account:${JSON.stringify(ACC)}, password:${JSON.stringify(PW)} }) }).then(r=>r.status)`)
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(4200)

// 进题库 → 打开长文档
await ev(`(function(){var b=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim().indexOf('题库')===0);if(b)b.click();return 1})()`)
await sleep(2800)
await ev(`(function(){
  var b = Array.from(document.querySelectorAll('button')).find(function(e){
    return (e.textContent||'').indexOf(${JSON.stringify(file.name)}) >= 0 });
  if (b) b.click(); return 1 })()`)
await sleep(2800)

console.log('=== ① 内容区确实能滚（前提）===')
const box = JSON.parse(await ev(`(function(){
  // 找渲染 markdown 的那个容器，再往上找到可滚的祖先
  var art = document.querySelector('article.md');
  if (!art) return JSON.stringify({ found: false });
  var el = art.parentElement;
  while (el && el !== document.body) {
    var oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2) {
      return JSON.stringify({ found: true, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight, cls: (el.className||'').slice(0,60) });
    }
    el = el.parentElement;
  }
  return JSON.stringify({ found: false });
})()`))
console.log('  ', JSON.stringify(box))
check('markdown 渲染出来了', box.found === true, box.found ? '' : '没找到 article.md 或可滚祖先')
check('内容确实超出可视区（有得滚）',
  box.found && box.scrollHeight > box.clientHeight, `${box.scrollHeight} > ${box.clientHeight}`)

/* ── ② 真的派发滚轮事件 ── */
console.log('')
console.log('=== ② 在内容上滚轮 ===')

/** 在 markdown 内容正中间派发一次滚轮，返回内容区的 scrollTop 变化 */
async function wheelOnContent(deltaY) {
  return JSON.parse(await ev(`(function(){
    var art = document.querySelector('article.md');
    if (!art) return JSON.stringify({ ok:false, reason:'no article' });
    // 找可滚祖先
    var el = art.parentElement;
    while (el && el !== document.body) {
      var oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2) break;
      el = el.parentElement;
    }
    if (!el || el === document.body) return JSON.stringify({ ok:false, reason:'no scroll box' });
    var before = el.scrollTop;
    var r = art.getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 200);
    var target = document.elementFromPoint(x, y) || art;
    target.dispatchEvent(new WheelEvent('wheel', {
      deltaY: ${deltaY}, deltaMode: 0, bubbles: true, cancelable: true,
      clientX: x, clientY: y,
    }));
    return JSON.stringify({ ok:true, before: before, after: el.scrollTop, moved: el.scrollTop !== before });
  })()`))
}

for (let i = 0; i < 3; i++) {
  const r = await wheelOnContent(120)
  await sleep(200)
  if (i === 0) console.log('  第一次滚轮:', JSON.stringify(r))
}

const afterDown = JSON.parse(await ev(`(function(){
  var art = document.querySelector('article.md');
  var el = art.parentElement;
  while (el && el !== document.body) {
    var oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2) break;
    el = el.parentElement;
  }
  return JSON.stringify({ scrollTop: el.scrollTop, pageText: document.body.innerText.slice(0, 0) });
})()`))
console.log('  滚轮后 scrollTop:', afterDown.scrollTop)
check('**滚轮能滚动文件内容**（用户报的就是这条）', afterDown.scrollTop > 0, `scrollTop=${afterDown.scrollTop}`)

/* ── ③ 滚到底之后再滚，应该翻页而不是卡住 ── */
console.log('')
console.log('=== ③ 内容滚到底之后 ===')
await ev(`(function(){
  var art = document.querySelector('article.md');
  var el = art.parentElement;
  while (el && el !== document.body) {
    var oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2) break;
    el = el.parentElement;
  }
  el.scrollTop = el.scrollHeight;   // 直接拉到底
  return 1 })()`)
await sleep(400)

const atBottom = JSON.parse(await ev(`(function(){
  var art = document.querySelector('article.md');
  var el = art.parentElement;
  while (el && el !== document.body) {
    var oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2) break;
    el = el.parentElement;
  }
  return JSON.stringify({ scrollTop: el.scrollTop, max: el.scrollHeight - el.clientHeight });
})()`))
console.log('  已滚到底:', JSON.stringify(atBottom))
check('内容确实滚到了底部', atBottom.scrollTop >= atBottom.max - 4, `${atBottom.scrollTop} / ${atBottom.max}`)

// 到底之后再滚一次：这时**不该**再被内容吃掉，应该交给翻页
const atBottomWheel = await wheelOnContent(120)
await sleep(900)
const pageMoved = String(await ev(`document.body.innerText`))
console.log('  到底后滚轮:', JSON.stringify(atBottomWheel))
check('滚到底后滚轮交还给翻页（内容区不再变）',
  atBottomWheel.ok && atBottomWheel.after === atBottomWheel.before,
  `before=${atBottomWheel.before} after=${atBottomWheel.after}`)
void pageMoved

/* ── 清理 ── */
const db = new DatabaseSync('D:/MyWeb/server/data/vault.db')
const u = db.prepare('SELECT id FROM users WHERE account = ?').get(ACC)
if (u) {
  const fs = db.prepare('SELECT store_path FROM files WHERE owner_id = ?').all(u.id)
  for (const t of ['profiles', 'sessions', 'courses', 'schedule_slots', 'import_tokens', 'import_log', 'activity_log'])
    { try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(u.id) } catch { /* 表结构不同 */ } }
  db.prepare('DELETE FROM files WHERE owner_id = ?').run(u.id)
  const { rm } = await import('node:fs/promises')
  const { resolve } = await import('node:path')
  for (const x of fs) {
    const abs = resolve('D:/MyWeb/server/data', x.store_path)
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
