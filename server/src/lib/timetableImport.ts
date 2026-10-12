/**
 * 课表类导入的**共用落库**。
 *
 * 三条导入路（WakeUp 备份 / ICS 日历 / 教务导出的课表 xlsx）拿到的东西
 * 最终形状是一样的：一批课程，每门课带若干时间段。写库规则也就一样：
 *
 *   · 课程按**唯一键 (owner, code, name, term)** upsert；
 *   · 每门课的时间段**先删后插**（导入即"这门课的课表以这份文件为准"）；
 *   · 写之前抓一份快照，导入历史里能撤销；
 *   · 全程一个事务，出错整体回滚。
 *
 * 为什么必须共用：这三套原来各写一份，改一处忘一处就会出现
 * "xlsx 导进去能撤销、ICS 导进去撤不了"这种莫名其妙的差异。
 * 成绩那边已经吃过同款教训（见交接文档：加新导入方式务必走同一套落库）。
 */

import type { Db } from '../db.ts'
import { captureSnapshot, logImport } from './importSnapshot.ts'

export interface IncomingSlot {
  /** 1=周一 … 7=周日 */
  day: number
  from: number
  span: number
  room: string
  weeks: string
}

export interface IncomingCourse {
  code: string
  name: string
  /** 空串表示这份文件里没有教师信息 —— 那就**不要覆盖**已有值 */
  teacher?: string
  term: string
  room?: string
  slots: IncomingSlot[]
}

export interface TimetableWriteResult {
  created: number
  updated: number
  slots: number
}

/**
 * @param source  写进导入历史的来源标记，如 'timetable-xlsx' / 'wakeup-file'
 * @param labelOf 生成导入历史里那句人话。做成函数是因为**文案里带条数**，
 *                而条数只有写完才知道；三条路的措辞又各不相同，不该由这里统一。
 */
export function writeTimetableImport(
  db: Db,
  ownerId: number,
  courses: IncomingCourse[],
  source: string,
  labelOf: (r: TimetableWriteResult) => string,
  detail: Record<string, unknown> = {},
): TimetableWriteResult {
  const snapshot = captureSnapshot(db, ownerId)
  const now = Date.now()
  let created = 0
  let updated = 0
  let slots = 0

  db.exec('BEGIN')
  try {
    /* 先取一份"导入前已存在哪些课"的快照用于计数 ——
       必须在写入过程中判断，否则同一批里重复出现的课会被算两次 */
    const existingRows = db
      .prepare('SELECT id, code, name, term FROM courses WHERE owner_id = ?')
      .all(ownerId) as { id: number; code: string; name: string; term: string }[]
    const existing = new Set(existingRows.map((x) => `${x.code}|${x.name}|${x.term}`))

    const upsert = db.prepare(
      `INSERT INTO courses (owner_id, code, name, teacher, credits, term, room, raw, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, '', ?, ?)
       ON CONFLICT(owner_id, code, name, term) DO UPDATE SET
         /* 文件里没有教师时**保留**已有的 —— 直接写 excluded.teacher
            会把 WakeUp 那条路（不带教师）的已有教师冲成空串 */
         teacher    = CASE WHEN excluded.teacher <> '' THEN excluded.teacher ELSE teacher END,
         room       = excluded.room,
         updated_at = excluded.updated_at`,
    )
    const findId = db.prepare('SELECT id FROM courses WHERE owner_id = ? AND code = ? AND name = ? AND term = ?')
    const delSlots = db.prepare('DELETE FROM schedule_slots WHERE course_id = ?')
    const insSlot = db.prepare(
      `INSERT INTO schedule_slots (owner_id, course_id, day, from_slot, span, room, weeks, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )

    for (const c of courses) {
      const key = `${c.code}|${c.name}|${c.term}`
      const existed = existing.has(key)
      upsert.run(ownerId, c.code, c.name, c.teacher ?? '', c.term, c.room ?? '', now, now)
      const row = findId.get(ownerId, c.code, c.name, c.term) as { id: number } | undefined
      if (!row) continue
      if (existed) updated++
      else created++

      delSlots.run(row.id)
      for (const s of c.slots) {
        insSlot.run(ownerId, row.id, s.day, s.from, s.span, s.room, s.weeks, now)
        slots++
      }
    }

    const result = { created, updated, slots }
    logImport(db, ownerId, source, labelOf(result), { ...result, ...detail }, snapshot)
    db.exec('COMMIT')
    return result
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
