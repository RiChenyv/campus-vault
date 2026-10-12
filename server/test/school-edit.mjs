/**
 * 在校信息「手动填写」的测试。
 *
 * 用户的要求：学号、专业等字段交给自己填。
 * 要点有三，缺一不可：
 *  ① 空块也要显示（否则用户找不到填写入口）
 *  ② 界面能填、能存、能持久（刷新后还在）
 *  ③ **与导入不冲突** —— 手填的值不能被一次导入覆盖掉
 *
 * 第 ③ 条最容易漏：两边都能写同一个字段，谁赢必须明确。
 */

import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

const API = 'http://127.0.0.1:5175/api'
const TMP = process.env.TEMP
const port = 9260
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (n, p, extra = '') => {
  results.push([n, p === true, extra])
  console.log(`${p === true ? 'PASS' : 'FAIL'}  ${n}${extra ? '  (' + extra + ')' : ''}`)
}

const db = new DatabaseSync('D:/MyWeb/server/data/vault.db')
const schoolOf = (userId) => {
  const r = db.prepare(
    'SELECT real_name, student_id, college, major, grade, class_name FROM profiles WHERE user_id = ?',
  ).get(userId)
  return r ?? {}
}

/* ── 先清空，从"什么都没填"开始 ── */
const USER = 1
const before = schoolOf(USER)
db.prepare(
  `UPDATE profiles SET real_name='', student_id='', college='', major='', grade='', class_name='', imported_at=NULL
    WHERE user_id = ?`,
).run(USER)
console.log('已清空账号 1 的在校信息，从零开始测')
console.log('')

/* ── 浏览器部分 ── */
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
  `--user-data-dir=${TMP}\\cv-edit`, '--window-size=1600,1200', '--remote-debugging-port=' + port, 'about:blank'],
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

/** React 受控输入：必须走原生 setter + input 事件 */
const fill = (label, value) => ev(`(function(){
  var el = document.querySelector('input[aria-label=${JSON.stringify(label)}]');
  if (!el) return 'no-input';
  var d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  d.set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`)

const openProfile = async () => {
  await ev(`(function(){
    var b = document.querySelector('[aria-label^="打开个人中心"]');
    if (b) b.click(); return 1 })()`)
  await sleep(1500)
}

await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(3000)
await ev(`fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ account:'admin', password:'Cv-Dev-Only-2026' }) }).then(r=>r.status)`)
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(4000)

/* ── ① 全空时也要显示，并且有编辑入口 ── */
console.log('=== ① 全空时的显示 ===')
await openProfile()
const blank = JSON.parse(await ev(`(function(){
  var t = document.body.innerText;
  return JSON.stringify({
    hasBlock: t.indexOf('在校信息') >= 0,
    hasEdit: !!document.querySelector('[aria-label="编辑在校信息"]'),
    showsUnset: t.indexOf('未填') >= 0,
  })
})()`))
console.log('  ', JSON.stringify(blank))
check('全空时**仍然显示**在校信息块（否则找不到填写入口）', blank.hasBlock === true)
check('有「编辑」按钮', blank.hasEdit === true)
check('空字段显示「未填」占位', blank.showsUnset === true)

/* ── ② 能填、能存 ── */
console.log('')
console.log('=== ② 填写并保存 ===')
await ev(`document.querySelector('[aria-label="编辑在校信息"]').click(); 1`)
await sleep(700)
for (const [k, v] of [
  ['姓名', '时晨翔'],
  ['学号', '2023010101'],
  ['学院', '计算机与网络空间安全学院'],
  ['专业', '计算机科学与技术'],
  ['年级', '2023'],
  ['班级', '计科2301'],
]) {
  const r = await fill(k, v)
  if (r !== 'ok') console.log(`  !! ${k}: ${r}`)
}
await sleep(300)
await ev(`document.querySelector('[aria-label="保存在校信息"]').click(); 1`)
await sleep(2200)

const saved = schoolOf(USER)
console.log('  数据库里:', JSON.stringify(saved))
check('姓名存进了服务端', saved.real_name === '时晨翔', String(saved.real_name))
check('学号存进了服务端', saved.student_id === '2023010101', String(saved.student_id))
check('学院存进了服务端', saved.college === '计算机与网络空间安全学院', String(saved.college))
check('专业存进了服务端', saved.major === '计算机科学与技术', String(saved.major))
check('年级存进了服务端', saved.grade === '2023', String(saved.grade))
check('班级存进了服务端', saved.class_name === '计科2301', String(saved.class_name))

/* ── ③ 刷新后仍在 ── */
console.log('')
console.log('=== ③ 刷新后是否还在 ===')
await send('Page.navigate', { url: 'http://127.0.0.1:5174/' })
await sleep(4000)
await openProfile()
const afterReload = await ev(`document.body.innerText`)
check('刷新后界面上仍有刚填的学号', String(afterReload).includes('2023010101'))
check('刷新后界面上仍有专业', String(afterReload).includes('计算机科学与技术'))

/* ── ④ 与导入不冲突：手填的值不能被导入覆盖 ── */
console.log('')
console.log('=== ④ 导入不能覆盖手填的内容 ===')
const cookie = (await (await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: 'admin', password: 'Cv-Dev-Only-2026' }),
})).headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')

const imp = await fetch(`${API}/import`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({
    source: 'school-info-conflict-test',
    dryRun: false,
    // 故意用不同的值，模拟"学校那边给的不一样"
    profile: { realName: '学校给的姓名', college: '学校给的学院' },
    courses: [],
  }),
}).then((r) => r.json())
console.log('  导入响应:', JSON.stringify(imp.data?.applied ?? imp.error))

const afterImport = schoolOf(USER)
console.log('  导入后:', JSON.stringify(afterImport))
check('**手填的姓名没有被导入覆盖**', afterImport.real_name === '时晨翔', String(afterImport.real_name))
check('**手填的学号没被清掉**', afterImport.student_id === '2023010101', String(afterImport.student_id))

/* ── ⑤ 空字段才由导入补上 ── */
console.log('')
console.log('=== ⑤ 空字段应当能被导入补上 ===')
db.prepare('UPDATE profiles SET grade = ? WHERE user_id = ?').run('', USER)
const imp2 = await fetch(`${API}/import`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({
    source: 'school-info-fill-test',
    dryRun: false,
    profile: { grade: '2024' },
    courses: [],
  }),
}).then((r) => r.json())
void imp2
const filled = schoolOf(USER)
check('空的「年级」被导入补上了', filled.grade === '2024', String(filled.grade))
check('已填的姓名依旧没被动', filled.real_name === '时晨翔', String(filled.real_name))

/* ── 清理：还原成测试前的样子 ── */
db.prepare(
  `UPDATE profiles SET real_name=?, student_id=?, college=?, major=?, grade=?, class_name=?
    WHERE user_id = ?`,
).run(
  before.real_name ?? '', before.student_id ?? '', before.college ?? '',
  before.major ?? '', before.grade ?? '', before.class_name ?? '', USER,
)
console.log('')
console.log('已还原账号 1 的在校信息')

db.close()
console.log('')
console.log('==================================================')
const fails = results.filter((r) => !r[1])
console.log(`  通过 ${results.length - fails.length} / ${results.length}`)
for (const [n, , extra] of fails) console.log(`   FAIL ${n}  ${extra}`)
console.log('==================================================')

ws.close(); proc.kill('SIGKILL')
process.exit(fails.length ? 1 : 0)
