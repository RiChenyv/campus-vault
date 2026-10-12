/**
 * 个人中心统计口径的纯函数测试（`lib/stats.ts`）。
 *
 * 这两个数原来写死在 data/mock.ts 里（连续 12 天 / 本周 7 份），
 * 接真实数据后"怎么算"必须钉住 —— 尤其是**跨天**和**今天还没记录**这两种情况。
 */

import { activityStreak, startOfWeek, dayKey } from '../../src/lib/stats.ts'

let pass = 0
let fail = 0
const failures = []
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; failures.push(`${name}  ${extra}`); console.log(`FAIL  ${name}${extra ? `  (${extra})` : ''}`) }
}
const section = (t) => { console.log(''); console.log(`--- ${t} ---`) }

/** 造一个"现在"：2026-10-08（周四）12:00 本地时间 */
const NOW = new Date(2026, 9, 8, 12, 0, 0)
const day = (offset) => {
  const d = new Date(NOW)
  d.setDate(d.getDate() + offset)
  return dayKey(d)
}
/** 只有有记录的日子才会出现在 days 里；这里只给"有活动"的那些 */
const days = (...offsets) => offsets.map((o) => ({ date: day(o), count: 1 }))

section('连续记录')
check('没有任何活动 → 0', activityStreak([], NOW) === 0, String(activityStreak([], NOW)))
check('只有今天 → 1', activityStreak(days(0), NOW) === 1, String(activityStreak(days(0), NOW)))
check('今天 + 昨天 → 2', activityStreak(days(0, -1), NOW) === 2, String(activityStreak(days(0, -1), NOW)))
check('今天 + 昨天 + 前天 → 3', activityStreak(days(0, -1, -2), NOW) === 3, String(activityStreak(days(0, -1, -2), NOW)))

/* 这条是关键口径：白天打开个人中心时，今天还没 push 不该把连续记录清成 0 */
check('**今天还没记录、昨天有** → 仍然算 1（不是 0）',
  activityStreak(days(-1), NOW) === 1, String(activityStreak(days(-1), NOW)))
check('今天还没记录、昨天+前天有 → 2',
  activityStreak(days(-1, -2), NOW) === 2, String(activityStreak(days(-1, -2), NOW)))
check('今天和昨天都没有（只有前天）→ 0（不往前凑数）',
  activityStreak(days(-2), NOW) === 0, String(activityStreak(days(-2), NOW)))
check('中间断了就停（今天、昨天、三天前）→ 2',
  activityStreak(days(0, -1, -3), NOW) === 2, String(activityStreak(days(0, -1, -3), NOW)))
check('count 为 0 的日子不算活动（接口只返回有记录的，但也不能被 0 蒙混）',
  activityStreak([{ date: day(0), count: 0 }, { date: day(-1), count: 2 }], NOW) === 1,
  String(activityStreak([{ date: day(0), count: 0 }, { date: day(-1), count: 2 }], NOW)))
check('跨月也能连（9/30 与 10/1）',
  activityStreak([{ date: '2026-09-30', count: 1 }, { date: '2026-10-01', count: 1 }, { date: day(0), count: 1 }].filter((x) => x.date === '2026-09-30' || x.date === '2026-10-01'), new Date(2026, 9, 1, 9)) === 2,
  '9/30 + 10/1')

section('本周起点（周一 00:00）')
const monday = (d) => {
  const t = new Date(startOfWeek(d))
  return `${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()} ${t.getHours()}:${t.getMinutes()}`
}
check('周四 → 本周一', monday(new Date(2026, 9, 8, 12)) === '2026-10-5 0:0', monday(new Date(2026, 9, 8, 12)))
check('**周一当天 → 就是当天**（不能退到上周一）', monday(new Date(2026, 9, 5, 0)) === '2026-10-5 0:0', monday(new Date(2026, 9, 5, 0)))
check('**周日 → 上一个周一**（周日不是一周的开始）', monday(new Date(2026, 9, 11, 23)) === '2026-10-5 0:0', monday(new Date(2026, 9, 11, 23)))
check('跨月：11/1 是周日 → 10/26', monday(new Date(2026, 10, 1, 10)) === '2026-10-26 0:0', monday(new Date(2026, 10, 1, 10)))
check('时间是当天 00:00（不是"现在减 7 天"）',
  new Date(startOfWeek(new Date(2026, 9, 8, 23, 59))).getHours() === 0,
  String(new Date(startOfWeek(new Date(2026, 9, 8, 23, 59))).getHours()))

section('dayKey 与后端口径一致（本地自然日，不是 UTC）')
check('晚上 23:30 仍算当天', dayKey(new Date(2026, 9, 8, 23, 30)) === '2026-10-08', dayKey(new Date(2026, 9, 8, 23, 30)))
check('凌晨 00:30 算当天', dayKey(new Date(2026, 9, 8, 0, 30)) === '2026-10-08', dayKey(new Date(2026, 9, 8, 0, 30)))
check('月份/日期补零', dayKey(new Date(2026, 0, 5)) === '2026-01-05', dayKey(new Date(2026, 0, 5)))

console.log('')
console.log('==================================================')
console.log(`  通过 ${pass} / ${pass + fail}${fail ? `（失败 ${fail}）` : ''}`)
console.log('==================================================')
if (fail) for (const x of failures) console.log('  FAIL ' + x)
process.exit(fail ? 1 : 0)
