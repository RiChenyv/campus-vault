/**
 * 全站 UI 巡检：把每个入口都走一遍，抓三类问题 ——
 *   ① 控制台异常 / JS 报错
 *   ② 该出现的关键元素没出现（白屏、数据没加载出来）
 *   ③ 4xx/5xx 与失败的请求（带 URL，光看控制台文案定位不了是哪个接口）
 * 外加行为验证：写操作必须真的落到服务端（交接文档测试原则①）。
 *
 * ⚠️ 需要一个**隔离的**环境，别拿用户正开着的网站跑：
 *
 *   $env:PORT="5178"; $env:DATA_DIR="'+ROOT+'\.tmp\data-test-vault"
 *   Set-Location '+ROOT+'\server; node src/index.ts
 *   Set-Location '+ROOT+'; node node_modules\vite\bin\vite.js --config .tmp/vite.test.config.mts
 *   Set-Location '+ROOT+'\server; node test/ui-sweep.mjs
 *
 * 脚本会先查 /api/health 的 dataDir，不是测试目录就直接拒绝运行。
 */

import { spawn } from 'node:child_process'
import { rm, mkdir } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'

const WEB = process.env.CV_WEB ?? 'http://127.0.0.1:5177'
const API = process.env.CV_API ?? 'http://127.0.0.1:5178/api'
const TMP = process.env.TEMP
const port = 9280
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (name, ok, extra = '') => {
  results.push([name, ok === true, extra])
  console.log(`${ok === true ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`)
}

/** 致命错误：设退出码后抛错。**不要 process.exit()** ——
 *  它会在 fetch 的 socket 正在关闭时撞 libuv 断言（交接文档坑 5）。 */
function fatal(msg) {
  console.error(msg)
  process.exitCode = 1
  throw new Error(msg)
}

/* ── 安全闸门 ── */
let health = null
try {
  health = await (await fetch(`${API}/health`, { signal: AbortSignal.timeout(4000) })).json()
} catch {
  fatal(`连不上测试后端 ${API} —— 先按文件头注释把测试前后端起起来`)
}
const dataDir = String(health?.data?.dataDir ?? '')
console.log('测试后端数据目录:', dataDir)
if (!/data-test/.test(dataDir)) fatal('拒绝运行：这不是测试数据目录（脚本会写数据）')

/* ── 一次性账号 ── */
const reg = await (await fetch(`${API}/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: 'Sw9#kQ4p', confirm: 'Sw9#kQ4p' }),
})).json()
if (!reg?.ok) {
  fatal(reg?.error?.code === 'TOO_LARGE'
    ? '注册被限流了（同 IP 一小时 10 个）—— 重启测试后端即可清掉计数'
    : '注册失败: ' + JSON.stringify(reg))
}
const sid = reg.data.sessionToken
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${sid}` }
console.log('测试账号:', reg.data.account)

const post = (p, b) => fetch(API + p, { method: 'POST', headers: auth, body: JSON.stringify(b) }).then((r) => r.json())
const getJson = async (p) => {
  const j = await (await fetch(API + p, { headers: auth })).json()
  /* 后端统一包了一层 { ok, data } —— 忘了剥壳会让断言全落空（踩过一次） */
  return j?.data ?? j
}

const seedLog = []
/** 塞种子数据。**放在空数据巡检之后**再调用 —— 空状态是另一条代码路径。 */
async function seed() {
  seedLog.push(['课程', (await post('/courses', { name: '数据结构（示例）', code: '2121030195', term: '2026-2027第1学期', credit: 3, teacher: '陈立群', room: '48#302' })).ok])
  seedLog.push(['第二门课', (await post('/courses', { name: '操作系统', code: '2121030201', term: '2026-2027第1学期', credit: 4 })).ok])
  seedLog.push(['手写笔记', (await post('/notes', { title: '第一章 绪论', body: '# 要点\n\n- 时间复杂度\n- 空间复杂度', courseId: '' })).ok])
  seedLog.push(['日历节点', (await post('/events', { day: new Date().getDate(), label: '数据结构 作业3 DDL', tone: 'ddl' })).ok])
  seedLog.push(['待办', (await post('/todos', { title: '复习第三章' })).ok])
  seedLog.push(['书签', (await post('/bookmarks', { name: 'MDN', url: 'https://developer.mozilla.org', category: '前端' })).ok])
  seedLog.push(['灵感', (await post('/ideas', { text: '用时间片轮转做过实验' })).ok])
  const tk = (await post('/import/token', {})).data.token
  const grades = await fetch(`${API}/import/grades`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Import-Token': tk },
    body: JSON.stringify({
      grades: [{ name: '数据结构（示例）', code: '2121030195', term: '2025-2026学年第二学期', score: '92', scoreNum: 92, credit: 3, gpa: 4, category: '专业教育课', nature: '必修', mode: '正常', examDate: '2026-06-30', retake: '正常' }],
      dryRun: false,
    }),
  }).then((r) => r.json())
  seedLog.push(['成绩', grades?.ok === true])
  const form = new FormData()
  form.append('files', new Blob(['# 算法笔记\n\n这是**加粗**内容\n\n- 列表项一\n'], { type: 'text/markdown' }), '算法笔记.md')
  form.append('scope', 'qbank')
  const up = await fetch(`${API}/files`, { method: 'POST', headers: { Authorization: `Bearer ${sid}` }, body: form }).then((r) => r.json())
  seedLog.push(['题库文件', up?.ok === true])
  console.log('种子数据:', seedLog.map(([k, ok]) => `${k}${ok ? '✓' : '✗'}`).join(' '))
}

