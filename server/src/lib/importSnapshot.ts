/**
 * 导入的"快照 / 撤销"。
 *
 * 为什么需要：导入是**破坏性**的 —— `/import` 对已存在的课程会
 * 先删掉它的旧课表位置再写新的（否则重复导入会不断追加）。
 * 一个解析错误就能把好好的课表改烂，而用户没有任何退路。
 *
 * 做法：写库**之前**把该用户的 courses + schedule_slots + grades 整个序列化进
 * import_log.detail。数据量很小（十几门课、几十条时间段、几十条成绩，几 KB），
 * 存全量比存 diff 简单得多，也不会因为漏记某个字段而还原不干净。
 *
 * 只保留最近若干次的快照，避免日志表无限膨胀。
 */

import type { Db } from '../db.ts'

export interface Snapshot {
  courses: unknown[]
  slots: unknown[]
  /**
   * 成绩单。**可选**：v11 之前的快照里没有这一项。
   * 撤销时见到 undefined 就跳过成绩还原 —— 否则"撤销一次课表导入"
   * 会把用户后来导入的成绩一起抹掉，那比不撤销更糟。
   */
  grades?: unknown[]
}

/** 撤销时最多往前找几条日志（跳过没有快照的旧记录） */
const MAX_LOOKBACK = 20

export function captureSnapshot(db: Db, ownerId: number): Snapshot {
  return {
    courses: db
      .prepare(
        `SELECT id, code, name, teacher, credits, term, room, raw, created_at, updated_at
           FROM courses WHERE owner_id = ?`,
      )
      .all(ownerId),
    slots: db
      .prepare(
        `SELECT id, course_id, day, from_slot, span, room, weeks, created_at
           FROM schedule_slots WHERE owner_id = ?`,
      )
      .all(ownerId),
    grades: db
      .prepare(
        `SELECT id, course_id, course_code, course_name, term, score, score_num, credit, gpa,
                category, nature, mode, is_major, exam_date, retake, edited, created_at, updated_at
           FROM grades WHERE owner_id = ?`,
      )
      .all(ownerId),
  }
}

/**
 * 写一条导入日志，并把快照一起存进去。
 * 所有导入路径都应该走这个函数，而不是自己 INSERT ——
 * 否则那条路径就没有撤销能力，用户也不知道为什么。
 */
