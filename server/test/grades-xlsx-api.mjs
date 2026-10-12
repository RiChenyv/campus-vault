/**
 * 成绩表格（xlsx）导入接口端到端测试。
 *
 * 自己起一个服务（**独立端口 + 独立数据目录**，放 `.tmp` 下让 vite 忽略），
 * 账号是一次性注册的 —— 绝不碰用户正在用的 5174/5175 和真实数据。
 *
 * 覆盖：
 *   · 上传 → 预览（dryRun 默认 true，**不写库**）
 *   · 确认导入 29 条 → 服务端真的写进去了（查 /api/grades 核对）
 *   · **再导一次：0 新增、29 更新** ← 这条是真 bug 的回归
 *     （唯一键原来含重修标记，解析器改好一列就会让同一门课新增一行，
 *      用户实测"重导后数据翻倍"；现在认的是「学期 + 课程号」）
 *   · 缺列时报错文案
 *   · 鉴权：必须走会话（requireAuth），站外令牌那一套在这里**不算数**
 *   · 手改过的学分不被下一次导入覆盖
 *
 * ⚠️ 不调 `process.exit()`（交接文档坑 5），只用 `process.exitCode`。
 */

import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'
import { makeGradesXlsx, makeGradesXlsxWithSharedStrings, REAL_XLSX, readRealXlsxBuffer } from './lib-xlsx-fixture.mjs'
const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER = resolve(HERE, '..')
/* 数据目录必须在 `.tmp` 下且名字里带 data-test：
   一是 vite 的 watch.ignored 同时覆盖了 `.tmp` 和 `server/data-*` 这类名字（坑 15），
   二是 credits-ui.mjs 那类脚本会拒绝对非测试目录写入。
   ⚠️ 注释里别把"星号 + 两个斜杠"写在一起 —— 那会提前结束块注释（坑 14），
   报的错会指向后面某行，跟本意毫无关系。 */
const DATA_DIR = resolve(SERVER, '..', '.tmp', 'data-test-xlsx')
const PORT = 5179
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
/** 值相等断言（比 check 少写一层 === 和提示文案） */
const eq_ = (name, actual, expected) =>
  check(name, actual === expected, `实际 ${JSON.stringify(actual)} ≠ 期望 ${JSON.stringify(expected)}`)

/* ------------------------------ 客户端 ------------------------------ */

const makeClient = () => {
  let cookie = ''
  return {
    get cookie() { return cookie },
    async req(method, path, body, opts = {}) {
      const headers = {}
      if (cookie) headers.Cookie = cookie
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
    /** multipart 上传：字段名必须是 `files`（和后端 upload.array('files', 5) 对齐） */
    async upload(path, { bytes, filename, dryRun, extraFields = {} }) {
      const form = new FormData()
      /* 第三个参数是**显式文件名**：不传的话 FormData 会用字段名当文件名，
         看起来像没问题，但服务端拿到的 originalname 是 "files"，
         日志和报错里就看不到用户真正的文件名了。 */
      form.append('files', new Blob([bytes]), filename)
      if (dryRun !== undefined) form.append('dryRun', String(dryRun))
      for (const [k, v] of Object.entries(extraFields)) form.append(k, String(v))
      const headers = {}
      if (cookie) headers.Cookie = cookie
      const res = await fetch(BASE + path, { method: 'POST', headers, body: form })
      const text = await res.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* 非 JSON */ }
      return { status: res.status, json, text }
    },
  }
}
const j = (r) => r.json
const msg = (r) => String(j(r)?.error?.message ?? '')
const code = (r) => String(j(r)?.error?.code ?? '')

/* ------------------------------ 造文件 ------------------------------ */

