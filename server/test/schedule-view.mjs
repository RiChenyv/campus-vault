/**
 * 课表页视觉验证：登录 → 进课表 → 截图 → 翻周再截一张。
 * 顺便断言几件必须成立的事，避免"看着像对"就收工。
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const TMP = process.env.TEMP
const port = 9247
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
  `--user-data-dir=${TMP}\\cv-sch`, '--window-size=1600,1200', '--remote-debugging-port=' + port, 'about:blank'],
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
await sleep(3500)

// 登录
const login = await ev(`(async function(){
  var r = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ account:'admin', password:'Cv-Dev-Only-2026' }) });
  return r.status;
})()`)
console.log('  登录:', login)
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(3500)

// 直接切到课表路由（点侧栏比找按钮稳）
const went = await ev(`(function(){
  var els = Array.from(document.querySelectorAll('button, a, [role=button]'));
  var t = els.find(function(e){ return (e.textContent||'').trim().indexOf('我的课表') === 0 });
  if (t) { t.click(); return 'clicked' }
  return 'not-found:' + els.map(function(e){return (e.textContent||'').trim()}).filter(Boolean).slice(0,25).join('|');
})()`)
console.log('  进课表:', String(went).slice(0, 120))
await sleep(2500)

const dump = async () => JSON.parse(await ev(`(function(){
  var txt = document.body.innerText;
  var blocks = Array.from(document.querySelectorAll('div')).filter(function(d){
    var s = d.getAttribute('style') || '';
    return s.indexOf('linear-gradient(155deg') >= 0;
  });
  return JSON.stringify({
    hasWeekNav: !!document.querySelector('[aria-label="上一周"]') && !!document.querySelector('[aria-label="下一周"]'),
    hasSampleBadge: txt.indexOf('示例') >= 0,
    weekTitle: (txt.match(/第\\s*\\d+\\s*周/) || [''])[0],
    blockCount: blocks.length,
    blocks: blocks.map(function(b){
      return (b.innerText||'').replace(/\\n/g,' | ').slice(0,70);
    }),
    legend: Array.from(document.querySelectorAll('span')).map(function(s){return (s.textContent||'').trim()}).filter(function(s){return /\\[0\\d\\]/.test(s)}).length,
  });
})()`))

const d = await dump()
console.log('  当前周:', d.weekTitle, ' 课块数:', d.blockCount)
console.log('  课块:', JSON.stringify(d.blocks.slice(0, 6)))
console.log('')

check('课表页有翻周按钮', d.hasWeekNav)
check('没有显示"示例"标记（说明读到了真实数据）', !d.hasSampleBadge, d.hasSampleBadge ? '显示了示例标记' : '')
check('显示了"第 N 周"', /第\s*\d+\s*周/.test(d.weekTitle), d.weekTitle)
check('渲染出了课程块', d.blockCount > 0, String(d.blockCount))
check('课程块里出现导入进来的课程名', d.blocks.some((b) => /示例课程|示例课程一|示例课程四/.test(b)), d.blocks[0] ?? '')

/* 当前周应该是第 5 周（学期 9/7 开始，用户当天 10/5） */
check('默认停在当前周（第 5 周）', d.weekTitle.includes('5'), d.weekTitle)

/* 截图：本周 */
const shot1 = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('D:\\MyWeb\\docs\\screenshots\\48-schedule-week5.png', Buffer.from(shot1.result.data, 'base64'))
console.log('')
console.log('  已存 48-schedule-week5.png')

/* 翻到第 12 周 —— 那里版面不同（通识示例课程一结束、通识示例课程三开始） */
await ev(`document.querySelector('[aria-label="下一周"]').click(); 1`)
await sleep(300)
for (let i = 0; i < 6; i++) { await ev(`document.querySelector('[aria-label="下一周"]').click(); 1`); await sleep(220) }
await sleep(1200)
const d12 = await dump()
console.log('  翻到:', d12.weekTitle, ' 课块数:', d12.blockCount)
console.log('  课块:', JSON.stringify(d12.blocks.slice(0, 8)))
console.log('')

check('翻到了第 12 周', d12.weekTitle.includes('12'), d12.weekTitle)
check('第 12 周课块数变少（通识示例课程一/基础示例课程一已结课）', d12.blockCount < d.blockCount, `${d.blockCount} → ${d12.blockCount}`)
check('第 12 周出现了「通识示例课程三」', d12.blocks.some((b) => /通识示例课程三/.test(b)), d12.blocks.map((b) => b.slice(0, 12)).join(' / '))
check('第 12 周不再有「通识示例课程一」', !d12.blocks.some((b) => /通识示例课程一/.test(b)))
check('第 12 周周一 3-4 是 专业示例课程五', d12.blocks.some((b) => /专业示例课程五/.test(b)))

const shot2 = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('D:\\MyWeb\\docs\\screenshots\\49-schedule-week12.png', Buffer.from(shot2.result.data, 'base64'))
console.log('  已存 49-schedule-week12.png')

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
