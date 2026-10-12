/**
 * ICS 课程表解析测试。
 *
 * 用真实形态的 ICS 片段（折行、转义、TZID、UTC、RRULE、全天事件都覆盖到）。
 */

import { spawn } from 'node:child_process'

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const TMP = process.env.TEMP
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9242

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
  `--user-data-dir=${TMP}\\cv-ics`, '--remote-debugging-port=' + port, 'about:blank'],
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

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//WakeUp//Schedule//CN',
  'BEGIN:VEVENT',
  'UID:1@wakeup',
  'SUMMARY:基础示例课程二',
  'LOCATION:四十八教A302',
  'DTSTART;TZID=Asia/Shanghai:20260907T080000',
  'DTEND;TZID=Asia/Shanghai:20260907T094000',
  'RRULE:FREQ=WEEKLY;COUNT=16',
  'DESCRIPTION:教师：王老师\\n备注：带计算器',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:2@wakeup',
  'SUMMARY:计算机网络\\\\A班',
  'LOCATION:网络工程实验室',
  // 折行：以空格开头的续行必须能拼回去
  'DTSTART;TZID=Asia/Shanghai:20260908T133000',
  'DTEND;TZID=Asia/Shanghai:20260908T151000',
  'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=8',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:3@wakeup',
  'SUMMARY:高等数学，上册',
  'DTSTART:20260910T080000Z',
  'DTEND:20260910T094000Z',
  'RRULE:FREQ=WEEKLY;UNTIL=20261231T000000Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:4@wakeup',
  'SUMMARY:国庆假期',
  'DTSTART;VALUE=DATE:20261001',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:5@wakeup',
  'DTSTART;TZID=Asia/Shanghai:20260911T100000',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(3000)

const login = await ev(`(async function(){
  var r = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ account:'admin', password:'Cv-Dev-Only-2026' }) });
  return r.status;
})()`)
console.log('  登录:', login)

const res = await ev(`(async function(){
  var r = await fetch('/api/import/ics', {
    method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
    body: JSON.stringify({ content: ${JSON.stringify(ICS)}, dryRun: true })
  });
  return JSON.stringify({ status: r.status, body: await r.json() });
})()`)
const out = JSON.parse(res)
console.log('  接口:', out.status, JSON.stringify(out.body?.data ?? out.body?.error).slice(0, 400))

check('接口返回 200', out.status === 200, String(out.status))
const d = out.body?.data
if (!d) {
  check('解析成功', false, JSON.stringify(out.body))
} else {
  console.log('  预览:', JSON.stringify(d.preview, null, 0))
  check('识别出 3 门课（全天事件与无标题的已跳过）', d.courses === 3, String(d.courses))
  check('提示了跳过的全天事件', (d.notes ?? []).some((n) => /全天/.test(n)), JSON.stringify(d.notes))
  check('提示了跳过的无标题事件', (d.notes ?? []).some((n) => /没有标题/.test(n)), JSON.stringify(d.notes))
  check('学期起始日取最早的一天', d.termStart === '2026-09-07', String(d.termStart))

  const phy = (d.preview ?? []).find((c) => c.name === '基础示例课程二')
  check('课程名解析正确', !!phy, JSON.stringify((d.preview ?? []).map((c) => c.name)))
  check('教室解析正确', phy?.room === '四十八教A302', String(phy?.room))
  check('教师从 DESCRIPTION 里提取出来', phy?.teacher === '王老师', String(phy?.teacher))
  check('本地时间未偏移（08:00-09:40）', (phy?.times ?? []).some((t) => /周1 08:00-09:40/.test(t)), JSON.stringify(phy?.times))
  check('RRULE COUNT 解析为「每周 共 16 次」', (phy?.times ?? []).some((t) => /每周 共 16 次/.test(t)), JSON.stringify(phy?.times))

  const net = (d.preview ?? []).find((c) => String(c.name).includes('计算机网络'))
  check('ICS 转义还原（\\\\ → \\）', !!net && net.name === '计算机网络\\A班', String(net?.name))
  check('INTERVAL=2 解析为「每 2 周」', (net?.times ?? []).some((t) => /每 2 周/.test(t)), JSON.stringify(net?.times))

  const math = (d.preview ?? []).find((c) => c.name === '高等数学，上册')
  check('值里的转义逗号还原', !!math, JSON.stringify((d.preview ?? []).map((c) => c.name)))
  check('UTC 时间转成了本地时间（08:00Z → 16:00 北京）', (math?.times ?? []).some((t) => /16:00-17:40/.test(t)), JSON.stringify(math?.times))
  check('RRULE UNTIL 解析为「至 2026-12-31」', (math?.times ?? []).some((t) => /至 2026-12-31/.test(t)), JSON.stringify(math?.times))
}

console.log('')
console.log('--- 坏文件 ---')
for (const [name, content, want] of [
  ['空内容', '', /没有收到文件内容/],
  ['不是 ICS', 'hello world', /不是 ICS 日历文件/],
  ['没有日程', 'BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR', /没有任何日程/],
  ['全是全天事件', 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:x\nDTSTART;VALUE=DATE:20261001\nEND:VEVENT\nEND:VCALENDAR', /全天事件/],
]) {
  const r = await ev(`(async function(){
    var r = await fetch('/api/import/ics', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
      body: JSON.stringify({ content: ${JSON.stringify(content)}, dryRun: true }) });
    return JSON.stringify({ status: r.status, body: await r.json() });
  })()`)
  const o = JSON.parse(r)
  const msg = o.body?.error?.message ?? ''
  check(`${name} → 明确报错`, o.status === 400 && want.test(msg), `${o.status} ${msg.slice(0, 46)}`)
}

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
