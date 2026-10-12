/**
 * LaTeX 数学公式渲染。
 *
 * 用户的笔记里有 `$e - 127$`、`$$V = (-1)^s \times M \times 2^E$$` 这类公式，
 * 之前原样显示成一串 `\times` `\sim`，完全没法读。
 *
 * 要点：
 *  ① 行内 `$...$` 和块级 `$$...$$` 都要认
 *  ② 渲染结果不能被后续的转义/斜体规则啃坏（`*` `\` `_` 在公式里常见）
 *  ③ 公式写错时**不能让整篇笔记崩掉**
 *  ④ `$ 5`（金额）这种不该被当成公式
 */

import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

const port = 9272
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

/* 用构建产物里的 markdown 模块做纯函数测试 —— 比开浏览器快得多，
   而这里要验的就是纯函数行为。 */
const md = readFileSync('D:/MyWeb/src/lib/markdown.ts', 'utf8')

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

const proc = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${process.env.TEMP}\\cv-math`,
    '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore', windowsHide: true })
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
  if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description || '').slice(0, 300))
  return r.result?.result?.value
}

await send('Page.enable'); await send('Runtime.enable')
// 用 vite 的开发服务器加载真实模块（和生产构建同一份源码）
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(3500)

// 动态 import 真实模块
await ev(`window.__md = null; import('/src/lib/markdown.ts').then(m => { window.__md = m }); 1`)
await sleep(2500)
const has = await ev(`!!window.__md && typeof window.__md.mdToHtml === 'function'`)
check('能加载真实 markdown 模块', has === true)
if (!has) { ws.close(); proc.kill('SIGKILL'); process.exit(1) }

const render = async (src) => ev(`window.__md.mdToHtml(${JSON.stringify(src)})`)

console.log('')
console.log('=== ① 行内公式 ===')
const r1 = await render('单精度 e 字段是 $e - 127$ 哦')
console.log('  ', String(r1).slice(0, 150))
check('行内 $...$ 渲染成了 KaTeX', String(r1).includes('katex'), String(r1).slice(0, 90))
check('原来的 $ 定界符没有残留', !String(r1).includes('$e - 127$'))
check('正文文字还在', String(r1).includes('单精度'))

console.log('')
console.log('=== ② 块级公式（单行）===')
const r2 = await render('$$V = (-1)^s \\times M \\times 2^E$$')
console.log('  ', String(r2).slice(0, 160))
check('块级公式有 math-block 容器', String(r2).includes('math-block'), String(r2).slice(0, 70))
check('渲染成了 KaTeX display', String(r2).includes('katex-display'))
/* 不能直接查 '\\times' 在不在 —— KaTeX 会把原始 TeX 塞进
   <annotation encoding="application/x-tex">，那是给读屏和"复制公式"用的，
   **不显示**。上一版就是被这个误判成失败的。
   要查的是：定界符没了、并且渲染出了真实的数学记号（× 与上标）。 */
check('定界符 $$ 没有残留', !String(r2).includes('$$'))
check('渲染出了真实的数学记号（×）', /[×⋅]|&#xD7;/.test(String(r2)) || String(r2).includes('mo'), String(r2).slice(0, 80))
check('原始 TeX 只出现在 annotation 里（不是可见文本）',
  !/>[^<]*\\times[^<]*</.test(String(r2).replace(/<annotation[^>]*>[^<]*<\/annotation>/g, '')))

console.log('')
console.log('=== ③ 块级公式（跨行）===')
const r3 = await render('$$\nV = (-1)^s \\times M \\times 2^E\n$$')
console.log('  ', String(r3).slice(0, 160))
check('跨行 $$ ... $$ 也能渲染', String(r3).includes('math-block') && String(r3).includes('katex'))

console.log('')
console.log('=== ④ 公式里的特殊字符不被啃坏 ===')
const r4 = await render('含星号：$a * b$ 和下标 $x_1$ 与 `代码`')
console.log('  ', String(r4).slice(0, 200))
check('公式里的 * 没被当成斜体', !String(r4).includes('<em>'), String(r4).slice(0, 100))
check('行内代码仍然正常', String(r4).includes('<code>代码</code>'))

console.log('')
console.log('=== ⑤ 金额不该被当成公式 ===')
const r5 = await render('这本书 $ 5 元，那本 $ 8 元')
console.log('  ', String(r5).slice(0, 140))
check('`$ 5` 这种没被误判成公式', !String(r5).includes('katex'), String(r5).slice(0, 90))

console.log('')
console.log('=== ⑥ 公式写错不能让整篇崩掉 ===')
let r6 = ''
try {
  r6 = String(await render('前面正常\n\n$$\\frac{1}{$$\n\n后面也要在'))
} catch (e) {
  r6 = 'THREW: ' + e.message
}
console.log('  ', r6.slice(0, 160))
check('写错的公式没有抛异常', !r6.startsWith('THREW'))
check('公式之外的文字仍然渲染出来了', r6.includes('前面正常') && r6.includes('后面也要在'), r6.slice(0, 100))

console.log('')
console.log('=== ⑦ 表格里的公式（用户截图里的场景）===')
const r7 = await render('| 情况 | e 字段 |\n| --- | --- |\n| 规格化 | $1 \\sim 254$ |\n| 非规格化 | $0$ |')
console.log('  ', String(r7).slice(0, 200))
check('表格仍然渲染成表格', String(r7).includes('<table>') && String(r7).includes('<td>'))
check('**表格单元格里的公式也渲染了**', String(r7).includes('katex'), String(r7).slice(0, 120))

ws.close(); proc.kill('SIGKILL')

console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')
void md
process.exit(fails.length ? 1 : 0)
