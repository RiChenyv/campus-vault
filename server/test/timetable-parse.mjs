/**
 * 课表 xlsx 解析测试（不需要后端）。
 *
 * 两段：
 *  ① **fixture**：用手造的、但和真实文件同构的表格，逐项核对期望值
 *     （期望值是手算出来的，不是拿实现自己验自己）。
 *  ② **真读一遍用户那份 `timeTableForStu12.xlsx`**：断言课程数 / 时间段数，
 *     并把它解析出来的 25 条与**库里已有的课表**逐字段对照 ——
 *     库里那份是之前用别的路子导进去的，是独立参照物。
 *     这台机器上没有那个文件时打 SKIP（不算失败，也不算通过）。
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { readXlsx } from '../src/lib/xlsx.ts'
import { parseTimetableTable, splitEntries, parseEntry, normalizeTerm } from '../src/lib/timetableXlsx.ts'
import { TT_ROWS, makeTimetableXlsx, REAL_TIMETABLE } from './lib-xlsx-fixture.mjs'

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; failures.push(`${name}  ${extra}`); console.log(`FAIL  ${name}${extra ? '  (' + extra + ')' : ''}`) }
}
const section = (t) => { console.log(''); console.log(`--- ${t} ---`) }

/* ================================================================== */
/*                  ① fixture：手算期望值                             */
/* ================================================================== */

section('解析 fixture（结构和真实文件一致）')
const parsed = parseTimetableTable(TT_ROWS)

console.log('  标题:', parsed.title, '｜学期:', parsed.term)
console.log('  课程:', parsed.courses.length, '门 ｜时间段:', parsed.slotCount, '条 ｜去重掉:', parsed.deduped)
for (const c of parsed.courses) {
  for (const s of c.slots) console.log(`    ${c.name} → 周${s.day} ${s.from}-${s.from + s.span - 1}节 ${s.weeks} ${s.room}`)
}

check('学期归一化：`2026-2027学年 秋季学期课表` → `2026-2027第1学期`', parsed.term === '2026-2027第1学期', parsed.term)
/* 手算：网络空间安全(1) + 通识示例课程二(2: 单周/双周) + 基础示例课程二(1)
        + 数据库原理(1) + 渗透测试(1) = 6 条；
        通识示例课程二在 3-4节 与 5-6节 两行重复 1 条、
        渗透测试在 9-10节 与 11-12节 两行重复 1 条 → 共去重 2 条 */
check('时间段 6 条', parsed.slotCount === 6, String(parsed.slotCount))
check('跨行重复被去掉 2 条', parsed.deduped === 2, String(parsed.deduped))
/* 手算：网络空间安全 / 通识示例课程二 / 基础示例课程二 / 数据库原理 / 渗透测试 = 5 门 */
check('课程 5 门', parsed.courses.length === 5, `${parsed.courses.length}：` + parsed.courses.map((c) => c.name).join(' / '))

const byName = new Map(parsed.courses.map((c) => [c.name, c]))
const design = byName.get('通识示例课程二[13]')
check('一格里的多条时段都收下了（单周 + 双周两个教室）', (design?.slots ?? []).length === 2,
  JSON.stringify((design?.slots ?? []).map((s) => s.weeks + '@' + s.room)))
check('单周写法原样保留', (design?.slots ?? []).some((s) => s.weeks === '1-9周(单)'), JSON.stringify(design?.slots))
check('双周写法原样保留', (design?.slots ?? []).some((s) => s.weeks === '2-8周(双)'), JSON.stringify(design?.slots))
check('课名保留课序号后缀（与库里课程名形态一致）', !!byName.get('通识示例课程二[13]'))

const db2 = byName.get('专业示例课程三[01]')
check('周次里的逗号没被当成条目分隔（`10周,12-13周,15-17周(单)` 保持一条）',
  (db2?.slots ?? []).length === 1 && db2?.slots[0]?.weeks === '10周,12-13周,15-17周(单)',
  JSON.stringify((db2?.slots ?? []).map((s) => s.weeks)))
check('节次按条目自己写的算（5-8节 → from 5 / span 4）',
  (db2?.slots ?? []).some((s) => s.from === 5 && s.span === 4),
  JSON.stringify((db2?.slots ?? []).map((s) => `${s.from}+${s.span}`)))

const net = byName.get('专业示例课程一[01]')
check('课程号解析正确', net?.code === '2121030179', String(net?.code))
check('教师解析正确', net?.teacher === '戊老师', String(net?.teacher))
check('星期/节次正确（周二 1-2 节）', net?.slots?.[0]?.day === 2 && net?.slots?.[0]?.from === 1 && net?.slots?.[0]?.span === 2,
  JSON.stringify(net?.slots))
check('教室解析正确', net?.slots?.[0]?.room === '四十八教603', String(net?.slots?.[0]?.room))

