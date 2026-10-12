/**
 * 模拟 Tampermonkey 执行油猴脚本。
 *
 * 为什么需要：光看"语法通过"不够 —— 脚本可能在 mount 阶段抛错、
 * 或者依赖了 Tampermonkey 才提供的 API。这里把 GM_* 打成桩，
 * 在假学校页面上真跑一遍，看右下角按钮出不出来。
 *
 * 顺便覆盖一个很常见的坑：学校的 Vue SPA 是**异步渲染**的，
 * document-idle 时 body 可能还在、但内容没出来；如果 mount 依赖内容，
 * 就会静默失败。所以这里也测"页面加载后内容才出现"的情况。
 */

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const TMP = process.env.TEMP
const port = 9253
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SCRIPT = readFileSync('D:/MyWeb/.tmp/cv-user.js', 'utf8')

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
  `--user-data-dir=${TMP}\\cv-ut`, '--window-size=1600,1200', '--remote-debugging-port=' + port, 'about:blank'],
  { stdio: 'ignore', windowsHide: true })
const ws = new WebSocket(await connect())
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
const consoleErrs = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrs.push(String(m.params?.exceptionDetails?.exception?.description ?? '').slice(0, 220))
  }
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

/* 一个像学校课程页的假页面：Vue 风格，内容异步出现 */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>我的课程 - 中国传媒大学</title></head>
<body>
<div id="app"><div class="loading">加载中…</div></div>
<script>
setTimeout(function(){
  document.getElementById('app').innerHTML =
    '<div class="side"><div class="avatar"></div><div class="uname">晨翔</div><div class="role">学生</div></div>' +
    '<div class="card"><div class="title">2131010006-基础示例课程二[02]</div>' +
    '<div>课程代码：202620271213101000602</div>' +
    '<div>示例学院二　开课：2026-09-07</div>' +
    '<div>必选修别：必修　学分数：4.0　授课教师：王老师</div>' +
    '<div class="term">2026-2027第1学期</div></div>';
}, 800);
<\/script>
</body></html>`

async function runScenario(label, waitBeforeInject) {
  console.log('')
  console.log(`--- ${label} ---`)
  consoleErrs.length = 0

  await send('Page.navigate', { url: 'about:blank' })
  await sleep(300)
  await ev(`document.open(); document.write(${JSON.stringify(PAGE)}); document.close(); 1`)
  await sleep(waitBeforeInject)

  // 打 GM_* 的桩，然后注入脚本（模拟 Tampermonkey 的行为）
  const stubs = `
    window.__gm = {};
    window.GM_getValue = function (k, d) { return Object.prototype.hasOwnProperty.call(window.__gm, k) ? window.__gm[k] : d };
    window.GM_setValue = function (k, v) { window.__gm[k] = v };
    window.GM_xmlhttpRequest = function () { /* 测试里不发真请求 */ };
    1`
  await ev(stubs)
  await ev(SCRIPT)

  await sleep(1500)
  const state = JSON.parse(await ev(`(function(){
    var fab = document.getElementById('cv-fab');
    var st = document.getElementById('cv-mask');
    return JSON.stringify({
      hasFab: !!fab,
      fabText: fab ? fab.textContent : '',
      fabVisible: fab ? (fab.getBoundingClientRect().width > 0) : false,
      hasStyle: !!Array.from(document.querySelectorAll('style')).find(function(s){ return (s.textContent||'').indexOf('cv-fab') >= 0 }),
      hasPanel: !!st,
    });
  })()`))
  console.log('  状态:', JSON.stringify(state))
  if (consoleErrs.length) console.log('  页面异常:', JSON.stringify(consoleErrs))
  return state
}

/* 场景 1：正常情况（等页面加载完再注入） */
const s1 = await runScenario('页面已加载完，再注入脚本', 2000)
check('按钮出现了', s1.hasFab === true)
check('按钮可见（有尺寸）', s1.fabVisible === true)
check('按钮文字正确', s1.fabText.includes('导入到 Campus Vault'), s1.fabText)
check('样式注入成功', s1.hasStyle === true)
check('注入过程没有抛异常', consoleErrs.length === 0, JSON.stringify(consoleErrs).slice(0, 160))

/* 场景 2：点按钮，看面板能不能开 */
if (s1.hasFab) {
  await ev(`document.getElementById('cv-fab').click(); 1`)
  await sleep(800)
  const panel = JSON.parse(await ev(`(function(){
    var m = document.getElementById('cv-mask');
    var t = m ? m.innerText : '';
    return JSON.stringify({
      open: !!m,
      asksToken: t.indexOf('令牌') >= 0,
      title: t.split('\\n')[0] || '',
    });
  })()`))
  console.log('  面板:', JSON.stringify(panel))
  check('点按钮能打开面板', panel.open === true)
  check('首次使用要求填令牌', panel.asksToken === true, panel.title)
}

/* 场景 3：内容还没渲染完就注入（模拟 @run-at 太早） */
const s3 = await runScenario('页面还在加载中就注入（内容 800ms 后才出现）', 150)
check('内容未就绪时按钮也能出来', s3.hasFab === true, s3.hasFab ? '' : '按钮没出来')

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
