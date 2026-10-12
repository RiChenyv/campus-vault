/**
 * 教务系统课表页（bkjw.cuc.edu.cn）——**脚本不再导入它**。
 *
 * 2026-10 的改动：课表改成「教务系统导出 xlsx → 导入页上传文件」。
 * 原因：那一页一个格子里塞了 4~6 个不同周次 / 教室 / 线上线下的时段，
 * 还靠固定表头把表拆成两张，版面一改就整段失效。
 *
 * 这个文件原来测的是 jw 页解析（课程号 / 教师 / 周次 / 连堂节次…）。
 * 那些解析连同 `jwCourses` 一起删了，所以现在改测**新契约**：
 *
 *   ① 这一页仍然被**认出来**（kind = 'timetable'）——
 *      这样面板能明确告诉用户"课表请用导出文件导入"，
 *      而不是含糊地说"没识别到内容"让人以为点错了页面；
 *   ② 它**不再产出任何可导入内容**（courses 为空 ⇒ 不可能有 slots），
 *      脚本因此永远不可能覆盖掉用文件导进来的课表；
 *   ③ 点开面板**一个会写库的请求都不发**，并且没有「导入」按钮；
 *   ④ 面板必须写清去哪儿导。
 *
 * 不需要后端：whoami 用桩回答（课表这条路上脚本不发别的请求）。
 */

import { spawn } from 'node:child_process'
import { buildUserscript } from '../src/lib/inject.ts'

const TMP = process.env.TEMP
const port = 9254
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
  `--user-data-dir=${TMP}\\cv-jw`, '--window-size=1600,1200', '--remote-debugging-port=' + port, 'about:blank'],
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
  /* 文档请求 → 换成我们的假页面；其它请求照常放行 */
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params
    const isDoc = /\.cuc\.edu\.cn\//.test(request.url)
    void send(isDoc ? 'Fetch.fulfillRequest' : 'Fetch.continueRequest', isDoc
      ? {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
          body: Buffer.from(PAGE, 'utf8').toString('base64'),
        }
      : { requestId })
  }
})
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description || '').slice(0, 400))
  return r.result?.result?.value
}

let pass = 0
let fail = 0
const check = (n, p, extra = '') => {
  if (p === true) { pass++; console.log(`PASS  ${n}`) } else { fail++; console.log(`FAIL  ${n}${extra ? '  (' + extra + ')' : ''}`) }
}
const panelText = () => ev(`(function(){ var p = document.getElementById('cv-panel'); return p ? p.innerText : '' })()`)

/* ── 按用户截图里的真实内容造假页面 ──
   ⚠️ 手法照 grades-userscript.mjs：把**文档请求 fulfill 成假页面**，
   于是 location.href 真的是 bkjw 的课表页 URL，内容又是我们造的。
   （只 Fetch.enable 不放行的话导航永远卡在 loading，
   `await send('Page.navigate')` 之后什么都做不了 —— 踩过一次。） */
const PAGE = `<!doctype html><html><body>
<div>2026-2027学年 秋季学期课表</div>
<table>
  <tr><td>节次/星期</td><td>星期一</td><td>星期二</td><td>星期三</td></tr>
  <tr><td>1(08:00~08:50)</td><td></td><td>
    <div>2121030179 专业示例课程一[01]</div><div>戊老师</div>
    <div>1-17周,星期2,08:00~09:50,</div><div>四十八教603</div>
  </td><td></td></tr>
  <tr><td>3(10:10~11:00)</td><td>
    <div>1131010002 通识示例课程二[13]</div><div>甲老师</div>
    <div>1-9周(单),星期1,13:30~15:10,</div><div>四十八教208</div>
  </td><td>
    <div>2171010001 体育(3)(示例项目)[25]</div><div>丑老师</div>
    <div>1-17周,星期2,10:10~12:00,</div><div>无</div>
  </td><td></td></tr>
</table>
<div>调课信息</div>
<div>专业示例课程四 2121030208</div>
<div>调课信息 从4周星期1的9-12节调整为5周星期7的5-8节,计算机基础教学实验1机房-48#102</div>
</body></html>`

await send('Page.enable')
await send('Runtime.enable')
await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
await send('Page.navigate', { url: 'https://bkjw.cuc.edu.cn/dtjwapp/sys/xskcb/abc/default/index.do' })
await sleep(800)

