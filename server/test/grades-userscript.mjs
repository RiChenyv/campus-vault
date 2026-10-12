/**
 * 油猴脚本「导入成绩」面板的**真实运行**测试。
 *
 * 书签脚本那条路径已经整体删除（2026-10，用户嫌麻烦）；
 * 油猴脚本这个面板才是用户日常走的路：
 * 进成绩页 → 右下角按钮变成「导入成绩」→ 点开面板 → 读取当前页 → 确认 → 导入（翻页交给用户自己）。
 * 面板是三步（收集中 / 确认 / 结果）分屏重绘的，步骤之间的状态传递最容易出问题，
 * 所以每一步都要真的点一遍。
 *
 * GM_* 接口在这里用真 fetch 打桩 —— 油猴里它是扩展级请求（不受 CORS 约束），
 * 测试里换成页面 fetch，所以假 API 也要发 CORS 头，并且浏览器要关掉 PNA。
 */

import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { buildUserscript } from '../src/lib/inject.ts'

const TMP = process.env.TEMP
const port = 9266
const apiPort = 5182
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------------------------- 假 API ---------------------------- */

const received = []
const api = createServer((req, res) => {
  const headers = {
    'Access-Control-Allow-Origin': req.headers.origin ?? '',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Import-Token',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Private-Network': 'true',
    'Content-Type': 'application/json',
  }
  if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return }
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    let json = null
    try { json = JSON.parse(body) } catch { /* 非 JSON */ }
    const path = (req.url ?? '').split('?')[0]
    received.push({ path, token: req.headers['x-import-token'] ?? '', body: json })
    if (path === '/api/import/whoami') {
      res.writeHead(200, headers)
      res.end(JSON.stringify({ ok: true, data: { id: 1, account: '20260000000', username: '测试同学' } }))
      return
    }
    if (path === '/api/import/grades') {
      const n = json?.grades?.length ?? 0
      res.writeHead(200, headers)
      res.end(JSON.stringify({
        ok: true,
        data: {
          dryRun: false, total: n, create: n, update: 0, kept: 0, linked: 20, unlinked: n - 20,
          notes: [`${n - 20} 条对不上已有课程（课程号不同），会存成「仅成绩」记录 —— 不会自动新建课程`],
          applied: { created: n, updated: 0, kept: 0, linked: 20, unlinked: n - 20 },
        },
      }))
      return
    }
    res.writeHead(404, headers)
    res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: '接口不存在' } }))
  })
})
await new Promise((r) => api.listen(apiPort, '127.0.0.1', r))

/* ---------------------------- 假成绩页 ---------------------------- */

