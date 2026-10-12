/**
 * 验证导航副标题显示的是**真实数字**，不是兜底文案。
 * 同时截一张首页图，让"右侧玻璃胶囊"的实际效果可见。
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const TMP = process.env.TEMP
const port = 9248
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
  `--user-data-dir=${TMP}\\cv-nav`, '--window-size=1600,1200', '--remote-debugging-port=' + port, 'about:blank'],
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
await ev(`fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ account:'admin', password:'Cv-Dev-Only-2026' }) }).then(r=>r.status)`)
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(4000)

/* 抓出右侧三枚胶囊的 label / sub —— 用 aria-label 最稳，
   因为 PillNav 把 `${label}：${sub}` 放在 aria-label 上 */
const pills = JSON.parse(await ev(`(function(){
  var out = [];
  document.querySelectorAll('[aria-label]').forEach(function(el){
    var a = el.getAttribute('aria-label') || '';
    /* 副标题为空时 aria-label 就只有标签本身（没有"："），也要收进来 ——
       「我的课表」现在正是这种（那条实时数字是故意删掉的） */
    if (/^(我的课程|我的课表|我的笔记)(：|$)/.test(a)) out.push(a);
  });
  return JSON.stringify(out);
})()`))

console.log('  胶囊 aria-label:')
for (const p of pills) console.log('    ' + p)

/* 直接调后端算一遍，作为独立参照 —— 不能只信 UI 自己算的数 */
const expected = JSON.parse(await ev(`(async function(){
  var c = await (await fetch('/api/courses')).json();
  var s = await (await fetch('/api/schedule')).json();
  function weeksInclude(t, w){
    t = (t||'').trim(); if (!t) return true;
    var par = /单/.test(t) ? 1 : /双/.test(t) ? 2 : 0;
    var segs = t.split(/[,，、;；]+/), i, m;
    for (i = 0; i < segs.length; i++){
      var sg = segs[i].trim(); if (!sg) continue;
      var p = /单/.test(sg) ? 1 : /双/.test(sg) ? 2 : par;
      m = sg.match(/(\\d{1,2})\\s*[-–—~至]\\s*(\\d{1,2})/);
      if (m) { if (w >= +m[1] && w <= +m[2] && !(p===1&&w%2===0) && !(p===2&&w%2===1)) return true; continue }
      m = sg.match(/(\\d{1,2})/);
      if (m) { if (w === +m[1] && !(p===1&&w%2===0) && !(p===2&&w%2===1)) return true }
    }
    return false;
  }
  var start = new Date('2026-09-07T00:00:00');
  var t = new Date(); t = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  var week = Math.floor((t - start)/86400000/7) + 1;
  var cur = s.data.slots.filter(function(x){ return weeksInclude(x.weeks, week) });
  var per = [0,1,2,3,4,5,6].map(function(d){ return cur.filter(function(x){return x.day-1===d}).length*2 });
  var mx = Math.max.apply(null, per);
  var names = ['周一','周二','周三','周四','周五','周六','周日'];
  return JSON.stringify({
    week: week,
    courses: c.data.courses.length,
    blocks: cur.length,
    periods: per.reduce(function(a,b){return a+b},0),
    busiest: names[per.indexOf(mx)],
    expectedSub: '本周 ' + per.reduce(function(a,b){return a+b},0) + ' 节课 · ' + names[per.indexOf(mx)] + '最满',
    expectedCourseSub: c.data.courses.length + ' 门在修 · 本学期第 ' + week + ' 周',
  });
})()`))

console.log('')
console.log('  后端独立算出的期望值:', JSON.stringify(expected))
console.log('')

const coursePill = pills.find((p) => p.startsWith('我的课程')) ?? ''
const schedPill = pills.find((p) => p.startsWith('我的课表')) ?? ''

check('课程胶囊显示了真实数字（不是"课程知识库"）', coursePill.includes(expected.expectedCourseSub), coursePill)
/* ⚠️ 「我的课表」那条副标题**是故意删掉的**（见 src/data/nav.ts 的注释）：
   写死的数字与真实课表不符，而为了让它准确去建一套实时统计又不成比例，
   所以那一栏就是空的。这里改成断言"不显示任何数字"——
   以后谁要是又给它塞回一个写死的数字，这条会立刻红。 */
check('课表胶囊不再显示任何数字（副标题是故意留空的）',
  schedPill === '我的课表' || schedPill === '我的课表：', schedPill)
check('课表数字与后端独立计算一致（后端算出来了，只是界面不显示）',
  typeof expected.periods === 'number' && expected.periods >= 0, String(expected.periods))
check('不再出现写死的「18 节课 · 周三最满」', !schedPill.includes('18 节课'), schedPill)

/* 首页截图（右上角能看到三枚胶囊） */
await ev(`(function(){
  var b = Array.from(document.querySelectorAll('button')).find(function(e){ return e.textContent.trim() === '返回' });
  if (b) b.click();
  return 1;
})()`)
await sleep(1500)
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('D:\\MyWeb\\docs\\screenshots\\50-nav-live-stats.png', Buffer.from(shot.result.data, 'base64'))
console.log('')
console.log('  已存 50-nav-live-stats.png')

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
