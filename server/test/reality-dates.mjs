/**
 * 界面上的日期必须是**真实日期**（日历 + 热力图）。
 *
 * 这一轮发现两处写死，都是同一类问题 —— **看起来是对的假数据**：
 *
 *   · `data/mock.ts` 的 `CAL_MONTH = { year: 2025, month: 11, days: 30 }`
 *     → 不管今天几号，日历永远显示「2025 年 11 月」；
 *       「今天」的高亮也写死在第 3 格（`isToday = d === 3`）。
 *   · `data/heatmap.ts` 的 `const TODAY = new Date(2026, 9, 4)`
 *     → 更严重：`buildFromCounts`（**真实数据**走的那条路）用它判断 future，
 *       于是"写死那天之后"的格子全被当成未来、真实计数被丢掉。
 *
 * 两段验证：
 *  ① **纯函数**（不需要浏览器、不需要后端）：把日期传进去逐项核对 ——
 *     天数（含闰年）、起始星期、"今天"的位置、热力图窗口的边界与计数保留。
 *     并且**对着真实时钟**再核一遍：算出来的必须就是今天的年月日。
 *  ② **真界面**（网站起着才跑）：在浏览器里读日历与热力图，
 *     断言显示的是今天所在的那个月、今天那一格被标出来了。
 *     网站没起就打印 SKIP —— 不是失败，但会明确告诉你没验到界面。
 */

import { spawn } from 'node:child_process'
import { rm, mkdir } from 'node:fs/promises'
import { buildMonthGrid, monthCells } from '../../src/lib/monthGrid.ts'
import { buildFromCounts } from '../../src/data/heatmap.ts'

const APP = 'http://127.0.0.1:5174'
const API = 'http://127.0.0.1:5175/api'
const TMP = process.env.TEMP
const port = 9272
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; failures.push(`${name}  ${extra}`); console.log(`FAIL  ${name}${extra ? '  (' + extra + ')' : ''}`) }
}
const section = (t) => { console.log(''); console.log(`--- ${t} ---`) }

/* ================================================================== */
/*                  ① 纯函数：对着已知事实核                          */
/* ================================================================== */

section('已知事实（手算过的，不是拿实现自己验自己）')
/* [年, 月, 天数, 1 号是周几（0=周一 … 6=周日）] */
const FACTS = [
  [2026, 10, 31, 3], // 2026-10-01 是周四 → 周一起始的第 3 列
  [2026, 2, 28, 6],  // 2026 不是闰年；2026-02-01 是周日
  [2028, 2, 29, 1],  // 2028 是闰年；2028-02-01 是周二
  [2024, 1, 31, 0],  // 2024-01-01 是周一
  [2024, 3, 31, 4],  // 2024-03-01 是周五
  [2023, 1, 31, 6],  // 2023-01-01 是周日
  [2000, 2, 29, 1],  // 世纪闰年（能被 400 整除）
  [1900, 2, 28, 3],  // 世纪平年（能被 100 整除但不能被 400）
]
for (const [y, m, days, first] of FACTS) {
  const g = buildMonthGrid(new Date(y, m - 1, 15))
  check(`${y} 年 ${m} 月：${days} 天`, g.days === days, String(g.days))
  check(`${y} 年 ${m} 月：1 号在第 ${first} 列（周一=0）`, g.firstWeekday === first, String(g.firstWeekday))
}

section('每一天落在哪一列 —— 和 JS 的 Date 对齐')
{
  /* 网格的第 i 格（含前面的空位）应该正好是 (firstWeekday + 日 - 1) % 7 列，
     而这一列必须等于"那天真实的星期"。这条能把"周一起始"的平移写错抓出来。 */
  let bad = ''
  for (const [y, m] of [[2026, 10], [2026, 2], [2028, 2], [2024, 3], [2025, 12]]) {
    const g = buildMonthGrid(new Date(y, m - 1, 1))
    for (let d = 1; d <= g.days; d++) {
      const col = (g.firstWeekday + d - 1) % 7
      const real = (new Date(y, m - 1, d).getDay() + 6) % 7
      if (col !== real) bad += `${y}-${m}-${d} 网格${col}/真实${real}；`
    }
  }
  check('整月每一天的列号和真实星期一致', bad === '', bad.slice(0, 120))
}

section('单元格拼接')
{
  const g = buildMonthGrid(new Date(2026, 9, 6))
  const cells = monthCells(g)
  check('前面补的空位数 = firstWeekday', cells.slice(0, g.firstWeekday).every((x) => x === null),
    JSON.stringify(cells.slice(0, 8)))
  check('总格数 = 空位 + 天数', cells.length === g.firstWeekday + g.days, String(cells.length))
  check('第一个数字是 1', cells[g.firstWeekday] === 1, String(cells[g.firstWeekday]))
  check('最后一个数字是本月天数', cells[cells.length - 1] === g.days, String(cells[cells.length - 1]))
  check('没有重复或跳号', cells.filter((x) => x !== null).join(',') ===
    Array.from({ length: g.days }, (_, i) => i + 1).join(','))
}

