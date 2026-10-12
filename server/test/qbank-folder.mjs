/**
 * 文件夹在题库里显示成**一个可展开的条目**。
 *
 * 用户的原话：「文件夹我希望只有一个按钮，点击展开文件夹，
 * 而不是把所有文件都分开放到题库里」。
 *
 * 所以要验证的是一条链：
 *   上传整个文件夹 → 列表里**只多出一个文件夹条目**（不是十几个文件）
 *   → 点它展开 → 里面的文件带子路径显示 → 再点收起
 *
 * 最容易漏的是第一条：如果分组没生效，文件仍会平铺，
 * 而"文件确实上传成功了"这种断言照样通过。
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const API = 'http://127.0.0.1:5175/api'
const TMP = process.env.TEMP
const port = 9265
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

/* 造一个有子目录的文件夹 */
const RUN = String(Date.now()).slice(-6)
const ROOT_NAME = `数据结构作业-${RUN}`
const DIR = `${TMP}\\${ROOT_NAME}`
mkdirSync(`${DIR}\\第一章`, { recursive: true })
mkdirSync(`${DIR}\\第二章`, { recursive: true })
writeFileSync(`${DIR}\\第一章\\习题-${RUN}.md`, '# 第一章习题\n', 'utf8')
writeFileSync(`${DIR}\\第二章\\习题-${RUN}.md`, '# 第二章习题\n', 'utf8')
writeFileSync(`${DIR}\\说明-${RUN}.txt`, `说明 ${RUN}\n`, 'utf8')

const cookie = (await (await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: 'admin', password: 'Cv-Dev-Only-2026' }),
})).headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')

console.log('测试文件夹:', DIR)
console.log('')

