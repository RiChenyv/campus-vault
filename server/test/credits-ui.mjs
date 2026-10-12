/**
 * 学分总览页的 UI 验证：真实数据 + 学分/绩点可改。
 *
 * 为什么要有它：成绩导入这条链路的最后一环是**界面**。
 * 服务端接口全绿、页面上什么都看不到，用户端的感受就是"没做"。
 *
 * 覆盖：
 *   · 统计口径（已修学分 / 未出分 / 平均绩点 / 毕业要求）
 *   · 按学期分组的明细、仅成绩标记、未出分显示「—」
 *   · **缺字段显示「未收集」**（灰标 + 逐项 chips + 缺学分的行不算进已修学分）
 *   · 点「改」→ 改学分与绩点 → 保存 → **服务端真的变了**（交接文档原则①）
 *
 * ⚠️ 跑之前必须先把网站起在**测试数据目录**上，否则会往真实库里塞数据：
 *
 *   $env:TMP="'+ROOT+'\.tmp"; $env:TEMP="'+ROOT+'\.tmp"
 *   $env:PORT="5175"; $env:DATA_DIR="'+ROOT+'\.tmp\data-test-vault"
 *   Set-Location '+ROOT+'\server; node src/index.ts             # 一个窗口
 *   Set-Location '+ROOT+'; node node_modules\vite\bin\vite.js   # 另一个窗口
 *   Set-Location '+ROOT+'\server; node test/credits-ui.mjs
 *
 * 想跑在**别的端口**（比如用户正开着 5174/5175 时）就用这两个环境变量：
 *
 *   $env:CV_API="http://127.0.0.1:5180/api"; $env:CV_APP="http://127.0.0.1:5177"
 *
 * 数据目录必须放在 **.tmp 下**（或任何 vite watcher 忽略的路径）：
 * 测试会往里写文件，watcher 一发现就整页热重载，界面断言会莫名其妙地失败。
 * 这个坑真实踩过 —— 见 vite.config.ts 的 watch.ignored。
 *
 * 脚本自己会先查 /api/health 的 dataDir —— 路径里没有 data-test 就直接退出，
 * 免得手一滑把成绩写进真实账号。账号是一次性注册的（原则③）。
 */

import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'

const TMP = process.env.TEMP
const port = 9267
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const API = process.env.CV_API ?? 'http://127.0.0.1:5175/api'
const APP = process.env.CV_APP ?? 'http://127.0.0.1:5174'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

/* ── 安全闸门：确认后端跑在测试数据目录上 ── */
let health = null
try {
  health = await (await fetch(`${API}/health`)).json()
} catch {
  console.error(`连不上 ${API} —— 先把后端和 vite 起起来（见文件头注释）`)
  process.exit(1)
}
const dataDir = String(health?.data?.dataDir ?? '')
console.log('后端数据目录:', dataDir)
if (!/data-test/.test(dataDir)) {
  console.error('')
  console.error('拒绝运行：后端用的不是测试数据目录。')
  console.error('这个脚本会新建账号并写入成绩，跑在真实库上会污染数据。')
  console.error('请按文件头注释，用 DATA_DIR=server\\data-test-ui 起一个后端再跑。')
  process.exit(1)
}

