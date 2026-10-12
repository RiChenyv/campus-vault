/**
 * 成绩单接口端到端测试。
 *
 * 自己起一个服务（独立端口 + 独立数据目录），**不碰正式数据**，
 * 账号也是一次性注册的（交接文档里的原则③）。
 *
 * 覆盖：
 *   · 导入：dry-run 预览 → 真导入 → 幂等重导
 *   · 关联：课程号对得上的挂到课程上；对不上的存成「仅成绩」，且**不新建课程**
 *   · 手改：PATCH 学分 / 绩点必须落库，且下次导入不覆盖（用户明确要求的两条）
 *   · 汇总：已修学分 / 未出分 / 加权平均绩点
 *   · 越权：别人的成绩改不动、删不掉；账号之间互相看不见
 *   · 撤销：import/undo 能把成绩单还原到导入前
 */

import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER = resolve(HERE, '..')
const DATA_DIR = resolve(SERVER, 'data-test-grades')
const PORT = 5178
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

/* ------------------------------ 客户端 ------------------------------ */

function makeClient() {
  let cookie = ''
  return {
    get cookie() { return cookie },
    async req(method, path, body, opts = {}) {
      const headers = {}
      if (cookie) headers.Cookie = cookie
      if (opts.origin) headers.Origin = opts.origin
      if (opts.token) headers['X-Import-Token'] = opts.token
      let payload
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
        payload = JSON.stringify(body)
      }
      const res = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual' })
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const kv = c.split(';')[0]
        if (kv.startsWith('cv_sid=')) cookie = kv
      }
      const text = await res.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* 非 JSON */ }
      return { status: res.status, json, text }
    },
  }
}
const j = (r) => r.json

/* ------------------------------ 测试数据 ------------------------------ */

/** [学期, 课程名, 课程号, 成绩, 学分, 绩点] —— 与开发时的仿造表格一致 */
const FIXTURE = [
  ['2025-2026学年第一学期', '马克思主义基本原理', '2211010024', '91', 3, 3.85],
  ['2025-2026学年第一学期', '专业示例课程一', '2121030179', '88', 3, 3.63],
  ['2025-2026学年第一学期', '专业示例课程五', '2121030229', '优秀', 3, null],
  ['2025-2026学年第一学期', '基础示例课程二', '2131010006', '76', 4, 2.85],
  ['2025-2026学年第一学期', '计算机系统', '2121030194', '84', 3, 3.33],
  ['2025-2026学年第一学期', '思政示例课程二', '2211010016', '90', 3, 3.7],
  ['2025-2026学年第一学期', '通识示例课程二', '1131010002', '92', 2, 4.0],
  ['2025-2026学年第一学期', '体育(3)(示例项目)', '2171010001', '85', 1, 3.5],
  ['2025-2026学年第一学期', '形势与政策(3)', '2211010004', '', 2, null],
  ['2024-2025学年第二学期', '高等数学A(下)', '2131010001', '86', 5, 3.7],
  ['2024-2025学年第二学期', '线性代数', '2131010002', '73', 3, 2.3],
  ['2024-2025学年第二学期', '程序设计基础(C)', '2121030102', '94', 4, 4.0],
].map(([term, name, code, score, credit, gpa]) => ({
  term, name, code, score, credit, gpa,
  scoreNum: /^\d+$/.test(score) ? Number(score) : null,
  category: '专业教育课', nature: '必修', mode: '正常', major: true,
  examDate: '2026-06-30', retake: '正常',
}))

/* FIXTURE 的期望汇总（手算，用来验证服务端算得对）
   已出分：除「形势与政策(3)」（成绩空）之外的 11 条
   已修学分 = 3+3+3+4+3+3+2+1+5+3+4 = 34
   未出分   = 2 学分 / 1 门
   绩点加权 = 只有 gpa 非 null 的算：3.85*3 + 3.63*3 + 2.85*4 + 3.33*3 + 3.7*3 + 4*2 + 3.5*1 + 3.7*5 + 2.3*3 + 4*4
   加权学分 = 3+3+4+3+3+2+1+5+3+4 = 31                                        */
const EXPECT_CREDIT = 34
const EXPECT_PENDING_CREDIT = 2
const EXPECT_GPA_CREDIT = 31
const EXPECT_AVG_GPA = Math.round(
  ((3.85 * 3 + 3.63 * 3 + 2.85 * 4 + 3.33 * 3 + 3.7 * 3 + 4 * 2 + 3.5 * 1 + 3.7 * 5 + 2.3 * 3 + 4 * 4) / EXPECT_GPA_CREDIT) * 100,
) / 100

