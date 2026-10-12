/**
 * 端到端：灵感 / 待办 的一键清空。
 *
 * 重点验证三件事：
 *  ① 确认弹窗出现，并且**说清了将删除多少条**
 *  ② 点「取消」不会删任何东西（防误触的关键）
 *  ③ 点确认后列表清空，且刷新后仍然是空的（服务端真的删了）
 */

import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const TMP = process.env.TEMP
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9227
const APP = 'http://127.0.0.1:5174/'
const RUN = String(Date.now()).slice(-6)

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

const proc = spawn(chromePath, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--user-data-dir=${TMP}\\cv-clear`, '--window-size=2600,900', `--remote-debugging-port=${port}`, 'about:blank'],
  { stdio: 'ignore', windowsHide: true })
const ws = new WebSocket(await connect())
await new Promise((r) => ws.addEventListener('open', r, { once: true }))

let id = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return 'ERR:' + String(r.result.exceptionDetails.exception?.description || '').slice(0, 200)
  return r.result?.result?.value
}

const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

const mouse = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 }); await sleep(110)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
}
const wheel = (dy) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 18, y: 370, deltaX: 0, deltaY: dy })

const PAGE_LABELS = ['主页', '灵感页', '任务页', '题库页', '日历页', '网址页', 'GitHub 页']
const curPage = () => ev(`(function(){
  var P=${JSON.stringify(PAGE_LABELS)};
  var e=document.elementFromPoint(Math.round(innerWidth/2),Math.round(innerHeight/2));
  var s=e; while(s){ if(s.tagName==='SECTION'&&P.indexOf(s.getAttribute('aria-label'))>=0) return s.getAttribute('aria-label'); s=s.parentElement }
  return null
})()`)
const gotoPage = async (label, tries = 9) => {
  for (let i = 0; i < tries; i++) {
    if ((await curPage()) === label) { await sleep(900); return true }
    await wheel(120); await sleep(1400)
  }
  return false
}
const backHome = async () => {
  if ((await ev(`!!document.querySelector('button[aria-label="返回首页"]')`)) !== true) return false
  await ev(`document.querySelector('button[aria-label="返回首页"]').click(); 1`)
  await sleep(2200)
  return true
}
const gotoTab = async (label) => {
  await backHome()
  for (let i = 0; i < 8; i++) { if ((await curPage()) === '主页') break; await wheel(-120); await sleep(1300) }
  const pos = JSON.parse(await ev(`(function(){
    var el=[].slice.call(document.querySelectorAll('[aria-label]')).filter(function(e){return (e.getAttribute('aria-label')||'').indexOf(${JSON.stringify(label)})===0})[0];
    if(!el) return JSON.stringify({miss:true});
    var r=el.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)})
  })()`))
  if (pos.miss) throw new Error('找不到圆环入口 ' + label)
  await mouse(pos.x, pos.y); await sleep(1100); await mouse(pos.x, pos.y); await sleep(2500)
}

/** React 兼容赋值 */
async function setField(sel, text) {
  const ok = await ev(`(function(){
    var el=document.querySelector(${JSON.stringify(sel)});
    if(!el) return false;
    var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`)
  await sleep(250)
  return ok
}
/** 按文案点按钮；视口外退回 el.click() */
async function clickByText(text) {
  const info = await ev(`(function(){
    var b=[].slice.call(document.querySelectorAll('button')).filter(function(x){return x.textContent.trim()===${JSON.stringify(text)}})[0];
    if(!b) return null;
    b.scrollIntoView({block:'center', inline:'center'});
    var r=b.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),
      inView: r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth, disabled:b.disabled});
  })()`)
  if (!info) return { miss: true }
  const o = JSON.parse(info)
  if (o.disabled) return { disabled: true }
  if (o.inView) { await mouse(o.x, o.y); return { how: 'mouse' } }
  await ev(`(function(){
    var b=[].slice.call(document.querySelectorAll('button')).filter(function(x){return x.textContent.trim()===${JSON.stringify(text)}})[0];
    if(b) b.click(); return true;
  })()`)
  return { how: 'js' }
}
/** 按 aria-label 点按钮 */
async function clickByLabel(label) {
  const ok = await ev(`(function(){
    var b=document.querySelector('button[aria-label=' + JSON.stringify(${JSON.stringify(label)}) + ']');
    if(!b) return false; b.click(); return true;
  })()`)
  await sleep(400)
  return ok
}

await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 2535, height: 740, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: APP })
await sleep(5000)

// 登录
if (await ev(`document.body.innerText.indexOf('创造，从此刻开始') >= 0`)) {
  await setField('input[aria-label="账户"]', 'admin')
  await setField('input[aria-label="密码"]', 'Cv-Dev-Only-2026')
  const b = JSON.parse(await ev(`(function(){var el=[].slice.call(document.querySelectorAll('button')).filter(function(x){return x.textContent.trim()==='登录'})[0];var r=el.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)})})()`))
  await mouse(b.x, b.y)
  await sleep(6500)
}
check('已登录', (await ev(`document.body.innerText.indexOf('记录每一位求知的灵魂') >= 0`)) === true)

/* ============================== 灵感清空 ============================== */
console.log('')
console.log('--- 灵感：一键清空 ---')
{
  await gotoTab('灵感')
  check('进入灵感页', (await ev(`!!document.querySelector('section[aria-label="灵感收集"]')`)) === true)

  // 先清干净，保证从零开始
  if ((await ev(`!!document.querySelector('button[aria-label="清空全部灵感"]')`)) === true) {
    await clickByLabel('清空全部灵感'); await sleep(500)
    await clickByLabel(`清空 1 条`).catch(() => {})
    await ev(`(function(){var bs=[].slice.call(document.querySelectorAll('button')).filter(function(x){return /^清空 \\d+ 条$/.test(x.textContent.trim())});if(bs[0])bs[0].click();return true})()`)
    await sleep(2500)
  }

  // 造 3 条
  for (let i = 1; i <= 3; i++) {
    await setField('textarea[aria-label="新建灵感"]', `清空测试灵感-${RUN}-${i}`)
    await clickByText('收进收件箱')
    await sleep(1800)
  }
  const before = await ev(`document.querySelectorAll('button[aria-label^="删除灵感"]').length`)
  console.log('    造出条目数:', before)
  check('已造出 3 条灵感', Number(before) >= 3, String(before))

  const hasClear = await ev(`!!document.querySelector('button[aria-label="清空全部灵感"]')`)
  check('列表非空时出现「清空」按钮', hasClear === true)

  // 打开弹窗
  await clickByLabel('清空全部灵感')
  await sleep(700)
  const dlg = await ev(`(function(){
    var d=document.querySelector('div[aria-label="清空全部灵感？"]');
    return d ? d.innerText : null
  })()`)
  console.log('    弹窗内容:', JSON.stringify(dlg))
  check('确认弹窗出现', typeof dlg === 'string' && dlg.length > 0)
  check('弹窗写明了将删除的条数', /将删除 \d+ 条/.test(String(dlg)), String(dlg).slice(0, 60))

  await writeFile('D:\\MyWeb\\docs\\screenshots\\43-clear-confirm.png', Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'))

  // ---- 先测「取消」 ----
  await clickByLabel('取消')
  await sleep(900)
  const afterCancel = await ev(`(function(){
    var s=document.querySelector('section[aria-label="灵感收集"]');
    return JSON.stringify({ dlg: !!document.querySelector('div[aria-label="清空全部灵感？"]'), n: document.querySelectorAll('button[aria-label^="删除灵感"]').length })
  })()`)
  const ac = JSON.parse(afterCancel)
  console.log('    取消后:', afterCancel)
  check('点取消后弹窗关闭', ac.dlg === false)
  check('点取消后一条都没删（防误触生效）', ac.n >= 3, 'n=' + ac.n)

  // ---- 再测确认 ----
  await clickByLabel('清空全部灵感')
  await sleep(700)
  const confirmText = await ev(`(function(){
    var d=document.querySelector('div[aria-label="清空全部灵感？"]');
    if(!d) return null;
    var bs=[].slice.call(d.querySelectorAll('button')).filter(function(x){return /^清空 \\d+ 条$/.test(x.textContent.trim())});
    return bs[0] ? bs[0].textContent.trim() : null
  })()`)
  console.log('    确认按钮文案:', confirmText)
  check('确认按钮带上了条数', /^清空 \d+ 条$/.test(String(confirmText)), String(confirmText))
  await clickByLabel(String(confirmText))
  await sleep(2500)

  const afterClear = await ev(`(function(){
    var s=document.querySelector('section[aria-label="灵感收集"]');
    return JSON.stringify({ n: document.querySelectorAll('button[aria-label^="删除灵感"]').length, txt: s.innerText.slice(0, 120), clearBtn: !!document.querySelector('button[aria-label="清空全部灵感"]') })
  })()`)
  const cl = JSON.parse(afterClear)
  console.log('    清空后:', afterClear)
  check('确认后灵感全部清空', cl.n === 0, 'n=' + cl.n)
  check('清空后「清空」按钮隐藏', cl.clearBtn === false)

  // 刷新确认真的落库了
  await send('Page.navigate', { url: APP }); await sleep(5500)
  await gotoTab('灵感')
  const afterReload = await ev(`document.querySelectorAll('button[aria-label^="删除灵感"]').length`)
  check('刷新后仍是空的（服务端真的删了）', Number(afterReload) === 0, 'n=' + afterReload)
}

/* ============================== 待办清空 ============================== */
console.log('')
console.log('--- 待办：一键清空 ---')
{
  await backHome()
  await gotoPage('任务页')
  check('进入任务页', (await ev(`!!document.querySelector('section[aria-label="待办内容"]')`)) === true)

  const existing = Number(await ev(`!!document.querySelector('button[aria-label="清空全部待办"]')`))
  if (existing) {
    await clickByLabel('清空全部待办'); await sleep(700)
    await ev(`(function(){var bs=[].slice.call(document.querySelectorAll('button')).filter(function(x){return /^清空 \\d+ 项$/.test(x.textContent.trim())});if(bs[0])bs[0].click();return true})()`)
    await sleep(2500)
  }

  for (let i = 1; i <= 3; i++) {
    await setField('input[aria-label="新建任务"]', `清空测试任务-${RUN}-${i}`)
    await clickByText('加入待办')
    await sleep(1800)
  }
  const n = Number(await ev(`document.querySelectorAll('section[aria-label="待办内容"] li').length`))
  console.log('    造出条目数:', n)
  check('已造出 3 项待办', n >= 3, String(n))

  const hasClear = await ev(`!!document.querySelector('button[aria-label="清空全部待办"]')`)
  check('列表非空时出现「清空」按钮', hasClear === true)

  await clickByLabel('清空全部待办')
  await sleep(700)
  const dlg = await ev(`(function(){
    var d=document.querySelector('div[aria-label="清空全部待办？"]');
    return d ? d.innerText : null
  })()`)
  console.log('    弹窗内容:', JSON.stringify(dlg))
  check('确认弹窗出现', typeof dlg === 'string' && dlg.length > 0)
  check('弹窗写明了将删除的项数', /将删除 \d+ 项/.test(String(dlg)), String(dlg).slice(0, 60))

  const ok = await ev(`(function(){
    var d=document.querySelector('div[aria-label="清空全部待办？"]');
    var bs=[].slice.call(d.querySelectorAll('button')).filter(function(x){return /^清空 \\d+ 项$/.test(x.textContent.trim())});
    if(!bs[0]) return false; bs[0].click(); return true;
  })()`)
  check('找到带条数的确认按钮', ok === true)
  await sleep(2500)

  const after = JSON.parse(await ev(`(function(){
    var s=document.querySelector('section[aria-label="待办内容"]');
    return JSON.stringify({ n: s.querySelectorAll('li').length, clearBtn: !!document.querySelector('button[aria-label="清空全部待办"]') })
  })()`))
  console.log('    清空后:', JSON.stringify(after))
  check('确认后待办全部清空', after.n === 0, 'n=' + after.n)

  await send('Page.navigate', { url: APP }); await sleep(5500)
  await gotoPage('任务页')
  const afterReload = Number(await ev(`document.querySelectorAll('section[aria-label="待办内容"] li').length`))
  check('刷新后仍是空的', afterReload === 0, 'n=' + afterReload)
}

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('  运行时异常:', errors.length ? errors.slice(0, 3).join(' | ').slice(0, 250) : '无')
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
