/**
 * 个人中心的几个统计口径 —— 纯函数，单独可测。
 *
 * 这些数原来全在 `data/mock.ts` 里写死（连续记录 12 天 / 本周笔记 7 份 /
 * 题库正确率 87%）。接真实数据后，"怎么算"这件事必须有个明确、可核对的地方，
 * 所以抽到这里，而不是散在组件里。
 */

/** 本地自然日的 `YYYY-MM-DD`（和后端 activity 的日期口径一致） */
export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * 本周一 00:00 的时间戳（本地）。
 *
 * 周一开头是全项目的约定（`lib/monthGrid.ts` 的月历、课表的周次都是周一开头），
 * 所以"本周"也按周一起算，不要一半周一半周日。
 */
export function startOfWeek(now: Date = new Date()): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // 周一 = 0
  return d.getTime()
}

/**
 * 连续记录天数：从今天往回数，连续有多少天有 push。
 *
 * 两个刻意的口径：
 *  · **今天还没 push 不算断** —— 从昨天起算。否则每天早上一打开个人中心，
 *    "连续记录"都显示 0，看起来像把之前的记录弄丢了。
 *  · 今天和昨天都没有 → 老实返回 0，不退到更早去凑一个好看的数字。
 *
 * @param days 后端 `/api/activity` 的 days（只有有记录的日子才在里面）
 */
export function activityStreak(days: { date: string; count: number }[], now: Date = new Date()): number {
  const active = new Set(days.filter((d) => d.count > 0).map((d) => d.date))
  if (!active.size) return 0

  const cur = new Date(now)
  cur.setHours(0, 0, 0, 0)
  if (!active.has(dayKey(cur))) {
    cur.setDate(cur.getDate() - 1)
    if (!active.has(dayKey(cur))) return 0
  }
  let n = 0
  while (active.has(dayKey(cur))) {
    n++
    cur.setDate(cur.getDate() - 1)
  }
  return n
}