section('读不懂的格子必须报出来（不能静默丢）')
check('badCells 收到那格说明文字', parsed.badCells.length === 1, JSON.stringify(parsed.badCells))
check('badCells 里是那一格原文', /学校新加的说明文字/.test(parsed.badCells[0] ?? ''), String(parsed.badCells[0]))

section('页脚：只提示、不导入')
const noteText = parsed.notes.join(' | ')
check('调课信息进了提示', /调课/.test(noteText), noteText.slice(0, 100))
check('「上课时间未确定」写的是「无」→ 不产生噪音提示', !/上课时间未确定/.test(noteText), noteText.slice(0, 100))

section('边界与错误')
check('按「逗号 + 6位以上课程号」切条目',
  splitEntries('2121030179-x 1-2周,星期1,1-2节,R,2121030229-y 1-2周,星期1,1-2节,R').length === 2,
  String(splitEntries('2121030179-x 1-2周,星期1,1-2节,R,2121030229-y 1-2周,星期1,1-2节,R').length))
check('条目里的逗号不会被切开', splitEntries('2121030179-x 10周,12-13周,星期1,1-2节,R').length === 1)
check('没有星期的格子解析失败（返回 null）', parseEntry('2121030179-x 1-17周,1-2节,教室') === null)
check('没有周次的格子解析失败', parseEntry('2121030179-x 星期1,1-2节,教室') === null)

const termCases = [
  ['2026-2027学年 秋季学期课表', '2026-2027第1学期'],
  ['2025-2026学年 春季学期课表', '2025-2026第2学期'],
]
check('学期写法两种学期都认得', termCases.every(([t, want]) => normalizeTerm(t).term === want),
  termCases.map(([t]) => normalizeTerm(t).term).join(' / '))

let threw = ''
try { parseTimetableTable([['2026-2027学年 秋季学期课表'], ['没有星期表头']]) } catch (e) { threw = e.message }
check('认不出星期表头时明确报错（不是给一张空表）', /星期/.test(threw), threw.slice(0, 80))

let threwTitle = ''
try { parseTimetableTable([['随便一个表格'], ['没有标题也没有表头']]) } catch (e) { threwTitle = e.message }
check('没有课表标题时明确报错', /标题/.test(threwTitle), threwTitle.slice(0, 60))

let threw2 = ''
try { parseTimetableTable([]) } catch (e) { threw2 = e.message }
check('空表格明确报错', /空/.test(threw2), threw2.slice(0, 60))

/* ================================================================== */
/*        ② 真读一遍作者本机那份导出文件（**默认跳过**，见下）          */
/* ================================================================== */
/*
 * 这一段是**一次性核对**：拿作者本机教务系统导出的真文件，和夹具的解析结果对照。
 * 公开仓库里默认**跳过**，原因有两个：
 *   1. 夹具里的课程名/教师名已经脱敏（变成「专业示例课程一」「甲老师」这类），
 *      而真文件里是原名 —— 名字对不上，逐条比对必然失败；
 *   2. 别人的机器上本来就没有这份文件。
 * 作者自己想在本地跑：`$env:CV_REAL='1'; node test/timetable-parse.mjs`
 */