const XLSX = makeGradesXlsx()
console.log(`[test] fixture xlsx ${XLSX.length} 字节`)
const XLSX_SHARED = makeGradesXlsxWithSharedStrings()
/* 缺列的变体（用来验"缺必须列要报错"） */
const XLSX_NO_SCORE = makeGradesXlsx({ dropColumns: ['总成绩'] })
const XLSX_NO_NAME = makeGradesXlsx({ dropColumns: ['课程名'] })

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
  process.exitCode = 1
} else {
  console.log(`[test] 服务已就绪 ${BASE}`)

  const me = makeClient()
  const other = makeClient()

  try {
    /* ------------------------- 准备 ------------------------- */
    section('准备：一次性账号 + 一门课程（用来验"自动关联课程"）')
    const reg = await me.req('POST', '/api/auth/register', { password: 'Xls7#kQ2p', confirm: 'Xls7#kQ2p' })
    check('注册成功', j(reg)?.ok === true, JSON.stringify(j(reg)?.error))
    const account = j(reg)?.data?.account

    /* 先建一门和表格里课程号一致的课 —— 导入时它必须被自动关联上 */
    const mkCourse = await me.req('POST', '/api/courses', {
      name: '示例课程01', code: '9000000001', term: '2025-2026学年 秋季学期', credit: 2,
    })
    check('建了一门测试课程', j(mkCourse)?.ok === true, JSON.stringify(j(mkCourse)?.error))

    /* ------------------------- 鉴权 ------------------------- */
    section('鉴权：这个接口走会话，不认导入令牌')
    const anon = await fetch(`${BASE}/api/import/grades-xlsx`, { method: 'POST', body: new FormData() })
    check('不带会话 → 401', anon.status === 401, `HTTP ${anon.status}`)

    /* 拿一枚导入令牌，确认它**不能**替代会话：
       这一条是刻意的 —— 文件从用户自己电脑传上来，没有"站外来源"这回事，
       所以走 requireAuth 而不是 makeImportAuth。 */
    const tokRes = await me.req('POST', '/api/import/token', { label: 'xlsx 测试' })
    const importToken = j(tokRes)?.data?.token
    check('拿到导入令牌', typeof importToken === 'string' && importToken.startsWith('cvi_'), String(importToken))
    const onlyToken = await fetch(`${BASE}/api/import/grades-xlsx`, {
      method: 'POST', headers: { 'X-Import-Token': importToken }, body: new FormData(),
    })
    check('只带导入令牌、不带会话 → 仍然 401', onlyToken.status === 401, `HTTP ${onlyToken.status}`)

    /* ------------------------- 没有文件 ------------------------- */
    section('没有文件 / 传错文件类型')
    const emptyForm = await fetch(`${BASE}/api/import/grades-xlsx`, {
      method: 'POST', headers: { Cookie: me.cookie }, body: new FormData(),
    }).then((r) => r.json())
    check('没传文件时明确报"没有收到文件"', /没有收到文件/.test(String(emptyForm?.error?.message)),
      String(emptyForm?.error?.message))
    check('错误码是 NO_FILE', emptyForm?.error?.code === 'NO_FILE', String(emptyForm?.error?.code))

    const csv = await me.upload('/api/import/grades-xlsx', {
      bytes: Buffer.from('课程名,总成绩\n高等数学,95\n', 'utf8'), filename: '成绩.csv',
    })
    check('传 CSV 时被挡下（不是 .xlsx）', csv.status === 400 && code(csv) === 'NOT_XLSX',
      `HTTP ${csv.status} ${code(csv)}`)
    check('并且告诉用户怎么办', /导出|另存/.test(msg(csv)), msg(csv).slice(0, 120))

    /* ------------------------- 预览（dryRun 默认 true） ------------------------- */
    section('预览：默认 dryRun，不写库')
    const preview = await me.upload('/api/import/grades-xlsx', { bytes: XLSX, filename: '全部成绩查询.xlsx' })
    check('预览返回 200', preview.status === 200, `HTTP ${preview.status} ${msg(preview)}`)
    const pv = j(preview)?.data
    check('默认是 dryRun（响应里 dryRun=true）', pv?.dryRun === true, JSON.stringify(pv?.dryRun))
    /* 需求里的四个数字 */
    check('识别到 29 条', pv?.total === 29, String(pv?.total))
    check('新增 29 条', pv?.create === 29, String(pv?.create))
    check('更新 0 条', pv?.update === 0, String(pv?.update))
    check('已忽略 8 列', pv?.parse?.ignoredCount === 8, String(pv?.parse?.ignoredCount))
    check('忽略了哪 8 列也带回来',
      (pv?.parse?.ignoredColumns ?? []).join('、') === '课序号、学时、等级成绩类型、考试类型、开课单位、是否及格、是否有效、特殊原因',
      JSON.stringify(pv?.parse?.ignoredColumns))
    check('notes 里写了"已忽略 8 列不需要的信息"',
      (pv?.notes ?? []).some((n) => /已忽略 8 列不需要的信息/.test(n)), JSON.stringify(pv?.notes))
    check('预览带上了文件名', pv?.parse?.fileName === '全部成绩查询.xlsx', String(pv?.parse?.fileName))
    check('预览带回了每一条（界面要列表）', (pv?.parse?.grades ?? []).length === 29,
      String((pv?.parse?.grades ?? []).length))
    check('没有缺字段（这份文件 12 列齐）', (pv?.parse?.missingFields ?? []).length === 0,
      JSON.stringify(pv?.parse?.missingFields))
    check('课程号对得上的那条被算成"关联课程"', pv?.linked >= 1, String(pv?.linked))
    check('对不上的算成"仅成绩"', pv?.unlinked === 28, String(pv?.unlinked))

    /* ★ 预览必须**真的没写库** */
    const afterPreview = await me.req('GET', '/api/grades')
    check('★ 预览之后库里仍然是 0 条（dryRun 真的没写）',
      (j(afterPreview)?.data?.grades ?? []).length === 0,
      `${(j(afterPreview)?.data?.grades ?? []).length} 条`)

    /* ------------------------- 确认导入 ------------------------- */
    section('确认导入 → 落库')
    const applied = await me.upload('/api/import/grades-xlsx', {
      bytes: XLSX, filename: '全部成绩查询.xlsx', dryRun: false,
    })
    check('导入返回 200', applied.status === 200, `HTTP ${applied.status} ${msg(applied)}`)
    const ap = j(applied)?.data
    check('dryRun=false', ap?.dryRun === false, JSON.stringify(ap?.dryRun))
    check('applied.created = 29', ap?.applied?.created === 29, JSON.stringify(ap?.applied))
    check('applied.updated = 0', ap?.applied?.updated === 0, String(ap?.applied?.updated))
    check('applied.linked = 1（那门测试课程被关联上）', ap?.applied?.linked === 1, String(ap?.applied?.linked))

    /* ★ 验到服务端真的变了（不能只看响应） */
    const listed = await me.req('GET', '/api/grades')
    const rows = j(listed)?.data?.grades ?? []
    check('★ 查库：真的有 29 条', rows.length === 29, `${rows.length} 条`)
    eq_('★ 汇总：已修学分 66.5', j(listed)?.data?.summary?.credit, 66.5)
    eq_('★ 汇总：已出分 29 门', j(listed)?.data?.summary?.count, 29)

    const first = rows.find((r) => r.courseCode === '9000000001')
    check('★ 第一条落库内容正确', first?.courseName === '示例课程01', String(first?.courseName))
    eq_('  · 学期', first?.term, '2025-2026学年 秋季学期')
    eq_('  · 成绩 88.0 → "88"', first?.score, '88')
    eq_('  · scoreNum = 88', first?.scoreNum, 88)
    eq_('  · 学分 2.0 → 2', first?.credit, 2)
    eq_('  · 绩点 3.04', first?.gpa, 3.04)
    eq_('  · 课程类别', first?.category, '通识教育核心课')
    eq_('  · 课程性质', first?.nature, '任选')
    eq_('  · 修读方式', first?.mode, '正常')
    eq_('  · 考试日期', first?.examDate, '2026-01-10')
    eq_('  · 重修重考', first?.retake, '正常')
    eq_('  · 是否主修', first?.isMajor, true)
    check('  · 关联到了课程', !!first?.courseId, String(first?.courseId))

    /* 空「是否主修」的行 → false（不是"未知"） */
    const majorBlank = rows.find((r) => r.courseCode === '9000000021')
    eq_('空「是否主修」落库为 false', majorBlank?.isMajor, false)
    eq_('那条成绩照样对', majorBlank?.score, '95')

    /* 导入历史 */
    const logs = await me.req('GET', '/api/import/log')
    const log0 = (j(logs)?.data?.logs ?? [])[0]
    eq_('导入历史记了一条', log0?.source, 'grades-xlsx')
    check('历史摘要里有新增条数', /新增 29/.test(String(log0?.summary)), String(log0?.summary))

    /* ------------------------- ★ 再导一次：只更新不新增 ------------------------- */
    section('★ 回归：再导一次必须"不新增、只更新"')
    const again = await me.upload('/api/import/grades-xlsx', {
      bytes: XLSX, filename: '全部成绩查询.xlsx', dryRun: false,
    })
    const ag = j(again)?.data
    check('第二次导入返回 200', again.status === 200, `HTTP ${again.status} ${msg(again)}`)
    check('★ 新增 0 条（没有翻倍）', ag?.applied?.created === 0, String(ag?.applied?.created))
    check('★ 更新 29 条', ag?.applied?.updated === 29, String(ag?.applied?.updated))
    const listed2 = await me.req('GET', '/api/grades')
    check('★ 查库：还是 29 条（不是 58 条）',
      (j(listed2)?.data?.grades ?? []).length === 29,
      `${(j(listed2)?.data?.grades ?? []).length} 条`)
    eq_('★ 汇总学分没翻倍', j(listed2)?.data?.summary?.credit, 66.5)

    /* ------------------------- 手改不被覆盖 ------------------------- */
    section('手改过的学分：下一次导入只补空字段')
    const target = (j(listed2)?.data?.grades ?? []).find((r) => r.courseCode === '9000000001')
    const patched = await me.req('PATCH', `/api/grades/${target.id}`, { credit: 9, gpa: 1.23 })
    check('手改学分/绩点成功', j(patched)?.ok === true, JSON.stringify(j(patched)?.error))
    eq_('改完立刻生效', (j(patched)?.data?.grades ?? []).find((r) => r.id === target.id)?.credit, 9)

    const third = await me.upload('/api/import/grades-xlsx', {
      bytes: XLSX, filename: '全部成绩查询.xlsx', dryRun: false,
    })
    const t3 = j(third)?.data
    check('第三次导入：kept = 1（那条手改过的只补空字段）', t3?.applied?.kept === 1, String(t3?.applied?.kept))
    const after = (await me.req('GET', '/api/grades')).json?.data?.grades ?? []
    const kept = after.find((r) => r.id === target.id)
    eq_('★ 手改的学分 9 没有被 2 顶回去', kept?.credit, 9)
    eq_('★ 手改的绩点 1.23 没有被 3.04 顶回去', kept?.gpa, 1.23)

    /* ------------------------- 缺列报错 ------------------------- */
    section('缺必须列 → 明确报错（不猜）')
    const noScore = await me.upload('/api/import/grades-xlsx', {
      bytes: XLSX_NO_SCORE, filename: '缺总成绩.xlsx',
    })
    check('缺「总成绩」→ 400', noScore.status === 400, `HTTP ${noScore.status}`)
    check('错误码 XLSX_PARSE_FAILED', code(noScore) === 'XLSX_PARSE_FAILED', code(noScore))
    check('文案里点名缺的是「总成绩」', /总成绩/.test(msg(noScore)), msg(noScore).slice(0, 140))
    check('文案里带上读到的表头，便于用户核对', /读到的表头是/.test(msg(noScore)), msg(noScore).slice(0, 160))
    check('文案里给出下一步', /发回来|别名|导出/.test(msg(noScore)), msg(noScore).slice(0, 200))
    check('报错时没有偷偷写库', (await me.req('GET', '/api/grades')).json?.data?.grades?.length === 29,
      String((await me.req('GET', '/api/grades')).json?.data?.grades?.length))

    const noName = await me.upload('/api/import/grades-xlsx', {
      bytes: XLSX_NO_NAME, filename: '缺课程名.xlsx',
    })
    check('缺「课程名」→ 400', noName.status === 400, `HTTP ${noName.status}`)
    check('文案里点名缺的是「课程名」', /课程名/.test(msg(noName)), msg(noName).slice(0, 140))

    /* 只有表头（没有数据行）：接口层要报 NO_GRADES，不能假装成功 */
    const headOnly = await me.upload('/api/import/grades-xlsx', {
      bytes: (await import('./lib-xlsx-fixture.mjs')).makeGradesXlsx({ headerOnly: true }),
      filename: '只有表头.xlsx',
    })
    check('只有表头 → 400 NO_GRADES', headOnly.status === 400 && code(headOnly) === 'NO_GRADES',
      `HTTP ${headOnly.status} ${code(headOnly)}`)
    check('文案说清"一条成绩都没读到"', /一条成绩都没读到/.test(msg(headOnly)), msg(headOnly).slice(0, 120))

    /* ------------------------- 共享字符串 / 真文件 ------------------------- */
    section('共享字符串写法 与 真实文件')
    const other2 = makeClient()
    await other2.req('POST', '/api/auth/register', { password: 'Xls8#kQ3p', confirm: 'Xls8#kQ3p' })
    const sh = await other2.upload('/api/import/grades-xlsx', {
      bytes: XLSX_SHARED, filename: '共享字符串.xlsx', dryRun: false,
    })
    check('共享字符串的表格也能导', sh.status === 200, `HTTP ${sh.status} ${msg(sh)}`)
    eq_('共享字符串：29 条', j(sh)?.data?.applied?.created, 29)
    const shRows = (await other2.req('GET', '/api/grades')).json?.data?.grades ?? []
    eq_('共享字符串：查库 29 条', shRows.length, 29)
    eq_('共享字符串：课程名解出来了',
      shRows.find((r) => r.courseCode === '9000000001')?.courseName,
      '示例课程01')
    eq_('★ 共享字符串与内联两条路结果一致（学分）',
      shRows.find((r) => r.courseCode === '9000000001')?.credit, 2)

    const realBuf = readRealXlsxBuffer()
    if (!realBuf) {
      console.log(`  SKIP  这台机器上没有 ${REAL_XLSX}（fixture 就是照它造的）`)
    } else {
      const other3 = makeClient()
      await other3.req('POST', '/api/auth/register', { password: 'Xls9#kQ4p', confirm: 'Xls9#kQ4p' })
      const real = await other3.upload('/api/import/grades-xlsx', {
        bytes: realBuf, filename: '全部成绩查询.xlsx', dryRun: false,
      })
      check('真实文件导入成功', real.status === 200, `HTTP ${real.status} ${msg(real)}`)
      eq_('真实文件：新增 29 条', j(real)?.data?.applied?.created, 29)
      const realRows = (await other3.req('GET', '/api/grades')).json?.data?.grades ?? []
      eq_('真实文件：查库 29 条', realRows.length, 29)
      eq_('★ 真实文件与 fixture 落库结果一致（学分合计）',
        (await other3.req('GET', '/api/grades')).json?.data?.summary?.credit, 66.5)
    }

    /* ------------------------- 账号隔离 ------------------------- */
    section('账号隔离：别人的表格导入进不了我的库')
    const mine = (await me.req('GET', '/api/grades')).json?.data?.grades ?? []
    const theirs = (await other2.req('GET', '/api/grades')).json?.data?.grades ?? []
    check('两个账号各自 29 条、互不干扰', mine.length === 29 && theirs.length === 29,
      `${mine.length} / ${theirs.length}`)
    check('两个账号的数据不是同一批（id 不同）', mine[0]?.id !== theirs[0]?.id,
      `${mine[0]?.id} / ${theirs[0]?.id}`)

    /* ------------------------- 渲染用的字段也回来 ------------------------- */
    section('界面要用的字段')
    const one = mine[0]
    check('带 edited 标记', typeof one?.edited === 'boolean', String(one?.edited))
    check('带 courseRgb（关联课程的配色）', typeof one?.courseRgb === 'string', String(one?.courseRgb))
    check('tableRows 里 29 条的 courseName 都非空', mine.every((r) => !!r.courseName))

  } catch (e) {
    fail++
    failures.push('测试脚本抛异常：' + (e && e.message ? e.message : String(e)))
    console.error('')
    console.error('[test] 脚本抛异常：', e)
    console.error('[test] 服务端日志尾部：')
    console.error(serverLog.slice(-2000))
  }

  /* ==================================================================
     界面那一段（可选）：把成绩表格从**真实的导入页**传一遍。
     需要另起一个前端指向本测试后端：

       $env:CV_TEST_APP="http://127.0.0.1:5178"   # 或任何代理到本端口的 vite

     没设这个环境变量就打印 SKIP 并**不算失败** —— 免得为了跑接口测试
     还必须先起一个前端。设了却没起来才报 FAIL（"没验到"不能当成"验过了"，
     见交接文档里 reality-dates.mjs 的那条约定）。
     ================================================================== */
  const appUrl = process.env.CV_TEST_APP
  if (!appUrl) {
    console.log('')
    console.log('--- 导入页 UI（SKIP）---')
    console.log('  没设 CV_TEST_APP —— 跳过界面验证。接口本身已经全部验过。')
    console.log('  想连界面一起验：起一个前端（代理到本测试后端）后设 CV_TEST_APP=http://127.0.0.1:<端口>')
  } else {
    try {
      await verifyImportUi({ appUrl, xlsx: XLSX, check, section, dataDir: DATA_DIR, port: PORT })
    } catch (e) {
      fail++
      failures.push('界面验证抛异常：' + (e && e.message ? e.message : String(e)))
      console.error('[test] 界面验证异常：', e)
    }
  }

  stop()
}

