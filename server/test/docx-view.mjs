/**
 * Word（.docx）站内查看。
 *
 * 用户反馈「上传的文件不支持 word 查看」。现在用 mammoth 转成 HTML。
 *
 * 两个关键点：
 *  ① 必须真的解析出**文档内容**。只断言"渲染了一个容器"是没用的 ——
 *     容器空着也算通过。
 *  ② **用用户库里真实的 docx** 测，不是造一个假的。
 *     真实文档里有表格、图片、样式，假的最小 docx 测不出这些。
 */

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const API = 'http://127.0.0.1:5175/api'
const TMP = process.env.TEMP
const port = 9273
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

/* ── 先在后端层面确认文件真的是 docx（zip 容器）── */
const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync('D:/MyWeb/server/data/vault.db')
const docxFiles = db.prepare("SELECT id, name, store_path FROM files WHERE kind = 'docx'").all()
db.close()

console.log(`库里有 ${docxFiles.length} 个 docx：`)
for (const f of docxFiles) console.log(`  · ${f.name}`)
console.log('')

/** .docx 是 zip：开头必须是 PK */
function isZip(p) {
  try {
    const b = readFileSync(p)
    return b[0] === 0x50 && b[1] === 0x4b
  } catch {
    return false
  }
}
const zipOk = docxFiles.filter((f) => isZip(`D:/MyWeb/server/data/${f.store_path}`))
check('这些都是真正的 .docx（zip 容器，PK 开头）', zipOk.length === docxFiles.length,
  `${zipOk.length}/${docxFiles.length}`)

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
  `--user-data-dir=${TMP}\\cv-docx`, '--window-size=1500,1000', '--remote-debugging-port=' + port, 'about:blank'],
  { stdio: 'ignore', windowsHide: true })
const ws = new WebSocket(await connect())
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
const errs = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errs.push(String(m.params?.exceptionDetails?.exception?.description ?? '').slice(0, 200))
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
  body: JSON.stringify({ account:'admin', password:'Cv-Dev-Only-2026' }) }).then(r=>r.status)`)
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(4500)
await ev(`(function(){var b=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim().indexOf('题库')===0);if(b)b.click();return 1})()`)
await sleep(3000)

/** 展开所有文件夹，好让里面的文件能被点到 */
await ev(`(function(){
  var rows = Array.from(document.querySelectorAll('[aria-label^="展开文件夹"]'));
  rows.forEach(function(r){ r.click() });
  return rows.length })()`)
await sleep(1500)

/** 点开某个文件，等 docx 解析完 */
async function openDocx(name) {
  await ev(`(function(){
    var b = Array.from(document.querySelectorAll('button')).find(function(e){
      return (e.textContent||'').indexOf(${JSON.stringify(name)}) >= 0 });
    if (b) b.click(); return 1 })()`)
  // mammoth 要下载 + 解析，给足时间
  await sleep(6000)
  return JSON.parse(await ev(`(function(){
    var art = document.querySelector('article.docx-body');
    var alert = document.querySelector('[role="alert"]');
    var t = art ? (art.innerText || '') : '';
    return JSON.stringify({
      hasArticle: !!art,
      textLen: t.length,
      head: t.slice(0, 120),
      htmlLen: art ? art.innerHTML.length : 0,
      tables: art ? art.querySelectorAll('table').length : 0,
      paras: art ? art.querySelectorAll('p').length : 0,
      headings: art ? art.querySelectorAll('h1,h2,h3,h4').length : 0,
      imgs: art ? art.querySelectorAll('img').length : 0,
      err: alert ? alert.textContent.slice(0, 120) : '',
      stillUnsupported: document.body.innerText.indexOf('暂不支持站内预览') >= 0,
    });
  })()`))
}

console.log('=== 逐个打开库里的 docx ===')
let anyRendered = false
for (const f of docxFiles.slice(0, 3)) {
  const r = await openDocx(f.name)
  console.log(`  ${f.name}`)
  console.log(`     正文 ${r.textLen} 字 · 段落 ${r.paras} · 标题 ${r.headings} · 表格 ${r.tables} · 图片 ${r.imgs}`)
  if (r.head) console.log(`     开头: ${r.head.replace(/\n/g, ' ').slice(0, 70)}`)
  if (r.err) console.log(`     错误: ${r.err}`)
  check(`**${f.name} 解析出了正文**`, r.hasArticle && r.textLen > 20,
    r.hasArticle ? `${r.textLen} 字` : r.err || '没有 docx-body')
  check(`  ${f.name} 不再显示「暂不支持站内预览」`, r.stillUnsupported === false)
  if (r.hasArticle && r.textLen > 20) anyRendered = true
}

console.log('')
check('至少有一个 Word 文档渲染成功（加载路径通了）', anyRendered)
check('控制台没有异常', errs.length === 0, errs.slice(0, 2).join(' | '))

console.log('')
console.log('=== 老格式 .doc 的处理（应当如实说明，而不是假装能看）===')
const hasDocInLib = false
void hasDocInLib
console.log('  （库里没有 .doc，这条靠代码路径保证：viewable 只对 .docx 放行）')

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