/* ── 一次性账号 + 导入令牌 ── */
const reg = await (await fetch(`${API}/auth/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: 'Ui9#kQ4p', confirm: 'Ui9#kQ4p' }),
})).json()
if (!reg?.ok) {
  console.error('注册失败：', JSON.stringify(reg))
  process.exit(1)
}
const sid = reg.data.sessionToken
console.log('测试账号:', reg.data.account)

const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${sid}` }
const tokRes = await (await fetch(`${API}/import/token`, { method: 'POST', headers: authHeaders, body: '{}' })).json()
const importToken = tokRes.data.token

/* ── 种子数据：一门课 + 12 条成绩 ── */
await fetch(`${API}/courses`, {
  method: 'POST', headers: authHeaders,
  body: JSON.stringify({ name: '基础示例课程二', code: '2131010006', term: '2025-2026学年第一学期', credit: 4 }),
})

const FIXTURE = [
  ['2025-2026学年第一学期', '马克思主义基本原理', '2211010024', '91', 3, 3.85],
  ['2025-2026学年第一学期', '专业示例课程一', '2121030179', '88', 3, 3.63],
  ['2025-2026学年第一学期', '专业示例课程五', '2121030229', '优秀', 3, null],
  ['2025-2026学年第一学期', '基础示例课程二', '2131010006', '76', 4, 2.85],
  ['2025-2026学年第一学期', '计算机系统', '2121030194', '84', 3, 3.33],
  ['2025-2026学年第一学期', '思政示例课程二', '2211010016', '90', 3, 3.7],
  ['2025-2026学年第一学期', '通识示例课程二', '1131010002', '92', 2, 4.0],
  ['2025-2026学年第一学期', '体育(3)(示例项目)', '2171010001', '85', 1, 3.5],
  ['2025-2026学年第一学期', '形势与政策(3)', '2211010004', '', 2, null],
  ['2024-2025学年第二学期', '高等数学A(下)', '2131010001', '86', 5, 3.7],
  ['2024-2025学年第二学期', '线性代数', '2131010002', '73', 3, 2.3],
  ['2024-2025学年第二学期', '程序设计基础(C)', '2121030102', '94', 4, 4.0],
].map(([term, name, code, score, credit, gpa]) => ({
  term, name, code, score, credit, gpa, scoreNum: /^\d+$/.test(score) ? Number(score) : null,
  category: '专业教育课', nature: '必修', mode: '正常', major: true, examDate: '2026-06-30', retake: '正常',
}))

const seed = await (await fetch(`${API}/import/grades`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Import-Token': importToken },
  body: JSON.stringify({ grades: FIXTURE, source: 'credits-ui-test', dryRun: false }),
})).json()
console.log('种子导入:', JSON.stringify(seed?.data?.applied ?? seed))

/* ── 再补一条「已出分、但学分是 0」的记录 ──
   这条是 2026-10 加的，专门为了**真的走到**「还有 N 条缺学分」那条分支：
   12 条种子数据的学分都是满的，缺学分口径那一段原来等于没测到
   （断言写成 `!/[0-9] 学分/` 那种"恒真"的话，永远 PASS 也永远没用）。 */
const zeroSeed = await (await fetch(`${API}/grades`, {
  method: 'POST', headers: authHeaders,
  body: JSON.stringify({
    name: '缺学分的课', code: '9999999999', term: '2025-2026学年第一学期',
    score: '88', credit: 0, gpa: null,
  }),
})).json()
console.log('补录缺学分那条:', zeroSeed?.ok === true ? 'OK' : JSON.stringify(zeroSeed?.error))

/* ── 浏览器 ── */
await rm(`${TMP}\\cv-cui`, { recursive: true, force: true })
const proc = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1600,1100',
  `--user-data-dir=${TMP}\\cv-cui`, '--remote-debugging-port=' + port, 'about:blank'],
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
const errs = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + String(m.params?.exceptionDetails?.exception?.description ?? '').slice(0, 200))
  if (m.method === 'Log.entryAdded' && m.params?.entry?.level === 'error') errs.push('LOG ' + String(m.params.entry.text).slice(0, 200))
})
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description || '').slice(0, 300))
  return r.result?.result?.value
}
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable')

await send('Page.navigate', { url: APP })
await sleep(2500)
/* 直接把会话令牌塞进 sessionStorage（前端就是从这儿读的），省掉驱动登录表单 */
await ev(`sessionStorage.setItem('cv.sid', ${JSON.stringify(sid)}); 1`)
await send('Page.navigate', { url: APP })
await sleep(4000)

const booted = await ev(`document.body.innerText.slice(0, 120)`)
check('登录态被识别（不是登录页）', !/登录|注册/.test(booted.slice(0, 40)), booted.slice(0, 50))

/* 环形导航的元素带 aria-label；按文字找不稳（图标为主），按前缀找最可靠 */
const goCourses = await ev(`(function(){
  var el = document.querySelector('[aria-label^="我的课程"]');
  if (!el) return false;
  el.click();
  return true;
})()`)
check('点到「我的课程」', goCourses === true)
await sleep(1200)
check('进到了课程页', (await ev(`document.body.innerText.indexOf('在修课程') >= 0`)) === true)

const goCredits = await ev(`(function(){
  var b = Array.prototype.slice.call(document.querySelectorAll('button'))
    .filter(function (x) { return (x.getAttribute('aria-label') || '').indexOf('在修课程') >= 0 })[0];
  if (!b) return false;
  b.click();
  return true;
})()`)
check('点到「在修课程」→ 学分总览', goCredits === true)
await sleep(2500)

/* 登录那一跳会先 401（请求还没带上会话），从这里开始才统计页面异常 */
errs.length = 0

const creditsText = await ev(`document.body.innerText`)
console.log('')
console.log('  学分总览页文本（前 400 字）:')
console.log(creditsText.slice(0, 400).split('\n').map((l) => '    ' + l).join('\n'))
console.log('')

