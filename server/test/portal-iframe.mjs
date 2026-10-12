/**
 * 融合门户（iframe 嵌套）的解析测试。
 *
 * 起因：用户在 i.cuc.edu.cn 点导入，面板显示「没识别到内容」。
 * 怀疑是门户把卡片嵌在 iframe 里 —— `innerText` **不包含 iframe 内容**，
 * 只读顶层文档当然什么都找不到。
 *
 * 所以这个测试**必须真的把内容放进 iframe**，直接在顶层文档里造内容是测不出来的。
 */

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const TMP = process.env.TEMP
const port = 9259
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
  `--user-data-dir=${TMP}\\cv-portal`, '--window-size=1400,1000', '--remote-debugging-port=' + port, 'about:blank'],
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

/* ── 造一个"融合门户"假页面 ──
   外壳在顶层文档，**用户信息与今日课表都放在 iframe 里**。

   iframe 用 `srcdoc`（不是 data: URL）：
   data: URL 是 **opaque 源**，父文档读不到它的 contentDocument，
   那样测出来永远是"跨域读不到"，等于没测。
   srcdoc 继承父文档的源，才是同源 iframe —— 和真实门户里的一致。 */
const SHELL = `<!doctype html><html><head><meta charset="utf-8"><title>融合服务门户</title></head>
<body>
  <div class="top">中国传媒大学　融合服务门户　学校官网　首页　全部服务</div>
  <div class="body"><iframe id="card" srcdoc="__CARD__" style="width:900px;height:600px"></iframe></div>
</body></html>`

const CARD = `<!doctype html><html><head><meta charset="utf-8"></head>
<body>
  <div class="side">
    <div class="uname">时晨翔 <i class="caret"></i></div>
    <div class="college" title="计算机与网络空间安全学院">计算机与网络空间安...</div>
    <div class="today">今日课表　周课表</div>
    <div>3-4 节：示例课程　某实验室</div>
    <div>5-6 节：通识示例课程二　四十八教</div>
  </div>
  <div class="tasks">
    <div>《示例课程》第3次作业　通识示例课程一：如何在分心的…　2026-10-07 15:59</div>
    <div>第4章作业　专业示例课程一　2027-01-02 15:59</div>
  </div>
</body></html>`

await send('Page.enable'); await send('Runtime.enable')

/* 先导航到真实 http 源，再用 document.write 写入外壳 ——
   这样页面与 srcdoc iframe 同源，contentDocument 读得到。 */
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(2500)

const escaped = CARD.replace(/"/g, '&quot;')
const shellWithCard = SHELL.replace('__CARD__', escaped)
await ev(`document.open(); document.write(${JSON.stringify(shellWithCard)}); document.close(); 1`)
await sleep(900)

const script = readFileSync('D:/MyWeb/.tmp/cv-user.js', 'utf8')
await ev(`window.GM_getValue=function(){return ''};window.GM_setValue=function(){};window.GM_xmlhttpRequest=function(){};1`)
await ev(script)
await sleep(900)

const data = JSON.parse(await ev(`JSON.stringify(cvParse())`))

console.log('页面类型:', data.kind)
console.log('诊断:', JSON.stringify(data.debug, null, 1).slice(0, 600))
console.log('')
console.log('解析出的 profile:', JSON.stringify(data.profile))
console.log('解析出的 today:', JSON.stringify(data.today))
console.log('解析出的 assignments:', JSON.stringify(data.assignments).slice(0, 240))
console.log('')

check('顶层文档本身读不到用户信息（确认 iframe 是必要的）',
  !(await ev(`document.body.innerText.includes('时晨翔')`)) === true,
  String(await ev(`document.body.innerText.includes('时晨翔')`)))

check('诊断报告了 iframe 数量', (data.debug?.iframeCount ?? 0) >= 1, String(data.debug?.iframeCount))
check('采集到了 iframe 的文本', (data.debug?.docs ?? []).length >= 2, JSON.stringify(data.debug?.docs))
check('文本里能看到 iframe 的内容', /时晨翔/.test(data.debug?.sample ?? ''), (data.debug?.sample ?? '').slice(0, 60))

check('**姓名解析出来了**（来自 iframe）', data.profile.realName === '时晨翔', String(data.profile.realName))
check('**学院解析出来了**（来自 title 属性）',
  /计算机与网络空间安全学院/.test(data.profile.college), String(data.profile.college))

console.log('')
console.log('=== 采集到的文本（前 300 字）===')
console.log('  ' + String(data.debug?.sample ?? '').slice(0, 300))

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