const ROWS = Array.from({ length: 29 }, (_, i) => [
  i < 10 ? '2025-2026学年第一学期' : i < 20 ? '2024-2025学年第二学期' : '2024-2025学年第一学期',
  `课程${i + 1}`, `22110100${String(i).padStart(2, '0')}`, String(60 + (i % 40)), '01', '专业教育课',
  '必修', String(1 + (i % 4)), '48', '正常', '否', '2026-06-30', (2 + (i % 30) / 10).toFixed(2), '正常',
])
const PAGE_SIZE = 10

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>成绩查询</title>
<style>body{font:13px/1.5 sans-serif}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}
.pager a{display:inline-block;padding:2px 8px;border:1px solid #bbb;margin-right:4px;cursor:pointer}
.pager a.disabled{opacity:.4}</style></head><body>
<div id="app">
  <div>学生成绩查询</div>
  <table><thead><tr><th>操作</th><th>学年学期</th><th>课程名</th><th>课程号</th><th>总成绩</th><th>课序号</th>
  <th>课程类别</th><th>课程性质</th><th>学分</th><th>学时</th><th>修读方式</th><th>是否主修</th><th>考试日期</th>
  <th>绩点</th><th>重修重考</th></tr></thead><tbody id="tb"></tbody></table>
  <div class="pager"><span>每页 10 条</span><span id="info"></span>
    <a id="first" class="disabled">|&lt;</a><a id="prev" class="disabled">&lt;</a><a id="next">&gt;</a><a id="last">&gt;|</a>
  </div>
</div>
<script>
  var ROWS = ${JSON.stringify(ROWS)};
  var PG = ${PAGE_SIZE};
  var page = 0;
  function render() {
    var start = page * PG, end = Math.min(start + PG, ROWS.length);
    var html = '';
    for (var i = start; i < end; i++) {
      html += '<tr><td>查看</td>' + ROWS[i].map(function (c) { return '<td>' + c + '</td>' }).join('') + '</tr>';
    }
    document.getElementById('tb').innerHTML = html;
    var pages = Math.ceil(ROWS.length / PG);
    document.getElementById('info').textContent = (start + 1) + '-' + end + ' 总记录数 ' + ROWS.length + ' 总页数 ' + pages;
    var last = page >= pages - 1;
    document.getElementById('prev').className = page === 0 ? 'disabled' : '';
    document.getElementById('first').className = page === 0 ? 'disabled' : '';
    document.getElementById('next').className = last ? 'disabled' : '';
    document.getElementById('last').className = last ? 'disabled' : '';
    document.getElementById('app').setAttribute('data-page', String(page));
  }
  document.getElementById('next').addEventListener('click', function () {
    if (page >= Math.ceil(ROWS.length / PG) - 1) return;
    /* 真实教务系统翻页是**异步请求**，有几百毫秒延迟。
       这里也延迟一下，否则收集快得像没发生，看不到"正在翻页"那一屏，
       而且 waitChange 的轮询路径也测不到。 */
    setTimeout(function () { page++; render() }, 400);
  });
  ['first','prev','last'].forEach(function (id) {
    document.getElementById(id).addEventListener('click', function () { render() });
  });
  render();
<\/script>
</body></html>`

/* ---------------------------- 浏览器 ---------------------------- */

await rm(`${TMP}\\cv-utg`, { recursive: true, force: true })
const proc = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1000,900',
  '--disable-features=PrivateNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults,LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests',
  `--user-data-dir=${TMP}\\cv-utg`, '--remote-debugging-port=' + port, 'about:blank'],
  { stdio: 'ignore', windowsHide: true })

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

const ws = new WebSocket(await connect())
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
const errs = []
let serve = { html: PAGE }
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + String(m.params?.exceptionDetails?.exception?.description ?? '').slice(0, 180))
  if (m.method === 'Log.entryAdded' && m.params?.entry?.level === 'error') errs.push('LOG ' + String(m.params.entry.text).slice(0, 180))
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params
    const isDoc = /\.cuc\.edu\.cn\//.test(request.url)
    void send(isDoc ? 'Fetch.fulfillRequest' : 'Fetch.continueRequest', isDoc
      ? {
          requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
          body: Buffer.from(serve.html, 'utf8').toString('base64'),
        }
      : { requestId })
  }
})
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description || '').slice(0, 300))
  return r.result?.result?.value
}
/** 按文字找一个按钮并点它；返回是否点到 */
const clickButton = (text) => ev(`(function(){
  var bs = Array.prototype.slice.call(document.querySelectorAll('#cv-panel button'));
  var b = bs.filter(function (x) { return (x.textContent || '').indexOf(${JSON.stringify(text)}) >= 0 })[0];
  if (!b) return false;
  if (b.disabled) return 'disabled';
  b.click();
  return true;
})()`)
const panelText = () => ev(`(function(){ var p = document.getElementById('cv-panel'); return p ? p.innerText : '' })()`)

const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
await send('Page.navigate', { url: 'https://bkjw.cuc.edu.cn/dtjwapp/sys/jqcx/abc123/default/index.do' })
await sleep(500)

/* 打 GM_* 的桩：GM_xmlhttpRequest 用真 fetch 实现 */
const SCRIPT = buildUserscript(`http://127.0.0.1:${apiPort}/api`)
await ev(`
  window.__gm = { cv_import_token: 'cvi_utest' };
  window.GM_getValue = function (k, d) { return Object.prototype.hasOwnProperty.call(window.__gm, k) ? window.__gm[k] : d };
  window.GM_setValue = function (k, v) { window.__gm[k] = v };
  window.GM_xmlhttpRequest = function (o) {
    fetch(o.url, { method: o.method || 'GET', headers: o.headers || {}, body: o.data })
      .then(function (r) { return r.text().then(function (t) { o.onload && o.onload({ status: r.status, responseText: t }) }) })
      .catch(function (e) { o.onerror && o.onerror(e) });
  };
  1`)
await ev(SCRIPT)
await sleep(500)

/* ---------------------------- 第一步：按钮自己变成「导入成绩」 ---------------------------- */
const fabText = await ev(`(function(){ var f = document.getElementById('cv-fab'); return f ? f.textContent : '' })()`)
check('右下角按钮出现了', !!fabText, fabText)
check('成绩页上按钮自己变成「导入成绩」', fabText === '导入成绩', fabText)

await ev(`document.getElementById('cv-fab').click(); 1`)
await sleep(600)
let text = await panelText()
check('面板认出了成绩页', /成绩查询/.test(text), text.split('\n').slice(0, 2).join(' / '))
/* ⚠️ 文案不能再声称"会自动翻页收齐" —— 自动翻页已移除（用户明确不要）。
   必须改成"还有下一页就自己翻页再点一次"，否则是句空话。 */
check('面板不再声称自动翻页，改成让用户自己翻页',
  !/自动翻页/.test(text) && /自己翻页/.test(text), (text.match(/成绩 \d+ 条.*/) ?? [''])[0].slice(0, 120))
check('面板列出了当前页的成绩条数', /成绩 10 条/.test(text), text.slice(0, 160))

/* ---------------------------- 第二步：收集中 ---------------------------- */
const started = await clickButton('导入成绩')
check('点到了「导入成绩」按钮', started === true, String(started))

/* 收集中那一屏是**过渡态**，翻完就换掉了 —— 要边翻边看，不能等结束再读。
   同时把整条路径上的面板文字都记下来。 */
const seenPanels = new Set()
let confirmText = ''
for (let i = 0; i < 120; i++) {
  const t = await panelText()
  seenPanels.add(t.split('\n')[0] ?? '')
  if (/正在读取这一页/.test(t)) seenPanels.add('__collecting__')
  if (/这一页读完了/.test(t)) { confirmText = t; break }
  await sleep(120)
}
const sawCollecting = seenPanels.has('__collecting__')
/* ⚠️ 用户明确说**不做自动翻页**：脚本只抓当前页，翻页交给用户自己。
   所以这里断言的是"单页"语义 —— 29 条那个数字来自三页，现在不该出现。 */
check('要么显示了「正在读取这一页」，要么直接进确认面板（同步解析，那一屏可能一闪而过）',
  sawCollecting || /这一页读完了/.test(confirmText), JSON.stringify([...seenPanels]))
/* 归属是异步查出来的（whoami）：面板一出现就断言会读到「正在确认归属…」。
   原来有翻页的那几秒盖住了这个时序，改成单页之后必须显式等一会儿。 */
for (let i = 0; i < 40; i++) {
  if (/将导入到：/.test(confirmText)) break
  await sleep(120)
  confirmText = await panelText()
}
/* 等归属那一行 */
console.log('  收集完成后的面板:', JSON.stringify(confirmText.split('\n').slice(0, 6)))
check('读完后切到确认面板', /这一页读完了/.test(confirmText), confirmText.split('\n')[0])
check('确认面板只显示当前页的 10 条（不再自动翻页收 29 条）',
  /成绩 10 条/.test(confirmText), (confirmText.match(/成绩 \d+ 条/) ?? [''])[0])
check('面板不再声称翻了 3 页', !/共 3 页/.test(confirmText), (confirmText.match(/共 \d+ 页/) ?? [''])[0])
check('面板不把内部标识当停止原因打给用户看',
  !/single-page|stuck|no-change|no-button|max-pages|max-rows/.test(confirmText),
  (confirmText.match(/说明：.*/) ?? ['(没有说明行)'])[0].slice(0, 60))
check('确认面板还没写库（服务端没收到请求）', !received.some((r) => r.path === '/api/import/grades'),
  JSON.stringify(received.map((r) => r.path)))
check('确认前显示归属', /将导入到：.+（\d+）/.test(confirmText), (confirmText.match(/将导入到：.*/) ?? [''])[0])

/* ---------------------------- 第三步：确认导入 ---------------------------- */
const doImport = await clickButton('确认导入')
check('点到了「确认导入 10 条」按钮', doImport === true, String(doImport))
await sleep(1500)
const doneText = await panelText()
console.log('  结果面板:', JSON.stringify(doneText.split('\n').slice(0, 6)))
check('切到结果面板', /成绩导入完成/.test(doneText), doneText.split('\n')[0])
check('结果面板显示新增 10 条', /新增 10/.test(doneText), doneText.split('\n').slice(0, 2).join(' / '))
check('结果面板把服务端的提示也念出来了', /仅成绩/.test(doneText), doneText.slice(0, 240))

const post = received.find((r) => r.path === '/api/import/grades')
check('服务端真的收到了 /api/import/grades', !!post)
check('载荷 10 条（只有当前页）', post?.body?.grades?.length === 10, `${post?.body?.grades?.length} 条`)
check('载荷带 source', post?.body?.source === 'userscript@bkjw.cuc.edu.cn', String(post?.body?.source))
check('载荷 dryRun=false', post?.body?.dryRun === false, String(post?.body?.dryRun))
check('令牌走 X-Import-Token', post?.token === 'cvi_utest', String(post?.token))
check('whoami 被调用过（归属校验）', received.some((r) => r.path === '/api/import/whoami'))
check('页面上没有未捕获异常', errs.length === 0, JSON.stringify(errs).slice(0, 200))

/* ---------------------------- 表格晚渲染（用户实测的场景） ----------------------------
   真实的成绩查询页是 Vue/Ant 渲染的，文档就绪时**整张表**还没出来
   （用户截图反馈：进去了十几秒，右下角还是「导入到 Campus Vault」）。
   原来只在 mount 和 mount+3s 各查一次，错过了就永远不补。

   注意模拟手法：先把 #app 藏起来（对 innerText 来说等于"没渲染"），
   6 秒后再显示出来。**不能只延迟 tbody 的行** —— 表头里的
   「总成绩 / 绩点 / 课程号」还在的话，按钮一开始就是对的，测了个寂寞。 */
console.log('')
console.log('--- 场景：整张表 6 秒后才渲染出来 ---')
serve.html = PAGE.replace(
  '\n  render();\n',
  "\n  document.getElementById('app').style.display = 'none';\n" +
  "  setTimeout(function () { document.getElementById('app').style.display = ''; render() }, 6000);\n",
)
check('（构造检查）假页面确实先把表格藏起来了', serve.html.includes("style.display = 'none'"))

await send('Page.navigate', { url: 'https://bkjw.cuc.edu.cn/dtjwapp/sys/jqcx/late/default/index.do' })
await sleep(500)
await ev(`
  window.__gm = { cv_import_token: 'cvi_utest' };
  window.GM_getValue = function (k, d) { return Object.prototype.hasOwnProperty.call(window.__gm, k) ? window.__gm[k] : d };
  window.GM_setValue = function (k, v) { window.__gm[k] = v };
  window.GM_xmlhttpRequest = function (o) {
    fetch(o.url, { method: o.method || 'GET', headers: o.headers || {}, body: o.data })
      .then(function (r) { return r.text().then(function (t) { o.onload && o.onload({ status: r.status, responseText: t }) }) })
      .catch(function (e) { o.onerror && o.onerror(e) });
  };
  1`)
await ev(SCRIPT)

const fabNow = () => ev(`(function(){ var f = document.getElementById('cv-fab'); return f ? f.textContent : '' })()`)
const earlyLabel = await fabNow()
check('表格没出来时，按钮还是默认文案', earlyLabel === '导入到 Campus Vault', earlyLabel)
await sleep(8500)
const lateLabel = await fabNow()
check('表格渲染后按钮**自己**变成「导入成绩」（不用点它）', lateLabel === '导入成绩', lateLabel)
check('按钮的 title 也跟着换了', /成绩/.test(String(await ev(`document.getElementById('cv-fab').title`))))

/* ---------------------------- "什么都没发就报成功" ----------------------------
   用户实测反馈："点击后提示导入成功，但页面无变化" ——
   库里查下来 0 条成绩、import_log 里也没有记录，说明**一个请求都没发**。

   原因：面板上的「今日课表 / 作业」只是展示，从来不发给后端（jobs 里只有
   profile + courses）。成绩页的表头含「考试日期」，会被作业识别规则命中 →
   面板显示"作业 1 条" → 点「导入」→ jobs 为空 → Promise.all([]) 立刻成功 →
   toast('导入完成')。绿色的成功提示，什么都没发生。

   这里就造这个页面：只有一条会被认成"作业"的文本，断言点「导入」之后
   **不能**出现成功提示，而要说明白没有可导入的内容。 */
console.log('')
console.log('--- 场景：只有"作业"能识别（不该报成功）---')
serve.html = `<!doctype html><html><head><meta charset="utf-8"><title>某页面</title></head><body>
  <div>课程任务：操作系统第3次作业 2026-10-07 15:59</div>
  <div>考试日期 2026-06-30</div>
</body></html>`
await send('Page.navigate', { url: 'https://bkjw.cuc.edu.cn/dtjwapp/sys/jqcx/noimp/default/index.do' })
await sleep(400)
await ev(`
  window.__gm = { cv_import_token: 'cvi_utest' };
  window.GM_getValue = function (k, d) { return Object.prototype.hasOwnProperty.call(window.__gm, k) ? window.__gm[k] : d };
  window.GM_setValue = function (k, v) { window.__gm[k] = v };
  window.__xm = 0;
  window.GM_xmlhttpRequest = function (o) {
    /* 只数**会写库**的 POST。/whoami 也是 POST，但它是只读的校验，
       把它算进来会让"一个请求都没发"这个断言永远失败。 */
    if (o.method === 'POST' && o.url.indexOf('/import/whoami') < 0) window.__xm++;
    fetch(o.url, { method: o.method || 'GET', headers: o.headers || {}, body: o.data })
      .then(function (r) { return r.text().then(function (t) { o.onload && o.onload({ status: r.status, responseText: t }) }) })
      .catch(function (e) { o.onerror && o.onerror(e) });
  };
  1`)
await ev(SCRIPT)
await sleep(400)
await ev(`document.getElementById('cv-fab').click(); 1`)
await sleep(800)
const panelNoImp = await panelText()
check('面板认出了"作业"（这就是误导的来源）', /作业/.test(panelNoImp), panelNoImp.split('\n').slice(0, 3).join(' / '))
const clickedImport = await clickButton('导入')
check('点到了「导入」按钮', clickedImport === true, String(clickedImport))
await sleep(1200)
const stillPanel = await panelText()
const posts = await ev(`(window.__xm || 0)`)
const toastShown = await ev(`!!Array.prototype.slice.call(document.querySelectorAll('div'))
  .filter(function (x) { return (x.textContent||'') === '导入完成' })[0]`)
check('没有发任何会写库的请求', posts === 0, `POST 次数 ${posts}`)
check('**不弹出"导入完成"**（原来这里是假的成功提示）', toastShown === false, String(toastShown))
check('面板说明了没有可导入的内容', /没有可以导入的内容/.test(stillPanel), stillPanel.slice(0, 160))

/* ---------------------------- 认出了成绩页但一行都没解析出来 ----------------------------
   用户实测："面板显示『成绩查询』，但说没有可导入的内容"。
   真实原因：Ant Design 的固定表头把 thead 和 tbody 拆成两张 <table>，
   而按"表头里有总成绩+课程号"找表的实现在只有表头的那张上命中 → 0 行。

   解析器的修法在 grades-parse.mjs 的 D2 场景里钉住了；这里验的是**面板行为**：
   不能落到"没有可导入的内容"（那句会让人以为点错了页面），
   而要说明白"认出了成绩页但没解析出数据"，并给出诊断信息的出口。 */
console.log('')
console.log('--- 场景：成绩页但 0 行（要能自己说清楚 + 给诊断出口）---')
serve.html = PAGE.replace(JSON.stringify(ROWS), '[]')
await send('Page.navigate', { url: 'https://bkjw.cuc.edu.cn/dtjwapp/sys/jqcx/empty/default/index.do' })
await sleep(500)
await ev(`
  window.__gm = { cv_import_token: 'cvi_utest' };
  window.GM_getValue = function (k, d) { return Object.prototype.hasOwnProperty.call(window.__gm, k) ? window.__gm[k] : d };
  window.GM_setValue = function (k, v) { window.__gm[k] = v };
  window.GM_xmlhttpRequest = function (o) {
    fetch(o.url, { method: o.method || 'GET', headers: o.headers || {}, body: o.data })
      .then(function (r) { return r.text().then(function (t) { o.onload && o.onload({ status: r.status, responseText: t }) }) })
      .catch(function (e) { o.onerror && o.onerror(e) });
  };
  1`)
await ev(SCRIPT)
await sleep(400)
await ev(`document.getElementById('cv-fab').click(); 1`)
await sleep(700)
const emptyPanel = await panelText()
check('面板说清了"认出了成绩页但没解析出行"', /认出了成绩页，但一行都没解析出来/.test(emptyPanel),
  emptyPanel.split('\n')[0])
check('**没有**落到"没有可导入的内容"（那是误导）', !/没有可以导入的内容/.test(emptyPanel))
check('给出了「复制诊断信息」的出口', /复制诊断信息/.test(emptyPanel))
check('面板里带了结构快照（几张表 / 选中哪张 / 数据行数）',
  /张表/.test(emptyPanel) && /表格数|数据行/.test(emptyPanel), emptyPanel.slice(0, 200).replace(/\n/g, '|'))
const debugJson = await ev(`document.getElementById('cv-panel').textContent.indexOf('"表格数"') >= 0`)
check('结构快照是 JSON（能直接复制发回来）', debugJson === true)

/* ---------------------------- 汇总 ---------------------------- */
console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close()
proc.kill('SIGKILL')
api.close()
process.exit(fails.length ? 1 : 0)
