/**
 * 端到端：题库左侧选中态 + 右侧预览的联动。
 *
 * 交互模型（同一个动作完成选中与取消）：
 *   · 点未选中的文件 → 它变成选中态，右侧展示它
 *   · 点另一个文件   → 新的变成选中态，原来那条恢复原样
 *   · 点已选中的文件 → 取消选中，右侧回到空状态，左侧也退出选中态
 *
 * 验证重点：
 *  ① 选中态**看得出来**（不只是边框颜色微调）
 *  ② 同一时刻**只有一条**是选中的
 *  ③ 切换后旧的那条真的恢复原样
 *  ④ 再点一次能取消，且不会立刻被"默认展示第一个"顶回来
 */

import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const TMP = process.env.TEMP
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9229
const APP = 'http://127.0.0.1:5174/'

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
  `--user-data-dir=${TMP}\\cv-toggle`, '--window-size=2600,900', `--remote-debugging-port=${port}`, 'about:blank'],
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

/**
 * 读左侧列表：每条的名字 + 是否选中 + 选中态长什么样。
 * 用 aria-current 判定选中（FileRow 上就是拿它标的），
 * 用实际计算样式判定"看得出来"。
 */
const listState = () => ev(`(function(){
  var s=document.querySelector('section[aria-label="题库页"]');
  if(!s) return JSON.stringify({miss:true});
  var rows=[].slice.call(s.querySelectorAll('button[aria-current]'));
  return JSON.stringify(rows.map(function(b){
    var box=b.parentElement;
    var cs=getComputedStyle(box);
    // 文件名 span 带 title=原始文件名，比从整串文本里切可靠
    var nameEl=b.querySelector('[title]');
    var nameCs=nameEl?getComputedStyle(nameEl):null;
    return {
      name: (nameEl && nameEl.getAttribute('title')) || (b.textContent||'').trim().slice(0,40),
      active: b.getAttribute('aria-current')==='true',
      bg: cs.backgroundImage.slice(0,42),
      shadow: cs.boxShadow.slice(0,52),
      transform: cs.transform,
      inlineTf: box.style.transform,
      inlineBg: box.style.background ? box.style.background.slice(0, 30) : '',
      weight: nameCs?nameCs.fontWeight:null
    };
  }));
})()`)

const viewerState = () => ev(`(function(){
  var s=document.querySelector('section[aria-label="题库页"]');
  var v=s?s.querySelector('.deco'):null;
  return JSON.stringify({
    hasViewer: !!v,
    fileName: v ? ((v.querySelector('h4')||{}).textContent||null) : null,
    empty: s ? s.innerText.indexOf('未打开任何文件') >= 0 : null,
    hasX: !!(s && s.querySelector('button[aria-label="关闭预览"]'))
  });
})()`)

/** 点第 i 条（用索引定位，避免重名干扰） */
const clickRow = async (i) => {
  const pos = JSON.parse(await ev(`(function(){
    var s=document.querySelector('section[aria-label="题库页"]');
    var rows=[].slice.call(s.querySelectorAll('button[aria-current]'));
    var b=rows[${i}];
    if(!b) return JSON.stringify({miss:true});
    b.scrollIntoView({block:'nearest'});
    var r=b.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2),
      inView: r.top>=0 && r.bottom<=innerHeight});
  })()`))
  if (pos.miss) return false
  if (pos.inView) await mouse(pos.x, pos.y)
  else {
    await ev(`(function(){
      var s=document.querySelector('section[aria-label="题库页"]');
      var rows=[].slice.call(s.querySelectorAll('button[aria-current]'));
      if(rows[${i}]) rows[${i}].click(); return true;
    })()`)
  }
  await sleep(1100)
  return true
}

await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 2535, height: 740, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: APP })
await sleep(5000)

if (await ev(`document.body.innerText.indexOf('创造，从此刻开始') >= 0`)) {
  await setField('input[aria-label="账户"]', 'admin')
  await setField('input[aria-label="密码"]', 'Cv-Dev-Only-2026')
  const b = JSON.parse(await ev(`(function(){var el=[].slice.call(document.querySelectorAll('button')).filter(function(x){return x.textContent.trim()==='登录'})[0];var r=el.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)})})()`))
  await mouse(b.x, b.y)
  await sleep(6500)
}
check('已登录', (await ev(`document.body.innerText.indexOf('记录每一位求知的灵魂') >= 0`)) === true)

