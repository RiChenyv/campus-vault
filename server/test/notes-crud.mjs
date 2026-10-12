/**
 * 「我的笔记」的两条写入路径：
 *  ① 上传外部文件（类比题库）
 *  ② 在应用里直接写
 *
 * 用户的原话是「笔记要可以直接通过外部文件上传（类比题库）」，
 * 所以 ① 是重点，必须真的传上去、真的能打开、真的能删。
 */

import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

const API = 'http://127.0.0.1:5175/api'
const TMP = process.env.TEMP
const port = 9275
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

const RUN = String(Date.now()).slice(-6)
const MD_NAME = `笔记文件-${RUN}.md`

const login = async (a, p) => {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: a, password: p }),
  })
  return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
}
const cookie = await login('admin', 'Cv-Dev-Only-2026')

/* ── ① 接口层：scope=note 能存能取 ── */
console.log('=== ① 接口层（scope=note）===')
const form = new FormData()
form.append('files', new Blob(['# 笔记测试\n\n这是**上传**的笔记。\n']), MD_NAME)
form.append('scope', 'note')
const up = await (await fetch(`${API}/files`, { method: 'POST', headers: { Cookie: cookie }, body: form })).json()
const fileId = up.data?.files?.[0]?.id
check('能上传 note 范围的文件', up.ok === true && !!fileId, JSON.stringify(up.data?.files?.[0]?.name))

const noteList = await (await fetch(`${API}/files?scope=note`, { headers: { Cookie: cookie } })).json()
check('**能在 note 范围里查到**', (noteList.data?.files ?? []).some((f) => f.id === fileId),
  `${(noteList.data?.files ?? []).length} 个`)

const qbankList = await (await fetch(`${API}/files?scope=qbank`, { headers: { Cookie: cookie } })).json()
check('**不会串到题库里**（scope 隔离）', !(qbankList.data?.files ?? []).some((f) => f.id === fileId))

/* ── ② 手写笔记接口 ── */
console.log('')
console.log('=== ② 手写笔记接口 ===')
const mk = async (m, p, b) => {
  const r = await fetch(`${API}${p}`, {
    method: m, headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: b ? JSON.stringify(b) : undefined,
  })
  return { status: r.status, ...(await r.json()) }
}
const noteTitle = `手写-${RUN}`
const made = await mk('POST', '/notes', { title: noteTitle, body: '## 要点\n\n公式 $e - 127$', courseId: 'c1' })
const noteId = made.data?.note?.id
check('能新建手写笔记', made.ok === true && !!noteId)
check('标题为空被拒', (await mk('POST', '/notes', { title: '   ', body: 'x' })).ok === false)
check('能改', (await mk('PATCH', `/notes/${noteId}`, { title: noteTitle, body: '改过了', courseId: 'c2' })).ok === true)

