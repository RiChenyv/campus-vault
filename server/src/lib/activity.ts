import type { Db } from '../db.ts'

/**
 * 活动日志 —— 热力图的**唯一真相**。
 *
 * 关键设计：存「事件流水」，不存「每天计数」。
 *
 * 为什么：热力图的每一格是"那天 push 了几次"。如果直接存计数，
 * 用户删掉一篇那天的笔记，计数不会回退 —— 热力图就永远多一格，
 * 而且没有任何办法修回来。存流水的话，计数是查询时按天聚合出来的，
 * 删掉事件源自然就对上了。
 *
 * 一次 push 的三种来源（与前端 README 的口径一致）：
 *   file      上传文件 —— **一次上传动作算一次**，不是每个文件算一次（见下）
 *   todo_done 完成待办
 *   idea      新建灵感
 *
 * ⚠️ 上传为什么要带 `batchKey`：
 * 前端是**逐个文件**发 POST 的（一个失败不影响其它，失败原因也能逐个报出来），
 * 所以服务端光看请求分不出"这是 19 个文件一次传的"还是"他传了 19 次"。
 * 由前端在一次用户动作开始时生成一个 batchKey、同批文件都带着它，
 * 这里配合 v13 的部分唯一索引做幂等插入 —— 同一批只落一条。
 */
export type ActivityKind = 'note' | 'todo_done' | 'file' | 'idea'

/**
 * 记一次活动。
 *
 * @param batchKey 同一"次"上传动作共用的键。给了它就变成幂等插入：
 *                 同 (owner, kind, batchKey) 只会有一条。空串 = 每调用一次记一条。
 * @returns 这次调用是否真的写入了（幂等跳过时返回 false，便于测试断言）
 */
export function logActivity(
  db: Db,
  ownerId: number,
  kind: ActivityKind,
  refId = '',
  at = Date.now(),
  batchKey = '',
): boolean {
  if (batchKey) {
    const r = db
      .prepare(
        `INSERT OR IGNORE INTO activity_log (owner_id, kind, ref_id, created_at, batch_key)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(ownerId, kind, refId, at, batchKey)
    return Number(r.changes) > 0
  }
  db.prepare('INSERT INTO activity_log (owner_id, kind, ref_id, created_at) VALUES (?, ?, ?, ?)').run(
    ownerId,
    kind,
    refId,
    at,
  )
  return true
}

/** 撤销某条事件（删除来源数据时调用） */
export function unlogActivity(db: Db, ownerId: number, kind: ActivityKind, refId: string) {
  db.prepare('DELETE FROM activity_log WHERE owner_id = ? AND kind = ? AND ref_id = ?').run(ownerId, kind, refId)
}

export interface DayCount {
  date: string
  count: number
}

/**
 * 按天聚合，返回 [from, to] 区间内**有记录的**日期。
 * 没有记录的日子不出现在结果里（前端补零），
 * 这样传输量只与活跃天数相关，而不是与区间长度相关。
 *
 * 时区处理：日期按**服务端本地时区**切分。用户的"某一天"就是他自己的
 * 自然日，而这是个本地单用户应用，服务端本地时区 == 用户时区。
 * 若将来要多时区，需要把时区偏移作为参数传进来。
 */
export function heatmap(db: Db, ownerId: number, fromMs: number, toMs: number): DayCount[] {
  const rows = db
    .prepare(
      `SELECT created_at FROM activity_log
        WHERE owner_id = ? AND created_at >= ? AND created_at < ?
        ORDER BY created_at`,
    )
    .all(ownerId, fromMs, toMs) as { created_at: number }[]

  const map = new Map<string, number>()
  for (const r of rows) {
    const key = localDateKey(r.created_at)
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date))
}

/** 时间戳 → 本地时区的 YYYY-MM-DD */
export function localDateKey(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 本地时区某天 00:00 的时间戳 */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