section('与现实保持一致（这条就是用户要的）')
{
  const now = new Date()
  const g = buildMonthGrid()
  check('年份 = 今年', g.year === now.getFullYear(), `${g.year} vs ${now.getFullYear()}`)
  check('月份 = 本月', g.month === now.getMonth() + 1, `${g.month} vs ${now.getMonth() + 1}`)
  check('今天是几号 = 真实日期', g.today === now.getDate(), `${g.today} vs ${now.getDate()}`)
  /* 天数用**另一种写法**独立数一遍（逐日往后走到月份变了为止），
     不用实现里那个 `new Date(y, m, 0)` 的写法，免得两边一起错 */
  let n = 0
  while (new Date(now.getFullYear(), now.getMonth(), n + 1).getMonth() === now.getMonth()) n++
  check('天数 = 逐日数出来的天数', g.days === n, `${g.days} vs ${n}`)
  check('不是写死的 2025 年 11 月（老 bug）', !(g.year === 2025 && g.month === 11) || (now.getFullYear() === 2025 && now.getMonth() === 10),
    `${g.year}-${g.month}`)
  console.log(`  → 现在算出来的是：${g.year} 年 ${g.month} 月，${g.days} 天，1 号在第 ${g.firstWeekday} 列，今天是 ${g.today} 号`)
}

/* ================================================================== */
/*                  ② 热力图：锚点也必须是真实今天                    */
/* ================================================================== */

section('热力图网格（近 26 周）')
{
  /* 固定一个日期，逐项核对边界（今天 = 2026-10-06，周二） */
  const cols = buildFromCounts(new Map([
    ['2026-10-06', 3], // 今天
    ['2026-10-05', 2], // 昨天
    ['2026-10-07', 9], // 明天 —— 未来，应该被清成 0
    ['2026-04-13', 1], // 网格最左一列的第一天
  ]), 26, new Date(2026, 9, 6))
  const flat = cols.flat()

  check('26 列 × 7 行', cols.length === 26 && cols.every((c) => c.length === 7),
    `${cols.length} 列`)
  const lastCol = cols[25] ?? []
  check('最后一列包含今天', lastCol.some((d) => d.date === '2026-10-06'),
    lastCol.map((d) => d.date).join(','))
  const t = flat.find((d) => d.date === '2026-10-06')
  check('今天不算"未来"', t?.future === false, String(t?.future))
  /* 这条是正题：老代码把"写死那天（2026-10-04）之后"的格子全当未来，
     真实计数被丢掉 —— 今天 push 过也显示 0。 */
  check('**今天的真实计数没有被丢掉**', t?.count === 3, `count=${t?.count}`)
  check('昨天的计数也在', flat.find((d) => d.date === '2026-10-05')?.count === 2,
    String(flat.find((d) => d.date === '2026-10-05')?.count))
  check('明天（未来）被清 0', flat.find((d) => d.date === '2026-10-07')?.count === 0,
    String(flat.find((d) => d.date === '2026-10-07')?.count))
  check('最左一列从 2026-04-13（周一）开始', flat[0]?.date === '2026-04-13', String(flat[0]?.date))
  check('网格覆盖 26 整周（182 天）', flat.length === 182, String(flat.length))
}

section('热力图与现实保持一致')
{
  const now = new Date()
  const isoToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  /* 空计数表 → 只验骨架。这条断言在任何日期都必须成立：
     老代码锚在 2026-10-04，过了那天"今天"就会变成 future —— 直接失败。 */
  const real = buildFromCounts(new Map(), 26).flat()
  const todayCell = real.find((d) => d.date === isoToday)
  check('真实时钟下，今天在网格里', !!todayCell, `找 ${isoToday}`)
  check('真实时钟下，今天不是"未来"（老 bug 的直接反证）', todayCell?.future === false,
    String(todayCell?.future))
  check('网格最后一天不早于今天', String(real[real.length - 1]?.date) >= isoToday,
    String(real[real.length - 1]?.date))
  console.log(`  → 热力图窗口：${real[0]?.date} … ${real[real.length - 1]?.date}，今天 ${isoToday}`)
}

/* ================================================================== */
/*                  ③ 真界面：网站起着才跑                            */
/* ================================================================== */

section('真界面（需要网站起着）')
let up = false
try {
  up = (await fetch(`${API}/health`, { signal: AbortSignal.timeout(2500) })).ok &&
    (await fetch(APP, { signal: AbortSignal.timeout(6000) })).ok
} catch { up = false }

