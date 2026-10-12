/**
 * 端到端（第二轮）：灵感 / 待办 / 书签 / GitHub 四页的持久化验证。
 *
 * 目标是证明同一件事：**数据在服务端，不在浏览器里。**
 * 所以每条用例都是「写入 → 刷新 → 仍在」，而不是只看当前页面显示什么。
 */

import { spawn } from 'node:child_process'

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const TMP = process.env.TEMP
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9223
const APP = 'http://127.0.0.1:5174/'

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const l = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
      const p = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (p) return p.webSocketDebuggerUrl
    } catch {
      /* retry */
    }
    await sleep(250)
  }
  throw new Error('CDP 连接超时')
}

const proc = spawn(
  chromePath,
  [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--disable-crash-reporter',
    `--user-data-dir=${TMP}\\cv-e2e2`,
    '--window-size=2600,900',
    `--remote-debugging-port=${port}`,
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
)
const ws = new WebSocket(await connect())
await new Promise((r) => ws.addEventListener('open', r, { once: true }))

let id = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text)
  }
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
})
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id
    pending.set(i, res)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
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
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
  await sleep(110)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
}
const boxOf = async (sel) =>
  JSON.parse(
    await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return JSON.stringify({miss:true});var r=e.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)})})()`),
  )
const wheel = (dy, x = 18, y = 370) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy })


/**
 * React 兼容地给受控输入框赋值。
 *
 * 直接 `el.value = x` 不行：React 在 value 上装了 tracker，
 * 它会认为"值没变过"而丢弃这次 onChange。
 * 必须拿到原型上的原生 setter 绕开 tracker，再派发一个冒泡的 input 事件。
 */


/**
 * 按文案点按钮。
 *
 * 优先用真实鼠标事件（更接近真人操作），但**必须先确认它在视口内** ——
 * 这些页面是 transform 分页 + 嵌套滚动容器，scrollIntoView 在这种结构里
 * 经常算错，实测出现过 y=-151（按钮跑到视口上方）的情况，
 * 那时 dispatchMouseEvent 会点到视口外，等于没点。
 *
 * 兜底走 el.click()：React 的 onClick 对合成点击同样响应，
 * 只有需要"用户手势"的场景（如 window.open / file picker）才必须真实鼠标。
 */
async function clickByText(text) {
  const info = await ev(`(function(){
    var b=[].slice.call(document.querySelectorAll('button')).filter(function(x){return x.textContent.trim()===${JSON.stringify(text)}})[0];
    if(!b) return null;
    b.scrollIntoView({block:'center', inline:'center'});
    var r=b.getBoundingClientRect();
    return JSON.stringify({
      x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2),
      w:Math.round(r.width), h:Math.round(r.height),
      inView: r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth,
      disabled: b.disabled
    });
  })()`)
  if (!info) return { miss: true }
  const o = JSON.parse(info)
  if (o.disabled) return { disabled: true, ...o }
  if (o.inView && o.w > 0 && o.h > 0) {
    await mouse(o.x, o.y)
    return { how: 'mouse', ...o }
  }
  await ev(`(function(){
    var b=[].slice.call(document.querySelectorAll('button')).filter(function(x){return x.textContent.trim()===${JSON.stringify(text)}})[0];
    if(b) b.click();
    return true;
  })()`)
  return { how: 'js-click', ...o }
}

/** 把元素滚进视野后返回它的中心坐标 */
async function centerOf(selector, byText) {
  const raw = await ev(`(function(){
    var el;
    if (${JSON.stringify(byText ?? null)}) {
      var bs=[].slice.call(document.querySelectorAll('button')).filter(function(x){return x.textContent.trim()===${JSON.stringify(byText ?? '')}});
      el=bs[0];
    } else {
      el=document.querySelector(${JSON.stringify(selector ?? '')});
    }
    if(!el) return null;
    el.scrollIntoView({block:'center', inline:'center'});
    var r=el.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2), w:Math.round(r.width), h:Math.round(r.height)});
  })()`)
  if (!raw) return { miss: true }
  return JSON.parse(raw)
}

async function setField(sel, text) {
  const ok = await ev(`(function(){
    var el=document.querySelector(${JSON.stringify(sel)});
    if(!el) return false;
    var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto,'value').set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`)
  await sleep(250)
  return ok
}

async function typeInto(sel, text) {
  const b = await boxOf(sel)
  if (b.miss) throw new Error('找不到输入框 ' + sel)
  await mouse(b.x, b.y)
  await sleep(180)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await sleep(120)
  for (const ch of text) {
    await send('Input.insertText', { text: ch })
    await sleep(10)
  }
  await sleep(180)
}

const waitFor = async (expr, ms = 15000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if ((await ev(expr)) === true) return true
    await sleep(200)
  }
  return false
}
const waitSection = async (label, ms = 15000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const lab = await ev(`(function(){var e=document.elementFromPoint(Math.round(innerWidth/2),Math.round(innerHeight/2));var s=e;while(s&&!(s.tagName==='SECTION'&&s.getAttribute('aria-label')))s=s.parentElement;return s?s.getAttribute('aria-label'):null})()`)
    if (lab === label) { await sleep(900); return true }
    await sleep(200)
  }
  return false
}
/**
 * 若当前在详情路由（Shell 里），点"返回首页"回到分页容器。
 * 详情页里滚轮是不翻页的 —— 不先回去，后面的 wheel 全是空转。
 */
const backHome = async () => {
  const has = await ev(`!!document.querySelector('button[aria-label="返回首页"]')`)
  if (!has) return false
  await ev(`document.querySelector('button[aria-label="返回首页"]').click(); 1`)
  await sleep(2200)
  return true
}


/** 页面级 section 名单 —— 视图内部还有嵌套 section，必须用名单排除 */
const PAGE_LABELS = ['主页', '灵感页', '任务页', '题库页', '日历页', '网址页', 'GitHub 页']
const curPage = () => ev(`(function(){
  var PAGE=["主页","灵感页","任务页","题库页","日历页","网址页","GitHub 页"];
  var e=document.elementFromPoint(Math.round(innerWidth/2),Math.round(innerHeight/2));
  var s=e;
  while(s){ if(s.tagName==='SECTION' && PAGE.indexOf(s.getAttribute('aria-label'))>=0) return s.getAttribute('aria-label'); s=s.parentElement }
  return null
})()`)

/** 滚到首页的指定屏 */
const gotoPage = async (label, tries = 9) => {
  for (let i = 0; i < tries; i++) {
    if ((await curPage()) === label) { await sleep(900); return true }
    await wheel(120)
    await sleep(1400)
  }
  return false
}

/** 用圆环进详情路由（真实鼠标点几何位置，环上的文案是 pointer-events-none） */
const gotoTab = async (label, pageIndex) => {
  await backHome()
  // 先回首页第 1 屏
  for (let i = 0; i < 8; i++) {
    if ((await curPage()) === '主页') break
    await wheel(-120)
    await sleep(1300)
  }
  const pos = JSON.parse(await ev(`(function(){
    var el=[].slice.call(document.querySelectorAll('[aria-label]')).filter(function(e){return (e.getAttribute('aria-label')||'').indexOf(${JSON.stringify(label)})===0})[0];
    if(!el) return JSON.stringify({miss:true});
    var r=el.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)})
  })()`))
  if (pos.miss) {
    const labels = await ev(`JSON.stringify([].slice.call(document.querySelectorAll('[aria-label]')).map(function(e){return e.getAttribute('aria-label')}).filter(function(x){return /^(题库|灵感|待办|日历)/.test(x)}))`)
    throw new Error('找不到圆环入口 ' + label + '；当前可用: ' + labels)
  }
  await mouse(pos.x, pos.y)
  await sleep(1100)
  await mouse(pos.x, pos.y)
  await sleep(2500)
}

const RUN = String(Date.now()).slice(-6)

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 2535, height: 740, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: APP })
await sleep(5000)

// 登录
if (await waitFor(`document.body.innerText.indexOf('创造，从此刻开始') >= 0`, 8000)) {
  await typeInto('input[aria-label="账户"]', 'admin')
  await typeInto('input[aria-label="密码"]', 'Cv-Dev-Only-2026')
  const btn = JSON.parse(await ev(`(function(){var b=[].slice.call(document.querySelectorAll('button')).filter(function(x){return x.textContent.trim()==='登录'})[0];if(!b)return JSON.stringify({miss:true});var r=b.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)})})()`))
  if (!btn.miss) await mouse(btn.x, btn.y)
  await waitFor(`document.body.innerText.indexOf('记录每一位求知的灵魂') >= 0`, 20000)
}
check('已登录进入首页', (await ev(`document.body.innerText.indexOf('记录每一位求知的灵魂') >= 0`)) === true)

/* ============================== 灵感 ============================== */
console.log('')
console.log('--- 灵感 ---')
const IDEA_TEXT = `灵感内容-${RUN}`
{
  await gotoTab('灵感', 1)
  const onIdeas = await ev(`!!document.querySelector('section[aria-label="灵感收集"]')`)
  check('进入灵感页', onIdeas === true)

  // 找输入框：灵感收集左栏那个 textarea
  const ta = await ev(`document.querySelector('textarea[aria-label="新建灵感"]') ? 'ok' : null`)
  check('找到灵感输入框', ta === 'ok')

  check('灵感赋值成功', (await setField('textarea[aria-label="新建灵感"]', IDEA_TEXT)) === true)
  const addBtn = await clickByText('收进收件箱')
  console.log('    提交按钮:', JSON.stringify(addBtn))
  await sleep(2500)

  check('灵感写入成功', (await ev(`document.body.innerText.indexOf(${JSON.stringify(IDEA_TEXT)}) >= 0`)) === true)

  // 刷新后仍在
  await send('Page.navigate', { url: APP })
  await sleep(5500)
  await gotoTab('灵感', 1)
  check('【刷新后仍在】灵感还在', (await ev(`document.body.innerText.indexOf(${JSON.stringify(IDEA_TEXT)}) >= 0`)) === true)
}

/* ============================== 待办 ============================== */
console.log('')
console.log('--- 待办 ---')
const TODO_TEXT = `待办事项-${RUN}`
{
  await gotoTab('待办', 2)
  check('圆环可进入待办详情页', (await ev(`document.body.innerText.indexOf('未完成') >= 0`)) === true)
  // 回首页并滚到第 3 屏（任务页）—— 只有那里有"新建任务"输入框
  await backHome()
  await gotoPage('任务页')
  const onMission = await ev(`!!document.querySelector('section[aria-label="待办内容"]')`)
  check('进入任务页（第 3 屏）', onMission === true)

  const ti = await ev(`document.querySelector('input[aria-label="新建任务"]') ? 'ok' : null`)
  check('找到待办输入框', ti === 'ok')

  check('待办赋值成功', (await setField('input[aria-label="新建任务"]', TODO_TEXT)) === true)
  const addBtn = await clickByText('加入待办')
  console.log('    提交按钮:', JSON.stringify(addBtn))
  await sleep(2500)

  check('待办写入成功', (await ev(`document.body.innerText.indexOf(${JSON.stringify(TODO_TEXT)}) >= 0`)) === true)

  await send('Page.navigate', { url: APP })
  await sleep(5500)
  await gotoPage('任务页')
  check('【刷新后仍在】待办还在', (await ev(`document.body.innerText.indexOf(${JSON.stringify(TODO_TEXT)}) >= 0`)) === true)
}

/* ============================== 书签 ============================== */
console.log('')
console.log('--- 书签 ---')
const BM_NAME = `书签-${RUN}`
{
  // 书签在第 6 屏（首页分页）
  for (let i = 0; i < 10; i++) {
    await wheel(120)
    if (await waitSection('网址页')) break
  }
  check('进入宝藏网址页', (await ev(`!!document.querySelector('section[aria-label="网址页"]')`) === true))
  // 等表单真正挂载出来再操作
  await waitFor(`!!document.querySelector('input[aria-label="网址名称"]')`, 8000)
  await sleep(600)
  const t0 = await ev(`document.querySelector('input[aria-label="网址名称"]') ? 'ok' : null`)
  check('找到书签名称输入框', t0 === 'ok')

  check('名称赋值成功', (await setField('input[aria-label="网址名称"]', BM_NAME)) === true)
  check('网址赋值成功', (await setField('input[aria-label="网址"]', `example.com/${RUN}`)) === true)
  const saveBtn = await clickByText('收进宝藏')
  console.log('    提交按钮:', JSON.stringify(saveBtn))
  await sleep(2500)

  // 点击前先看一眼表单到底填进去了没有 —— 失败时能立刻定位是"没填进去"还是"接口报错"
  const formState = await ev(`(function(){
    var s=document.querySelector('section[aria-label="网址收录"]');
    if(!s) return 'no-form';
    var is=[].slice.call(s.querySelectorAll('input'));
    return JSON.stringify({ values: is.map(function(i){return (i.getAttribute('aria-label')||'?')+'='+i.value}) })
  })()`)
  console.log('    表单状态:', formState)
  const saveErr = await ev(`(function(){var m=document.body.innerText.match(/名称不能为空|网址格式不正确|保存失败[^\\n]{0,40}|连接不到服务器/);return m?m[0]:null})()`)
  if (saveErr) console.log('    页面报错:', saveErr)

  check('书签写入成功', (await ev(`document.body.innerText.indexOf(${JSON.stringify(BM_NAME)}) >= 0`)) === true)

  await send('Page.navigate', { url: APP })
  await sleep(5500)
  for (let i = 0; i < 10; i++) {
    await wheel(120)
    if (await waitSection('网址页')) break
  }
  check('【刷新后仍在】书签还在', (await ev(`document.body.innerText.indexOf(${JSON.stringify(BM_NAME)}) >= 0`)) === true)
}

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('  运行时异常:', errors.length ? errors.slice(0, 3).join(' | ').slice(0, 300) : '无')
console.log('==================================================')

ws.close()
proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
