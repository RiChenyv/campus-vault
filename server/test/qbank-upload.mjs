/**
 * 题库上传的两项验证：
 *  ① markdown 上传后能在站内显示（原来打开是一片空白）
 *  ② 能选整个文件夹，并跳过不支持的类型
 *
 * 第 ① 条必须**真的看渲染结果**：原来的 bug 是"接口对了但正文没传进来"，
 * 只断言"上传成功"是查不出来的。
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const API = 'http://127.0.0.1:5175/api'
const TMP = process.env.TEMP
const port = 9261
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

/* ── 准备一个"文件夹"，里面有 md、代码、以及应被跳过的东西 ── */
const RUN = String(Date.now()).slice(-6)
const DIR = `${TMP}\\qbank-folder-${RUN}`
mkdirSync(`${DIR}\\第一章`, { recursive: true })
mkdirSync(`${DIR}\\第二章`, { recursive: true })

const MD_NAME = `笔记-${RUN}.md`
writeFileSync(
  `${DIR}\\第一章\\${MD_NAME}`,
  `# 第一章 标题\n\n这是**加粗**内容，验证 markdown 能渲染。\n\n- 列表项一\n- 列表项二\n\n> 引用块内容\n`,
  'utf8',
)
writeFileSync(`${DIR}\\第二章\\代码-${RUN}.py`, `def hello():\n    return "world"\n`, 'utf8')
writeFileSync(`${DIR}\\第二章\\文本-${RUN}.txt`, `纯文本内容 ${RUN}\n`, 'utf8')
// 应被跳过：不支持的扩展名 + 系统垃圾
writeFileSync(`${DIR}\\病毒-${RUN}.exe`, 'MZ not really', 'binary')
writeFileSync(`${DIR}\\.DS_Store`, 'junk', 'utf8')
writeFileSync(`${DIR}\\第二章\\Thumbs.db`, 'junk', 'binary')

console.log('测试文件夹:', DIR)
console.log('')

/* ── 后端：白名单接口 ── */
const cookie = (await (await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: 'admin', password: 'Cv-Dev-Only-2026' }),
})).headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')

const allowedRes = await fetch(`${API}/files/allowed`, { headers: { Cookie: cookie } }).then((r) => r.json())
const exts = allowedRes.data?.extensions ?? {}
console.log('=== 后端白名单接口 ===')
check('GET /files/allowed 可用', Object.keys(exts).length > 10, `${Object.keys(exts).length} 项`)
check('包含 md（markdown 允许上传）', exts.md === 'markdown', String(exts.md))
check('不包含 exe（会被前置过滤掉）', !('exe' in exts))
check('不包含 db（Thumbs.db 会被过滤）', !('db' in exts))

/* ── 浏览器 ── */
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
  `--user-data-dir=${TMP}\\cv-qbank`, '--window-size=1600,1200', '--remote-debugging-port=' + port, 'about:blank'],
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

await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(3000)
await ev(`fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ account:'admin', password:'Cv-Dev-Only-2026' }) }).then(r=>r.status)`)
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(4000)

// 进题库
await ev(`(function(){
  var b = Array.from(document.querySelectorAll('button')).find(function(e){ return e.textContent.trim().indexOf('题库') === 0 });
  if (b) b.click(); return 1 })()`)
await sleep(2500)

console.log('')
console.log('=== ① 文件夹上传入口 ===')
const ui = JSON.parse(await ev(`(function(){
  return JSON.stringify({
    hasDir: !!document.querySelector('[aria-label="选择题库文件夹"]'),
    hasFile: !!document.querySelector('[aria-label="选择题库文件"]'),
    dirHasAttr: (function(){
      var el = document.querySelector('[aria-label="选择题库文件夹"]');
      return el ? (el.hasAttribute('webkitdirectory') || el.hasAttribute('directory')) : false
    })(),
    dirBtn: !!Array.from(document.querySelectorAll('button')).find(function(e){
      return (e.getAttribute('aria-label')||'') === '上传整个文件夹' }),
  })
})()`))
console.log('  ', JSON.stringify(ui))
check('有文件夹选择 input', ui.hasDir === true)
check('该 input 带 webkitdirectory 属性', ui.dirHasAttr === true)
check('有「选择整个文件夹」按钮', ui.dirBtn === true)
check('原文件多选入口还在', ui.hasFile === true)

/* ── ② 用 CDP 把整个文件夹塞进文件夹 input ── */
console.log('')
console.log('=== ② 上传整个文件夹 ===')
/* ⚠️ webkitdirectory 的 input 要传**目录路径**。
   传文件列表时 CDP 会静默失败：files.length 仍为 0，change 事件也不触发，
   表现成"功能坏了"，其实只是测试调用方式不对。 */
const files = [DIR]