/* ── 浏览器 ── */
await rm(`${TMP}\\cv-sweep`, { recursive: true, force: true })
await mkdir(`${TMP}\\cv-sweep`, { recursive: true })
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1600,1100',
  `--user-data-dir=${TMP}\\cv-sweep`, '--remote-debugging-port=' + port, 'about:blank'],
  { stdio: 'ignore', windowsHide: true })

async function connect() {
  for (let i = 0; i < 60; i++) {
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
let step = '(启动)'
const errors = []
const badNet = []
const allBadNet = []
const reqUrl = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Network.requestWillBeSent') reqUrl.set(m.params.requestId, String(m.params.request?.url ?? ''))
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(`[${step}] JS异常: ` + String(m.params?.exceptionDetails?.exception?.description ?? '').slice(0, 200))
  }
  if (m.method === 'Network.responseReceived') {
    const r = m.params.response
    if (r.status >= 400 && !/favicon/.test(r.url)) {
      const line = `[${step}] ${r.status} ${r.url.replace(WEB, '').slice(0, 110)}`
      badNet.push(line); allBadNet.push(line)
    }
  }
  if (m.method === 'Network.loadingFailed') {
    const url = String(reqUrl.get(m.params.requestId) ?? '').replace(WEB, '')
    if (!/favicon/.test(url)) {
      const line = `[${step}] 请求失败 ${m.params.errorText} → ${url.slice(0, 110) || '(未知URL)'}`
      badNet.push(line); allBadNet.push(line)
    }
  }
  if (m.method === 'Log.entryAdded' && m.params?.entry?.level === 'error') {
    const t = String(m.params.entry.text)
    if (/favicon/.test(t)) return
    /* 「Failed to load resource」是网络那两条的重复，而且控制台消息会**迟到**
       （前一步的错落到下一步的桶里）—— 以带 URL 的网络记录为准 */
    if (/Failed to load resource/i.test(t)) return
    errors.push(`[${step}] 控制台: ` + t.slice(0, 200))
  }
})
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return 'EVALERR: ' + String(r.result.exceptionDetails.exception?.description || '').slice(0, 240)
  return r.result?.result?.value
}
const bodyText = () => ev(`document.body.innerText`)
async function waitText(t, ms = 6000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (String(await bodyText()).includes(t)) return true
    await sleep(150)
  }
  return false
}
async function clickAt(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
/**
 * 点导航项（环形 4 个 / 胶囊 3 个）。
 * ⚠️ 环形那四个的"键盘可达按钮"是 0×0 透明元素、**只绑了 onKeyDown**；
 * 真正接收鼠标的是它下面的 SVG 扇形。所以取**标签文字的中心**发真实鼠标事件。
 */
async function clickNav(label) {
  const box = await ev(`(function(){
    var b = Array.prototype.slice.call(document.querySelectorAll('button'))
      .filter(function (x) { return (x.getAttribute('aria-label') || '').indexOf(${JSON.stringify(label)}) === 0 && x.getBoundingClientRect().width > 0 })[0];
    if (b) { var r = b.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }); }
    var t = Array.prototype.slice.call(document.querySelectorAll('div,span'))
      .filter(function (x) { return x.children.length === 0 && (x.textContent || '').trim() === ${JSON.stringify(label)} && x.getBoundingClientRect().width > 0 })[0];
    if (t) { var r2 = t.getBoundingClientRect(); return JSON.stringify({ x: r2.x + r2.width / 2, y: r2.y + r2.height / 2 }); }
    return '';
  })()`)
  if (!box) return ''
  const { x, y } = JSON.parse(box)
  await clickAt(x, y)
  return `(${Math.round(x)},${Math.round(y)})`
}
/** 回首页（Esc）。写成函数声明，位置无关 */
async function goHome() {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(900)
}
/** 给受控输入框赋值（直接改 .value 不触发 React 的 onChange） */
async function setInput(selector, value) {
  return ev(`(function(){
    var el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'not-found';
    var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var set = Object.getOwnPropertyDescriptor(proto, 'value').set;
    set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`)
}
async function clickByText(text, tag = 'button') {
  return ev(`(function(){
    var b = Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(tag)}))
      .filter(function (x) { return (x.textContent || '').replace(/\\s+/g, '').indexOf(${JSON.stringify(text)}) >= 0 })[0];
    if (!b) return 'not-found';
    b.click();
    return 'ok';
  })()`)
}

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable')

step = '登录'
await send('Page.navigate', { url: WEB })
await sleep(2500)
await ev(`sessionStorage.setItem('cv.sid', ${JSON.stringify(sid)}); 1`)
await send('Page.navigate', { url: WEB })
await sleep(5000)

/* ================= 第一轮：空账号（最容易白屏的地方） ================= */
console.log('')
console.log('=== 第一轮：空数据 ===')
const EMPTY_VIEWS = [
  ['题库', ['上传题库资料', '题库还是空的']],
  ['灵感', ['收件箱空了']],
  ['待办', ['TODO']],
  ['日历', ['本月重要节点', '这个月还没有安排']],
  ['我的课程', ['在修课程']],
  ['我的课表', ['周课表']],
  ['我的笔记', ['我写的笔记']],
]
for (const [label, markers] of EMPTY_VIEWS) {
  step = `空·${label}`
  errors.length = 0; badNet.length = 0
  if (!['题库', '灵感', '待办', '日历'].includes(label)) await goHome()
  const at = await clickNav(label)
  check(`空账号也点得到「${label}」`, at !== '', String(at))
  await sleep(1500)
  const txt = String(await bodyText())
  const missing = markers.filter((m) => !txt.includes(m))
  check(`空账号下「${label}」有内容/空状态引导`, missing.length === 0,
    missing.length ? '缺: ' + missing.join('、') + ' | 开头: ' + txt.slice(0, 90).replace(/\n/g, '|') : '')
  check(`空账号下「${label}」没有控制台异常`, errors.length === 0, errors.slice(0, 2).join(' || '))
  check(`空账号下「${label}」没有 4xx/5xx`, badNet.length === 0, badNet.slice(0, 2).join(' || '))
}

/* ================= 塞数据，第二轮 ================= */
await seed()
await send('Page.navigate', { url: WEB })
await sleep(5000)
const boot = String(await bodyText())
check('登录后进入首页（不是登录页）', !/登录|注册|密码/.test(boot.slice(0, 60)), boot.slice(0, 60).replace(/\n/g, '|'))
check('首页有标语', boot.includes('Recording every curious soul') && boot.includes('记录每一位求知的灵魂'))

console.log('')
console.log('=== 第二轮：有数据 ===')
const RING_VIEWS = [
  ['题库', ['上传题库资料', '算法笔记']],
  ['灵感', ['收件箱', '用时间片轮转做过实验']],
  ['待办', ['TODO', '复习第三章']],
  ['日历', ['本月重要节点', '学习热力图', '数据结构 作业3 DDL']],
]
const PILL_VIEWS = [
  ['我的课程', ['在修课程', '数据结构（示例）', '本学期课程']],
  ['我的课表', ['周课表', '周一']],
  ['我的笔记', ['我写的笔记', '第一章 绪论']],
]
for (const [label, markers] of RING_VIEWS) {
  step = label
  errors.length = 0; badNet.length = 0
  const at = await clickNav(label)
  check(`点得到「${label}」入口`, at !== '', String(at))
  await sleep(1700)
  const txt = String(await bodyText())
  check(`「${label}」真的切到了详情页`, !txt.includes('Recording every curious soul'), txt.slice(0, 70).replace(/\n/g, '|'))
  const missing = markers.filter((m) => !txt.includes(m))
  check(`「${label}」渲染出关键内容`, missing.length === 0,
    missing.length ? '缺: ' + missing.join('、') + ' | 开头: ' + txt.slice(0, 80).replace(/\n/g, '|') : '')
  check(`「${label}」没有控制台异常`, errors.length === 0, errors.slice(0, 2).join(' || '))
  check(`「${label}」没有 4xx/5xx`, badNet.length === 0, badNet.slice(0, 3).join(' || '))
}
for (const [label, markers] of PILL_VIEWS) {
  step = label
  errors.length = 0; badNet.length = 0
  await goHome()
  const at = await clickNav(label)
  check(`点得到「${label}」入口`, at !== '', String(at))
  await sleep(1700)
  const txt = String(await bodyText())
  check(`「${label}」真的切到了详情页`, !txt.includes('Recording every curious soul'), txt.slice(0, 70).replace(/\n/g, '|'))
  const missing = markers.filter((m) => !txt.includes(m))
  check(`「${label}」渲染出关键内容`, missing.length === 0,
    missing.length ? '缺: ' + missing.join('、') + ' | 开头: ' + txt.slice(0, 80).replace(/\n/g, '|') : '')
  check(`「${label}」没有控制台异常`, errors.length === 0, errors.slice(0, 2).join(' || '))
  check(`「${label}」没有 4xx/5xx`, badNet.length === 0, badNet.slice(0, 3).join(' || '))
}

/* ---- 二级页面 ---- */
step = '课程详情'
errors.length = 0; badNet.length = 0
await goHome(); await clickNav('我的课程'); await sleep(1600)
await ev(`(function(){
  var b = Array.prototype.slice.call(document.querySelectorAll('button'))
    .filter(function (x) { return (x.getAttribute('aria-label') || '').indexOf('数据结构（示例）') >= 0 })[0];
  if (b) b.click();
  return !!b;
})()`)
await sleep(1800)
check('课程详情渲染出课程名', (await waitText('数据结构（示例）', 4000)) === true, String(await bodyText()).slice(0, 80).replace(/\n/g, '|'))
check('课程详情没有控制台异常', errors.length === 0, errors.slice(0, 2).join(' || '))
check('课程详情没有 4xx/5xx', badNet.length === 0, badNet.slice(0, 3).join(' || '))

step = '学分总览'
errors.length = 0; badNet.length = 0
await goHome(); await clickNav('我的课程'); await sleep(1600)
await ev(`(function(){
  var b = Array.prototype.slice.call(document.querySelectorAll('button'))
    .filter(function (x) { return (x.getAttribute('aria-label') || '').indexOf('在修课程') >= 0 })[0];
  if (b) b.click();
  return !!b;
})()`)
await sleep(2000)
check('学分总览渲染出成绩明细', (await waitText('成绩明细', 4000)) === true)
check('学分总览没有控制台异常', errors.length === 0, errors.slice(0, 2).join(' || '))
check('学分总览没有 4xx/5xx', badNet.length === 0, badNet.slice(0, 3).join(' || '))

step = '导入页'
errors.length = 0; badNet.length = 0
await goHome(); await clickNav('我的课程'); await sleep(1600)
await ev(`(function(){
  var b = Array.prototype.slice.call(document.querySelectorAll('button'))
    .filter(function (x) { return (x.textContent || '').indexOf('导入课程') >= 0 })[0];
  if (b) b.click();
  return !!b;
})()`)
await sleep(2000)
check('导入页渲染出油猴脚本一栏', (await waitText('油猴脚本', 4000)) === true, String(await bodyText()).slice(0, 80).replace(/\n/g, '|'))
check('导入页没有控制台异常', errors.length === 0, errors.slice(0, 2).join(' || '))
check('导入页没有 4xx/5xx', badNet.length === 0, badNet.slice(0, 3).join(' || '))

/* ---- 命令面板 / 个人中心 / 显示设置 ---- */
step = '命令面板'
errors.length = 0
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 })
await sleep(900)
check('Ctrl+K 打开命令面板', (await ev(`!!document.querySelector('[aria-label="命令面板"]')`)) === true)
check('命令面板没有控制台异常', errors.length === 0, errors.slice(0, 2).join(' || '))
await goHome()