/* ── ③ 界面 ── */
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
  ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${TMP}\\cv-notes`,
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
const fill = (label, value) => ev(`(function(){
  var el = document.querySelector('[aria-label=${JSON.stringify(label)}]');
  if (!el) return 'no-input';
  var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
            : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
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

// 进「我的笔记」
await ev(`(function(){
  var b = Array.from(document.querySelectorAll('button')).find(function(e){
    return e.textContent.trim().indexOf('我的笔记') === 0 });
  if (b) b.click(); return 1 })()`)
await sleep(3000)

console.log('')
console.log('=== ③ 界面入口 ===')
const ui = JSON.parse(await ev(`(function(){
  return JSON.stringify({
    hasUpload: !!document.querySelector('[aria-label="上传笔记文件"]'),
    hasDir: !!document.querySelector('[aria-label="选择笔记文件夹"]'),
    hasWrite: !!document.querySelector('[aria-label="写一条笔记"]'),
    hasNoteFile: document.body.innerText.indexOf(${JSON.stringify(MD_NAME)}) >= 0,
    hasNoteTitle: document.body.innerText.indexOf(${JSON.stringify(noteTitle)}) >= 0,
  })
})()`))
console.log('  ', JSON.stringify(ui))
check('有「上传笔记文件」按钮', ui.hasUpload === true)
check('有「选择整个文件夹」', ui.hasDir === true)
check('有「写一条笔记」按钮', ui.hasWrite === true)
check('**刚上传的笔记文件显示出来了**', ui.hasNoteFile === true)
check('已有的手写笔记显示出来了', ui.hasNoteTitle === true)

console.log('')
console.log('=== ④ 界面：写一条 ===')
const W = `界面手写-${RUN}`
await ev(`document.querySelector('[aria-label="写一条笔记"]').click(); 1`)
await sleep(800)
await fill('笔记标题', W)
await fill('笔记正文', '## 要点\n\n补码 $e - 127$\n\n$$V = (-1)^s \\times M \\times 2^E$$')
await sleep(400)
await ev(`document.querySelector('[aria-label="保存笔记"]').click(); 1`)
await sleep(2500)
check('**界面上出现了新手写笔记**', String(await ev(`document.body.innerText`)).includes(W))

const list = await mk('GET', '/notes')
check('**服务端也存下了**', (list.data?.notes ?? []).some((n) => n.title === W),
  `${(list.data?.notes ?? []).length} 篇`)
const saved = (list.data?.notes ?? []).find((n) => n.title === W)
check('正文原样保存（Markdown 没被改动）', String(saved?.body ?? '').includes('$$V = (-1)^s'), String(saved?.body ?? '').slice(0, 40))

console.log('')
console.log('=== ⑤ 界面：展开渲染（含公式）===')
await ev(`(function(){
  var b = document.querySelector('[aria-label="展开笔记 ${W}"]');
  if (b) b.click(); return 1 })()`)
await sleep(1500)
const rendered = JSON.parse(await ev(`(function(){
  var arts = Array.from(document.querySelectorAll('article.md'));
  var hit = arts.find(function(a){ return (a.innerText||'').indexOf('要点') >= 0 });
  return JSON.stringify({
    found: !!hit,
    hasKatex: hit ? !!hit.querySelector('.katex') : false,
    hasH2: hit ? !!hit.querySelector('h2') : false,
  })
})()`))
console.log('  ', JSON.stringify(rendered))
check('展开后渲染了正文', rendered.found === true)
check('**正文里的公式也渲染了**', rendered.hasKatex === true)

console.log('')
console.log('=== ⑥ 刷新后仍在 ===')
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(4000)
await ev(`(function(){
  var b = Array.from(document.querySelectorAll('button')).find(function(e){
    return e.textContent.trim().indexOf('我的笔记') === 0 });
  if (b) b.click(); return 1 })()`)
await sleep(3000)
const after = String(await ev(`document.body.innerText`))
check('手写笔记刷新后仍在', after.includes(W))
check('上传的笔记文件刷新后仍在', after.includes(MD_NAME))

/* ── 清理 ── */
const allNotes = await mk('GET', '/notes')
for (const n of allNotes.data?.notes ?? []) await mk('DELETE', `/notes/${n.id}`)
const allFiles = await (await fetch(`${API}/files?scope=note`, { headers: { Cookie: cookie } })).json()
for (const f of allFiles.data?.files ?? []) {
  await fetch(`${API}/files/${encodeURIComponent(f.id)}`, { method: 'DELETE', headers: { Cookie: cookie } })
}
console.log('')
console.log(`已清理 ${(allNotes.data?.notes ?? []).length} 篇手写笔记、${(allFiles.data?.files ?? []).length} 个笔记文件`)

const db = new DatabaseSync('D:/MyWeb/server/data/vault.db')
const left = db.prepare("SELECT COUNT(*) n FROM notes").get().n
db.close()
check('清理干净', left === 0, `剩 ${left} 篇`)

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