/* 桩 GM：令牌给一个真值（否则面板先问令牌），whoami 用桩回答，其余请求计数 */
const SCRIPT = buildUserscript('http://127.0.0.1:5175/api')
await ev(`
  window.__gm = { cv_import_token: 'cvi_jwtest' };
  window.__writes = 0;
  window.__whoami = 0;
  window.GM_getValue = function (k, d) { return Object.prototype.hasOwnProperty.call(window.__gm, k) ? window.__gm[k] : d };
  window.GM_setValue = function (k, v) { window.__gm[k] = v };
  window.GM_xmlhttpRequest = function (o) {
    if (o.url.indexOf('/import/whoami') >= 0) {
      window.__whoami++;
      o.onload && o.onload({ status: 200, responseText: JSON.stringify({ ok: true, data: { account: 'jwtest', username: '测试同学' } }) });
      return;
    }
    /* 课表这条路上不该有别的请求。真发了就记下来 —— 这正是要断言的 */
    if ((o.method || 'GET').toUpperCase() === 'POST') window.__writes++;
    o.onload && o.onload({ status: 200, responseText: JSON.stringify({ ok: true, data: {} }) });
  };
  1`)
await ev(SCRIPT)
await sleep(500)

/* ---------------------------- 解析器契约 ---------------------------- */
const data = JSON.parse(await ev(`JSON.stringify(cvParse())`))
console.log('识别页面类型:', data.kind)
check('课表页仍然被认出来 (timetable)', data.kind === 'timetable', String(data.kind))
check('不再产出任何课程（⇒ 不可能产出时间段）', (data.courses ?? []).length === 0, `${(data.courses ?? []).length} 门`)
check('课程里没有带 slots 的条目', (data.courses ?? []).every((c) => !(c.slots ?? []).length))
check('注入过程没有抛异常', errs.length === 0, JSON.stringify(errs).slice(0, 150))

const notes = (data.notes ?? []).join(' | ')
console.log('解析器提示:', notes)
check('提示里说明了改用文件导入', /导出|xlsx|上传文件/.test(notes), notes.slice(0, 140))
check('提示里给了去处（导入页 / 上传文件）', /导入页|上传文件/.test(notes), notes.slice(0, 140))

/* ---------------------------- 面板契约 ---------------------------- */
const fabText = await ev(`(function(){ var f = document.getElementById('cv-fab'); return f ? f.textContent : '' })()`)
check('右下角按钮出现了', !!fabText, String(fabText))
check('按钮**不是**「导入成绩」（这不是成绩页）', fabText !== '导入成绩', String(fabText))

await ev(`document.getElementById('cv-fab').click(); 1`)
await sleep(800)
const text = await panelText()
console.log('--- 面板文案 ---')
console.log(text.split('\n').slice(0, 12).map((l) => '  ' + l).join('\n'))

check('面板有专门的课表提示（不是"没识别到内容"）', /课表/.test(text) && !/没识别到内容/.test(text), text.split('\n')[0] ?? '')
check('面板写清了去哪导（导出 / xlsx / 上传文件）', /导出|xlsx|上传文件/.test(text), text.slice(0, 160))
const hasImportBtn = await ev(`(function(){
  var bs = Array.prototype.slice.call(document.querySelectorAll('#cv-panel button'));
  return bs.some(function (b) { return /^(导入|导入成绩|确认导入)/.test(b.textContent.trim()) });
})()`)
check('面板**没有**「导入」按钮', hasImportBtn === false, String(hasImportBtn))

const writes = await ev(`window.__writes`)
check('点开面板**没有发任何会写库的请求**', writes === 0, `POST 次数 ${writes}`)
/* 这一页没有可导入内容 ⇒ 连归属校验（whoami）都不必发。
   有请求才说明脚本还在管课表。 */
const whoami = await ev(`window.__whoami`)
check('课表页上**一个请求都不发**（连 whoami 也不需要）', whoami === 0, `whoami 次数 ${whoami}`)

console.log('')
console.log('==================================================')
console.log(`  通过 ${pass} / ${pass + fail}`)
console.log('==================================================')

try { ws.close() } catch { /* ignore */ }
proc.kill('SIGKILL')
process.exit(fail ? 1 : 0)