step = '个人中心'
errors.length = 0
await ev(`(function(){
  var b = Array.prototype.slice.call(document.querySelectorAll('button'))
    .filter(function (x) { var a = x.getAttribute('aria-label') || ''; return a.indexOf('个人中心') >= 0 || a.indexOf('个人面板') >= 0 })[0];
  if (b) b.click();
  return !!b;
})()`)
await sleep(1200)
const profile = String(await bodyText())
check('个人中心渲染出在校信息', profile.includes('在校信息') || profile.includes('个人中心'), profile.slice(0, 80).replace(/\n/g, '|'))
check('个人中心没有控制台异常', errors.length === 0, errors.slice(0, 2).join(' || '))
await goHome()

step = '显示设置'
errors.length = 0
await ev(`(function(){
  var b = Array.prototype.slice.call(document.querySelectorAll('button'))
    .filter(function (x) { return /画质|显示|设置/.test(x.getAttribute('aria-label') || '') })[0];
  if (b) b.click();
  return !!b;
})()`)
await sleep(900)
check('显示设置没有控制台异常', errors.length === 0, errors.slice(0, 2).join(' || '))
await goHome()

/* ================= 行为验证：写操作要真的落到服务端 ================= */
step = '灵感-写入'
errors.length = 0; badNet.length = 0
await clickNav('灵感'); await sleep(1600)
check('找得到灵感输入框', (await setInput('textarea[aria-label="新建灵感"]', '巡检写进来的灵感')) === 'ok')
check('找得到「收进收件箱」', (await clickByText('收进收件箱')) === 'ok')
await sleep(1600)
check('灵感写进了服务端', JSON.stringify(await getJson('/ideas')).includes('巡检写进来的灵感'))
check('灵感写入没有控制台异常', errors.length === 0, errors.slice(0, 2).join(' || '))
check('灵感写入没有 4xx/5xx', badNet.length === 0, badNet.slice(0, 2).join(' || '))