/* 已修学分的口径 2026-10 变了：**缺学分的行（credit 为 0/空）与未出分的行都不算进去**，
   旁边会写「还有 N 条缺学分」。文案也从「11 门已出分」改成了「共 11 门」。
   种子 12 条 + 1 条"出分但 0 学分" = 13 条；算进已修学分的是 11 条（34 学分），
   未出分 1 条（2 学分），出分但缺学分 1 条。 */
check('显示已修学分 34（共 11 门）', /已修学分[\s\S]{0,24}34/.test(creditsText) && /共 11 门/.test(creditsText),
  (creditsText.match(/已修学分[\s\S]{0,24}/) ?? [''])[0].replace(/\n/g, '/'))
check('★ 缺学分的那条没算进已修学分，并且明确写出「还有 1 条缺学分」',
  /还有 1 条缺学分/.test(creditsText),
  (creditsText.match(/[^\n]*还有 \d+ 条缺学分[^\n]*/) ?? ['(没写出来)'])[0])
check('★ 进度条那边也标了"未计入"（否则用户会以为进度是完整的）',
  /还有 1 条缺学分，未计入/.test(creditsText),
  (creditsText.match(/[^\n]*未计入[^\n]*/) ?? ['(没有)'])[0])
check('显示未出分 2 学分 / 1 门', /未出分[\s\S]{0,30}2/.test(creditsText) && /1 门 · 待出分/.test(creditsText))
check('显示加权平均绩点 3.48', /3\.48/.test(creditsText), (creditsText.match(/3\.\d\d/) ?? [''])[0])

/* ── 「未收集」显示（用户第 2 条需求）──────────────────────────────
   表格里没有的列 / 空单元格，界面上要明确显示灰色的「未收集」，
   让用户能发现并逐条补 —— 空着一片空白是发现不了的。 */
check('页面上有明确的「未收集」字样', /未收集/.test(creditsText),
  (creditsText.match(/[^\n]*未收集[^\n]*/) ?? ['(一个字都没有)'])[0])
check('缺字段的行有灰标「缺 N 项」', /缺 \d+ 项/.test(creditsText),
  (creditsText.match(/缺 \d+ 项[^\n]*/) ?? ['(没有灰标)'])[0])
check('★ 缺得最多的那条列全了 7 项（课程类别/性质/修读方式/考试日期/重修重考/学分/绩点）',
  /缺 7 项/.test(creditsText), (creditsText.match(/缺 \d+ 项[^\n]*/) ?? ['(没有)'])[0])
check('逐项写了「课程类别 未收集」', /课程类别 未收集/.test(creditsText))
check('逐项写了「修读方式 未收集」', /修读方式 未收集/.test(creditsText))
check('逐项写了「考试日期 未收集」', /考试日期 未收集/.test(creditsText))
check('逐项写了「学分 未收集」', /学分 未收集/.test(creditsText),
  (creditsText.match(/[^\n]*学分 未收集[^\n]*/) ?? ['(没有)'])[0])
check('逐项写了「绩点 未收集」', /绩点 未收集/.test(creditsText))
check('学分缺失时不说「0 学分」（0 和"没有"是两回事）', !/\b0 学分/.test(creditsText),
  (creditsText.match(/\b0 学分/g) ?? []).length + ' 处')
check('学期标题上有「N 条有未收集项」', /\d+ 条有未收集项/.test(creditsText),
  (creditsText.match(/\d+ 条有未收集项/) ?? ['(没有)'])[0])
check('★「未收集」用的是灰字（不是醒目色 —— 它是提示，不是警告）',
  (await ev(`(function () {
    var el = Array.prototype.slice.call(document.querySelectorAll('span'))
      .filter(function (x) { return /未收集/.test(x.textContent || '') && x.children.length === 0 })[0];
    if (!el) return 'none';
    var cs = getComputedStyle(el);
    var m = cs.color.match(/rgba?\\((\\d+), ?(\\d+), ?(\\d+)/);
    if (!m) return 'color=' + cs.color;
    var r = +m[1], g = +m[2], b = +m[3];
    /* 灰 = 三个通道接近；低透明度也算（rgba 的 a 很小） */
    var flat = Math.max(r, g, b) - Math.min(r, g, b) < 40;
    var dim = /rgba\\([^)]*,\\s*0?\\.\\d+\\)/.test(cs.color);
    return (flat || dim) ? 'gray' : ('colorful:' + cs.color);
  })()`)) === 'gray')