section('真读一遍本机导出的 `timeTableForStu12.xlsx`')
if (process.env.CV_REAL !== '1') {
  console.log('SKIP  这一段默认不跑（夹具已脱敏，与真文件课名不一致）。要跑：$env:CV_REAL=\'1\'')
} else if (!existsSync(REAL_TIMETABLE)) {
  console.log(`SKIP  这台机器上没有 ${REAL_TIMETABLE} —— 这一段没验，**不是通过**。`)
} else {
  const real = parseTimetableTable(readXlsx(readFileSync(REAL_TIMETABLE)).rows)
  console.log(`  ${real.title} ｜${real.term}`)
  console.log(`  课程 ${real.courses.length} 门 · 时间段 ${real.slotCount} 条 · 跨行去重 ${real.deduped} 条 · 读不懂 ${real.badCells.length} 格`)
  check('真实文件：14 门课', real.courses.length === 14, String(real.courses.length))
  check('真实文件：25 个时间段', real.slotCount === 25, String(real.slotCount))
  check('真实文件：学期是 2026-2027第1学期', real.term === '2026-2027第1学期', real.term)
  check('真实文件：没有读不懂的格子', real.badCells.length === 0, JSON.stringify(real.badCells))
  check('真实文件：调课信息只进提示、不进课表', real.notes.some((n) => /调课/.test(n)))
  /* 按**课程号**找而不是按课名：公开仓库里夹具的课名已脱敏，课程号没动 */
  const fourSlot = real.courses.find((c) => c.code === '2121030197')
  check('真实文件：同一门课的多时段都收下了（课程号 2121030197 共 4 条）',
    (fourSlot?.slots ?? []).length === 4, String((fourSlot?.slots ?? []).length))

  /* 与**库里已有的课表**逐字段对照 —— 那份是独立参照物。
     库路径从 DATA_DIR 取（默认 ../data），不写死某台机器的绝对路径。 */
  const DB = resolve(process.env.DATA_DIR ?? './data', 'vault.db')
  if (!existsSync(DB)) {
    console.log(`SKIP  读不到真实库（${DB}），跳过与库里课表的对照。`)
  } else {
    const db = new DatabaseSync(DB, { readOnly: true })
    const rows = db.prepare(
      `SELECT c.name AS cname, s.day, s.from_slot, s.span, s.room, s.weeks
         FROM schedule_slots s JOIN courses c ON c.id = s.course_id
        WHERE s.owner_id = 1`,
    ).all()
    db.close()
    /* 课名比对的归一化：只去课序号后缀 `[01]`。
       ⚠️ 另有一处**真实的数据漂移**：教务系统后来把「体育(3)」改成了
       「体育(3)(示例项目)」，所以文件里那条与库里那条课名不同、时段字段完全一样。
       这一条不该靠"放宽比对"糊过去 —— 单独断言出来，并说明由 courseMatch 的
       前缀规则负责合并（接口那边有对应测试）。 */
    const norm = (n) => n.replace(/[\[［]\s*\d+\s*[\]］]\s*$/, '').replace(/\s+/g, '')
    const dbRows = rows.map((r) => ({ ...r, k: `${norm(r.cname)}|${r.day}|${r.from_slot}|${r.span}|${r.weeks}|${r.room}` }))
    const dbSet = new Map(dbRows.map((r) => [r.k, r]))
    let exact = 0
    const onlyFile = []
    for (const c of real.courses) {
      for (const s of c.slots) {
        const k = `${norm(c.name)}|${s.day}|${s.from}|${s.span}|${s.weeks}|${s.room}`
        if (dbSet.has(k)) { exact++; dbSet.delete(k) } else onlyFile.push(`${c.name} 周${s.day} ${s.from}-${s.from + s.span - 1}节 ${s.weeks} ${s.room}`)
      }
    }
    /* 剩下的是"课名有前缀关系"的那些：按 (星期/节次/周次/教室) 再配一次 */
    const prefixOnly = []
    for (const item of [...onlyFile]) {
      const m = item.match(/^(.*?) 周(\d+) (\d+)-(\d+)节 (.*?) (.*)$/)
      if (!m) continue
      const [, fname, day, from, to, weeks, room] = m
      for (const [k, r] of [...dbSet.entries()]) {
        const [, d, f, sp, w, rm] = k.split('|')
        if (d !== day || f !== from || sp !== String(Number(to) - Number(from) + 1) || w !== weeks || rm !== room) continue
        if (!r.cname.replace(/[\[［]\s*\d+\s*[\]］]\s*$/, '').startsWith(norm(fname))) continue
        prefixOnly.push(`${fname} ↔ 库里 ${r.cname}`)
        dbSet.delete(k)
        onlyFile.splice(onlyFile.indexOf(item), 1)
        break
      }
    }
    /* 口径：逐字段一致 + 只有课名有前缀关系 = 全部对得上，且两边都没有多出来的 */
    check(`与库里已有课表逐字段对上（${rows.length} 条）`,
      exact + prefixOnly.length === rows.length && !onlyFile.length && !dbSet.size,
      `一致 ${exact} + 课名前缀 ${prefixOnly.length} = ${exact + prefixOnly.length}/${rows.length}；` +
      `只有文件里有 ${onlyFile.length}；只有库里有 ${dbSet.size}` +
      (onlyFile.length ? `；例：${onlyFile[0]}` : '') +
      (onlyFile.length || dbSet.size ? `；库里例：${[...dbSet.values()][0]?.cname ?? '-'}` : ''))
    check('课名漂移只有「体育(3)→体育(3)(示例项目)」这一处（交给 courseMatch 前缀规则合并）',
      prefixOnly.length <= 1 && (prefixOnly.length === 0 || /体育/.test(prefixOnly[0] ?? '')),
      prefixOnly.join(' / ') || '（无）')
  }
}

section('产物本身能被 xlsx 解析器读回来（fixture 没造漂）')
const roundTrip = parseTimetableTable(readXlsx(makeTimetableXlsx()).rows)
check('fixture 经 makeZip → readXlsx → 解析，结果与直接传行数组一致',
  roundTrip.slotCount === parsed.slotCount && roundTrip.courses.length === parsed.courses.length,
  `${roundTrip.slotCount} vs ${parsed.slotCount}`)

console.log('')
console.log('==================================================')
console.log(`  通过 ${pass} / ${pass + fail}${fail ? `（失败 ${fail}）` : ''}`)
console.log('==================================================')
if (fail) for (const f of failures) console.log('  FAIL ' + f)
process.exit(fail ? 1 : 0)
