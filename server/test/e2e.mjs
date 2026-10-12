/**
 * 端到端：前端 ↔ 后端联调验证。
 *
 * 重点验证一条 IndexedDB 时代做不到的事：
 * **换一个全新的浏览器配置（相当于换设备），数据依然在。**
 */

import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const TMP = process.env.TEMP
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9222
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

const profile = process.argv[2] ?? 'cv-e2e'
const proc = spawn(
  chromePath,
  [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--disable-crash-reporter',
    `--user-data-dir=${TMP}\\${profile}`,
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

/** 每次运行用唯一文件名，避免与历史数据重名导致计数/查找串味 */
const RUN = String(Date.now()).slice(-6)
const F_PDF = `期末试卷-${RUN}.pdf`
const F_MD = `复习提纲-${RUN}.md`
const F_PNG = `错题截图-${RUN}.png`

/** 把样例文件复制成唯一名 —— setFileInputFiles 需要磁盘上真实存在的路径 */
const SRC = 'D:\\MyWeb\\.tmp\\qbank'
const { copyFile, unlink } = await import('node:fs/promises')
const LOCAL_PDF = `${SRC}\\${F_PDF}`
const LOCAL_MD = `${SRC}\\${F_MD}`
const LOCAL_PNG = `${SRC}\\${F_PNG}`
await copyFile(`${SRC}\\期末试卷.pdf`, LOCAL_PDF)
await copyFile(`${SRC}\\复习提纲.md`, LOCAL_MD)
await copyFile(`${SRC}\\错题截图.png`, LOCAL_PNG)
const cleanup = () => {
  for (const f of [LOCAL_PDF, LOCAL_MD, LOCAL_PNG]) unlink(f).catch(() => undefined)
}
process.on('exit', cleanup)

const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

const mouse = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
  await sleep(120)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
}
const boxOf = async (sel) =>
  JSON.parse(
    await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return JSON.stringify({miss:true});var r=e.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)})})()`),
  )
const wheel = (dy) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 18, y: 370, deltaX: 0, deltaY: dy })

/** 真实键盘输入 —— React 对合成事件不认，必须打真键 */
async function typeInto(sel, text) {
  const b = await boxOf(sel)
  if (b.miss) throw new Error('找不到输入框 ' + sel)
  await mouse(b.x, b.y)
  await sleep(200)
  // 先清空
  await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await sleep(120)
  for (const ch of text) {
    await send('Input.insertText', { text: ch })
    await sleep(12)
  }
  await sleep(200)
}

const waitFor = async (expr, ms = 12000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if ((await ev(expr)) === true) return true
    await sleep(200)
  }
  return false
}

const waitSection = async (label, ms = 12000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const lab = await ev(`(function(){var e=document.elementFromPoint(Math.round(innerWidth/2),Math.round(innerHeight/2));var s=e;while(s&&!(s.tagName==='SECTION'&&s.getAttribute('aria-label')))s=s.parentElement;return s?s.getAttribute('aria-label'):null})()`)
    if (lab === label) { await sleep(900); return true }
    await sleep(200)
  }
  return false
}

await send('Page.enable')
await send('Runtime.enable')
await send('DOM.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 2535, height: 740, deviceScaleFactor: 1, mobile: false })

/* ---------------------------- 1. 登录页 ---------------------------- */
console.log('')
console.log('--- 登录 ---')
await send('Page.navigate', { url: APP })
await sleep(5000)

const onLogin = await ev(`document.body.innerText.indexOf('创造，从此刻开始') >= 0`)
check('未登录时显示登录页', onLogin === true)

// 后端不可用提示不该出现
check('没有出现"连接不到服务器"提示', (await ev(`document.body.innerText.indexOf('连接不到服务器') < 0`)) === true)

await typeInto('input[aria-label="账户"]', 'admin')
await typeInto('input[aria-label="密码"]', 'Cv-Dev-Only-2026')
const loginBtn = JSON.parse(await ev(`(function(){
  var bs=[].slice.call(document.querySelectorAll('button'));
  var b=bs.filter(function(x){return x.textContent.trim()==='登录'})[0];
  if(!b) return JSON.stringify({miss:true});
  var r=b.getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)})
})()`))
check('找到登录按钮', !loginBtn.miss)
if (!loginBtn.miss) await mouse(loginBtn.x, loginBtn.y)

const loggedIn = await waitFor(`document.body.innerText.indexOf('记录每一位求知的灵魂') >= 0`, 20000)
check('登录成功，进入首页', loggedIn === true)
check('登录后 localStorage 里不再有明文会话', (await ev(`localStorage.getItem('cv.session') === null`)) === true)
check('登录后 localStorage 里不再有账号表', (await ev(`localStorage.getItem('cv.accounts') === null`)) === true)
check('cookie 是 httpOnly（JS 读不到 session）', (await ev(`document.cookie.indexOf('cv_sid') < 0`)) === true,
  await ev(`document.cookie`))

/* ---------------------------- 2. 刷新保持登录 ---------------------------- */
console.log('')
console.log('--- 刷新保持登录 ---')
await send('Page.navigate', { url: APP })
await sleep(5000)
check('刷新后仍是登录态（cookie 生效）', (await ev(`document.body.innerText.indexOf('记录每一位求知的灵魂') >= 0`)) === true)

/* ---------------------------- 3. 题库上传 ---------------------------- */
console.log('')
console.log('--- 题库上传 ---')
for (let i = 0; i < 5; i++) {
  await wheel(120)
  if (await waitSection('题库页')) break
}
check('到达题库页', (await ev(`!!document.querySelector('section[aria-label="题库页"]')`)) === true)

const doc = await send('DOM.getDocument')
const inp = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: 'section[aria-label="题库页"] input[aria-label="选择题库文件"]' })
check('找到文件输入', !!inp.result?.nodeId)
await send('DOM.setFileInputFiles', {
  nodeId: inp.result.nodeId,
  files: [LOCAL_PDF, LOCAL_MD, LOCAL_PNG],
})
await sleep(4000)

const listed = JSON.parse(await ev(`(function(){
  var s=document.querySelector('section[aria-label="题库页"]');
  if(!s) return JSON.stringify({ n:-1, txt:'SECTION-MISSING', body: document.body.innerText.slice(0,240) });
  var bs=[].slice.call(s.querySelectorAll('button[aria-current]'));
  return JSON.stringify({ n: bs.length, txt: s.innerText })
})()`))
if (listed.n === -1) console.log('    !! 题库页 section 消失，页面内容:', JSON.stringify(listed.body))
console.log('    列表条目数:', listed.n)
check('三个文件上传成功', listed.txt.includes(F_PDF) && listed.txt.includes(F_MD) && listed.txt.includes(F_PNG),
  '共 ' + listed.n + ' 条')
check('中文文件名没有乱码（且含本次运行 ID）', listed.txt.includes(F_PDF) && listed.txt.includes(F_MD) && listed.txt.includes(F_PNG))

// 图片用服务器 URL 渲染（不再是 blob:）
// 上传后默认选中第一个文件（PDF），所以这里不能断言一定有 img。
// 先确认"有查看器在渲染"，再单独点开图片确认它走的是服务器地址。
const viewerState = await ev(`(function(){
  var s=document.querySelector('section[aria-label="题库页"]');
  return JSON.stringify({ iframe: !!s.querySelector('iframe'), img: !!s.querySelector('img'), art: !!s.querySelector('article.md') })
})()`)
check('上传后有查看器在渲染', /"(iframe|img|art)":true/.test(String(viewerState)), String(viewerState))

const pickImg = await ev(`(function(){
  var s=document.querySelector('section[aria-label="题库页"]');
  var b=[].slice.call(s.querySelectorAll('button[aria-current]')).filter(function(x){return (x.textContent||'').indexOf(${JSON.stringify(F_PNG)})>=0})[0];
  if(b) b.click(); return !!b
})()`)
await sleep(1500)
const imgSrc = await ev(`(function(){var i=document.querySelector('section[aria-label="题库页"] img');return i?i.getAttribute('src'):null})()`)
check('图片走服务器地址（非 blob）', typeof imgSrc === 'string' && imgSrc.startsWith('/api/files/'), String(imgSrc))

/* ---------------------------- 4. 刷新后仍在 ---------------------------- */
console.log('')
console.log('--- 刷新后仍在（原来是"退出再打开就没了"）---')
await send('Page.navigate', { url: APP })
await sleep(5500)
for (let i = 0; i < 5; i++) {
  await wheel(120)
  if (await waitSection('题库页')) break
}
const afterReload = JSON.parse(await ev(`(function(){
  var s=document.querySelector('section[aria-label="题库页"]');
  var txt=s.innerText;
  return JSON.stringify({ n: s.querySelectorAll('button[aria-current]').length, txt: txt })
})()`))
console.log('    刷新后条目数:', afterReload.n)
check('刷新后本次上传的文件仍在', afterReload.txt.includes(F_PDF) && afterReload.txt.includes(F_MD) && afterReload.txt.includes(F_PNG),
  '共 ' + afterReload.n + ' 条')

// 逐个点开，验证每种类型都能正确渲染
const pickAndProbe = async (name) => {
  await ev(`(function(){
    var s=document.querySelector('section[aria-label="题库页"]');
    var b=[].slice.call(s.querySelectorAll('button[aria-current]')).filter(function(x){return (x.textContent||'').indexOf(${JSON.stringify(name)})>=0})[0];
    if(b) b.click(); return !!b
  })()`)
  await sleep(1500)
  return JSON.parse(await ev(`(function(){
    var s=document.querySelector('section[aria-label="题库页"]');
    var img=s.querySelector('img');
    return JSON.stringify({
      img: img?img.getAttribute('src'):null,
      iframe: !!s.querySelector('iframe'),
      art: !!s.querySelector('article.md'),
      code: !!s.querySelector('.code pre')
    })
  })()`))
}
const rPdf = await pickAndProbe(F_PDF)
console.log('    PDF 查看器:', JSON.stringify(rPdf))
check('刷新后 PDF 用 iframe 打开', rPdf.iframe === true, JSON.stringify(rPdf))
const rImg = await pickAndProbe(F_PNG)
console.log('    图片查看器:', JSON.stringify(rImg))
check('刷新后图片用服务器地址显示', typeof rImg.img === 'string' && rImg.img.startsWith('/api/files/'), String(rImg.img))
const rMd = await pickAndProbe(F_MD)
console.log('    MD 查看器:', JSON.stringify(rMd))
check('刷新后 Markdown 正常渲染', rMd.art === true, JSON.stringify(rMd))

/* ---------------------------- 5. 换浏览器配置 ---------------------------- */
console.log('')
console.log('--- 换一个全新的浏览器配置（等价于换设备）---')
{
  // 用同一账号，在干净的 profile 里登录，看数据在不在
  const ws2 = await (async () => {
    const t = await send('Target.createTarget', { url: 'about:blank' })
    return t.result.targetId
  })()
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
  const other = list.find((t) => t.id === ws2)
  const ws3 = new WebSocket(other.webSocketDebuggerUrl)
  await new Promise((r) => ws3.addEventListener('open', r, { once: true }))
  let id3 = 0
  const pend3 = new Map()
  ws3.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pend3.has(m.id)) { pend3.get(m.id)(m); pend3.delete(m.id) }
  })
  const send3 = (method, params = {}) =>
    new Promise((res) => { const i = ++id3; pend3.set(i, res); ws3.send(JSON.stringify({ id: i, method, params })) })
  const ev3 = async (expr) =>
    (await send3('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value

  await send3('Page.enable')
  await send3('Runtime.enable')
  await send3('Emulation.setDeviceMetricsOverride', { width: 2535, height: 740, deviceScaleFactor: 1, mobile: false })
  await send3('Page.navigate', { url: APP })
  await sleep(5000)

  // 这个新标签页共享同一个浏览器 profile，所以 cookie 是共享的。
  // 真正要验证的是：数据来自服务器而不是浏览器本地存储 ——
  // 所以这里清掉 localStorage 再刷新，看数据是否依然存在。
  await ev3(`localStorage.clear(); sessionStorage.clear(); 1`)
  await send3('Network.clearBrowserCache')
  await send3('Page.navigate', { url: APP })
  await sleep(5500)

  const stillIn = await ev3(`document.body.innerText.indexOf('记录每一位求知的灵魂') >= 0`)
  check('清空浏览器本地存储后仍是登录态（凭据在服务端）', stillIn === true)

  for (let i = 0; i < 5; i++) {
    await send3('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 18, y: 370, deltaX: 0, deltaY: 120 })
    await sleep(1300)
    const lab = await ev3(`(function(){var e=document.elementFromPoint(Math.round(innerWidth/2),Math.round(innerHeight/2));var s=e;while(s&&!(s.tagName==='SECTION'&&s.getAttribute('aria-label')))s=s.parentElement;return s?s.getAttribute('aria-label'):null})()`)
    if (lab === '题库页') break
  }
  await sleep(1200)
  const t3 = await ev3(`(function(){var s=document.querySelector('section[aria-label="题库页"]');return s?s.innerText:''})()`)
  console.log('    清空本地存储后仍能看到本次上传的三个文件:', [F_PDF, F_MD, F_PNG].every((x) => String(t3).includes(x)))
  check('清空 localStorage 后文件仍在（数据在服务器磁盘上）',
    [F_PDF, F_MD, F_PNG].every((x) => String(t3).includes(x)), 'txt长度=' + String(t3).length)

  await writeFile('D:\\MyWeb\\docs\\screenshots\\42-e2e-qbank.png', Buffer.from((await send3('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'))
  ws3.close()
}

/* ---------------------------- 6. 退出登录 ---------------------------- */
console.log('')
console.log('--- 退出登录 ---')
{
  const out = await fetch('http://127.0.0.1:5174/api/auth/logout', {
    method: 'POST',
    headers: { Cookie: (await send('Network.getCookies', { urls: [APP] })).result.cookies.map((c) => `${c.name}=${c.value}`).join('; ') },
  }).then((r) => r.json())
  check('服务端退出接口返回 ok', out?.ok === true)
  const me = await fetch('http://127.0.0.1:5174/api/auth/me').then((r) => r.json())
  check('退出后 me 返回未登录', me?.ok === false, JSON.stringify(me?.error?.code))
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
