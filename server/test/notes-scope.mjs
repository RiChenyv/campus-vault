/**
 * 题库和笔记分开 + 上传前必须选学科。
 *
 * 用户的要求：
 *  · 「题库和笔记不要用同一个数据」
 *  · 「笔记需要用户自行确认学科之后上传」
 *
 * 这两条都要验到**行为**上，不能只看代码里有没有那个字符串：
 *  ① 笔记页的资料库**不该**出现题库文件
 *  ② 没选学科时**传不上去**（按钮禁用 + 后端也不会收到）
 *  ③ 选了学科之后，文件要带上 courseId
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const API = 'http://127.0.0.1:5175/api'
const TMP = process.env.TEMP
const port = 9278
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

/* ── 准备：一门课 + 一个题库文件（用来验证"不会串到笔记里"）── */
const courses = await (await fetch(`${API}/courses`, { headers: { Cookie: cookie } })).json()
const course = courses.data.courses[0]
console.log(`用课程「${course.name}」(id=${course.id})`)
console.log('')

const mkFile = async (scope, name, courseId) => {
  const f = new FormData()
  f.append('files', new Blob([`# ${name}\n`]), name)
  f.append('scope', scope)
  if (courseId) f.append('courseId', courseId)
  const r = await fetch(`${API}/files`, { method: 'POST', headers: { Cookie: cookie }, body: f })
  return (await r.json()).data?.files?.[0]
}
const qbankFile = await mkFile('qbank', `题库文件-${RUN}.md`, '')
const noteFile = await mkFile('note', `笔记文件-${RUN}.md`, course.id)
console.log(`题库文件: ${qbankFile?.name}`)
console.log(`笔记文件: ${noteFile?.name}（归属 ${course.name}）`)
console.log('')

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
  ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${TMP}\\cv-sep`,
    '--window-size=1500,1100', '--remote-debugging-port=' + port, 'about:blank'],
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
const setSelect = (label, value) => ev(`(function(){
  var el = document.querySelector('[aria-label=${JSON.stringify(label)}]');
  if (!el) return 'no-select';
  var d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  d.set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`)

await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(3000)
await ev(`fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ account:'admin', password:'Cv-Dev-Only-2026' }) }).then(r=>r.status)`)
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(4500)
await ev(`(function(){
  var b = Array.from(document.querySelectorAll('button')).find(function(e){
    return e.textContent.trim().indexOf('我的笔记') === 0 });
  if (b) b.click(); return 1 })()`)
await sleep(4000)

console.log('=== ① 笔记页不显示题库文件 ===')
const body = String(await ev(`document.body.innerText`))
check('笔记文件显示出来了', body.includes(`笔记文件-${RUN}`))
check('**题库文件没有出现**（两个数据源分开了）', !body.includes(`题库文件-${RUN}`),
  body.includes(`题库文件-${RUN}`) ? '题库文件串进来了' : '')

console.log('')
console.log('=== ② 上传前必须选学科 ===')
const ui = JSON.parse(await ev(`(function(){
  var sel = document.querySelector('[aria-label="选择所属学科"]');
  var up = document.querySelector('[aria-label="上传笔记文件"]');
  var dir = document.querySelector('[aria-label="上传整个笔记文件夹"]');
  return JSON.stringify({
    hasSelect: !!sel,
    selValue: sel ? sel.value : null,
    upDisabled: up ? up.disabled : null,
    dirDisabled: dir ? dir.disabled : null,
    optionCount: sel ? sel.options.length : 0,
  })
})()`))
console.log('  ', JSON.stringify(ui))
check('有「选择所属学科」下拉', ui.hasSelect === true)
check('下拉里有真实课程', ui.optionCount > 2, `${ui.optionCount} 项（含占位）`)
check('默认是「请选择」而不是某门课', ui.selValue === '', JSON.stringify(ui.selValue))
check('**没选学科时上传按钮是禁用的**', ui.upDisabled === true)
check('**文件夹按钮也是禁用的**', ui.dirDisabled === true)

const hint = String(await ev(`document.body.innerText`))
check('提示用户先选学科', hint.includes('先在上面选好学科'), '')

console.log('')
console.log('=== ③ 选了学科之后才能传 ===')
await setSelect('选择所属学科', course.id)
await sleep(600)
const after = JSON.parse(await ev(`(function(){
  var up = document.querySelector('[aria-label="上传笔记文件"]');
  var dir = document.querySelector('[aria-label="上传整个笔记文件夹"]');
  return JSON.stringify({ upDisabled: up.disabled, dirDisabled: dir.disabled });
})()`))
console.log('  ', JSON.stringify(after))
check('选好学科后上传按钮可用了', after.upDisabled === false)
check('文件夹按钮也可用了', after.dirDisabled === false)

/* 真的用界面传一个文件 */
const DIR = `${TMP}\\sep-${RUN}`
mkdirSync(DIR, { recursive: true })
const UI_NAME = `界面传的-${RUN}.md`
writeFileSync(`${DIR}\\${UI_NAME}`, '# 界面传的\n', 'utf8')
const doc = await send('DOM.getDocument', {})
const node = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '[aria-label="选择笔记文件"]' })
await send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [`${DIR}\\${UI_NAME}`] })
await sleep(5000)

const list = await (await fetch(`${API}/files?scope=note`, { headers: { Cookie: cookie } })).json()
const made = (list.data?.files ?? []).find((f) => f.name === UI_NAME)
console.log('  服务端查到:', JSON.stringify(made ? { name: made.name, courseId: made.courseId } : null))
check('**界面上传成功了**', !!made)
check('**带上了刚选的学科**', made?.courseId === course.id, String(made?.courseId))

const shown = String(await ev(`document.body.innerText`))
check('列表里显示了所属课程名', shown.includes(course.name), '')
check('**题库文件仍然没出现**', !shown.includes(`题库文件-${RUN}`))

/* ── 清理 ── */
for (const name of [qbankFile.name, noteFile.name, UI_NAME]) {
  const all = await (await fetch(`${API}/files?scope=${name === qbankFile.name ? 'qbank' : 'note'}`, { headers: { Cookie: cookie } })).json()
  for (const f of all.data?.files ?? []) {
    if (f.name === name) await fetch(`${API}/files/${encodeURIComponent(f.id)}`, { method: 'DELETE', headers: { Cookie: cookie } })
  }
}
console.log('')
console.log('已清理测试文件')

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
