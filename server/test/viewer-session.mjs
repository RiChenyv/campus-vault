/**
 * 把 cookie 删掉之后，题库里的文件仍然能正常打开。
 *
 * 这是上一条（头像）的**同源问题**：查看器的 <img> / <iframe> / 文本 fetch
 * 都在用裸 URL `/api/files/<id>/raw`，它们发不出 Authorization 头，
 * 只能靠 cookie。cookie 一旦不是当前标签页的账号，服务端按归属校验 404，
 * 表现成图片裂掉、PDF 一片空白、markdown 打不开。
 *
 * 所以必须**在 cookie 被删掉的状态下**测 —— 正常登录时怎么测都是好的。
 */

import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { writeFileSync, mkdirSync } from 'node:fs'

const API = 'http://127.0.0.1:5175/api'
const TMP = process.env.TEMP
const port = 9269
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
  return { sid: j.data?.sessionToken, cookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') }
}

const reg = await (await fetch(`${API}/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: PW, confirm: PW }),
})).json()
const ACC = reg.data.account
const guest = await login(ACC, PW)
console.log(`临时账号 ${ACC}`)
console.log('')

/* 传三个文件：图片、markdown、PDF */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
  'base64',
)
const MD = `# 会话测试\n\n这是**加粗**内容。\n`
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
  'utf8',
)

async function up(name, body) {
  const f = new FormData()
  f.append('files', new Blob([body]), name)
  f.append('scope', 'qbank')
  const r = await fetch(`${API}/files`, { method: 'POST', headers: { Cookie: guest.cookie }, body: f })
  return (await r.json()).data?.files?.[0]
}
const imgFile = await up(`图-${RUN}.png`, PNG)
const mdFile = await up(`笔记-${RUN}.md`, MD)
const pdfFile = await up(`文档-${RUN}.pdf`, PDF)
console.log('已上传:', [imgFile?.name, mdFile?.name, pdfFile?.name].join(', '))
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
  `--user-data-dir=${TMP}\\cv-viewer`, '--window-size=1600,1200', '--remote-debugging-port=' + port, 'about:blank'],
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
  body: JSON.stringify({ account:${JSON.stringify(ACC)}, password:${JSON.stringify(PW)} }) }).then(r=>r.status)`)
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(4200)
await ev(`(function(){var b=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim().indexOf('题库')===0);if(b)b.click();return 1})()`)
await sleep(2800)

/** 点开某个文件，返回渲染结果 */
async function open(name) {
  await ev(`(function(){
    var b = Array.from(document.querySelectorAll('button')).find(function(e){
      return (e.textContent||'').indexOf(${JSON.stringify(name)}) >= 0 });
    if (b) b.click(); return 1 })()`)
  await sleep(2600)
  return JSON.parse(await ev(`(function(){
    var img = document.querySelector('img[alt]');
    var ifr = document.querySelector('iframe');
    var art = document.querySelector('article.md');
    return JSON.stringify({
      imgOk: img ? (img.complete && img.naturalWidth > 0) : null,
      imgSrc: img ? img.src.slice(0, 12) : '',
      iframeSrc: ifr ? ifr.src.slice(0, 12) : '',
      mdOk: !!art,
      err: (document.querySelector('[role="alert"]')||{}).textContent || '',
    })
  })()`))
}

/* ── ① 正常情况 ── */
console.log('=== ① 正常登录时 ===')
const img1 = await open(`图-${RUN}.png`)
console.log('  图片:', JSON.stringify(img1))
check('图片能显示', img1.imgOk === true, JSON.stringify(img1))
check('图片用的是 blob: 地址', String(img1.imgSrc).startsWith('blob:'), img1.imgSrc)

const md1 = await open(`笔记-${RUN}.md`)
check('markdown 能渲染', md1.mdOk === true)

/* ── ② 删掉 cookie ── */
console.log('')
console.log('=== ② 删掉 cv_sid cookie 之后 ===')
await send('Network.enable')
// host-only cookie 必须带 url 才删得掉
await send('Network.deleteCookies', { name: 'cv_sid', url: 'http://127.0.0.1:5174/' })
await sleep(400)

const noAuth = JSON.parse(await ev(`fetch('/api/auth/me').then(r=>r.json())
  .then(j=>JSON.stringify({ok:j.ok}))`))
check('确认 cookie 已失效', noAuth.ok !== true, JSON.stringify(noAuth))

// 刷新：sessionStorage 里的令牌还在，cookie 没了
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(4500)
await ev(`(function(){var b=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim().indexOf('题库')===0);if(b)b.click();return 1})()`)
await sleep(2800)

const shown = String(await ev(`document.body.innerText`))
check('页面身份仍是临时账号', shown.includes(ACC), shown.slice(0, 50).replace(/\n/g, ' '))

const img2 = await open(`图-${RUN}.png`)
console.log('  图片:', JSON.stringify(img2))
check('**没有 cookie 时图片仍能显示**', img2.imgOk === true, JSON.stringify(img2))

const pdf2 = await open(`文档-${RUN}.pdf`)
console.log('  PDF:', JSON.stringify(pdf2))
check('**没有 cookie 时 PDF 仍能打开**', String(pdf2.iframeSrc).startsWith('blob:'), pdf2.iframeSrc)

const md2 = await open(`笔记-${RUN}.md`)
check('**没有 cookie 时 markdown 仍能渲染**', md2.mdOk === true)

/* ── ③ 对照：裸 URL 确实挂了 ── */
console.log('')
console.log('=== ③ 对照 ===')
const bare = await ev(`fetch('/api/files/${imgFile.id}/raw', { credentials:'include', cache:'no-store' })
  .then(r=>r.status).catch(()=>-1)`)
console.log('  裸 URL（只靠 cookie，且无 cookie）->', bare)
check('裸 URL 确实取不到（说明这个修复是必要的）', bare !== 200, `HTTP ${bare}`)

const withHeader = await ev(`(function(){
  var sid = sessionStorage.getItem('cv.sid');
  return fetch('/api/files/${imgFile.id}/raw', { cache:'no-store', headers:{ Authorization:'Bearer '+sid } })
    .then(function(r){ return r.status }).catch(function(){ return -1 });
})()`)
check('带上本标签页的令牌就能取到（修复走的就是这条路）', withHeader === 200, `HTTP ${withHeader}`)

/* 清理 */
const db = new DatabaseSync('D:/MyWeb/server/data/vault.db')
const u = db.prepare('SELECT id FROM users WHERE account = ?').get(ACC)
if (u) {
  const fs = db.prepare('SELECT store_path FROM files WHERE owner_id = ?').all(u.id)
  for (const t of ['profiles', 'sessions', 'courses', 'schedule_slots', 'import_tokens', 'import_log', 'activity_log'])
    { try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(u.id) } catch { /* 表结构不同 */ } }
  db.prepare('DELETE FROM files WHERE owner_id = ?').run(u.id)
  const { rm } = await import('node:fs/promises')
  const { resolve } = await import('node:path')
  for (const f of fs) {
    const abs = resolve('D:/MyWeb/server/data', f.store_path)
    if (abs.startsWith(resolve('D:/MyWeb/server/data'))) await rm(abs, { force: true }).catch(() => {})
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id)
  console.log('')
  console.log(`已清理临时账号 ${ACC}`)
}
db.close()
void writeFileSync; void mkdirSync

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