await gotoPage('题库页')
check('到达题库页', (await ev(`!!document.querySelector('section[aria-label="题库页"]')`)) === true)

const rows0 = JSON.parse(await listState())
console.log('  列表条数:', rows0.length)
check('列表里至少 3 条（切换测试需要）', rows0.length >= 3, String(rows0.length))

// ---- ① 默认选中第一条，且看得出来 ----
const active0 = rows0.filter((r) => r.active)
check('默认恰好一条处于选中态', active0.length === 1, '选中 ' + active0.length + ' 条')
const a0 = active0[0]
check('选中条有染色的底色（不是只有边框）', /gradient/.test(String(a0.bg)) && !/none/.test(String(a0.bg)), String(a0.bg))
check('选中条有左侧色条（inset shadow）', /inset/.test(String(a0.shadow)), String(a0.shadow))
check('选中条有位移（translateX）', a0.transform !== 'none' && a0.transform !== 'matrix(1, 0, 0, 1, 0, 0)', String(a0.transform))
check('选中条文件名加粗', Number(a0.weight) >= 600, String(a0.weight))

const unsel = rows0.filter((r) => !r.active)[0]
check('未选中条没有染色底色', /none/.test(String(unsel.bg)) || unsel.bg === 'none', String(unsel.bg))
check('未选中条没有位移', unsel.transform === 'none', String(unsel.transform))
check('选中态与未选中态**确实不同**', a0.bg !== unsel.bg && a0.transform !== unsel.transform)

const v0 = JSON.parse(await viewerState())
check('右侧展示了默认选中的那条', v0.hasViewer === true && String(v0.fileName) === String(a0.name),
  `预览=${v0.fileName} 选中=${a0.name}`)
check('右侧不再有 ✕ 按钮（X 方案已废弃）', v0.hasX === false)

await writeFile('D:\\MyWeb\\docs\\screenshots\\46-row-selected.png', Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'))

// ---- ② 点另一条 → 切换，旧的恢复原样 ----
await clickRow(1)
const rows1 = JSON.parse(await listState())
const active1 = rows1.filter((r) => r.active)
check('切换后仍然只有一条选中', active1.length === 1, '选中 ' + active1.length + ' 条')
check('选中的换成了第二条', active1[0] && active1[0].name === rows0[1].name, String(active1[0]?.name))
console.log('    切换后各行:', JSON.stringify(rows1.map((r, i) => ({ i, n: r.name.slice(0, 22), a: r.active, tf: r.transform }))))
const oldRow = rows1.find((r) => r.name === a0.name)
check('原来那条已恢复原样（无底色、无位移）',
  /none/.test(String(oldRow.bg)) && oldRow.transform === 'none', JSON.stringify({ bg: oldRow.bg, tf: oldRow.transform }))
const v1 = JSON.parse(await viewerState())
check('右侧跟着换成了新文件', String(v1.fileName) === String(rows0[1].name), `预览=${v1.fileName}`)

// ---- ③ 再点已选中的那条 → 取消，右侧无展示 ----
await clickRow(1)
const rows2 = JSON.parse(await listState())
check('再点一次后没有选中项', rows2.filter((r) => r.active).length === 0,
  '仍有 ' + rows2.filter((r) => r.active).length + ' 条选中')
const v2 = JSON.parse(await viewerState())
check('取消后右侧无任何展示', v2.hasViewer === false, 'hasViewer=' + v2.hasViewer)
check('取消后显示空状态', v2.empty === true)
check('取消后没有被"默认展示第一个"顶回来', v2.hasViewer === false)

await writeFile('D:\\MyWeb\\docs\\screenshots\\47-row-deselected.png', Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'))

// ---- ④ 取消后再点别的文件，应能重新选中 ----
await clickRow(2)
const rows3 = JSON.parse(await listState())
const active3 = rows3.filter((r) => r.active)
check('取消后可以重新选中', active3.length === 1, '选中 ' + active3.length + ' 条')
check('重新选中的是第三条', active3[0] && active3[0].name === rows0[2].name, String(active3[0]?.name))
const v3 = JSON.parse(await viewerState())
check('右侧重新展示', v3.hasViewer === true, 'file=' + v3.fileName)

// ---- ⑤ 列表条数没被选中逻辑影响 ----
check('选中/取消不改变列表条数', rows3.length === rows0.length, `${rows0.length} -> ${rows3.length}`)

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('  运行时异常:', errors.length ? errors.slice(0, 3).join(' | ').slice(0, 250) : '无')
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