/**
 * 用无头 Chrome 打开导入页，真的塞一个 xlsx 进去，走完预览 → 确认导入。
 *
 * 为什么要这一段：接口全绿、页面上什么都看不到，用户端的感受就是"没做"。
 * 而且上传这条路有几个**只有真浏览器才暴露**的问题：file input 的 accept、
 * FormData 的文件名、预览区渲染、成功提示。
 */
async function verifyImportUi({ appUrl, xlsx, check, section, dataDir }) {
  const { spawn } = await import('node:child_process')
  const { rm, writeFile } = await import('node:fs/promises')
  const { resolve } = await import('node:path')

  const TMP = process.env.TEMP
  const port = 9281
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  section('导入页 UI：真的传一个文件走一遍')

  /* 一次性账号 */
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'Uix9#kQ7p', confirm: 'Uix9#kQ7p' }),
  }).then((r) => r.json())
  const sid = reg?.data?.sessionToken
  check('界面验证用的一次性账号注册成功', !!sid, JSON.stringify(reg?.error))

  const XLSX_PATH = resolve(TMP, 'cv-ui-upload-fixture.xlsx')
  await writeFile(XLSX_PATH, xlsx)

  await rm(`${TMP}\\cv-gxa-ui`, { recursive: true, force: true })
  const proc = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1600,1200',
    `--user-data-dir=${TMP}\\cv-gxa-ui`, '--remote-debugging-port=' + port, 'about:blank'],
    { stdio: 'ignore', windowsHide: true })

  const connect = async () => {
    for (let i = 0; i < 60; i++) {
      try {
        const l = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
        const p = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
        if (p) return p.webSocketDebuggerUrl
      } catch { /* retry */ }
      await sleep(250)
    }
    throw new Error('CDP 超时（前端没起来？）')
  }

  try {
    const ws = new WebSocket(await connect())
    await new Promise((r) => ws.addEventListener('open', r, { once: true }))
    let id = 0
    const pending = new Map()
    const excs = []
    const posts = []
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data)
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
      if (m.method === 'Runtime.exceptionThrown') {
        excs.push(String(m.params?.exceptionDetails?.exception?.description ?? '').slice(0, 160))
      }
      if (m.method === 'Network.requestWillBeSent' && /grades-xlsx/.test(m.params?.request?.url ?? '')) {
        posts.push(m.params.request.method)
      }
    })
    const send = (method, params = {}) =>
      new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
      if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description || '').slice(0, 200))
      return r.result?.result?.value
    }
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')

    await send('Page.navigate', { url: appUrl })
    await sleep(2500)
    /* 直接把会话令牌塞进 sessionStorage（前端就是从这儿读的），省掉驱动登录表单 */
    await ev(`sessionStorage.setItem('cv.sid', ${JSON.stringify(sid)}); 1`)
    await send('Page.navigate', { url: appUrl })
    await sleep(4000)

    /* 环形导航没有「导入」入口，要走「我的课程」→「导入课程 · 课表 · 成绩」 */
    await ev(`(function(){var el=document.querySelector('[aria-label^="我的课程"]'); if(el) el.click(); return !!el})()`)
    await sleep(1500)
    const opened = await ev(`(function(){
      var b = Array.prototype.slice.call(document.querySelectorAll('button'))
        .filter(function (x) { return /导入课程/.test(x.textContent || '') })[0];
      if (!b) return false;
      b.click();
      return true;
    })()`)
    check('从课程页点进了导入页', opened === true)
    await sleep(2000)

    let txt = await ev(`document.body.innerText`)
    check('★ 书签脚本那一栏已经不在了', !/书签脚本/.test(txt) && !/拖我到书签栏/.test(txt))
    check('★ 换成了「上传表格文件（.xlsx）」', /上传表格文件/.test(txt))
    check('油猴脚本 / 导入令牌两栏没被误删', /油猴脚本/.test(txt) && /导入令牌/.test(txt))

    /* 真的把文件塞进 file input */
    const doc = await send('DOM.getDocument', { depth: -1 })
    const q = await send('DOM.querySelector', {
      nodeId: doc.result.root.nodeId, selector: 'input[type=file][accept*="xlsx"]',
    })
    const nodeId = q.result?.nodeId
    check('找得到 xlsx 的 file input', !!nodeId && nodeId > 0, String(nodeId))
    await send('DOM.setFileInputFiles', { nodeId, files: [XLSX_PATH] })
    await sleep(4000)

    txt = await ev(`document.body.innerText`)
    check('预览显示「识别到 29 条」', /识别到\s*29\s*条/.test(txt),
      (txt.match(/[^\n]*识别到[^\n]*/) ?? ['(没有)'])[0])
    check('预览显示新增 29 / 更新 0', /新增\s*29/.test(txt) && /更新\s*0/.test(txt),
      (txt.match(/[^\n]*新增[^\n]*/) ?? ['(没有)'])[0])
    check('★ 预览显示「已忽略 8 列不需要的信息」', /已忽略 8 列不需要的信息/.test(txt),
      (txt.match(/[^\n]*已忽略[^\n]*/) ?? ['(没有)'])[0])
    check('预览列出了识别到的课程（实体解码后是中文）', /浓缩的世界史/.test(txt),
      (txt.match(/[^\n]*浓缩[^\n]*/) ?? ['(没有)'])[0])
    check('★ 上传即预览——预览阶段只发 1 次请求（dryRun，没写库）',
      posts.length === 1 && posts[0] === 'POST', JSON.stringify(posts))

    const beforeNodes = (await fetch(`${BASE}/api/grades`, { headers: { Authorization: `Bearer ${sid}` } })
      .then((r) => r.json()))?.data?.grades?.length ?? -1
    check('★ 预览之后服务端仍然是 0 条', beforeNodes === 0, String(beforeNodes))

    /* 确认导入 */
    const ok = await ev(`(function(){
      var b = Array.prototype.slice.call(document.querySelectorAll('button'))
        .filter(function (x) { return (x.textContent || '').trim() === '确认导入' })[0];
      if (!b) return false;
      b.click();
      return true;
    })()`)
    check('点到了「确认导入」', ok === true)
    /* ⚠️ 成功提示 3.2 秒后自动消失，别等太久才去读 */
    await sleep(1200)
    txt = await ev(`document.body.innerText`)
    check('★ 弹出了导入完成提示（新增 29）', /成绩导入完成/.test(txt) && /新增 29/.test(txt),
      (txt.match(/[^\n]*导入完成[^\n]*/) ?? ['(没有)'])[0])
    check('★ 导入历史里出现了「成绩表格 (.xlsx)」', /成绩表格/.test(txt))
    check('确认时又发了一次 POST（预览 1 + 确认 1 = 2）', posts.length === 2, JSON.stringify(posts))

    const after = (await fetch(`${BASE}/api/grades`, { headers: { Authorization: `Bearer ${sid}` } }).then((r) => r.json()))
    check('★ 服务端真的有 29 条成绩', (after?.data?.grades ?? []).length === 29,
      String((after?.data?.grades ?? []).length))
    check('★ 服务端学分合计 66.5', after?.data?.summary?.credit === 66.5, String(after?.data?.summary?.credit))

    /* 学分总览上应该看不到「未收集」—— 这份表格 12 个字段齐 */
    await send('Page.navigate', { url: appUrl })
    await sleep(4000)
    await ev(`(function(){var el=document.querySelector('[aria-label^="我的课程"]'); if(el) el.click(); return !!el})()`)
    await sleep(2500)
    await ev(`(function(){var b=Array.prototype.slice.call(document.querySelectorAll('button')).filter(function(x){return (x.getAttribute('aria-label')||'').indexOf('在修课程')>=0})[0]; if(b) b.click(); return !!b})()`)
    await sleep(3000)
    const creditsTxt = await ev(`document.body.innerText`)
    check('★ 导入的数据在学分总览上正常显示', /浓缩的世界史/.test(creditsTxt),
      creditsTxt.slice(0, 80).replace(/\n/g, ' '))
    check('★ 字段齐全 → 不该出现「未收集」', !/未收集/.test(creditsTxt),
      (creditsTxt.match(/[^\n]*未收集[^\n]*/g) ?? []).slice(0, 2).join(' | '))
    check('导入过程中页面没有未捕获异常', excs.length === 0, JSON.stringify(excs).slice(0, 240))

    ws.close()
  } finally {
    proc.kill('SIGKILL')
    await rm(`${TMP}\\cv-gxa-ui`, { recursive: true, force: true }).catch(() => {})
  }
}

/* ------------------------------ 汇总 ------------------------------ */


console.log('')
console.log('==================================================')
console.log(`  通过 ${pass} / ${pass + fail}`)
for (const f of failures) console.log(`   FAIL ${f}`)
console.log('==================================================')
process.exitCode = fail ? 1 : 0