check('学分/绩点仍然可以就地改（缺学分的行也要能补）', /学分和绩点都可以改/.test(creditsText))

check(
  '按学期分组（种子数据里的两个学期都在）',
  ['2025-2026学年第一学期', '2024-2025学年第二学期'].every((t) => creditsText.includes(t)),
  '缺：' + ['2025-2026学年第一学期', '2024-2025学年第二学期'].filter((t) => !creditsText.includes(t)).join(','),
)
check('列出了 12 门课', FIXTURE.every((f) => creditsText.includes(f.name)))
check('「优秀」原样显示（不瞎猜成 90 分）', creditsText.includes('优秀'))
check('未出分的显示「—」', /形势与政策\(3\)[\s\S]{0,60}—/.test(creditsText))
check('课程号对得上的不算「仅成绩」', /基础示例课程二已手改|基础示例课程二[\s\S]{0,20}2131010006/.test(creditsText))
check('提示了"学分和绩点都可以改"', /学分和绩点都可以改/.test(creditsText))

/* ── 改学分与绩点（用户明确要求的两条之一） ── */
const opened = await ev(`(function(){
  var b = Array.prototype.slice.call(document.querySelectorAll('button'))
    .filter(function (x) { return (x.getAttribute('aria-label') || '').indexOf('修改 基础示例课程二') >= 0 })[0];
  if (!b) return false;
  b.click();
  return true;
})()`)
check('点到「改」（基础示例课程二）', opened === true)
await sleep(600)

const filled = await ev(`(function(){
  var credit = document.querySelector('input[aria-label="学分"]');
  var gpa = document.querySelector('input[aria-label="绩点"]');
  if (!credit || !gpa) return 'no-inputs';
  return JSON.stringify({ credit: credit.value, gpa: gpa.value });
})()`)
check('编辑框带出了当前学分与绩点', filled === '{"credit":"4","gpa":"2.85"}', String(filled))

/* 用原生 setter 改值 + 派发 input 事件，React 才认得出（直接改 .value 不会触发 onChange） */
await ev(`(function(){
  var set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  var credit = document.querySelector('input[aria-label="学分"]');
  var gpa = document.querySelector('input[aria-label="绩点"]');
  set.call(credit, '3.5');
  credit.dispatchEvent(new Event('input', { bubbles: true }));
  set.call(gpa, '3.9');
  gpa.dispatchEvent(new Event('input', { bubbles: true }));
  return 1;
})()`)
await sleep(300)
const saved = await ev(`(function(){
  var b = Array.prototype.slice.call(document.querySelectorAll('button'))
    .filter(function (x) { return (x.textContent || '').trim() === '保存' })[0];
  if (!b) return false;
  b.click();
  return true;
})()`)
check('点到「保存」', saved === true)
await sleep(1800)

const afterText = await ev(`document.body.innerText`)
check('界面上学分变成了 3.5', /基础示例课程二[\s\S]{0,200}3\.5 学分/.test(afterText),
  (afterText.match(/基础示例课程二[\s\S]{0,110}/) ?? [''])[0].replace(/\n/g, '|'))
check('界面上绩点变成了 3.90', /基础示例课程二[\s\S]{0,200}3\.90/.test(afterText))
check('出现了「已手改」标记', afterText.includes('已手改'))
check('汇总跟着变（已修学分 33.5）', /33\.5/.test(afterText), (afterText.match(/33\.\d/) ?? [''])[0])

/* ── 服务端真的变了吗（交接文档原则①：只断言"界面上不见了"查不出"只改了内存"） ── */
const serverList = await (await fetch(`${API}/grades`, { headers: authHeaders })).json()
const row = (serverList.data.grades ?? []).find((g) => g.courseCode === '2131010006')
check('服务端学分真的是 3.5', row?.credit === 3.5, JSON.stringify(row?.credit))
check('服务端绩点真的是 3.9', row?.gpa === 3.9, JSON.stringify(row?.gpa))
check('服务端标记了 edited（下次导入不会覆盖）', row?.edited === true, JSON.stringify(row?.edited))
check('服务端汇总也是 33.5', serverList.data.summary?.credit === 33.5, JSON.stringify(serverList.data.summary?.credit))

/* ── 截图留档 ── */
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${TMP}\\credits-ui.png`, Buffer.from(shot.result.data, 'base64'))
console.log('  截图已存到 .tmp/credits-ui.png')
check('页面上没有未捕获异常', errs.length === 0, JSON.stringify(errs).slice(0, 200))

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close()
proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
