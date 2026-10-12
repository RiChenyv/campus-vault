/**
 * 课表截图逐格分类（第二版）。
 *
 * ── 为什么不用"到背景距离"或"饱和度" ──
 * 试过，都会误判。反例：
 *   示例课程甲(紫) 正常色 RGB(179,148,244)  到背景 60
 *   通识示例课程三   褪色色 RGB(216,165,187)  到背景 60
 * 距离一样，但前者是正常课、后者是 [非本周]。饱和度同理：
 *   示例课程乙 褪色(140,177,241) S=0.42  >  示例课程甲 正常(179,148,244) S=0.39
 * 跨课程用单一阈值必然失败。
 *
 * ── 现在的判据 ──
 * 同一个格子在 17 周里有多个颜色。褪色 = 本色向背景色做 alpha 混合，
 * 所以它**落在「背景 → 本色」这条直线上**；而"换了另一门课"不会落在这条线上。
 *   · 取该格子中离背景最远的颜色作为本色 F
 *   · 对每个颜色 C，算它到直线 BG→F 的**垂直距离**
 *   · 垂直距离小 → 是混合 → 褪色；垂直距离大 → 换课了 → 正常
 * 这样"浅色课程"和"褪色"就不会再混淆。
 */

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const TMP = process.env.TEMP
const port = 9246
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DIR = 'D:/MyWeb/.tmp/timetable'
const IMGS = JSON.parse(readFileSync(`${DIR}/list.json`, 'utf8'))

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
  `--user-data-dir=${TMP}\\cv-scan2`, '--remote-debugging-port=' + port, 'about:blank',
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
writeFileSync(`${DIR}/scan.html`, '<!doctype html><meta charset="utf-8"><title>scan</title><body></body>')
await send('Page.navigate', { url: 'file:///' + DIR + '/scan.html' })
await sleep(800)

await ev(`
window.__grab = async function (paths) {
  const COLS = [
    ['一', 105, 245], ['二', 287, 415], ['三', 455, 565], ['四', 615, 740],
    ['五', 765, 905], ['六', 950, 1060], ['日', 1105, 1215],
  ];
  const ROWS = [
    ['1-2', 445, 755], ['3-4', 830, 1130], ['5-6', 1210, 1520],
    ['7-8', 1595, 1905], ['9-10', 1975, 2285], ['11-12', 2360, 2660],
  ];
  function avg(d, w, x0, x1, y0, y1) {
    let n = 0, r = 0, g = 0, b = 0;
    for (let y = y0; y <= y1; y += 5) for (let x = x0; x <= x1; x += 5) {
      const i = (y * w + x) * 4; r += d[i]; g += d[i+1]; b += d[i+2]; n++;
    }
    return [r/n, g/n, b/n];
  }
  const out = [];
  for (let wi = 0; wi < paths.length; wi++) {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im); im.onerror = () => rej(new Error('load ' + paths[wi]));
      im.src = paths[wi];
    });
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    for (const [rk, y0, y1] of ROWS) {
      const bg = avg(d, cv.width, 4, 55, y0, y1);
      for (const [ck, x0, x1] of COLS) {
        out.push({ w: wi+1, cell: ck+'|'+rk, c: avg(d, cv.width, x0, x1, y0, y1), bg });
      }
    }
    cv.width = 0; cv.height = 0;
  }
  return out;
}; 1`)

const rows = JSON.parse(await ev(`window.__grab(${JSON.stringify(IMGS)}).then(r => JSON.stringify(r))`))

/* ---------- 按格子分组，做垂直距离判定 ---------- */
const byCell = new Map()
for (const r of rows) {
  if (!byCell.has(r.cell)) byCell.set(r.cell, [])
  byCell.get(r.cell).push(r)
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const len = (v) => Math.hypot(v[0], v[1], v[2])
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const result = {}
const detail = []
for (const [cell, list] of byCell) {
  list.sort((a, b) => a.w - b.w)
  // 本色 = 离背景最远的那个
  let F = null, fmax = -1
  for (const it of list) {
    const dist = len(sub(it.c, it.bg))
    if (dist > fmax) { fmax = dist; F = it }
  }
  // 背景色取该格子各周的中位数（各周略有差异）
  const bgAvg = [0, 1, 2].map((k) => list.reduce((s, x) => s + x.bg[k], 0) / list.length)
  const dirv = sub(F.c, bgAvg)
  const dirLen2 = dot(dirv, dirv)

  const sig = []
  for (const it of list) {
    const v = sub(it.c, bgAvg)
    const distBG = len(v)
    let cls
    if (distBG < 30) {
      cls = '.'                      // 基本等于背景 → 无课
    } else if (dirLen2 < 1) {
      cls = '#'
    } else {
      const alpha = dot(v, dirv) / dirLen2
      // 投影点，算垂直（残差）分量
      const proj = dirv.map((x) => x * alpha)
      const perp = len(sub(v, proj))
      if (perp < 12 && alpha < 0.78) cls = '-'   // 在混合直线上且更淡 → 褪色
      else cls = '#'                              // 换课了，或就是本色
    }
    sig.push(cls)
    detail.push({ cell, w: it.w, cls, rgb: it.c.map((x) => Math.round(x)).join(','), d: Math.round(distBG) })
  }
  result[cell] = sig.join('')
}

console.log('判据: . 无课   - 褪色[非本周]   # 正常上课（含"换了另一门课"）')
console.log('列 = 第 1 .. 17 周')
console.log('')
console.log('格子        ' + Array.from({ length: 17 }, (_, i) => (i + 1) % 10).join(''))
for (const cell of [...byCell.keys()]) {
  const s = result[cell]
  if (/[#-]/.test(s)) console.log(cell.padEnd(11) + s)
}

/* ---------- 自检：拿我肉眼核对过的格子验判据 ---------- */
console.log('')
console.log('=== 自检（这几格我逐张图看过）===')
const checks = [
  ['四|5-6', 'W1-9 褪色, W10-17 正常', (s) => s.slice(0, 9) === '---------' && s.slice(9) === '########'],
  ['五|1-2', '奇数周正常(单周课)', (s) => s === '#-#-#-#-#-#-#-#-#'],
  ['一|3-4', 'W1-9 紫色正常, W10-17 换成粉色课(都正常)', (s) => s === '#########' + '########'],
  ['六|1-2', '17 周全正常', (s) => s === '#################'],
]
let ok = 0
for (const [cell, desc, test] of checks) {
  const s = result[cell] ?? ''
  const pass = test(s)
  if (pass) ok++
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${cell}  ${desc}`)
  if (!pass) console.log(`        实际: ${s}`)
}
console.log(`  自检 ${ok}/${checks.length}`)

writeFileSync('D:\\MyWeb\\.tmp\\scan4.json', JSON.stringify({ result, detail }, null, 1))
console.log('')
console.log('已存 D:\\MyWeb\\.tmp\\scan4.json')

ws.close(); proc.kill('SIGKILL')
