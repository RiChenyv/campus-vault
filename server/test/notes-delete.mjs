/**
 * 笔记的删除能力：**逐条删 + 一次性全删**，两条路径都要有。
 *
 * 用户的原话：「要和题库的删除功能类似，可以一次性全删，也可以逐条删除」。
 *
 * 所以这个测试必须把两条都验到，而且都要验到**服务端真的删了** ——
 * 只测"界面上不见了"是查不出"其实只是内存里移除了"的。
 */

import { spawn } from 'node:child_process'

const API = 'http://127.0.0.1:5175/api'
const TMP = process.env.TEMP
const port = 9276
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

const RUN = String(Date.now()).slice(-6)
const login = async (a, p) => {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: a, password: p }),
  })
  return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
}
const cookie = await login('admin', 'Cv-Dev-Only-2026')
const call = async (m, path, b) => {
  const r = await fetch(`${API}${path}`, {
    method: m, headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, ...(await r.json()) }
}
const listNotes = async () => (await call('GET', '/notes')).data?.notes ?? []
const listNoteFiles = async () =>
  (await (await fetch(`${API}/files?scope=note`, { headers: { Cookie: cookie } })).json()).data?.files ?? []

/* ── 准备：三篇手写笔记 + 一个笔记文件 ── */
const titles = [`删除甲-${RUN}`, `删除乙-${RUN}`, `删除丙-${RUN}`]
for (const title of titles) await call('POST', '/notes', { title, body: '内容', courseId: '' })
const form = new FormData()
form.append('files', new Blob(['# 保留我\n']), `保留-${RUN}.md`)
form.append('scope', 'note')
await fetch(`${API}/files`, { method: 'POST', headers: { Cookie: cookie }, body: form })
console.log(`准备了 ${titles.length} 篇手写笔记 + 1 个笔记文件`)
console.log('')

console.log('=== ① 接口：逐条删除 ===')
const before = await listNotes()
const target = before.find((n) => n.title === titles[0])
console.log('  单条删除:', JSON.stringify(await call('DELETE', `/notes/${target.id}`)))
const afterOne = await listNotes()
check('**服务端少了一篇**', afterOne.length === before.length - 1, `${before.length} -> ${afterOne.length}`)
check('删掉的是指定那篇', !afterOne.some((n) => n.id === target.id))
check('删不存在的返回 404', (await call('DELETE', '/notes/999999')).status === 404)

console.log('')
console.log('=== ② 接口：全部删除 ===')
const beforeClear = await listNotes()
console.log(`  清空前 ${beforeClear.length} 篇`)
const cleared = await call('DELETE', '/notes')
console.log('  清空:', JSON.stringify(cleared))
check('**服务端清空了**', (await listNotes()).length === 0, `${(await listNotes()).length} 篇`)
check('回报了删掉的数量', cleared.data?.removed === beforeClear.length,
  `${cleared.data?.removed} vs ${beforeClear.length}`)

console.log('')
console.log('=== ③ 清空笔记**不能**顺手删掉笔记文件 ===')
const filesLeft = await listNoteFiles()
check('笔记文件还在（两种东西分开管）', filesLeft.length === 1, `${filesLeft.length} 个`)

/* ── 界面 ── */
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

const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${TMP}\\cv-note-del`,
    '--window-size=1500,1000', '--remote-debugging-port=' + port, 'about:blank'],
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

await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(3000)
await ev(`fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ account:'admin', password:'Cv-Dev-Only-2026' }) }).then(r=>r.status)`)
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(4500)

// 界面上先造两篇
for (const t of [`界面甲-${RUN}`, `界面乙-${RUN}`]) {
  await call('POST', '/notes', { title: t, body: 'x', courseId: '' })
}
await ev(`(function(){
  var b = Array.from(document.querySelectorAll('button')).find(function(e){
    return e.textContent.trim().indexOf('我的笔记') === 0 });
  if (b) b.click(); return 1 })()`)
await sleep(3000)

console.log('')
console.log('=== ④ 界面：逐条删除按钮 ===')
const hasDel = await ev(`!!document.querySelector('[aria-label="删除笔记 界面甲-${RUN}"]')`)
check('每一篇都有删除按钮', hasDel === true)
await ev(`document.querySelector('[aria-label="删除笔记 界面甲-${RUN}"]').click(); 1`)
await sleep(2500)
check('界面上少了一篇', !String(await ev(`document.body.innerText`)).includes(`界面甲-${RUN}`))
check('**服务端也少了**', !(await listNotes()).some((n) => n.title === `界面甲-${RUN}`),
  JSON.stringify((await listNotes()).map((n) => n.title)))

console.log('')
console.log('=== ⑤ 界面：清空全部（带确认关卡）===')
const hasClear = await ev(`!!document.querySelector('[aria-label="清空全部笔记"]')`)
check('有「清空全部」按钮', hasClear === true)

// 先点开确认框，**不要**直接确认
await ev(`document.querySelector('[aria-label="清空全部笔记"]').click(); 1`)
await sleep(900)
const dialog = JSON.parse(await ev(`(function(){
  var d = document.querySelector('[role="dialog"]');
  return JSON.stringify({ open: !!d, text: d ? d.innerText.replace(/\\n/g,' | ') : '' })
})()`))
console.log('  弹窗:', dialog.text.slice(0, 130))
check('点按钮先弹确认框（不是直接删）', dialog.open === true)
check('弹窗说明了会删多少', /全部 \d+ 篇/.test(dialog.text), dialog.text.slice(0, 90))
check('弹窗说明了不可撤销', /不可撤销/.test(dialog.text))
check('说明了不影响笔记文件', /笔记文件不受影响/.test(dialog.text))

// 取消 → 一篇都不能少
const beforeCancel = (await listNotes()).length
await ev(`document.querySelector('[aria-label="取消"]').click(); 1`)
await sleep(900)
check('点取消后什么都没删', (await listNotes()).length === beforeCancel, `${beforeCancel} -> ${(await listNotes()).length}`)

// 真正确认
await ev(`document.querySelector('[aria-label="清空全部笔记"]').click(); 1`)
await sleep(800)
await ev(`(function(){
  var b = Array.from(document.querySelectorAll('[role="dialog"] button'))
    .find(function(e){ return (e.getAttribute('aria-label')||'').indexOf('删除全部') === 0 });
  if (b) b.click(); return 1 })()`)
await sleep(3000)

check('**界面上全没了**', (await listNotes()).length === 0, `${(await listNotes()).length} 篇`)
const uiText = String(await ev(`document.body.innerText`))
check('空状态提示出现了', uiText.includes('还没有手写的笔记'))
check('清空后按钮消失（空列表不显示清空入口）',
  (await ev(`!!document.querySelector('[aria-label="清空全部笔记"]')`)) === false)
check('**笔记文件仍在**（没被一起清掉）', (await listNoteFiles()).length === 1)

/* ── 清理 ── */
for (const f of await listNoteFiles()) {
  await fetch(`${API}/files/${encodeURIComponent(f.id)}`, { method: 'DELETE', headers: { Cookie: cookie } })
}
for (const n of await listNotes()) await call('DELETE', `/notes/${n.id}`)
console.log('')
console.log('已清理测试数据')

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
