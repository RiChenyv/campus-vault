/**
 * WakeUp 备份文件解析测试。
 *
 * 按官方备份格式（5 行 JSON）造假数据 —— 结构取自
 * koishi-plugin-course-schedule 的 convertWakeupPayload()，
 * 字段名（node/startTime/endTime/id/courseName/day/startNode/step/startWeek/endWeek/type/room/ownTime）
 * 与真实文件一致。
 */

import { spawn } from 'node:child_process'

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const TMP = process.env.TEMP
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9241

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
  `--user-data-dir=${TMP}\\cv-wk`, '--remote-debugging-port=' + port, 'about:blank'],
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

await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(3000)

// 导入接口需要登录态：先打登录接口把 httpOnly cookie 种上，
// 后面所有 fetch 都带 credentials:'include'，会自动带上它
const login = await ev(`(async function(){
  var r = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'admin', password: 'Cv-Dev-Only-2026' })
  });
  return r.status;
})()`)
console.log('  登录:', login)
if (login !== 200) { console.log('!! 登录失败，后续用例无意义'); process.exit(1) }

/* 把解析器当成模块在页面里跑：先取出它的源码 */
const src = await ev(`(async function(){
  var r = await fetch('/@fs/D:/MyWeb/server/src/lib/wakeup.ts');
  return await r.text();
})()`)

// 用 esbuild 风格的思路不行 —— 直接在页面里跑 TS 也不现实。
// 改为：把 TS 源码里的类型标注剥掉（这份文件类型标注都是行内/interface，可安全剥离）
// 更稳妥的做法是真编译一次，这里用 vite 的转换能力：
const compiled = await ev(`(async function(){
  var r = await fetch('/@fs/D:/MyWeb/server/src/lib/wakeup.ts');
  var t = await r.text();
  // 交给页面的 TS 转换器（vite 会对 /@fs 路径做 transform）
  var m = await import('/@fs/D:/MyWeb/server/src/lib/wakeup.ts');
  return JSON.stringify({ hasParse: typeof m.parseWakeupBackup === 'function', hasWeeks: typeof m.weeksLabel === 'function' });
})()`).catch(() => null)
console.log('  编译探测:', compiled)

/* ---------------- 造备份文件 ---------------- */
await ev(`
  window.__mk = function () {
    var meta = JSON.stringify({ version: 2, type: 'wakeup_schedule' });
    var timeTable = JSON.stringify([
      { node: 1, startTime: '08:00', endTime: '08:45' },
      { node: 2, startTime: '08:55', endTime: '09:40' },
      { node: 3, startTime: '10:00', endTime: '10:45' },
      { node: 4, startTime: '10:55', endTime: '11:40' },
      { node: 5, startTime: '13:30', endTime: '14:15' },
      { node: 6, startTime: '14:25', endTime: '15:10' },
      { node: 7, startTime: '15:30', endTime: '16:15' },
      { node: 8, startTime: '16:25', endTime: '17:10' },
      { node: 9, startTime: '18:00', endTime: '18:45' },
      { node: 10, startTime: '18:55', endTime: '19:40' }
    ]);
    var tableInfo = JSON.stringify({ startDate: '2026-09-07', tableName: '2026-2027第1学期', id: 1 });
    var courseInfos = JSON.stringify([
      { id: 101, courseName: '基础示例课程二' },
      { id: 102, courseName: '计算机网络' },
      { id: 103, courseName: '高等数学' },
      { id: 104, courseName: '自定义时间课' }
    ]);
    var courseDetails = JSON.stringify([
      { id: 101, day: 1, startNode: 1, step: 2, startWeek: 1, endWeek: 16, type: 0, room: '四十八教A302' },
      { id: 101, day: 3, startNode: 3, step: 2, startWeek: 1, endWeek: 16, type: 0, room: '四十八教A302' },
      { id: 102, day: 2, startNode: 5, step: 2, startWeek: 1, endWeek: 16, type: 1, room: '网络工程实验室' },
      { id: 103, day: 4, startNode: 1, step: 2, startWeek: 2, endWeek: 16, type: 2, room: '一教101' },
      { id: 104, day: 5, startNode: 7, step: 1, startWeek: 1, endWeek: 8, type: 0, room: '某处', ownTime: true },
      { id: 999, day: 6, startNode: 1, step: 1, startWeek: 1, endWeek: 4, type: 0, room: '' },
      { id: 103, day: 9, startNode: 1, step: 1, startWeek: 1, endWeek: 4, type: 0, room: '' },
      { id: 102, day: 3, startNode: 88, step: 1, startWeek: 1, endWeek: 4, type: 0, room: '' }
    ]);
    return [meta, timeTable, tableInfo, courseInfos, courseDetails].join('\\n');
  };
  1`)