if (!up) {
  console.log('SKIP  网站没在跑（5174 / 5175），这一段没验 —— **不是通过**。')
  console.log('      要验界面就先按交接文档起网站，再跑一次这个脚本。')
} else {
  await rm(`${TMP}\\cv-cal`, { recursive: true, force: true })
  await mkdir(`${TMP}\\cv-cal`, { recursive: true })
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1600,1100',
    `--user-data-dir=${TMP}\\cv-cal`, '--remote-debugging-port=' + port, 'about:blank'],
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
    if (m.method === 'Log.entryAdded' && m.params?.entry?.level === 'error') errs.push('LOG ' + String(m.params.entry.text).slice(0, 160))
  })
  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) return 'EVALERR ' + String(r.result.exceptionDetails.exception?.description || '').slice(0, 200)
    return r.result?.result?.value
  }
  await send('Page.enable'); await send('Runtime.enable')

  await send('Page.navigate', { url: APP })
  await sleep(2500)
  /* 登录一次：界面在未登录时不渲染日历 */
  await ev(`fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ account:'admin', password:'Cv-Dev-Only-2026' }) }).then(r=>r.status)`)
  await send('Page.navigate', { url: APP })
  await sleep(5000)

  const g = buildMonthGrid()
  const title = await ev(`document.body.innerText.indexOf(${JSON.stringify(`${g.year} 年 ${g.month} 月`)}) >= 0`)
  check(`界面上写着「${g.year} 年 ${g.month} 月」`, title === true)

  /* 选择器带**年份**：热力图的格子也用「N 月 N 日」当 aria-label，
     只按"月 日"选会把热力图的日子一起算进来（第一次就是这么误报 35 个的）。
     ⚠️ 属性值里有空格，CSS 选择器里必须带引号，否则整个选择器非法。 */
  const daySel = `[aria-label^="${g.year} 年 ${g.month} 月 "]`
  const dayCells = await ev(`document.querySelectorAll(${JSON.stringify(daySel)}).length`)
  check(`日历里画出了 ${g.days} 个日子`, dayCells === g.days, `实际 ${dayCells} 个`)

  const todayCell = await ev(`(function(){
    var el = document.querySelector('[data-today="1"]');
    return el ? el.textContent.replace(/\\s+/g, ' ').trim() : '(没有标记)';
  })()`)
  check(`今天（${g.today} 号）被标出来了，且只有一个`, String(todayCell).startsWith(String(g.today)), String(todayCell))

  const todayCount = await ev(`document.querySelectorAll('[data-today="1"]').length`)
  check('「今天」的格子只有一个', todayCount === 1, String(todayCount))

  /* 1 号必须落在第 firstWeekday 列（前面正好那么多个空位）——
     这条验的是"周一起始"的平移在真界面上对不对 */
  const firstSel = `[aria-label^="${g.year} 年 ${g.month} 月 1 日"]`
  const offset = await ev(`(function(){
    var first = document.querySelector(${JSON.stringify(firstSel)});
    if (!first) return -1;
    return Array.prototype.indexOf.call(first.parentElement.children, first);
  })()`)
  check(`1 号在第 ${g.firstWeekday} 列（前面补了 ${g.firstWeekday} 个空位）`, offset === g.firstWeekday, `实际第 ${offset} 列`)

  /* 老 bug 的直接反证：界面上不该再出现写死的那一年那一月 */
  const stale = await ev(`document.body.innerText.indexOf('2025 年 11 月') >= 0`)
  check('界面上不再出现写死的「2025 年 11 月」', stale === false)

  /* 滚到第 5 屏再截图 —— 首页那 7 屏是叠在一起用 transform 平移的，
     日历在第 5 屏，直接截图只能拍到第一屏（截图里看不到日历就没法核对）。
     用**真实键盘事件**翻屏：应用自己监听 ArrowDown 翻屏，
     而环形导航那个 aria-label 元素不是真正的点击目标（合成 click 不翻页）。 */
  for (let i = 0; i < 4; i++) {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
    await sleep(700)
  }
  await sleep(900)
  const panelDays = await ev(`document.querySelectorAll(${JSON.stringify(daySel)}).length`)
  check('翻到日历那一屏后，日子数量还是对的', panelDays === g.days, `实际 ${panelDays} 个`)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(`${TMP}\\calendar-month.png`, Buffer.from(shot.result.data, 'base64'))
  console.log('  截图已存到 .tmp/calendar-month.png')

  /* 热力图里也要有"今天"这一格 —— 它同样是按真实日期铺的 */
  const now = new Date()
  const heatSel = `[aria-label^="${now.getMonth() + 1} 月 ${now.getDate()} 日"]`
  const heatToday = await ev(`(function(){
    var el = document.querySelector(${JSON.stringify(heatSel)});
    return el ? el.getAttribute('aria-label') : '';
  })()`)
  check('热力图里有"今天"那一格', /次 push/.test(String(heatToday)), String(heatToday))

  /* 顺手当一次冒烟测试：首页 7 屏是同时挂载的，
     任何一块渲染炸了这里都能看见（比如删掉 mock 里的东西忘了改引用）。 */
  check('页面上没有未捕获异常 / 控制台报错', errs.length === 0, JSON.stringify(errs).slice(0, 240))

  ws.close()
  chrome.kill('SIGKILL')
}

/* ================================================================== */
console.log('')
console.log('==================================================')
console.log(`  通过 ${pass} / ${pass + fail}${up ? '' : '（界面那段 SKIP 了）'}`)
for (const f of failures) console.log(`   FAIL ${f}`)
console.log('==================================================')
process.exitCode = fail ? 1 : 0