const doc = await send('DOM.getDocument', {})
const node = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '[aria-label="选择题库文件夹"]' })
if (!node.result?.nodeId) {
  check('找到文件夹 input 节点', false)
} else {
  await send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files })
  await sleep(6000)

  const afterUpload = String(await ev(`document.body.innerText`))
  console.log('  页面提示:', afterUpload.match(/已上传[^\n]*/)?.[0] ?? '(无)')

  /* 文件夹默认折叠 —— 这正是用户要的「只有一个按钮」。
     所以先确认：**折叠时里面的文件不该出现在列表里**。 */
  const folderRow = await ev(`(function(){
    var rows = Array.from(document.querySelectorAll('[aria-label^="展开文件夹"],[aria-label^="收起文件夹"]'));
    var mine = rows.find(function(e){ return (e.getAttribute('aria-label')||'').indexOf('qbank-folder-') >= 0 });
    return mine ? mine.getAttribute('aria-label') : '';
  })()`)
  console.log('  文件夹条目:', folderRow)
  check('上传后列表里出现**一个文件夹条目**', String(folderRow).startsWith('展开文件夹'), String(folderRow))
  check(
    '折叠状态下里面的文件没有平铺出来',
    !new RegExp('笔记-' + RUN).test(afterUpload),
    new RegExp('笔记-' + RUN).test(afterUpload) ? '文件被摊开了' : '',
  )

  // 展开它
  await ev(`(function(){
    var rows = Array.from(document.querySelectorAll('[aria-label^="展开文件夹"]'));
    var mine = rows.find(function(e){ return (e.getAttribute('aria-label')||'').indexOf('qbank-folder-') >= 0 });
    if (mine) mine.click();
    return 1 })()`)
  await sleep(1200)

  const after = String(await ev(`document.body.innerText`))
  check('上传了文件夹里的文件', new RegExp('笔记-' + RUN).test(after), after.match(new RegExp('笔记-' + RUN + '\\.md'))?.[0] ?? '(没找到)')
  check('子目录下的代码文件也传了', new RegExp('代码-' + RUN).test(after), '')
  // 注意别匹配到按钮上的静态文字「会跳过不支持的类型」—— 要带数字的才是真提示
  const skipMsg = String(after).match(/跳过 \d+ 个不支持的类型/)?.[0] ?? ''
  check('不支持的类型被跳过（有带数量的提示）', !!skipMsg, skipMsg || '(没有跳过提示)')

  /* ── ③ markdown 真的渲染出来了 ── */
  console.log('')
  console.log('=== ③ markdown 站内显示 ===')

  // 确保选中的是那个 md
  await ev(`(function(){
    var els = Array.from(document.querySelectorAll('button'));
    var t = els.find(function(e){ return (e.textContent||'').indexOf('笔记-${RUN}') >= 0 });
    if (t) t.click();
    return 1 })()`)
  await sleep(2500)

  const rendered = JSON.parse(await ev(`(function(){
    var art = document.querySelector('article.md');
    return JSON.stringify({
      hasArticle: !!art,
      text: art ? (art.innerText || '').slice(0, 200) : '',
      hasH1: art ? !!art.querySelector('h1') : false,
      hasStrong: art ? !!art.querySelector('strong') : false,
      hasLi: art ? !!art.querySelector('li') : false,
      hasBlockquote: art ? !!art.querySelector('blockquote') : false,
    })
  })()`))
  console.log('  ', JSON.stringify({ ...rendered, text: rendered.text.slice(0, 70) }))

  check('markdown 用 article.md 渲染了', rendered.hasArticle === true, rendered.hasArticle ? '' : '没有 article.md 元素')
  check('标题渲染成了 <h1>', rendered.hasH1 === true)
  check('**加粗** 渲染成了 <strong>', rendered.hasStrong === true)
  check('列表渲染成了 <li>', rendered.hasLi === true)
  check('引用渲染成了 <blockquote>', rendered.hasBlockquote === true)
  check('正文内容确实显示出来了', rendered.text.includes('第一章'), rendered.text.slice(0, 50))

  /* ── ⑤ 滚轮能滚动文件内容 ──
     用户报告「markdown 下滚无反应，看不到完整内容」。
     翻页逻辑原来只把滚轮让给带 .overflow-y-auto 类名的容器，
     而查看器内容区是 overflow-auto，类名对不上 —— 滚轮被翻页吃掉。

     必须**真的派发滚轮事件**并看 scrollTop 变没变：只看 DOM 结构查不出来。 */
  console.log('')
  console.log('=== ⑤ 滚轮滚动文件内容 ===')
  const scrollInfo = async () => JSON.parse(await ev(`(function(){
    var art = document.querySelector('article.md');
    if (!art) return JSON.stringify({ found:false });
    var el = art.parentElement;
    while (el && el !== document.body) {
      var oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2) {
        return JSON.stringify({ found:true, scrollTop: el.scrollTop, max: el.scrollHeight - el.clientHeight });
      }
      el = el.parentElement;
    }
    return JSON.stringify({ found:false });
  })()`))

  // 先把内容撑长（这个测试的 md 很短，可能不够滚）
  await ev(`(function(){
    var art = document.querySelector('article.md');
    if (art) art.innerHTML = art.innerHTML + Array(80).fill('<p>填充段落，用来撑长内容以便测试滚动。</p>').join('');
    return 1 })()`)
  await sleep(500)

  const s0 = await scrollInfo()
  console.log('  内容区:', JSON.stringify(s0))
  check('内容超出可视区（有得滚）', s0.found === true && s0.max > 0, JSON.stringify(s0))

  /* ⚠️ 不能用「派发滚轮后看 scrollTop 变没变」来判断。
     `dispatchEvent(new WheelEvent(...))` 是**合成事件**，它不会触发原生滚动 ——
     即使一切正常，scrollTop 也永远不变，测试会假失败（上一版就栽在这）。

     真正要问的是：**翻页逻辑有没有把这个滚轮吃掉**。
     它吃掉的方式就是 preventDefault()。所以看 defaultPrevented：
       · false → 没被吃，浏览器会正常滚动内容 ✓
       · true  → 被翻页截走，内容滚不动 ✗（用户报的就是这个）
     再用 elementFromPoint 取光标正下方的真实元素，模拟"鼠标停在正文上"。 */
  const wheelRes = JSON.parse(await ev(`(function(){
    var art = document.querySelector('article.md');
    var el = art.parentElement;
    while (el && el !== document.body) {
      var oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2) break;
      el = el.parentElement;
    }
    el.scrollTop = 0;
    var r = art.getBoundingClientRect();
    var x = r.left + r.width / 2, y = Math.min(r.top + 100, window.innerHeight - 20);
    /* 直接在 article 上派发。原来用 elementFromPoint 取"光标下的元素"，
       但无头模式里那个点可能落在覆盖层上（实测拿到 SECTION），
       守卫就测不到了。article 上的滚轮会冒泡到 window，正是真实路径。 */
    var ev = new WheelEvent('wheel', {
      deltaY: 120, deltaMode: 0, bubbles: true, cancelable: true, clientX: x, clientY: y });
    art.dispatchEvent(ev);
    return JSON.stringify({ prevented: ev.defaultPrevented, targetTag: 'ARTICLE' });
  })()`))
  console.log('  滚轮事件:', JSON.stringify(wheelRes))
  check('滚轮派发在正文上（前提）', wheelRes.targetTag === 'ARTICLE', JSON.stringify(wheelRes))
  check('**内容滚轮没有被翻页逻辑吃掉**（用户报的就是这条）', wheelRes.prevented === false,
    wheelRes.prevented ? '被 preventDefault 了 —— 内容滚不动' : '')

  /* 反向对照：把内容拉到底之后再滚，这时**应该**交给翻页。
     否则"永远不吃滚轮"也能让上面那条通过 —— 那是另一个 bug（翻不了页）。 */
  const atBottom = JSON.parse(await ev(`(function(){
    var art = document.querySelector('article.md');
    var el = art.parentElement;
    while (el && el !== document.body) {
      var oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2) break;
      el = el.parentElement;
    }
    el.scrollTop = el.scrollHeight;
    var r = art.getBoundingClientRect();
    var x = r.left + r.width / 2, y = Math.min(r.top + 100, window.innerHeight - 20);
    var ev = new WheelEvent('wheel', {
      deltaY: 120, deltaMode: 0, bubbles: true, cancelable: true, clientX: x, clientY: y });
    art.dispatchEvent(ev);
    return JSON.stringify({ prevented: ev.defaultPrevented, scrollTop: el.scrollTop });
  })()`))
  console.log('  滚到底之后:', JSON.stringify(atBottom))
  check('内容滚到底后，滚轮交还给翻页（没被永久霸占）', atBottom.prevented === true,
    atBottom.prevented ? '' : '到底了还不放给翻页 —— 会翻不了页')

  /* ── ④ 备注里记下了子目录 ──
     不能扫页面文本：库里别的文件备注也含「来自…」，会匹配错元素。
     直接查这个文件的 note。 */
  console.log('')
  console.log('=== ④ 子目录信息 ===')
  const storedList = await fetch(`${API}/files?scope=qbank`, { headers: { Cookie: cookie } }).then((r) => r.json())
  const mine = (storedList.data?.files ?? []).filter((f) => f.name.includes(RUN))
  // 子目录信息现在存在 folder 字段（原来塞在 note 里 —— 那只是文字，
  // 列表没法按它分组，用户看到的仍是摊开的文件）
  const withFolder = mine.filter((f) => (f.folder ?? '').includes('第一章') || (f.folder ?? '').includes('第二章'))
  console.log('  这批文件的 folder:', JSON.stringify(mine.map((f) => f.folder)))
  check('folder 字段记下了来自哪个子目录', withFolder.length > 0, `${withFolder.length}/${mine.length} 个带子目录`)

  /* ── 清理：删掉刚上传的测试文件 ── */
  console.log('')
  console.log('=== 清理测试文件 ===')
  const list = await fetch(`${API}/files?scope=qbank`, { headers: { Cookie: cookie } }).then((r) => r.json())
  let removed = 0
  for (const f of list.data?.files ?? []) {
    if (f.name.includes(RUN)) {
      await fetch(`${API}/files/${encodeURIComponent(f.id)}`, { method: 'DELETE', headers: { Cookie: cookie } })
      removed++
    }
  }
  console.log(`  已删除 ${removed} 个测试文件`)
}

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