step = '待办-写入'
errors.length = 0; badNet.length = 0
/* ⚠️ 待办的新建框只在**首页第 3 屏**（MissionView）。
   点圆环「待办」进的详情页（TodosView）**没有新建入口** —— 功能缺口，见下面的记录。 */
await goHome(); await sleep(600)
check('首页的待办新建框存在', (await setInput('input[aria-label="新建任务"]', '巡检写进来的待办')) === 'ok')
check('找得到「加入待办」', (await clickByText('加入待办')) === 'ok')
await sleep(1600)
check('待办写进了服务端', JSON.stringify(await getJson('/todos')).includes('巡检写进来的待办'))
check('待办写入没有控制台异常', errors.length === 0, errors.slice(0, 2).join(' || '))
check('待办写入没有 4xx/5xx', badNet.length === 0, badNet.slice(0, 2).join(' || '))
await clickNav('待办'); await sleep(1400)
if (!(await ev(`!!document.querySelector('input[aria-label="新建任务"], textarea[aria-label="新建任务"]')`))) {
  console.log('  ⚠️ 已知问题：圆环「待办」进的详情页不能新建待办（新建框只在首页第 3 屏）')
}

step = '课程-写入'
errors.length = 0; badNet.length = 0
await goHome(); await clickNav('我的课程'); await sleep(1600)
check('找得到「新建课程」', (await ev(`(function(){ var b = document.querySelector('[aria-label="新建课程"]'); if (b) b.click(); return !!b })()`)) === true)
await sleep(600)
check('填课程名', (await setInput('input[aria-label="课程名 *"]', '巡检新建的课')) === 'ok')
check('填学分', (await setInput('input[aria-label="学分"]', '2')) === 'ok')
check('找得到「保存课程」', (await ev(`(function(){ var b = document.querySelector('[aria-label="保存课程"]'); if (b) b.click(); return !!b })()`)) === true)
await sleep(1800)
check('课程写进了服务端', JSON.stringify(await getJson('/courses')).includes('巡检新建的课'))
check('课程写入没有控制台异常', errors.length === 0, errors.slice(0, 2).join(' || '))
check('课程写入没有 4xx/5xx', badNet.length === 0, badNet.slice(0, 2).join(' || '))

