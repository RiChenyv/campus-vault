/**
 * 课表 xlsx 导入的接口端到端测试。
 *
 * 自己起一个**独立端口 + 独立数据目录**的后端，不碰正式数据。
 * 覆盖：
 *   ① 上传即预览（dryRun 默认 true）—— 不写库
 *   ② 确认导入 —— 课程与时间段落库
 *   ③ **合并到已有课程**：库里已有一门学期写法不同的同名课程时，
 *      不能再新建一条（否则用户会看到两门一样的课，一门有课表一门没有）
 *   ④ 再导一次：更新而不是翻倍（幂等）
 *   ⑤ **撤销**：恢复到导入前，且用**会话令牌**（Authorization）也能撤
 *      —— 这是本轮修掉的一个真 bug（撤销接口原来只认 cookie，
 *      多标签页登录不同账号时会撤掉别人的导入）
 */

import { spawn } from 'node:child_process'
import { rm, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTimetableXlsx, TT_ROWS } from './lib-xlsx-fixture.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER = resolve(HERE, '..')
const DATA_DIR = resolve(SERVER, '..', '.tmp', 'data-test-timetable')
/* 5180 是 `.tmp/vite.test.config.mts` 里代理的目标端口 —— 界面那段要用它 */
const PORT = 5180
const BASE = `http://127.0.0.1:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; failures.push(`${name}  ${extra}`); console.log(`FAIL  ${name}${extra ? '  (' + extra + ')' : ''}`) }
}
const section = (t) => { console.log(''); console.log(`--- ${t} ---`) }

/* ---------------------------- 起独立后端 ---------------------------- */
await rm(DATA_DIR, { recursive: true, force: true })
await mkdir(DATA_DIR, { recursive: true })
console.log(`[test] 数据目录 ${DATA_DIR}`)

const child = spawn(process.execPath, ['src/index.ts'], {
  cwd: SERVER,
  env: { ...process.env, PORT: String(PORT), DATA_DIR, TMP: process.env.TMP, TEMP: process.env.TEMP },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
child.stdout.on('data', (d) => { serverLog += d.toString() })
child.stderr.on('data', (d) => { serverLog += d.toString() })
const stop = () => { if (!child.killed) child.kill('SIGKILL') }

let up = false
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) { up = true; break } } catch { /* retry */ }
  await sleep(250)
}
if (!up) { console.error('[test] 服务没起来：\n' + serverLog); stop(); process.exit(1) }
console.log(`[test] 服务已就绪 ${BASE}`)

/* ---------------------------- 会话 ---------------------------- */
let cookie = ''
let sessionToken = ''
const j = async (r) => { try { return await r.json() } catch { return null } }
const req = async (method, path, body, opts = {}) => {
  const headers = {}
  if (cookie) headers.Cookie = cookie
  if (sessionToken && !opts.noAuthHeader) headers.Authorization = `Bearer ${sessionToken}`
  let payload
  if (opts.form) payload = opts.form
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
  const r = await fetch(`${BASE}${path}`, { method, headers: { ...headers, ...(opts.headers ?? {}) }, body: payload })
  const setC = r.headers.getSetCookie?.() ?? []
  if (setC.length && !opts.keepCookie) cookie = setC.map((c) => c.split(';')[0]).join('; ')
  return { status: r.status, body: await j(r) }
}

const login = await req('POST', '/api/auth/login', { account: 'admin', password: 'Cv-Dev-Only-2026' })
check('登录成功（空库会自动播种管理员）', login.status === 200, JSON.stringify(login.body))
sessionToken = login.body?.data?.sessionToken ?? ''
check('登录返回了会话令牌（用于验证"只带令牌也能撤销"）', !!sessionToken)

const post = (p, b) => req('POST', p, b)
const get = (p) => req('GET', p)

/** 造一份课表 xlsx 的 FormData */
const xlsxForm = (apply) => {
  const form = new FormData()
  const buf = makeTimetableXlsx()
  form.append('files', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'timeTableForStu12.xlsx')
  if (apply) form.append('dryRun', 'false')
  return form
}
const slotsOf = async () => {
  const r = await get('/api/schedule')
  return r.body?.data?.slots ?? []
}
const coursesOf = async () => {
  const r = await get('/api/courses')
  return r.body?.data?.courses ?? []
}

/* ---------------------------- ① 先放一门"学期写法不同"的同名课程 ---------------------------- */
section('① 库里已有一门学期写法不同的同名课程（模拟以前用 ICS 导过）')
const pre = await post('/api/courses', {
  name: '专业示例课程一[01]',
  code: '2121030179',
  term: '2026-09-07',
  credit: 3,
  teacher: '戊老师',
})
check('预置课程创建成功', pre.status === 200, JSON.stringify(pre.body?.error))
const preId = pre.body?.data?.course?.id
check('预置课程有 id', preId != null && preId !== '', String(preId))

/* ---------------------------- ② 上传即预览 ---------------------------- */
section('② 上传即预览（dryRun 默认 true，不写库）')
const preview = await req('POST', '/api/import/timetable-xlsx', undefined, { form: xlsxForm(false) })
check('预览接口 200', preview.status === 200, JSON.stringify(preview.body?.error))
const pd = preview.body?.data
check('识别出 5 门课 / 6 个时间段', pd?.courses === 5 && pd?.slots === 6, `courses=${pd?.courses} slots=${pd?.slots}`)
check('学期归一化为 2026-2027第1学期', pd?.term === '2026-2027第1学期', String(pd?.term))
check('跨行重复报了数（2 条）', pd?.deduped === 2, String(pd?.deduped))
check('读不懂的格子报了数（1 格）', (pd?.badCells ?? []).length === 1, JSON.stringify(pd?.badCells))
check('预览里没写库：课程表还是只有那 1 门', (await coursesOf()).length === 1, String((await coursesOf()).length))
check('预览里没写库：时间段还是 0 条', (await slotsOf()).length === 0, String((await slotsOf()).length))
check('预览带了逐门预览（供界面显示）', (pd?.preview ?? []).length === 5, String((pd?.preview ?? []).length))

/* ---------------------------- ③ 确认导入（合并） ---------------------------- */
section('③ 确认导入 —— 同名课程必须**合并**、不能新建')
const apply1 = await req('POST', '/api/import/timetable-xlsx', undefined, { form: xlsxForm(true) })
check('导入接口 200', apply1.status === 200, JSON.stringify(apply1.body?.error))
const a1 = apply1.body?.data
check('时间段写入 6 条', a1?.applied?.slots === 6, JSON.stringify(a1?.applied))

const courses1 = await coursesOf()
check('课程仍然是 5 门（没有为同名课多建一条）', courses1.length === 5, `${courses1.length}：` + courses1.map((c) => c.name).join(' / '))
check('同名课程只有一条',
  courses1.filter((c) => c.name === '专业示例课程一[01]').length === 1,
  JSON.stringify(courses1.filter((c) => /网络空间/.test(c.name)).map((c) => c.name + '@' + c.term)))
const kept = courses1.find((c) => c.name === '专业示例课程一[01]')
check('合并到的是**已有那一条**（学期没有被改写）', kept?.term === '2026-09-07', String(kept?.term))

const slots1 = await slotsOf()
check('时间段一共 6 条', slots1.length === 6, String(slots1.length))
check('合并进来的课也拿到了时间段（网络空间安全 1 条）',
  slots1.filter((s) => String(s.course_name ?? '').includes('专业示例课程一')).length === 1,
  JSON.stringify(slots1.map((s) => s.course_name)))
check('单双周两个教室都写进去了',
  slots1.filter((s) => String(s.course_name ?? '').includes('通识示例课程二')).length === 2,
  String(slots1.filter((s) => String(s.course_name ?? '').includes('通识示例课程二')).length))

/* ---------------------------- ④ 再导一次：更新不翻倍 ---------------------------- */
section('④ 再导一次（幂等）')
const apply2 = await req('POST', '/api/import/timetable-xlsx', undefined, { form: xlsxForm(true) })
const a2 = apply2.body?.data
check('第二次：新增 0 门、更新 5 门', a2?.applied?.created === 0 && a2?.applied?.updated === 5,
  JSON.stringify(a2?.applied))
check('第二次：时间段仍是 6 条（没有翻倍）', (await slotsOf()).length === 6, String((await slotsOf()).length))
check('第二次：课程仍是 5 门', (await coursesOf()).length === 5, String((await coursesOf()).length))

/* ---------------------------- ⑤ 撤销 ----------------------------
   语义：撤销的是**最近一次**带快照的导入（恢复到那次导入之前）。
   这里导了两次，所以要连撤两次才回到最初 —— 断言按这个语义走。 */
section('⑤ 撤销（连撤两次才回到最初）')
const undo1 = await post('/api/import/undo', {})
check('第一次撤销 200', undo1.status === 200, JSON.stringify(undo1.body?.error))
check('第一次撤销回到「上一次导入之前」——那时已经有 5 门课 / 6 条时间段',
  (await coursesOf()).length === 5 && (await slotsOf()).length === 6,
  `${(await coursesOf()).length} 门 / ${(await slotsOf()).length} 条`)

const undo2 = await post('/api/import/undo', {})
check('第二次撤销 200', undo2.status === 200, JSON.stringify(undo2.body?.error))
check('第二次撤销回到最初：时间段 0 条', (await slotsOf()).length === 0, String((await slotsOf()).length))
check('第二次撤销回到最初：课程只剩预置的 1 门', (await coursesOf()).length === 1, String((await coursesOf()).length))

const undo3 = await post('/api/import/undo', {})
check('没得撤时明确报错（不是假装成功）', undo3.status === 400 && /没有可撤销/.test(undo3.body?.error?.message ?? ''),
  `${undo3.status} ${undo3.body?.error?.message}`)

section('⑤b 只带会话令牌（不带 cookie）也能撤销 —— 本轮修的坑')
/* 关键：makeImportAuth 刻意不看 Authorization，而本站是"按标签页独立会话"。
   第二个标签页登录了别的账号时，只认 cookie 的接口会去操作**那个账号**的数据。 */
const importByCookie = await req('POST', '/api/import/timetable-xlsx', undefined, { form: xlsxForm(true), noAuthHeader: true })
check('先用 cookie 导一次（不带 Authorization）', importByCookie.status === 200, JSON.stringify(importByCookie.body?.error))
check('导入后 5 门课 / 6 条时间段', (await coursesOf()).length === 5 && (await slotsOf()).length === 6,
  `${(await coursesOf()).length} 门 / ${(await slotsOf()).length} 条`)

const onlyToken = await fetch(`${BASE}/api/import/undo`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
  /* 故意不带 Cookie */
})
const onlyTokenBody = await onlyToken.json().catch(() => null)
check('只带 Authorization、不带 Cookie 时撤销成功（原来会 401）', onlyToken.status === 200,
  `status=${onlyToken.status} ${JSON.stringify(onlyTokenBody?.error)}`)
check('撤销确实生效（回到最初的 1 门 / 0 条）',
  (await coursesOf()).length === 1 && (await slotsOf()).length === 0,
  `${(await coursesOf()).length} 门 / ${(await slotsOf()).length} 条`)

/* ---------------------------- 错误路径 ---------------------------- */
section('错误路径：给人话，不是 500')
const notXlsx = await req('POST', '/api/import/timetable-xlsx', undefined, {
  form: (() => { const f = new FormData(); f.append('files', new Blob(['hello'], { type: 'text/plain' }), 'a.txt'); return f })(),
})
check('传非 xlsx → 400 且说明原因', notXlsx.status === 400 && /xlsx/.test(notXlsx.body?.error?.message ?? ''),
  `${notXlsx.status} ${notXlsx.body?.error?.message}`)

const noFile = await req('POST', '/api/import/timetable-xlsx', undefined, { form: new FormData() })
check('没传文件 → 400 且说明去哪儿导出', noFile.status === 400 && /导出/.test(noFile.body?.error?.message ?? ''),
  `${noFile.status} ${noFile.body?.error?.message}`)

const gradesXlsxOnTimetable = await req('POST', '/api/import/timetable-xlsx', undefined, {
  form: (() => { const f = new FormData(); f.append('files', new Blob([makeTimetableXlsx([['随便一个表格'], ['没有星期表头']])], { type: 'application/octet-stream' }), 'x.xlsx'); return f })(),
})
check('表格里没有课表结构 → 400 且报错是中文原因（不是 500）',
  gradesXlsxOnTimetable.status === 400 && /标题|星期/.test(gradesXlsxOnTimetable.body?.error?.message ?? ''),
  `${gradesXlsxOnTimetable.status} ${String(gradesXlsxOnTimetable.body?.error?.message).slice(0, 80)}`)

/* ---------------------------- 共用落库的行为细节 ----------------------------
   三条路（WakeUp / ICS / 课表 xlsx）现在共用 writeTimetableImport。
   重构时特意保留了原来各自的两个细微行为，这里直接对着函数验，
   免得只有"xlsx 那条路"被测到、另两条的差异悄悄变了：

     · WakeUp 不带教师 → **不能**把已有课程的教师冲成空串
       （原来是 `teacher = excluded.teacher` 只在 ICS 那条路才有，
         合并成一份后必须写成 CASE WHEN）
     · ICS 给的是钟点不是节次 → from/span 存 0 必须原样落库 */
section('共用落库：WakeUp / ICS 的差异没被改坏')
{
  const { openDb } = await import('../src/db.ts')
  const { writeTimetableImport } = await import('../src/lib/timetableImport.ts')
  const scratch = resolve(SERVER, '..', '.tmp', 'data-test-writer', 'vault.db')
  await rm(resolve(SERVER, '..', '.tmp', 'data-test-writer'), { recursive: true, force: true })
  await mkdir(resolve(SERVER, '..', '.tmp', 'data-test-writer'), { recursive: true })
  const db = openDb(scratch)
  const owner = db.prepare('INSERT INTO users (account, password_hash, is_admin, created_at) VALUES (?,?,0,?) RETURNING id').get('writertest', 'x', Date.now()).id

  /* ① WakeUp 风格：教师为空 → 已有教师必须保留 */
  writeTimetableImport(db, owner, [
    { code: '', name: '基础示例课程二', teacher: '子老师', term: 'T', room: 'R1', slots: [{ day: 3, from: 3, span: 2, room: 'R1', weeks: '1-17周' }] },
  ], 'test-wakeup', () => 'first')
  const t1 = db.prepare('SELECT teacher FROM courses WHERE owner_id = ?').get(owner).teacher
  writeTimetableImport(db, owner, [
    { code: '', name: '基础示例课程二', teacher: '', term: 'T', room: 'R2', slots: [{ day: 3, from: 3, span: 2, room: 'R2', weeks: '1-17周' }] },
  ], 'test-wakeup', () => 'second')
  const after = db.prepare('SELECT teacher, room FROM courses WHERE owner_id = ?').get(owner)
  check('WakeUp 不带教师时，已有教师**不被冲掉**', after.teacher === '子老师' && t1 === '子老师', String(after.teacher))
  check('同一门课的时间段是"先删后插"（没有翻倍）',
    db.prepare('SELECT COUNT(*) n FROM schedule_slots WHERE owner_id = ?').get(owner).n === 1,
    String(db.prepare('SELECT COUNT(*) n FROM schedule_slots WHERE owner_id = ?').get(owner).n))
  check('教室按新文件更新', after.room === 'R2', String(after.room))

  /* ② ICS 风格：from/span = 0 表示"按钟点而非节次"，要原样落库 */
  writeTimetableImport(db, owner, [
    { code: '', name: 'ICS课', teacher: 'T', term: '2026-09-07', room: 'R', slots: [{ day: 1, from: 0, span: 0, room: 'R', weeks: '每周' }] },
  ], 'test-ics', () => 'ics')
  const ics = db.prepare(
    `SELECT s.from_slot, s.span, s.weeks FROM schedule_slots s JOIN courses c ON c.id = s.course_id
      WHERE s.owner_id = ? AND c.name = 'ICS课'`,
  ).get(owner)
  check('ICS 的 from/span 存 0 原样落库', ics?.from_slot === 0 && ics?.span === 0 && ics?.weeks === '每周', JSON.stringify(ics))

  /* ③ 导入历史里记了来源，撤销才有依据 */
  check('写了两条导入历史（可撤销的凭据）',
    db.prepare('SELECT COUNT(*) n FROM import_log WHERE owner_id = ?').get(owner).n === 3,
    String(db.prepare('SELECT COUNT(*) n FROM import_log WHERE owner_id = ?').get(owner).n))
  db.close()
}

/* ---------------------------- 界面（可选） ----------------------------
   设了 CV_TEST_APP 才跑：那个前端必须把 /api 代理到本测试后端（PORT 5180）。
   照 grades-xlsx-api.mjs 的约定 —— 没验到界面时明确写出来，
   不能让人误以为"验过了"。 */
const APP = process.env.CV_TEST_APP ?? ''
if (!APP) {
  console.log('')
  console.log('SKIP  没设 CV_TEST_APP，界面那一段没验 —— **不是通过**。')
  console.log('      要验界面：起一个把 /api 代理到 5180 的前端，再带 CV_TEST_APP 跑一遍')
  console.log('      （仓库里现成的：node node_modules/vite/bin/vite.js --config .tmp/vite.test.config.mts）')
} else {
  section('界面：在导入页真的传一份课表 xlsx')
  const { writeFileSync } = await import('node:fs')
  const { spawn: spawnChrome } = await import('node:child_process')
  const xlsxPath = resolve(SERVER, '..', '.tmp', 'tt-fixture.xlsx')
  writeFileSync(xlsxPath, makeTimetableXlsx())
  const cdpPort = 9338
  const profile = resolve(SERVER, '..', '.tmp', 'cv-ttui')
  await rm(profile, { recursive: true, force: true })
  await mkdir(profile, { recursive: true })
  const chrome = spawnChrome('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1600,1100',
      `--user-data-dir=${profile}`, '--remote-debugging-port=' + cdpPort, 'about:blank'],
    { stdio: 'ignore', windowsHide: true })

  let wsUrl = ''
  for (let i = 0; i < 60; i++) {
    try {
      const l = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((r) => r.json())
      const p = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (p) { wsUrl = p.webSocketDebuggerUrl; break }
    } catch { /* retry */ }
    await sleep(250)
  }
  const ws2 = new WebSocket(wsUrl)
  await new Promise((r) => ws2.addEventListener('open', r, { once: true }))
  let cid = 0
  const pend = new Map()
  const excs = []
  ws2.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
    if (m.method === 'Runtime.exceptionThrown') excs.push(String(m.params?.exceptionDetails?.exception?.description ?? '').slice(0, 160))
  })
  const send2 = (method, params = {}) => new Promise((res) => { const i = ++cid; pend.set(i, res); ws2.send(JSON.stringify({ id: i, method, params })) })
  const ev2 = async (expr) => {
    const r = await send2('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) return 'EVALERR ' + String(r.result.exceptionDetails.exception?.description || '').slice(0, 200)
    return r.result?.result?.value
  }
  const clickText = (t) => ev2(`(function(){
    var b = Array.prototype.slice.call(document.querySelectorAll('button')).find(function(e){ return (e.textContent||'').indexOf(${JSON.stringify(t)}) >= 0 });
    if (b) { b.click(); return true } return false })()`)

  await send2('Page.enable'); await send2('Runtime.enable'); await send2('DOM.enable')
  await send2('Page.navigate', { url: APP })
  await sleep(2500)
  await ev2(`fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ account:'admin', password:'Cv-Dev-Only-2026' }) }).then(r=>r.status)`)
  await send2('Page.navigate', { url: APP })
  await sleep(4500)

  check('进到「我的课程」', await clickText('我的课程'))
  await sleep(1500)
  check('点开导入入口', await clickText('导入课程'))
  await sleep(1500)
  check('切到「上传文件」那一栏', await clickText('上传文件'))
  await sleep(1200)

  const doc = await send2('DOM.getDocument', { depth: -1 })
  const node = await send2('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: 'input[accept*=".ics"]' })
  check('找到课表文件输入框', !!node.result?.nodeId)
  await send2('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [xlsxPath] })
  await sleep(1200)

  let body = String(await ev2(`document.body.innerText`))
  check('界面认出是教务课表表格', /识别为\s*教务课表表格/.test(body), (body.match(/识别为[^\n]*/) ?? [''])[0])
  check('文件名显示出来了', /tt-fixture\.xlsx/.test(body), (body.match(/\S*tt-fixture\.xlsx/) ?? [''])[0])

  check('点「预览会导入什么」', await clickText('预览会导入什么'))
  await sleep(1800)
  body = String(await ev2(`document.body.innerText`))
  check('预览显示 课程 5 门 · 时间段 6 条', /课程\s*5\s*门/.test(body) && /时间段\s*6\s*条/.test(body),
    (body.match(/课程[^\n]*时间段[^\n]*/) ?? [''])[0])
  check('预览显示归一化后的学期', /2026-2027第1学期/.test(body), (body.match(/学期[^\n]*/) ?? [''])[0])
  check('预览提示了跨行重复去重', /重复出现/.test(body), (body.match(/[^\n]*重复出现[^\n]*/) ?? [''])[0])
  check('预览提示有格子没读懂', /没读懂/.test(body), (body.match(/[^\n]*没读懂[^\n]*/) ?? [''])[0])
  check('预览里列出了逐门课程', /专业示例课程一\[01\]/.test(body))

  check('点「确认导入」', await clickText('确认导入'))
  await sleep(2500)
  body = String(await ev2(`document.body.innerText`))
  check('界面提示导入完成', /导入完成/.test(body), (body.match(/导入完成[^\n]*/) ?? [''])[0])

  const coursesUi = await coursesOf()
  const slotsUi = await slotsOf()
  check('服务端真的写进去了：5 门课', coursesUi.length === 5, `${coursesUi.length}：` + coursesUi.map((c) => c.name).join(' / '))
  check('服务端真的写进去了：6 条时间段', slotsUi.length === 6, String(slotsUi.length))
  check('页面没有未捕获异常', excs.length === 0, excs.join(' | '))

  try { ws2.close() } catch { /* ignore */ }
  chrome.kill('SIGKILL')
}

/* ---------------------------- 收尾 ---------------------------- */
stop()
await sleep(400)
console.log('')
console.log('==================================================')
console.log(`  通过 ${pass} / ${pass + fail}${fail ? `（失败 ${fail}）` : ''}`)
console.log('==================================================')
if (fail) {
  for (const f of failures) console.log('  FAIL ' + f)
  console.log('')
  console.log('[test] 服务端日志：')
  console.log(serverLog.split('\n').slice(-25).join('\n'))
}
process.exit(fail ? 1 : 0)
