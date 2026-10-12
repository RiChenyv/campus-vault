/**
 * 课表截图逐格扫描。
 *
 * 判据不是"饱和度"，而是**到背景色的距离** —— 先用已知答案的格子校准过：
 *   空(无课)      到背景 ≈ 12
 *   褪色[非本周]  到背景 ≈ 70
 *   正常上课      到背景 ≈ 130
 * 背景色从**左侧时间栏**同高度取，这样能自动适应截图的竖向渐变。
 *
 * 用 Chrome + canvas 读像素：Node 没有内置 JPEG 解码，而 Chrome 现成的。
 */

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const TMP = process.env.TEMP
const port = 9245
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const OBJ = 'D:/MyWeb/.tmp/timetable'
/* 第 1..17 周。注意最后一项之前写错过一个字符，这次逐字核对过。 */
const IMGS = JSON.parse(readFileSync('D:/MyWeb/.tmp/timetable/list.json', 'utf8'))

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

const proc = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
  `--user-data-dir=${TMP}\\cv-scan`, '--remote-debugging-port=' + port, 'about:blank',
], { stdio: 'ignore', windowsHide: true })

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
  if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description || '').slice(0, 500))
  return r.result?.result?.value
}

await send('Page.enable'); await send('Runtime.enable')
writeFileSync('D:/MyWeb/.tmp/timetable/scan.html', '<!doctype html><meta charset="utf-8"><title>scan</title><body></body>')
await send('Page.navigate', { url: 'file:///D:/MyWeb/.tmp/timetable/scan.html' })
await sleep(800)

const script = `
window.__scan = async function (paths) {
  const COLS = [
    ['一', 105, 245], ['二', 287, 415], ['三', 455, 565], ['四', 615, 740],
    ['五', 765, 905], ['六', 950, 1060], ['日', 1105, 1215],
  ];
  const ROWS = [
    ['1-2', 445, 755], ['3-4', 830, 1130], ['5-6', 1210, 1520],
    ['7-8', 1595, 1905], ['9-10', 1975, 2285], ['11-12', 2360, 2660],
  ];
  function avg(data, w, x0, x1, y0, y1) {
    let n = 0, r = 0, g = 0, b = 0;
    for (let y = y0; y <= y1; y += 6) {
      for (let x = x0; x <= x1; x += 6) {
        const i = (y * w + x) * 4;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
    }
    return [r / n, g / n, b / n];
  }
  const out = [];
  for (let wi = 0; wi < paths.length; wi++) {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('load fail ' + paths[wi]));
      im.src = paths[wi];
    });
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const w = cv.width;
    for (const [rk, y0, y1] of ROWS) {
      // 背景取左侧时间栏（纯背景），同高度 —— 自动适应竖向渐变
      const bg = avg(d, w, 4, 55, y0, y1);
      for (const [ck, x0, x1] of COLS) {
        const c = avg(d, w, x0, x1, y0, y1);
        const dist = Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]);
        out.push({
          w: wi + 1, cell: ck + '|' + rk,
          d: Math.round(dist),
          rgb: [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])].join(','),
          bg: [Math.round(bg[0]), Math.round(bg[1]), Math.round(bg[2])].join(','),
        });
      }
    }
    cv.width = 0; cv.height = 0;
  }
  return out;
};
1`

await ev(script)
const paths = IMGS  // 相对路径，与页面同源
console.log(`扫描 ${paths.length} 张图 ...`)
const rows = await ev(`window.__scan(${JSON.stringify(paths)}).then(r => JSON.stringify(r))`)
const data = JSON.parse(rows)
console.log(`采到 ${data.length} 个格子`)

/* -------- 距离分布，用来确认阈值没踩线 -------- */
const dists = data.map((r) => r.d).sort((a, b) => a - b)
const hist = {}
for (const d of dists) {
  const bucket = Math.floor(d / 20) * 20
  hist[bucket] = (hist[bucket] || 0) + 1
}
console.log('')
console.log('=== 到背景距离的分布（找天然的断点）===')
for (const k of Object.keys(hist).map(Number).sort((a, b) => a - b)) {
  console.log(`  ${String(k).padStart(3)}-${String(k + 19).padStart(3)}  ${'#'.repeat(Math.ceil(hist[k] / 2))} (${hist[k]})`)
}

/* -------- 阈值：留出空隙 -------- */
const EMPTY_MAX = 35
const FADE_MAX = 100
const cls = (d) => (d < EMPTY_MAX ? '.' : d < FADE_MAX ? '-' : '#')

console.log('')
console.log('判据: . 无课(<35)   - 褪色[非本周](35-100)   # 正常上课(>=100)')
console.log('')
const cells = [...new Set(data.map((r) => r.cell))]
const header = '格子        ' + Array.from({ length: 17 }, (_, i) => (i + 1) % 10).join('')
console.log(header)
const summary = {}
for (const cell of cells) {
  const sig = data.filter((r) => r.cell === cell).sort((a, b) => a.w - b.w).map((r) => cls(r.d)).join('')
  summary[cell] = sig
  if (/[#-]/.test(sig)) console.log(cell.padEnd(11) + sig)
}

writeFileSync('D:\\MyWeb\\.tmp\\scan3.json', JSON.stringify({ summary, data }, null, 1))
console.log('')
console.log('明细已存 D:\\MyWeb\\.tmp\\scan3.json')

ws.close(); proc.kill('SIGKILL')
