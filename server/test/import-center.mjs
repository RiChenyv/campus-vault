/**
 * 导入中心 UI 验证。
 *
 * 断言的是"用户能不能真的走通"，所以：
 *  · 从「我的课程」点进导入中心（不是直接改路由）
 *  · 真的上传一个 ICS 文件（走 DOM.setFileInputFiles，不是调接口）
 *  · 真的点「预览」看有没有课表列出来
 *  · 三个标签页都要能开
 *
 * ⚠️ **已过时**（2026-10 全站 bug 巡检时确认）。两个原因：
 *   ① 导入中心后来改过版：标签页/分区都换了名字和位置，
 *      这里断言的是**旧版面**（三个标签 web/file/manual、独立的令牌区与历史区）。
 *   ② 它驱动的是**用户正开着的 5174**，不是隔离环境，
 *      既会受真实数据影响，也没法在测试里随便跑。
 * 现在这块的覆盖在 `ui-sweep.mjs`（隔离环境 + 导入页渲染/无 4xx），
 * 以及 `test/import-ownership.mjs`（归属与令牌语义）。
 * 所以这里直接**跳过**，而不是留一份 1/14 的红灯把真回归埋在噪声里。
 */

console.log('SKIP  import-center.mjs 已过时（断言的是改版前的导入中心，且跑在 5174 真实站点上）')
console.log('      现在的覆盖：test/ui-sweep.mjs（导入页渲染 + 无 4xx）、test/import-ownership.mjs（归属语义）')
/* 这里可以放心 exit：此刻还只有 import 语句跑过，没起浏览器、没有在飞的 socket
   （有 socket 时 process.exit 会撞 libuv 断言，见交接文档坑 5）。 */
process.exit(0)

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const TMP = process.env.TEMP
const port = 9252
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
  `--user-data-dir=${TMP}\\cv-imp`, '--window-size=1600,1200', '--remote-debugging-port=' + port, 'about:blank'],
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

/* 造一个真 ICS 文件给上传用 */
const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//CN',
  'BEGIN:VEVENT', 'UID:ui-test-1@x', 'SUMMARY:UI测试课程',
  'LOCATION:测试楼101',
  'DTSTART;TZID=Asia/Shanghai:20260907T080000',
  'DTEND;TZID=Asia/Shanghai:20260907T094000',
  'RRULE:FREQ=WEEKLY;COUNT=4',
  'END:VEVENT', 'END:VCALENDAR',
].join('\r\n')
const icsPath = 'D:\\MyWeb\\.tmp\\ui-import-test.ics'
writeFileSync(icsPath, ICS, 'utf8')

await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(3500)

// 登录
await ev(`fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ account:'admin', password:'Cv-Dev-Only-2026' }) }).then(r=>r.status)`)
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(4000)

/* ── 1. 从「我的课程」进导入中心 ── */
const clickedCourses = await ev(`(function(){
  var els = Array.from(document.querySelectorAll('button, a, [role=button]'));
  var t = els.find(function(e){ return (e.textContent||'').trim().indexOf('我的课程') === 0 });
  if (t) { t.click(); return 'ok' }
  return 'not-found'
})()`)
console.log('  进我的课程:', clickedCourses)
await sleep(2200)

const hasImportEntry = await ev(`(function(){
  var t = document.body.innerText;
  return t.indexOf('导入课程与课表') >= 0 ? 'yes' : 'no:' + t.slice(0,120).replace(/\\n/g,'|')
})()`)
check('「我的课程」页有导入入口', hasImportEntry === 'yes', String(hasImportEntry).slice(0, 100))

const clickedImport = await ev(`(function(){
  var els = Array.from(document.querySelectorAll('button'));
  var b = els.find(function(e){ return (e.textContent||'').indexOf('导入课程与课表') >= 0 });
  if (b) { b.click(); return 'ok' }
  return 'not-found'
})()`)
console.log('  点导入入口:', clickedImport)
await sleep(2200)

/* ── 2. 三个标签页 ── */
const tabs = await ev(`(function(){
  var t = document.body.innerText;
  return JSON.stringify({
    web: t.indexOf('从学校网站导入') >= 0,
    file: t.indexOf('上传文件') >= 0,
    manual: t.indexOf('手动添加') >= 0,
  })
})()`)
const tb = JSON.parse(tabs)
check('导入中心有三个标签页', tb.web && tb.file && tb.manual, tabs)

/* 默认页应当是「从学校网站导入」，含油猴与书签两块 */
const webPane = await ev(`(function(){
  var t = document.body.innerText;
  return JSON.stringify({
    hasUserscript: t.indexOf('安装油猴脚本') >= 0,
    hasBookmarklet: t.indexOf('拖我到书签栏') >= 0 || t.indexOf('生成导入令牌') >= 0,
    hasToken: t.indexOf('导入令牌') >= 0,
    hasHistory: t.indexOf('导入历史') >= 0,
  })
})()`)
const wp = JSON.parse(webPane)
check('有油猴脚本安装按钮', wp.hasUserscript, webPane)
check('有书签脚本入口（或令牌生成）', wp.hasBookmarklet, webPane)
check('有导入令牌区', wp.hasToken)
check('有导入历史区', wp.hasHistory)