/* ================= 统计数字必须是真实的（原来写死 158 / 9） ================= */
step = '课程统计'
errors.length = 0; badNet.length = 0
await goHome(); await clickNav('我的课程'); await sleep(2500)
const tiles = JSON.parse(await ev(`(function(){
  var out = {};
  ['在修课程', '资料总量', '本周新增'].forEach(function (label) {
    var labelEl = Array.prototype.slice.call(document.querySelectorAll('div,span,dt'))
      .filter(function (x) { return x.children.length === 0 && (x.textContent || '').trim() === label })[0];
    out[label] = labelEl && labelEl.parentElement
      ? labelEl.parentElement.textContent.replace(/\\s+/g, ' ').trim().slice(0, 40) : '(没找到)';
  });
  return JSON.stringify(out);
})()`))
const files = await getJson('/files')
const notes = await getJson('/notes')
const weekAgo = Date.now() - 7 * 86400000
const docs = (files.files ?? []).filter((x) => x.scope === 'qbank' || x.scope === 'note')
const expectFiles = docs.length
const expectWeek = docs.filter((x) => x.scope === 'note' && x.createdAt >= weekAgo).length +
  (notes.notes ?? []).filter((x) => x.createdAt >= weekAgo).length
console.log('  三格统计:', JSON.stringify(tiles), `(服务端: 资料 ${expectFiles} / 本周 ${expectWeek})`)
/* 按「标签 + 数字 + 单位」整段匹配：光查 "1" 会被 158 这种数字骗过，
   而 tile 的文本是折叠过的（"资料总量1份文件"，标签和数字之间没有空格） */
const tileRe = (label, value, unit) => new RegExp(label + '\\s*' + value + '\\s*' + unit)
check('「资料总量」显示的是真实数字',
  tileRe('资料总量', expectFiles, '份文件').test(tiles['资料总量']), tiles['资料总量'])
check('「本周新增」显示的是真实数字',
  tileRe('本周新增', expectWeek, '份笔记').test(tiles['本周新增']), tiles['本周新增'])
check('统计里不再出现写死的 158', !tiles['资料总量'].includes('158'), tiles['资料总量'])
check('课程统计没有控制台异常', errors.length === 0, errors.slice(0, 2).join(' || '))
check('课程统计没有 4xx/5xx', badNet.length === 0, badNet.slice(0, 2).join(' || '))

/* ---- 汇总 ---- */
console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('--- 全程 4xx/5xx 与失败请求 ---')
console.log(allBadNet.length ? allBadNet.map((l) => '   ' + l).join('\n') : '   (无)')
console.log('==================================================')

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${TMP}\\ui-sweep.png`, Buffer.from(shot.result.data, 'base64'))
console.log('  截图已存到 .tmp/ui-sweep.png')

ws.close()
chrome.kill('SIGKILL')
process.exitCode = fails.length ? 1 : 0
