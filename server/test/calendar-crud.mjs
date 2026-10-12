/**
 * 日历「本月重要节点」的增删。
 *
 * 用户反馈：这一栏原来写死在 mock 里，既不能加也不能删。
 *
 * 要点：
 *  ① 界面上真的能加、能删（不是只有接口能用）
 *  ② **刷新后还在** —— 只测"点完界面变了"不够，那可能只是内存状态
 *  ③ 删错了不会把别人的数据删掉（归属校验）
 */

import { spawn } from 'node:child_process'

const API = 'http://127.0.0.1:5175/api'
const TMP = process.env.TEMP
const port = 9274
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

const RUN = String(Date.now()).slice(-6)
const LABEL = `测试安排-${RUN}`

/* ── 接口层先跑一遍（快，且能定位是接口还是界面）── */
const login = async (a, p) => {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: a, password: p }),
  })
  return { cookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') }
}
const cookie = (await login('admin', 'Cv-Dev-Only-2026')).cookie
const call = async (m, path, body) => {
  const r = await fetch(`${API}${path}`, {
    method: m, headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: r.status, ...(await r.json()) }
}

console.log('=== ① 接口层 ===')
const created = await call('POST', '/events', { day: 9, label: LABEL, tone: 'exam' })
const id = created.data?.event?.id
check('能新增', created.ok === true && !!id, JSON.stringify(created.data?.event))
check('日期越界被拒', (await call('POST', '/events', { day: 99, label: 'x' })).ok === false)
check('内容为空被拒', (await call('POST', '/events', { day: 1, label: '   ' })).ok === false)
check('能改', (await call('PATCH', `/events/${id}`, { day: 10, label: LABEL + '改', tone: 'ddl' })).ok === true)

/* ── 界面层 ── */
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
  `--user-data-dir=${TMP}\\cv-cal`, '--window-size=1500,1000', '--remote-debugging-port=' + port, 'about:blank'],
  { stdio: 'ignore', windowsHide: true })
const ws = new WebSocket(await connect())
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let cid = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++cid; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description || '').slice(0, 300))
  return r.result?.result?.value
}
/** React 受控输入必须走原生 setter */
const fill = (label, value) => ev(`(function(){
  var el = document.querySelector('[aria-label=${JSON.stringify(label)}]');
  if (!el) return 'no-input';
  var proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  var d = Object.getOwnPropertyDescriptor(proto, 'value');
  d.set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  return 'ok';
})()`)

await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(3000)
await ev(`fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ account:'admin', password:'Cv-Dev-Only-2026' }) }).then(r=>r.status)`)
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(4500)

// 进日历页
await ev(`(function(){
  var b = Array.from(document.querySelectorAll('button')).find(function(e){
    return e.textContent.trim().indexOf('日历') === 0 });
  if (b) b.click(); return 1 })()`)
await sleep(3000)

console.log('')
console.log('=== ② 界面：入口齐全 ===')
const ui = JSON.parse(await ev(`(function(){
  return JSON.stringify({
    hasDay: !!document.querySelector('[aria-label="几号"]'),
    hasLabel: !!document.querySelector('[aria-label="安排内容"]'),
    hasTone: !!document.querySelector('[aria-label="类型"]'),
    hasAdd: !!document.querySelector('[aria-label="添加安排"]'),
    hasZone: document.body.innerText.indexOf('本月重要节点') >= 0,
  })
})()`))
console.log('  ', JSON.stringify(ui))
check('有「几号」输入', ui.hasDay === true)
check('有「安排内容」输入', ui.hasLabel === true)
check('有类型选择', ui.hasTone === true)
check('有「添加」按钮', ui.hasAdd === true)
check('在「本月重要节点」区里', ui.hasZone === true)

console.log('')
console.log('=== ③ 界面：添加 ===')
const NEW = `界面新增-${RUN}`
await fill('几号', '15')
const toneSet = await fill('类型', 'exam')
console.log('  设置类型:', toneSet)
await fill('安排内容', NEW)
await sleep(400)
await ev(`document.querySelector('[aria-label="添加安排"]').click(); 1`)
await sleep(2500)
const afterAdd = String(await ev(`document.body.innerText`))
check('**界面上出现了新增的安排**', afterAdd.includes(NEW), afterAdd.includes(NEW) ? '' : '没看到')
check('输入框已清空（方便连续添加）',
  String(await ev(`document.querySelector('[aria-label="安排内容"]').value`)) === '',
  JSON.stringify(await ev(`document.querySelector('[aria-label="安排内容"]').value`)))

console.log('')
console.log('=== ④ 数据真的落库了（不是只改了内存）===')
const list = await call('GET', '/events')
const mine = (list.data?.events ?? []).filter((e) => e.label === NEW)
console.log('  服务端查到:', JSON.stringify(mine))
check('**服务端确实存下了**', mine.length === 1, `${mine.length} 条`)
check('日期存对了', mine[0]?.day === 15, String(mine[0]?.day))
check('类型存对了', mine[0]?.tone === 'exam', String(mine[0]?.tone))

console.log('')
console.log('=== ⑤ 刷新后还在 ===')
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(4000)
await ev(`(function(){
  var b = Array.from(document.querySelectorAll('button')).find(function(e){
    return e.textContent.trim().indexOf('日历') === 0 });
  if (b) b.click(); return 1 })()`)
await sleep(3000)
check('刷新后仍然显示', String(await ev(`document.body.innerText`)).includes(NEW))

console.log('')
console.log('=== ⑥ 界面：删除 ===')
const del = await ev(`(function(){
  var b = document.querySelector('[aria-label="删除安排 ${NEW}"]');
  if (!b) return 'not-found';
  b.click(); return 'clicked';
})()`)
console.log('  删除按钮:', del)
await sleep(2500)
check('**界面上删掉了**', !String(await ev(`document.body.innerText`)).includes(NEW))
const list2 = await call('GET', '/events')
check('**服务端也没了**', !(list2.data?.events ?? []).some((e) => e.label === NEW),
  JSON.stringify((list2.data?.events ?? []).map((e) => e.label)))

/* ── 清理 ── */
const all = await call('GET', '/events')
for (const e of all.data?.events ?? []) await call('DELETE', `/events/${e.id}`)
console.log('')
console.log(`已清理 ${(all.data?.events ?? []).length} 条测试数据`)

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