export function logImport(
  db: Db,
  ownerId: number,
  source: string,
  summary: string,
  detail: Record<string, unknown>,
  snapshot: Snapshot,
): void {
  db.prepare(
    'INSERT INTO import_log (owner_id, source, summary, detail, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(ownerId, source, summary, JSON.stringify({ ...detail, snapshot }), Date.now())

  // 只留最近 10 条带快照的日志，超出的把快照字段摘掉（保留摘要供查阅）
  const rows = db
    .prepare(
      `SELECT id, detail FROM import_log
        WHERE owner_id = ? AND detail LIKE '%"snapshot"%'
        ORDER BY created_at DESC LIMIT -1 OFFSET 10`,
    )
    .all(ownerId) as { id: number; detail: string }[]
  for (const r of rows) {
    try {
      const d = JSON.parse(r.detail) as Record<string, unknown>
      delete d.snapshot
      db.prepare('UPDATE import_log SET detail = ? WHERE id = ?').run(JSON.stringify(d), r.id)
    } catch {
      /* detail 坏了就留着，不影响主流程 */
    }
  }
}

export interface UndoResult {
  restoredCourses: number
  restoredSlots: number
  fromSource: string
  fromTime: number
}

/**
 * 撤销最近一次带快照的导入。
 * 返回 null 表示没有可撤销的记录 —— 调用方应当明确告诉用户，
 * 而不是假装成功。
 */
export function undoLastImport(db: Db, ownerId: number): UndoResult | null {
  const rows = db
    .prepare(
      `SELECT id, source, detail, created_at FROM import_log
        WHERE owner_id = ? AND detail LIKE '%"snapshot"%'
        ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(ownerId, MAX_LOOKBACK) as { id: number; source: string; detail: string; created_at: number }[]

  for (const row of rows) {
    let snap: Snapshot | null = null
    try {
      const d = JSON.parse(row.detail) as { snapshot?: Snapshot }
      if (d.snapshot && Array.isArray(d.snapshot.courses) && Array.isArray(d.snapshot.slots)) snap = d.snapshot
    } catch {
      continue
    }
    if (!snap) continue

    db.exec('BEGIN')
    try {
      // 先清空再按快照重建。id 一并还原，这样课程与课表位置的关联不会错位。
      db.prepare('DELETE FROM schedule_slots WHERE owner_id = ?').run(ownerId)
      db.prepare('DELETE FROM courses WHERE owner_id = ?').run(ownerId)

      const insCourse = db.prepare(
        `INSERT INTO courses (id, owner_id, code, name, teacher, credits, term, room, raw, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const c of snap.courses as Record<string, string | number>[]) {
        insCourse.run(
          c.id as number, ownerId, String(c.code ?? ''), String(c.name ?? ''),
          String(c.teacher ?? ''), Number(c.credits ?? 0), String(c.term ?? ''),
          String(c.room ?? ''), String(c.raw ?? ''),
          Number(c.created_at ?? Date.now()), Number(c.updated_at ?? Date.now()),
        )
      }

      const insSlot = db.prepare(
        `INSERT INTO schedule_slots (id, owner_id, course_id, day, from_slot, span, room, weeks, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const s of snap.slots as Record<string, string | number | null>[]) {
        insSlot.run(
          s.id as number, ownerId, (s.course_id ?? null) as number | null,
          Number(s.day ?? 1), Number(s.from_slot ?? 1), Number(s.span ?? 1),
          String(s.room ?? ''), String(s.weeks ?? ''), Number(s.created_at ?? Date.now()),
        )
      }

      /* 成绩单：**只有快照里确实存过**才还原。
         v11 之前的快照没有 grades 字段，那种情况必须原样留着 ——
         否则"撤销一次课表导入"会把用户后来导入的成绩一起删掉。 */
      if (Array.isArray(snap.grades)) {
        db.prepare('DELETE FROM grades WHERE owner_id = ?').run(ownerId)
        const insGrade = db.prepare(
          `INSERT INTO grades (id, owner_id, course_id, course_code, course_name, term, score, score_num,
             credit, gpa, category, nature, mode, is_major, exam_date, retake, edited, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        for (const g of snap.grades as Record<string, string | number | null>[]) {
          insGrade.run(
            g.id as number, ownerId, String(g.course_id ?? ''), String(g.course_code ?? ''),
            String(g.course_name ?? ''), String(g.term ?? ''), String(g.score ?? ''),
            g.score_num === null || g.score_num === undefined ? null : Number(g.score_num),
            Number(g.credit ?? 0),
            g.gpa === null || g.gpa === undefined ? null : Number(g.gpa),
            String(g.category ?? ''), String(g.nature ?? ''), String(g.mode ?? ''),
            Number(g.is_major ?? 0), String(g.exam_date ?? ''), String(g.retake ?? ''),
            Number(g.edited ?? 0), Number(g.created_at ?? Date.now()), Number(g.updated_at ?? Date.now()),
          )
        }
      }

      // 这条日志被消费掉了，摘掉快照避免撤销两次
      const d = JSON.parse(row.detail) as Record<string, unknown>
      delete d.snapshot
      db.prepare('UPDATE import_log SET detail = ? WHERE id = ?').run(JSON.stringify(d), row.id)

      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }

    return {
      restoredCourses: snap.courses.length,
      restoredSlots: snap.slots.length,
      fromSource: row.source,
      fromTime: row.created_at,
    }
  }
  return null
}