/* 油猴脚本地址应当是后端真实提供的 */
const usHref = await ev(`(function(){
  var a = Array.from(document.querySelectorAll('a')).find(function(e){ return (e.textContent||'').indexOf('安装油猴脚本') >= 0 });
  return a ? a.getAttribute('href') : ''
})()`)
check('油猴安装链接指向后端脚本', /\/api\/import\/userscript\.user\.js$/.test(String(usHref)), String(usHref))

/* 可拖拽的书签链接。
   注意：不能只断言"以 javascript: 开头" —— React 19 把 javascript: 的 href
   换成 `javascript:throw new Error(...)`，那段文本同样以 javascript: 开头，
   会假通过。必须与后端返回的真实 URL 全等比较。 */
const realBm = await ev(`fetch('/api/import/bookmarklet', {credentials:'include'})
  .then(function(r){return r.json()}).then(function(j){ return j.ok ? j.data.url : '' })`)
const dragHref = await ev(`(function(){
  var a = Array.from(document.querySelectorAll('a')).find(function(e){ return (e.textContent||'').indexOf('拖我到书签栏') >= 0 });
  if (!a) return JSON.stringify({ found: false })
  var h = a.getAttribute('href') || ''
  return JSON.stringify({ found: true, draggable: a.draggable, len: h.length,
    isReactBlock: h.indexOf('React has blocked') >= 0,
    head: h.slice(0, 32) })
})()`)
const dh = JSON.parse(String(dragHref))
check('书签链接存在且可拖拽', dh.found === true && dh.draggable === true, String(dragHref)) 
check('书签链接不是 React 的拦截占位', dh.isReactBlock === false, dh.isReactBlock ? 'href=' + dh.head : dh.head)
check('书签链接长度与后端产出一致', dh.len === String(realBm).length, `页面 ${dh.len} vs 后端 ${String(realBm).length}`)

/* ── 3. 切到文件标签，真上传一个 ICS ── */
await ev(`(function(){
  var b = Array.from(document.querySelectorAll('button')).find(function(e){ return e.textContent.trim() === '上传文件' });
  if (b) b.click(); return 1
})()`)
await sleep(1200)

const filePane = await ev(`(function(){
  var t = document.body.innerText;
  return JSON.stringify({ hasDrop: t.indexOf('拖到这里') >= 0, hasHint: t.indexOf('.ics') >= 0 })
})()`)
const fp = JSON.parse(filePane)
check('文件页有拖放区', fp.hasDrop, filePane)
check('文件页说明了支持 .ics', fp.hasHint)

/* DOM.setFileInputFiles —— 这是唯一能真实触发 change 的方式 */
const doc = await send('DOM.getDocument', {})
const inputNode = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]' })
if (inputNode.result?.nodeId) {
  await send('DOM.setFileInputFiles', { nodeId: inputNode.result.nodeId, files: [icsPath] })
  await sleep(2000)
  const detected = await ev(`document.body.innerText.indexOf('识别为 ICS 日历文件') >= 0`)
  check('上传后被识别为 ICS 文件', detected === true)

  // 点「预览会导入什么」
  await ev(`(function(){
    var b = Array.from(document.querySelectorAll('button')).find(function(e){ return e.textContent.trim() === '预览会导入什么' });
    if (b) b.click(); return 1
  })()`)
  await sleep(2500)
  const previewText = await ev(`document.body.innerText`)
  check('预览列出了课程', String(previewText).includes('UI测试课程'), String(previewText).includes('UI测试课程') ? '' : '没找到课程名')
  check('预览显示了统计', /课程\s*\d+\s*门/.test(String(previewText)))
  check('有「确认导入」按钮', String(previewText).includes('确认导入'))
  check('有「取消」按钮', String(previewText).includes('取消'))
} else {
  check('找到文件输入框', false, 'DOM 里没有 input[type=file]')
}

/* ── 4. 手动添加页 ── */
await ev(`(function(){
  var b = Array.from(document.querySelectorAll('button')).find(function(e){ return e.textContent.trim() === '手动添加' });
  if (b) b.click(); return 1
})()`)
await sleep(1200)
const manual = await ev(`(function(){
  return JSON.stringify({
    name: !!document.querySelector('input[aria-label="课程名"]'),
    day: !!document.querySelector('select[aria-label="星期"]'),
    from: !!document.querySelector('input[aria-label="起始节次"]'),
    weeks: !!document.querySelector('input[aria-label="周次"]'),
    add: !!Array.from(document.querySelectorAll('button')).find(function(e){ return e.textContent.trim() === '添加' }),
  })
})()`)
const mn = JSON.parse(manual)
check('手动添加表单字段齐全', mn.name && mn.day && mn.from && mn.weeks && mn.add, manual)

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('D:\\MyWeb\\docs\\screenshots\\53-import-center.png', Buffer.from(shot.result.data, 'base64'))
console.log('  已存 53-import-center.png')

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