/* ── 浏览器 ── */
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
  `--user-data-dir=${TMP}\\cv-fold`, '--window-size=1600,1200', '--remote-debugging-port=' + port, 'about:blank'],
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
  body: JSON.stringify({ account:'admin', password:'Cv-Dev-Only-2026' }) }).then(r=>r.status)`)
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(4000)
await ev(`(function(){var b=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim().indexOf('题库')===0);if(b)b.click();return 1})()`)
await sleep(2500)

/* 记下上传前的状态 */
const before = JSON.parse(await ev(`(function(){
  var inp = document.querySelector('[aria-label="选择题库文件夹"]');
  return JSON.stringify({
    folderRows: document.querySelectorAll('[aria-label^="展开文件夹"],[aria-label^="收起文件夹"]').length,
    text: document.body.innerText.slice(0, 0),
    hasName: document.body.innerText.includes(${JSON.stringify(ROOT_NAME)}),
  })
})()`))
console.log('上传前 — 文件夹条目数:', before.folderRows, ' 已存在同名文件夹:', before.hasName)

/* ── 上传整个文件夹（CDP 对 webkitdirectory 要传目录路径）── */
const doc = await send('DOM.getDocument', {})
const node = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '[aria-label="选择题库文件夹"]' })
await send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [DIR] })
await sleep(8000)

const after = JSON.parse(await ev(`(function(){
  var rows = Array.from(document.querySelectorAll('[aria-label^="展开文件夹"],[aria-label^="收起文件夹"]'));
  var mine = rows.filter(function(e){ return (e.getAttribute('aria-label')||'').includes(${JSON.stringify(ROOT_NAME)}) });
  var t = document.body.innerText;
  return JSON.stringify({
    totalRows: rows.length,
    mineCount: mine.length,
    mineLabel: mine[0] ? mine[0].getAttribute('aria-label') : '',
    // 折叠状态下，里面的文件名**不应该**出现在列表里
    flatMdVisible: (t.match(/习题-${RUN}\\.md/g) || []).length,
    hintText: (t.match(/\\d+ 个文件/g) || []).slice(0, 3),
  })
})()`))
console.log('')
console.log('=== 上传后 ===')
console.log('  ', JSON.stringify(after))

check('列表里出现了一个文件夹条目', after.mineCount === 1, `${after.mineCount} 个`)
check('条目默认是**折叠**状态', after.mineLabel.startsWith('展开文件夹'), after.mineLabel)
check(
  '**文件没有平铺出来**（折叠时列表里看不到里面的文件）',
  after.flatMdVisible === 0,
  `页面上出现 ${after.flatMdVisible} 次文件名`,
)
check('条目上显示了文件数量', after.hintText.some((s) => s.includes('3 个文件')), JSON.stringify(after.hintText))

/* ── 展开 ── */
console.log('')
console.log('=== 点击展开 ===')
await ev(`(function(){
  var rows = Array.from(document.querySelectorAll('[aria-label^="展开文件夹"]'));
  var mine = rows.find(function(e){ return (e.getAttribute('aria-label')||'').includes(${JSON.stringify(ROOT_NAME)}) });
  if (mine) mine.click();
  return 1 })()`)
await sleep(1200)

const opened = JSON.parse(await ev(`(function(){
  var rows = Array.from(document.querySelectorAll('[aria-label^="展开文件夹"],[aria-label^="收起文件夹"]'));
  var mine = rows.filter(function(e){ return (e.getAttribute('aria-label')||'').includes(${JSON.stringify(ROOT_NAME)}) });
  var t = document.body.innerText;
  return JSON.stringify({
    label: mine[0] ? mine[0].getAttribute('aria-label') : '',
    mdVisible: (t.match(/习题-${RUN}\\.md/g) || []).length,
    subPathShown: t.includes('第一章/') && t.includes('第二章/'),
  })
})()`))
console.log('  ', JSON.stringify(opened))

check('点击后变成「收起」状态', opened.label.startsWith('收起文件夹'), opened.label)
check('展开后能看到里面的文件', opened.mdVisible >= 2, `出现 ${opened.mdVisible} 次`)
check('显示了子路径（区分第一章/第二章）', opened.subPathShown === true)

/* ── 再点收起 ── */
console.log('')
console.log('=== 再点收起 ===')
await ev(`(function(){
  var rows = Array.from(document.querySelectorAll('[aria-label^="收起文件夹"]'));
  var mine = rows.find(function(e){ return (e.getAttribute('aria-label')||'').includes(${JSON.stringify(ROOT_NAME)}) });
  if (mine) mine.click();
  return 1 })()`)
await sleep(1200)
const closed = JSON.parse(await ev(`(function(){
  var rows = Array.from(document.querySelectorAll('[aria-label^="展开文件夹"],[aria-label^="收起文件夹"]'));
  var mine = rows.filter(function(e){ return (e.getAttribute('aria-label')||'').includes(${JSON.stringify(ROOT_NAME)}) });
  var t = document.body.innerText;
  return JSON.stringify({
    label: mine[0] ? mine[0].getAttribute('aria-label') : '',
    mdVisible: (t.match(/习题-${RUN}\\.md/g) || []).length,
  })
})()`))
check('再点能收起', closed.label.startsWith('展开文件夹'), closed.label)
check('收起后文件又看不见了', closed.mdVisible === 0, `还有 ${closed.mdVisible} 次`)

/* ── 数据层：folder 字段确实存了 ── */
console.log('')
console.log('=== 数据层 ===')
const list = await fetch(`${API}/files?scope=qbank`, { headers: { Cookie: cookie } }).then((r) => r.json())
const mine = (list.data?.files ?? []).filter((f) => (f.folder ?? '').startsWith(ROOT_NAME))
console.log('  ', JSON.stringify(mine.map((f) => ({ name: f.name, folder: f.folder }))))
check('三个文件都带上了 folder 字段', mine.length === 3, `${mine.length} 个`)
check('folder 里存的是相对目录（含子目录）',
  mine.some((f) => f.folder === `${ROOT_NAME}/第一章`) && mine.some((f) => f.folder === `${ROOT_NAME}/第二章`),
  JSON.stringify(mine.map((f) => f.folder)))
check('顶层文件没有子目录', mine.some((f) => f.folder === ROOT_NAME))

/* ── 搜索：按文件夹名能找到 ── */
console.log('')
console.log('=== 按文件夹名搜索 ===')
const searchRes = await fetch(`${API}/files?scope=qbank&q=${encodeURIComponent(ROOT_NAME)}`, { headers: { Cookie: cookie } })
  .then((r) => r.json())
check('搜文件夹名能搜到里面的文件', (searchRes.data?.files ?? []).length === 3, `${(searchRes.data?.files ?? []).length} 个`)

/* 清理 */
let rm = 0
for (const f of list.data?.files ?? []) {
  if ((f.folder ?? '').startsWith(ROOT_NAME)) {
    await fetch(`${API}/files/${encodeURIComponent(f.id)}`, { method: 'DELETE', headers: { Cookie: cookie } })
    rm++
  }
}
console.log('')
console.log(`已清理 ${rm} 个测试文件`)

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