const file = await ev(`window.__mk()`)
console.log('  造出文件行数:', String(file).split('\n').length)

/* ---------------- 调后端解析 ---------------- */
const res = await ev(`(async function(){
  var r = await fetch('/api/import/wakeup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ content: window.__mk(), dryRun: true })
  });
  return JSON.stringify({ status: r.status, body: await r.json() });
})()`)
const out = JSON.parse(res)
console.log('  接口返回:', out.status, JSON.stringify(out.body?.data ?? out.body?.error).slice(0, 260))

check('接口返回 200', out.status === 200, String(out.status))
const d = out.body?.data
if (!d) {
  check('解析成功', false, JSON.stringify(out.body))
} else {
  check('识别出 3 门课（自定义时间那条被跳过）', d.courses === 3, String(d.courses))
  check('识别出 4 个合法时间段（其余 4 条被正确丢弃）', d.slots === 4, String(d.slots))
  check('课表名解析正确', d.tableName === '2026-2027第1学期', String(d.tableName))
  check('开学日解析正确', d.termStart === '2026-09-07', String(d.termStart))
  check('提示了跳过自定义时间课程', (d.notes ?? []).some((n) => /自定义时间/.test(n)), JSON.stringify(d.notes))
  check('提示了找不到课程名的条目', (d.notes ?? []).some((n) => /缺少名称/.test(n)), JSON.stringify(d.notes))
  check('提示了节次不存在的条目', (d.notes ?? []).some((n) => /找不到对应节次/.test(n)), JSON.stringify(d.notes))

  const phy = (d.preview ?? []).find((c) => c.name === '基础示例课程二')
  check('课程名正确', !!phy, JSON.stringify((d.preview ?? []).map((c) => c.name)))
  check('同一门课的多个时间段合并到一起', (phy?.times ?? []).length === 2, JSON.stringify(phy?.times))
  check('时间由节次换算正确（1-2 节 → 08:00-09:40）', (phy?.times ?? []).some((t) => /08:00-09:40/.test(t)), JSON.stringify(phy?.times))
  check('周次带上了单双周标记', (d.preview ?? []).some((c) => (c.times ?? []).some((t) => /\(单\)/.test(t))), JSON.stringify((d.preview ?? []).map((c) => c.times)))

  const net = (d.preview ?? []).find((c) => c.name === '计算机网络')
  check('单周课程标了 (单)', (net?.times ?? []).some((t) => /\(单\)/.test(t)), JSON.stringify(net?.times))
  const math = (d.preview ?? []).find((c) => c.name === '高等数学')
  check('双周课程标了 (双)', (math?.times ?? []).some((t) => /\(双\)/.test(t)), JSON.stringify(math?.times))
  check('day=9 的非法条目被丢弃', !(d.preview ?? []).some((c) => (c.times ?? []).some((t) => /周9/.test(t))))
}

/* ---------------- 坏文件应明确报错 ---------------- */
console.log('')
console.log('--- 坏文件 ---')
for (const [name, content, want] of [
  ['空内容', '', /没有收到文件内容/],
  ['行数不足', '{"a":1}\n{"b":2}', /不是 WakeUp 备份文件/],
  ['JSON 损坏', 'x\ny\nz\nw\nv', /不是合法 JSON/],
  ['课程全空', '[]\n[]\n{}\n[]\n[]', /没能从文件里解析出任何课程/],
]) {
  const r = await ev(`(async function(){
    var r = await fetch('/api/import/wakeup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ content: ${JSON.stringify(content)}, dryRun: true })
    });
    return JSON.stringify({ status: r.status, body: await r.json() });
  })()`)
  const o = JSON.parse(r)
  const msg = o.body?.error?.message ?? ''
  check(`${name} → 明确报错（不是 500）`, o.status === 400 && want.test(msg), `${o.status} ${msg.slice(0, 40)}`)
}

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