/* ------------------------------ 起服务 ------------------------------ */

await rm(DATA_DIR, { recursive: true, force: true })
console.log(`[test] 已重置测试数据目录 ${DATA_DIR}`)

const child = spawn(process.execPath, ['src/index.ts'], {
  cwd: SERVER,
  env: { ...process.env, PORT: String(PORT), DATA_DIR },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
child.stdout.on('data', (d) => { serverLog += d.toString() })
child.stderr.on('data', (d) => { serverLog += d.toString() })
const stop = () => { if (!child.killed) child.kill('SIGKILL') }

let up = false
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) { up = true; break }
  } catch { /* 还没起来 */ }
  await sleep(250)
}
if (!up) {
  console.error('[test] 服务未能启动：')
  console.error(serverLog)
  stop()
  process.exit(1)
}
console.log(`[test] 服务已就绪 ${BASE}`)

const me = makeClient()
const other = makeClient()

try {
  /* ------------------------- 账号与令牌 ------------------------- */
  section('准备：注册一次性账号 + 导入令牌')
  const reg = await me.req('POST', '/api/auth/register', { password: 'Grd7#kQ2p', confirm: 'Grd7#kQ2p' })
  check('注册成功', j(reg)?.ok === true, JSON.stringify(j(reg)?.error))
  const account = j(reg)?.data?.account
  const tok = await me.req('POST', '/api/import/token', { label: '成绩测试' })
  const token = j(tok)?.data?.token
  check('拿到导入令牌', typeof token === 'string' && token.startsWith('cvi_'), String(token))

  /* ------------------------- 鉴权 ------------------------- */
  section('鉴权：站外请求必须带令牌')
  const noToken = await fetch(`${BASE}/api/import/grades`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://bkjw.cuc.edu.cn' },
    body: JSON.stringify({ grades: FIXTURE }),
  })
  const noTokenJson = await noToken.json().catch(() => null)
  check('站外无令牌被拒（401）', noToken.status === 401, String(noToken.status))
  check('拒绝原因是 TOKEN_REQUIRED', noTokenJson?.error?.code === 'TOKEN_REQUIRED', JSON.stringify(noTokenJson?.error))

  const emptyBody = await fetch(`${BASE}/api/import/grades`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Import-Token': token, Origin: 'https://bkjw.cuc.edu.cn' },
    body: JSON.stringify({ grades: [] }),
  })
  const emptyJson = await emptyBody.json().catch(() => null)
  check('空数据被拒（400 NO_GRADES）', emptyJson?.error?.code === 'NO_GRADES', JSON.stringify(emptyJson?.error))

  const schoolPost = (path, body) => fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Import-Token': token, Origin: 'https://bkjw.cuc.edu.cn' },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))

  /* ------------------------- 先放一门课，验证关联 --------------- */
  section('准备：先有一门课程（用来验证成绩能不能挂上去）')
  const mkCourse = await me.req('POST', '/api/courses', { name: '基础示例课程二', code: '2131010006', term: '2025-2026学年第一学期', credit: 4 })
  check('建了一门「基础示例课程二」', j(mkCourse)?.ok === true, JSON.stringify(j(mkCourse)?.error))
  const courseId = j(mkCourse)?.data?.course?.id
  const coursesBefore = (j(await me.req('GET', '/api/courses'))?.data?.courses ?? []).length

  /* ------------------------- dry-run ------------------------- */
  section('导入预览（dry-run 缺省就是预览）')
  const dry = await schoolPost('/api/import/grades', { grades: FIXTURE, source: 'userscript@bkjw.cuc.edu.cn' })
  check('预览成功', dry.json?.ok === true, JSON.stringify(dry.json?.error))
  check('预览说会新增 12 条', dry.json?.data?.create === 12, String(dry.json?.data?.create))
  check('预览说一条都不更新', dry.json?.data?.update === 0, String(dry.json?.data?.update))
  check('预览指出只有 1 条能关联到课程', dry.json?.data?.linked === 1, String(dry.json?.data?.linked))
  check('预览指出 11 条对不上课程', dry.json?.data?.unlinked === 11, String(dry.json?.data?.unlinked))
  const afterDry = await me.req('GET', '/api/grades')
  check('预览没有写库', (j(afterDry)?.data?.grades ?? []).length === 0, String((j(afterDry)?.data?.grades ?? []).length))

  /* ------------------------- 真导入 ------------------------- */
  section('真导入')
  const imp = await schoolPost('/api/import/grades', { grades: FIXTURE, source: 'userscript@bkjw.cuc.edu.cn', dryRun: false })
  check('导入成功', imp.json?.ok === true, JSON.stringify(imp.json?.error))
  check('落库新增 12 条', imp.json?.data?.applied?.created === 12, JSON.stringify(imp.json?.data?.applied))
  check('关联到课程 1 条', imp.json?.data?.applied?.linked === 1, JSON.stringify(imp.json?.data?.applied))

  const list = await me.req('GET', '/api/grades')
  const grades = j(list)?.data?.grades ?? []
  check('查回 12 条', grades.length === 12, String(grades.length))
  check('新学期的排在最前面', grades[0]?.term === '2025-2026学年第一学期', String(grades[0]?.term))
  check('最后一条是旧学期', grades[grades.length - 1]?.term === '2024-2025学年第二学期', String(grades[grades.length - 1]?.term))

  const phys = grades.find((g) => g.courseCode === '2131010006')
  check('课程号对得上的挂到了课程上', phys?.courseId === courseId, `${phys?.courseId} vs ${courseId}`)
  check('顺手带回了课程配色字段', typeof phys?.courseRgb === 'string', JSON.stringify(phys?.courseRgb))
  const opSys = grades.find((g) => g.courseCode === '2121030194')
  check('对不上的 courseId 是空串（仅成绩）', opSys?.courseId === '', JSON.stringify(opSys?.courseId))

  const coursesAfter = (j(await me.req('GET', '/api/courses'))?.data?.courses ?? []).length
  check('导入**没有**新建课程', coursesAfter === coursesBefore, `${coursesBefore} → ${coursesAfter}`)

  /* ------------------------- 汇总 ------------------------- */
  section('汇总（学分 / 未出分 / 平均绩点）')
  const s = j(list)?.data?.summary ?? {}
  console.log('  summary =', JSON.stringify(s))
  check('已修学分 = 34', s.credit === EXPECT_CREDIT, String(s.credit))
  check('已出分 11 门', s.count === 11, String(s.count))
  check('未出分 1 门 / 2 学分', s.pendingCount === 1 && s.pendingCredit === EXPECT_PENDING_CREDIT,
    `${s.pendingCount} 门 / ${s.pendingCredit}`)
  check(`加权平均绩点 = ${EXPECT_AVG_GPA}`, s.avgGpa === EXPECT_AVG_GPA, String(s.avgGpa))
  check('参与绩点加权的学分 = 31（不把「优秀」算进去）', s.gpaCredit === EXPECT_GPA_CREDIT, String(s.gpaCredit))
  check('«优秀» 的 gpa 是 null 而不是 0', grades.find((g) => g.courseName === '专业示例课程五')?.gpa === null)
  check('«优秀» 的 scoreNum 是 null', grades.find((g) => g.courseName === '专业示例课程五')?.scoreNum === null)

  /* ------------------------- 幂等 ------------------------- */
  section('幂等：再导一次不应翻倍')
  const again = await schoolPost('/api/import/grades', { grades: FIXTURE, dryRun: false })
  check('第二次导入新增 0 条', again.json?.data?.applied?.created === 0, JSON.stringify(again.json?.data?.applied))
  check('第二次导入更新 12 条', again.json?.data?.applied?.updated === 12, JSON.stringify(again.json?.data?.applied))
  check('总数仍然是 12', ((j(await me.req('GET', '/api/grades'))?.data?.grades) ?? []).length === 12)

  /* ------------------------- 手改学分 / 绩点（用户明确要求） ------------------------- */
  section('手改：学分与绩点（用户明确要求能改）')
  const target = grades.find((g) => g.courseCode === '2131010006')
  const patched = await me.req('PATCH', `/api/grades/${target.id}`, { credit: 3.5, gpa: 3.9 })
  check('PATCH 成功', j(patched)?.ok === true, JSON.stringify(j(patched)?.error))
  const afterPatch = (j(patched)?.data?.grades ?? []).find((g) => g.id === target.id)
  check('学分改成了 3.5', afterPatch?.credit === 3.5, String(afterPatch?.credit))
  check('绩点改成了 3.9', afterPatch?.gpa === 3.9, String(afterPatch?.gpa))
  check('标记为「手动改过」', afterPatch?.edited === true, String(afterPatch?.edited))
  check('汇总跟着变了（已修学分 33.5）', j(patched)?.data?.summary?.credit === 33.5, String(j(patched)?.data?.summary?.credit))

  section('手改要能扛住下一次导入')
  const reimport = await schoolPost('/api/import/grades', { grades: FIXTURE, dryRun: false })
  check('重导时这条被算作「手改保留」', (reimport.json?.data?.applied?.kept ?? 0) >= 1,
    JSON.stringify(reimport.json?.data?.applied))
  const keptRow = ((j(await me.req('GET', '/api/grades'))?.data?.grades) ?? []).find((g) => g.id === target.id)
  check('手改的学分没被顶回 4', keptRow?.credit === 3.5, String(keptRow?.credit))
  check('手改的绩点没被顶回 2.85', keptRow?.gpa === 3.9, String(keptRow?.gpa))

  section('手改：清空成绩与绩点')
  const clearOne = await me.req('PATCH', `/api/grades/${target.id}`, { score: '', gpa: null, scoreNum: null })
  const cleared = (j(clearOne)?.data?.grades ?? []).find((g) => g.id === target.id)
  check('成绩被清空', cleared?.score === '', JSON.stringify(cleared?.score))
  check('绩点被清空', cleared?.gpa === null, JSON.stringify(cleared?.gpa))
  check('清空后计入「未出分」', (j(clearOne)?.data?.summary?.pendingCount ?? 0) >= 2,
    String(j(clearOne)?.data?.summary?.pendingCount))

  section('手改：手工新增一条（学校页面拿不到的课）')
  const manual = await me.req('POST', '/api/grades', {
    name: '自行申报的学分', code: 'MANUAL-1', term: '2024-2025学年第一学期', score: '95', credit: 2, gpa: 4,
  })
  check('手工新增成功', j(manual)?.ok === true, JSON.stringify(j(manual)?.error))
  check('手工新增后总数 13', (j(manual)?.data?.grades ?? []).length === 13, String((j(manual)?.data?.grades ?? []).length))
  const manualRow = (j(manual)?.data?.grades ?? []).find((g) => g.courseCode === 'MANUAL-1')
  check('手工新建立刻标记 edited', manualRow?.edited === true, String(manualRow?.edited))

  section('校验：缺课程名要被拒')
  const bad = await me.req('POST', '/api/grades', { term: 'x', credit: 1 })
  check('缺课程名被拒（400）', bad.status === 400 && j(bad)?.error?.code === 'BAD_REQUEST', JSON.stringify(j(bad)?.error))
  const badPatch = await me.req('PATCH', `/api/grades/${target.id}`, { courseName: '  ' })
  check('把课程名改成空白被拒', badPatch.status === 400, String(badPatch.status))

  section('校验：改成重名的成绩要给能看懂的错')
  /* 撞唯一键（课程号+课程名+学期+重修）应该是 400 + 中文原因，
     而不是 500「服务器内部错误」—— 后者会让用户以为程序坏了。
     构造撞键：同一个课程号 + 同一个学期，先存两条不同名的，
     再把其中一条改成另一条的名字。 */
  /* 成绩的"身份" = 学期 + 课程号（见 lib/grades.ts 的 gradeKey）。
     课程名只是展示字段：同一学期同一课程号，不管名字怎么写，都是**同一条**。
     踩过的坑：原来的键含 retake，解析器把它从空串改成「正常」之后，
     同一门课重导一次就新增一行（用户实测数据翻倍）—— 所以这里钉住新语义。 */
  const clashA = await me.req('POST', '/api/grades', {
    name: '撞键测试A', code: 'CLASH-1', term: '2024-2025学年第一学期', credit: 1,
  })
  const clashB = await me.req('POST', '/api/grades', {
    name: '撞键测试B', code: 'CLASH-1', term: '2024-2025学年第一学期', credit: 1,
  })
  check('同课程号同学期算同一条：第二条被拒（400）', clashB.status === 400,
    `A=${clashA.status} B=${clashB.status} ${JSON.stringify(j(clashB)?.error)}`)
  check('错误码是 GRADE_EXISTS', j(clashB)?.error?.code === 'GRADE_EXISTS', JSON.stringify(j(clashB)?.error))
  check('错误文案是中文且说得清怎么办',
    /已经有一条/.test(String(j(clashB)?.error?.message)), String(j(clashB)?.error?.message))
  const idB = j(clashA)?.data?.id
  const stillThere = (j(await me.req('GET', '/api/grades'))?.data?.grades ?? []).find((g) => g.id === idB)
  check('被拒之后原来那条没被改坏', stillThere?.courseName === '撞键测试A', String(stillThere?.courseName))

  /* ------------------------- 越权 ------------------------- */
  section('越权与账号隔离')
  /* 先记下当前条数，越权尝试之后再核对 —— 写死数字的话，
     上面每加一条测试数据这里就得跟着改（刚踩过） */
  const countBeforeSteal = ((j(await me.req('GET', '/api/grades'))?.data?.grades) ?? []).length
  const reg2 = await other.req('POST', '/api/auth/register', { password: 'Oth8#kQ3p', confirm: 'Oth8#kQ3p' })
  check('第二个账号注册成功', j(reg2)?.ok === true, JSON.stringify(j(reg2)?.error))
  const otherList = await other.req('GET', '/api/grades')
  check('另一个账号看不到我的成绩', (j(otherList)?.data?.grades ?? []).length === 0,
    String((j(otherList)?.data?.grades ?? []).length))
  const steal = await other.req('PATCH', `/api/grades/${target.id}`, { credit: 99 })
  check('另一个账号改不动我的成绩（404）', steal.status === 404, String(steal.status))
  const stealDel = await other.req('DELETE', `/api/grades/${target.id}`)
  check('另一个账号删不掉我的成绩（404）', stealDel.status === 404, String(stealDel.status))
  const mine = (j(await me.req('GET', '/api/grades'))?.data?.grades) ?? []
  check('我的成绩一条没少', mine.length === countBeforeSteal, `${countBeforeSteal} → ${mine.length}`)
  check('我的成绩也没被改（学分还是 3.5）',
    mine.find((g) => g.id === target.id)?.credit === 3.5,
    String(mine.find((g) => g.id === target.id)?.credit))

  const noAuth = await fetch(`${BASE}/api/grades`)
  check('未登录读成绩被拒（401）', noAuth.status === 401, String(noAuth.status))

  /* ------------------------- 撤销 ------------------------- */
  section('撤销：import/undo 还原成绩单')
  const beforeUndo = (j(await me.req('GET', '/api/grades'))?.data?.grades ?? []).length
  const undo = await me.req('POST', '/api/import/undo')
  check('撤销成功', j(undo)?.ok === true, JSON.stringify(j(undo)?.error))
  const afterUndoRows = (j(await me.req('GET', '/api/grades'))?.data?.grades ?? [])
  /* 最近一次带快照的导入是"手改扛住导入"那次重导，快照拍在它之前 ——
     也就是 12 条 + 手工那条还没有的状态（手工新增在重导之后）。 */
  check('撤销后条数变回上一次导入之前', afterUndoRows.length < beforeUndo,
    `${beforeUndo} → ${afterUndoRows.length}`)
  check('撤销后服务端确实变了（不是只改了返回值）', afterUndoRows.length === 12,
    `${afterUndoRows.length} 条`)

  /* ------------------------- 删除 ------------------------- */
  section('删除一条 / 清空')
  const delId = afterUndoRows[0]?.id
  const del = await me.req('DELETE', `/api/grades/${delId}`)
  check('删除成功', j(del)?.ok === true, JSON.stringify(j(del)?.error))
  check('删完剩 11 条', (j(del)?.data?.grades ?? []).length === 11, String((j(del)?.data?.grades ?? []).length))
  const clear = await me.req('DELETE', '/api/grades')
  check('清空成功', j(clear)?.ok === true && j(clear)?.data?.removed === 11, JSON.stringify(j(clear)?.data?.removed))
  check('清空后为 0 条', (j(clear)?.data?.grades ?? []).length === 0)
  check('清空后汇总归零', j(clear)?.data?.summary?.credit === 0 && j(clear)?.data?.summary?.avgGpa === null,
    JSON.stringify(j(clear)?.data?.summary))
} catch (e) {
  fail++
  failures.push('测试脚本抛异常：' + (e && e.stack ? e.stack : e))
  console.error('测试脚本抛异常：', e)
}

console.log('')
console.log('==================================================')
console.log(`  通过 ${pass} / ${pass + fail}`)
for (const f of failures) console.log(`   FAIL ${f}`)
console.log('==================================================')
if (fail && serverLog.trim()) {
  console.log('[test] 服务端日志（末尾 2000 字）：')
  console.log(serverLog.slice(-2000))
}

stop()
await sleep(200)
process.exit(fail ? 1 : 0)
