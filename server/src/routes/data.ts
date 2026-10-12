import { Router } from 'express'
import type { Db } from '../db.ts'
import { getUser, requireAuth } from '../lib/auth.ts'
import { badRequest, notFound, ok, param, wrap } from '../lib/http.ts'
import { logActivity, heatmap, startOfLocalDay } from '../lib/activity.ts'
import { removeStored } from '../lib/storage.ts'
import { courseIndexOf, isUniqueViolation, listGrades, matchCourseId, normalizeGrade } from '../lib/grades.ts'

/**
 * 清理不再被任何灵感/待办引用的文件。
 *
 * 为什么必须做：`idea_images` / `todo_attachments` 是关联表，
 * 删掉灵感只会级联删掉**关联行**，`files` 里的记录和磁盘上的字节会留下来 ——
 * 攒久了就是一堆永远访问不到的垃圾文件。
 *
 * 判定「孤儿」的条件：该用户的、scope 属于这两类的文件，
 * 且在两张关联表里都找不到引用。
 */
function purgeOrphanFiles(db: Db, dataDir: string, ownerId: number, scopes: string[]) {
  const ph = scopes.map(() => '?').join(',')
  const orphans = db
    .prepare(
      `SELECT f.id, f.store_path FROM files f
        WHERE f.owner_id = ? AND f.scope IN (${ph})
          AND NOT EXISTS (SELECT 1 FROM idea_images ii WHERE ii.file_id = f.id)
          AND NOT EXISTS (SELECT 1 FROM todo_attachments ta WHERE ta.file_id = f.id)`,
    )
    .all(ownerId, ...scopes) as { id: string; store_path: string }[]

  if (!orphans.length) return 0
  const del = db.prepare('DELETE FROM files WHERE id = ?')
  for (const f of orphans) {
    // 先删库行再删磁盘，和单文件删除保持同一顺序：
    // 反过来的话崩在中间会留下"行在文件没了"的死记录
    del.run(f.id)
    void removeStored(dataDir, f.store_path)
  }
  return orphans.length
}

/* ============================== 灵感 ============================== */

export function ideaRoutes(db: Db, dataDir: string): Router {
  const r = Router()
  r.use(requireAuth(db))

  const imagesOf = (ideaId: number) =>
    (
      db
        .prepare(
          `SELECT f.id, f.name, f.kind, f.bytes FROM idea_images ii
             JOIN files f ON f.id = ii.file_id
            WHERE ii.idea_id = ? ORDER BY ii.sort`,
        )
        .all(ideaId) as { id: string; name: string; kind: string; bytes: number }[]
    ).map((f) => ({ ...f, url: `/api/files/${f.id}/raw` }))

  r.get(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const rows = db
        .prepare('SELECT id, text, created_at FROM ideas WHERE owner_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 500')
        .all(me.id) as { id: number; text: string; created_at: number }[]
      ok(res, {
        ideas: rows.map((x) => ({ id: x.id, text: x.text, createdAt: x.created_at, images: imagesOf(x.id) })),
      })
    }),
  )

  r.post(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
      const fileIds: string[] = Array.isArray(req.body?.fileIds) ? req.body.fileIds.slice(0, 12) : []
      if (!text && !fileIds.length) throw badRequest('内容和图片不能都为空')

      const now = Date.now()
      const info = db
        .prepare('INSERT INTO ideas (owner_id, text, created_at) VALUES (?, ?, ?)')
        .run(me.id, text, now)
      const id = Number(info.lastInsertRowid)

      const ins = db.prepare('INSERT OR IGNORE INTO idea_images (idea_id, file_id, sort) VALUES (?, ?, ?)')
      let sort = 0
      for (const fid of fileIds) {
        // 只能挂自己的文件，否则可以引用别人的图
        const own = db.prepare('SELECT owner_id FROM files WHERE id = ?').get(fid) as { owner_id: number } | undefined
        if (own && own.owner_id === me.id) ins.run(id, fid, sort++)
      }

      logActivity(db, me.id, 'idea', String(id))
      ok(res, { idea: { id, text, createdAt: now, images: imagesOf(id) } })
    }),
  )

  r.delete(
    '/:id',
    wrap(async (req, res) => {
      const me = getUser(req)
      const id = Number(req.params.id)
      const row = db.prepare('SELECT id, owner_id FROM ideas WHERE id = ?').get(id) as
        | { id: number; owner_id: number }
        | undefined
      if (!row || row.owner_id !== me.id) throw notFound('灵感不存在')
      db.prepare('DELETE FROM ideas WHERE id = ?').run(id)
      // 事件日志也要撤掉，否则热力图会多算一格且永远修不回来
      db.prepare("DELETE FROM activity_log WHERE owner_id = ? AND kind = 'idea' AND ref_id = ?").run(me.id, String(id))
      // 配图文件一并回收，不留孤儿
      purgeOrphanFiles(db, dataDir, me.id, ['idea'])
      ok(res, { done: true })
    }),
  )

  /* ---------------------------- 清空全部 ----------------------------
     一次删光该用户的全部灵感。放在 `/` 上（而不是 `/:id`），
     避免 `/:id` 收到 "all" 这种字符串时走进 Number() 变成 NaN。 */
  r.delete(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const n = (db.prepare('SELECT COUNT(*) AS n FROM ideas WHERE owner_id = ?').get(me.id) as { n: number }).n
      if (!n) {
        ok(res, { removed: 0 })
        return
      }

      // 一个事务里删干净：灵感 + 关联行 + 活动日志
      db.exec('BEGIN')
      try {
        db.prepare('DELETE FROM ideas WHERE owner_id = ?').run(me.id)
        db.prepare("DELETE FROM activity_log WHERE owner_id = ? AND kind = 'idea'").run(me.id)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }

      // 文件回收放在事务外：删磁盘不可能回滚，放进事务只会给人"能回滚"的错觉
      const files = purgeOrphanFiles(db, dataDir, me.id, ['idea'])
      ok(res, { removed: n, files })
    }),
  )

  return r
}

/* ============================== 待办 ============================== */

export function todoRoutes(db: Db, dataDir: string): Router {
  const r = Router()
  r.use(requireAuth(db))

  const attachmentsOf = (todoId: number) =>
    (
      db
        .prepare(
          `SELECT f.id, f.name, f.kind, f.bytes FROM todo_attachments ta
             JOIN files f ON f.id = ta.file_id
            WHERE ta.todo_id = ? ORDER BY ta.sort`,
        )
        .all(todoId) as { id: string; name: string; kind: string; bytes: number }[]
    ).map((f) => ({ ...f, url: `/api/files/${f.id}/raw` }))

  r.get(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const rows = db
        .prepare(
          'SELECT id, title, done, done_at, created_at, sort FROM todos WHERE owner_id = ? ORDER BY done, created_at DESC, rowid DESC LIMIT 1000',
        )
        .all(me.id) as {
        id: number
        title: string
        done: number
        done_at: number | null
        created_at: number
        sort: number
      }[]
      ok(res, {
        todos: rows.map((x) => ({
          id: x.id,
          title: x.title,
          done: x.done === 1,
          doneAt: x.done_at,
          createdAt: x.created_at,
          sort: x.sort,
          attachments: attachmentsOf(x.id),
        })),
      })
    }),
  )

  r.post(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 300) : ''
      const fileIds: string[] = Array.isArray(req.body?.fileIds) ? req.body.fileIds.slice(0, 12) : []
      if (!title && !fileIds.length) throw badRequest('标题不能为空')

      const now = Date.now()
      const info = db
        .prepare('INSERT INTO todos (owner_id, title, created_at) VALUES (?, ?, ?)')
        .run(me.id, title, now)
      const id = Number(info.lastInsertRowid)

      const ins = db.prepare('INSERT OR IGNORE INTO todo_attachments (todo_id, file_id, sort) VALUES (?, ?, ?)')
      let sort = 0
      for (const fid of fileIds) {
        const own = db.prepare('SELECT owner_id FROM files WHERE id = ?').get(fid) as { owner_id: number } | undefined
        if (own && own.owner_id === me.id) ins.run(id, fid, sort++)
      }
      ok(res, {
        todo: { id, title, done: false, doneAt: null, createdAt: now, sort: 0, attachments: attachmentsOf(id) },
      })
    }),
  )

  r.patch(
    '/:id',
    wrap(async (req, res) => {
      const me = getUser(req)
      const id = Number(req.params.id)
      const row = db.prepare('SELECT id, done, owner_id FROM todos WHERE id = ?').get(id) as
        | { id: number; done: number; owner_id: number }
        | undefined
      if (!row || row.owner_id !== me.id) throw notFound('待办不存在')

      if (typeof req.body?.title === 'string') {
        db.prepare('UPDATE todos SET title = ? WHERE id = ?').run(req.body.title.trim().slice(0, 300), id)
      }
      if (typeof req.body?.done === 'boolean') {
        const done = req.body.done
        db.prepare('UPDATE todos SET done = ?, done_at = ? WHERE id = ?').run(done ? 1 : 0, done ? Date.now() : null, id)
        // 完成 → 记一次 push；取消完成 → 撤销这次 push（热力图要跟着回退）
        if (done && row.done === 0) logActivity(db, me.id, 'todo_done', String(id))
        if (!done && row.done === 1) {
          db.prepare("DELETE FROM activity_log WHERE owner_id = ? AND kind = 'todo_done' AND ref_id = ?").run(
            me.id,
            String(id),
          )
        }
      }
      ok(res, { done: true })
    }),
  )

  r.delete(
    '/:id',
    wrap(async (req, res) => {
      const me = getUser(req)
      const id = Number(req.params.id)
      const row = db.prepare('SELECT id, owner_id FROM todos WHERE id = ?').get(id) as
        | { id: number; owner_id: number }
        | undefined
      if (!row || row.owner_id !== me.id) throw notFound('待办不存在')
      db.prepare('DELETE FROM todos WHERE id = ?').run(id)
      db.prepare("DELETE FROM activity_log WHERE owner_id = ? AND kind = 'todo_done' AND ref_id = ?").run(
        me.id,
        String(id),
      )
      // 附件一并回收
      purgeOrphanFiles(db, dataDir, me.id, ['todo'])
      ok(res, { done: true })
    }),
  )

  /* ---------------------------- 清空全部 ---------------------------- */
  r.delete(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const n = (db.prepare('SELECT COUNT(*) AS n FROM todos WHERE owner_id = ?').get(me.id) as { n: number }).n
      if (!n) {
        ok(res, { removed: 0 })
        return
      }

      db.exec('BEGIN')
      try {
        db.prepare('DELETE FROM todos WHERE owner_id = ?').run(me.id)
        // 已完成待办产生过 push，清空时这些日志也要撤掉，
        // 否则热力图会留下永远对不上的计数
        db.prepare("DELETE FROM activity_log WHERE owner_id = ? AND kind = 'todo_done'").run(me.id)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }

      const files = purgeOrphanFiles(db, dataDir, me.id, ['todo'])
      ok(res, { removed: n, files })
    }),
  )

  return r
}

/* ============================== 书签 ============================== */

export function bookmarkRoutes(db: Db): Router {
  const r = Router()
  r.use(requireAuth(db))

  const dto = (x: { id: number; name: string; url: string; note: string; category: string; created_at: number }) => ({
    id: x.id,
    name: x.name,
    url: x.url,
    note: x.note,
    category: x.category,
    createdAt: x.created_at,
  })

  r.get(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const rows = db
        .prepare('SELECT id, name, url, note, category, created_at FROM bookmarks WHERE owner_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1000')
        .all(me.id) as { id: number; name: string; url: string; note: string; category: string; created_at: number }[]
      ok(res, { bookmarks: rows.map(dto) })
    }),
  )

  r.post(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 200) : ''
      let url = typeof req.body?.url === 'string' ? req.body.url.trim().slice(0, 2000) : ''
      const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 1000) : ''
      const category = typeof req.body?.category === 'string' ? req.body.category.trim().slice(0, 40) : ''
      if (!name) throw badRequest('名称不能为空')
      if (!url) throw badRequest('网址不能为空')
      // 自动补协议，用户往往只填 example.com
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`
      try {
        const u = new URL(url)
        // 只允许 http/https —— 挡掉 javascript: data: 这类会在点击时执行脚本的协议
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol')
      } catch {
        throw badRequest('网址格式不正确')
      }

      const now = Date.now()
      const info = db
        .prepare('INSERT INTO bookmarks (owner_id, name, url, note, category, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(me.id, name, url, note, category, now)
      ok(res, { bookmark: dto({ id: Number(info.lastInsertRowid), name, url, note, category, created_at: now }) })
    }),
  )

  r.patch(
    '/:id',
    wrap(async (req, res) => {
      const me = getUser(req)
      const id = Number(req.params.id)
      const row = db.prepare('SELECT id, owner_id FROM bookmarks WHERE id = ?').get(id) as
        | { id: number; owner_id: number }
        | undefined
      if (!row || row.owner_id !== me.id) throw notFound('书签不存在')

      const sets: string[] = []
      const args: (string | number)[] = []
      if (typeof req.body?.name === 'string') {
        sets.push('name = ?')
        args.push(req.body.name.trim().slice(0, 200))
      }
      if (typeof req.body?.url === 'string') {
        let url = req.body.url.trim()
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`
        try {
          const u = new URL(url)
          if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad')
        } catch {
          throw badRequest('网址格式不正确')
        }
        sets.push('url = ?')
        args.push(url.slice(0, 2000))
      }
      if (typeof req.body?.note === 'string') {
        sets.push('note = ?')
        args.push(req.body.note.slice(0, 1000))
      }
      if (typeof req.body?.category === 'string') {
        sets.push('category = ?')
        args.push(req.body.category.trim().slice(0, 40))
      }
      if (!sets.length) throw badRequest('没有要更新的字段')
      args.push(id)
      db.prepare(`UPDATE bookmarks SET ${sets.join(', ')} WHERE id = ?`).run(...args)
      ok(res, { done: true })
    }),
  )

  r.delete(
    '/:id',
    wrap(async (req, res) => {
      const me = getUser(req)
      const id = Number(req.params.id)
      const row = db.prepare('SELECT id, owner_id FROM bookmarks WHERE id = ?').get(id) as
        | { id: number; owner_id: number }
        | undefined
      if (!row || row.owner_id !== me.id) throw notFound('书签不存在')
      db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id)
      ok(res, { done: true })
    }),
  )

  return r
}

/* ============================ 活动日志 / 热力图 ============================ */

export function activityRoutes(db: Db): Router {
  const r = Router()
  r.use(requireAuth(db))

  r.get(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const to = req.query.to ? Number(req.query.to) : Date.now() + 86400000
      const from = req.query.from ? Number(req.query.from) : startOfLocalDay(to) - 180 * 86400000
      if (Number.isNaN(from) || Number.isNaN(to)) throw badRequest('时间参数不正确')
      const days = heatmap(db, me.id, from, to)
      const total = days.reduce((n, d) => n + d.count, 0)
      ok(res, { days, total, from, to })
    }),
  )

  return r
}

/* ------------------------- 日历：本月重要节点 -------------------------
   原来写死在 mock 里，用户不能增删。现在落库，字段和原模型一一对应
   （day / label / tone），前端换数据源时不用改渲染逻辑。
   不写 activity_log —— 热力图统计的是文件/笔记/想法这类学习活动，
   把日历节点塞进去会把热力图数据搞脏。
   ------------------------------------------------------------------- */

/** 三种色调，和前端 toneRgb 的键一一对应 */
const CAL_TONES = new Set(['ddl', 'exam', 'activity'])

export function calendarRoutes(db: Db): Router {
  const r = Router()
  r.use(requireAuth(db))

  const dto = (x: { id: number; day: number; label: string; tone: string; created_at: number }) => ({
    id: x.id,
    day: x.day,
    label: x.label,
    tone: x.tone,
    createdAt: x.created_at,
  })

  const readBody = (body: Record<string, unknown> | undefined) => {
    const day = Number(body?.day)
    // 1~31：前端按"几号"定位，不分月份（和原模型一致）
    if (!Number.isFinite(day) || day < 1 || day > 31) throw badRequest('日期要在 1~31 之间')
    const label = typeof body?.label === 'string' ? body.label.trim().slice(0, 120) : ''
    if (!label) throw badRequest('内容不能为空')
    const rawTone = typeof body?.tone === 'string' ? body.tone : ''
    const tone = CAL_TONES.has(rawTone) ? rawTone : 'activity'
    return { day: Math.round(day), label, tone }
  }

  const one = (id: number) =>
    db.prepare('SELECT id, day, label, tone, created_at FROM calendar_events WHERE id = ?').get(id) as
      | { id: number; day: number; label: string; tone: string; created_at: number }
      | undefined

  r.get(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const rows = db
        .prepare('SELECT id, day, label, tone, created_at FROM calendar_events WHERE owner_id = ? ORDER BY day, created_at, rowid')
        .all(me.id) as { id: number; day: number; label: string; tone: string; created_at: number }[]
      ok(res, { events: rows.map(dto) })
    }),
  )

  r.post(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const v = readBody(req.body)
      const now = Date.now()
      const info = db
        .prepare('INSERT INTO calendar_events (owner_id, day, label, tone, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(me.id, v.day, v.label, v.tone, now)
      const row = one(Number(info.lastInsertRowid))
      ok(res, { event: dto(row!) })
    }),
  )

  r.patch(
    '/:id',
    wrap(async (req, res) => {
      const me = getUser(req)
      const id = Number(param(req, 'id'))
      const cur = db.prepare('SELECT id, owner_id FROM calendar_events WHERE id = ?').get(id) as
        | { id: number; owner_id: number }
        | undefined
      // 归属校验：不能凭 id 就改别人的数据
      if (!cur || cur.owner_id !== me.id) throw notFound('这条安排不存在')
      const v = readBody(req.body)
      db.prepare('UPDATE calendar_events SET day = ?, label = ?, tone = ? WHERE id = ?').run(v.day, v.label, v.tone, id)
      ok(res, { event: dto(one(id)!) })
    }),
  )

  r.delete(
    '/:id',
    wrap(async (req, res) => {
      const me = getUser(req)
      const id = Number(param(req, 'id'))
      const cur = db.prepare('SELECT id, owner_id FROM calendar_events WHERE id = ?').get(id) as
        | { id: number; owner_id: number }
        | undefined
      if (!cur || cur.owner_id !== me.id) throw notFound('这条安排不存在')
      db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id)
      ok(res, { done: true })
    }),
  )

  return r
}

/* ------------------------------ 手写笔记 ------------------------------
   和 files 不同：这些是用户在应用里**直接写**的内容，没有对应的上传文件。
   正文按 Markdown 存、按 Markdown 渲染（复用同一套渲染器）。
   ------------------------------------------------------------------- */

const NOTE_MAX = 200_000 // 单篇 20 万字符，够写一整门课的提纲了

export function notesRoutes(db: Db): Router {
  const r = Router()
  r.use(requireAuth(db))

  interface NoteRow {
    id: number
    owner_id: number
    course_id: string
    title: string
    body: string
    created_at: number
    updated_at: number
  }

  const dto = (x: NoteRow) => ({
    id: x.id,
    courseId: x.course_id,
    title: x.title,
    body: x.body,
    createdAt: x.created_at,
    updatedAt: x.updated_at,
  })

  const row = (id: number) =>
    db
      .prepare(
        `SELECT id, owner_id, course_id, title, body, created_at, updated_at FROM notes WHERE id = ?`,
      )
      .get(id) as NoteRow | undefined

  const readBody = (b: Record<string, unknown> | undefined) => {
    const title = typeof b?.title === 'string' ? b.title.trim().slice(0, 200) : ''
    if (!title) throw badRequest('标题不能为空')
    const body = typeof b?.body === 'string' ? b.body : ''
    if (body.length > NOTE_MAX) throw badRequest('内容太长了')
    const courseId = typeof b?.courseId === 'string' ? b.courseId.trim().slice(0, 64) : ''
    return { title, body, courseId }
  }

  r.get(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const rows = db
        .prepare(
          `SELECT id, owner_id, course_id, title, body, created_at, updated_at FROM notes
            WHERE owner_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 500`,
        )
        .all(me.id) as unknown as NoteRow[]
      ok(res, { notes: rows.map(dto) })
    }),
  )

  r.post(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const v = readBody(req.body)
      const now = Date.now()
      const info = db
        .prepare(
          'INSERT INTO notes (owner_id, course_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(me.id, v.courseId, v.title, v.body, now, now)
      ok(res, { note: dto(row(Number(info.lastInsertRowid))!) })
    }),
  )

  r.patch(
    '/:id',
    wrap(async (req, res) => {
      const me = getUser(req)
      const id = Number(param(req, 'id'))
      const cur = row(id)
      // 归属校验：不能凭 id 改别人的笔记
      if (!cur || cur.owner_id !== me.id) throw notFound('这篇笔记不存在')
      const v = readBody(req.body)
      db.prepare('UPDATE notes SET course_id = ?, title = ?, body = ?, updated_at = ? WHERE id = ?').run(
        v.courseId, v.title, v.body, Date.now(), id,
      )
      ok(res, { note: dto(row(id)!) })
    }),
  )

  /* 全部删掉。和题库的"清空"对应 ——
     用户要的是"能逐条删，也能一次清干净"，两个都得有。
     放在 /:id 之前：集合级操作先于单条操作。 */
  r.delete(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const n = db.prepare('SELECT COUNT(*) AS n FROM notes WHERE owner_id = ?').get(me.id) as { n: number }
      db.prepare('DELETE FROM notes WHERE owner_id = ?').run(me.id)
      ok(res, { removed: n.n })
    }),
  )
  r.delete(
    '/:id',
    wrap(async (req, res) => {
      const me = getUser(req)
      const id = Number(param(req, 'id'))
      const cur = row(id)
      if (!cur || cur.owner_id !== me.id) throw notFound('这篇笔记不存在')
      db.prepare('DELETE FROM notes WHERE id = ?').run(id)
      ok(res, { done: true })
    }),
  )

  return r
}

/* ------------------------------ 课程 ------------------------------
   courses 表原本只为"从教务系统导入"设计。用户还要能自己建课程、配色、写备注，
   所以这里补一套标准的增删改。

   几点说明：
    · 用 requireAuth（会话鉴权），不是 authImport —— 那些是给学校页面脚本用的，
      语义不同：脚本凭令牌，界面凭登录态。
    · 删课程会**连带删掉它的课表格**（schedule_slots 上是 ON DELETE CASCADE）。
      这是对的：课程没了，课表上的格子也不该留着。
    · 附件不会被删 —— files.course_id 只是软关联，删课程后它们变成"未归类"，
      而不是消失。用户不会希望删一门课就丢掉里面的资料。
   ------------------------------------------------------------------ */

/** '92 214 190' -> '#5cd6be'。空串返回空串。 */
function rgbToHex(rgb: string): string {
  const parts = rgb.trim().split(/\s+/)
  if (parts.length !== 3) return ''
  const hex = parts.map((p) => {
    const n = Number(p)
    if (!Number.isFinite(n) || n < 0 || n > 255) return ''
    return Math.round(n).toString(16).padStart(2, '0')
  })
  return hex.some((h) => h === '') ? '' : '#' + hex.join('')
}

/** 预设配色。自己建的课程从里面轮着取，省得让用户填色号 */
const COURSE_COLORS = ['143 178 255', '186 155 255', '92 214 190', '255 179 107', '255 140 140', '142 224 106']

export function courseRoutes(db: Db): Router {
  const r = Router()
  r.use(requireAuth(db))

  interface CourseRow {
    id: number
    owner_id: number
    code: string
    name: string
    teacher: string
    credits: number
    term: string
    room: string
    color: string
    note: string
    manual: number
    created_at: number
    updated_at: number
  }

  /** 附带的文件数 / 笔记数 —— 前端要显示，但不该存在表里（会不同步） */
  const countsOf = (ownerId: number) => {
    const files = db
      .prepare("SELECT course_id, COUNT(*) AS n FROM files WHERE owner_id = ? AND course_id != '' GROUP BY course_id")
      .all(ownerId) as { course_id: string; n: number }[]
    const notes = db
      .prepare("SELECT course_id, COUNT(*) AS n FROM notes WHERE owner_id = ? AND course_id != '' GROUP BY course_id")
      .all(ownerId) as { course_id: string; n: number }[]
    return {
      files: new Map(files.map((x) => [x.course_id, x.n])),
      notes: new Map(notes.map((x) => [x.course_id, x.n])),
    }
  }

  const dto = (x: CourseRow, c: { files: Map<string, number>; notes: Map<string, number> }) => ({
    // 前端一直用字符串 id（mock 里是 c1/c2），这里统一成字符串，避免大量改动
    id: String(x.id),
    name: x.name,
    teacher: x.teacher,
    room: x.room,
    term: x.term,
    credit: x.credits,
    code: x.code,
    note: x.note,
    manual: x.manual === 1,
    /* rgb 是空格分隔的（'92 214 190'，CSS 里要写 rgb(92 214 190 / .2)）。
       color 是十六进制（'#5cd6be'）。**不能直接拼 '#'** ——
       '#92 214 190' 不是合法色值，浏览器会整条忽略。
       这里把三段十进制转成两位十六进制。 */
    color: rgbToHex(x.color),
    rgb: x.color,
    files: c.files.get(String(x.id)) ?? 0,
    notes: c.notes.get(String(x.id)) ?? 0,
    createdAt: x.created_at,
    updatedAt: x.updated_at,
  })

  const one = (id: number) =>
    db
      .prepare('SELECT * FROM courses WHERE id = ?')
      .get(id) as CourseRow | undefined

  r.get(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const rows = db
        .prepare('SELECT * FROM courses WHERE owner_id = ? ORDER BY term DESC, name')
        .all(me.id) as unknown as CourseRow[]
      const c = countsOf(me.id)
      ok(res, { courses: rows.map((x) => dto(x, c)) })
    }),
  )

  r.post(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const b = (req.body ?? {}) as Record<string, unknown>
      const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : ''
      if (!name) throw badRequest('课程名不能为空')
      const teacher = typeof b.teacher === 'string' ? b.teacher.trim().slice(0, 80) : ''
      const room = typeof b.room === 'string' ? b.room.trim().slice(0, 80) : ''
      const term = typeof b.term === 'string' ? b.term.trim().slice(0, 64) : ''
      const note = typeof b.note === 'string' ? b.note.slice(0, 2000) : ''
      const credits = Number(b.credit)
      const safeCredits = Number.isFinite(credits) && credits >= 0 && credits <= 30 ? credits : 0

      /* code 参与唯一索引 (owner_id, code, name, term)。
         自己建的课程没有课程号，用时间戳造一个 —— 否则再建一门同名的
         （比如"重修"）会撞唯一键，报一个用户看不懂的错。 */
      const code = typeof b.code === 'string' && b.code.trim() ? b.code.trim().slice(0, 64) : 'manual-' + Date.now()

      // 配色：没指定就从预设里按已有课程数轮着取，省得让用户填色号
      let color = typeof b.color === 'string' ? b.color.trim().replace(/^#/, '').slice(0, 32) : ''
      if (!color) {
        const n = db.prepare('SELECT COUNT(*) AS n FROM courses WHERE owner_id = ?').get(me.id) as { n: number }
        color = COURSE_COLORS[n.n % COURSE_COLORS.length]!
      }

      const now = Date.now()
      const info = db
        .prepare(
          'INSERT INTO courses (owner_id, code, name, teacher, credits, term, room, raw, color, note, manual, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
        )
        .run(me.id, code, name, teacher, safeCredits, term, room, '', color, note, now, now)
      const c = countsOf(me.id)
      ok(res, { course: dto(one(Number(info.lastInsertRowid))!, c) })
    }),
  )

  r.patch(
    '/:id',
    wrap(async (req, res) => {
      const me = getUser(req)
      const id = Number(param(req, 'id'))
      const cur = one(id)
      // 归属校验：不能凭 id 改别人的课程
      if (!cur || cur.owner_id !== me.id) throw notFound('这门课程不存在')
      const b = (req.body ?? {}) as Record<string, unknown>
      const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : cur.name
      if (!name) throw badRequest('课程名不能为空')
      const pick = (k: keyof CourseRow, max: number) =>
        typeof b[k] === 'string' ? (b[k] as string).trim().slice(0, max) : (cur[k] as string)
      const credits = Number(b.credit)
      db.prepare(
        'UPDATE courses SET name = ?, teacher = ?, room = ?, term = ?, credits = ?, color = ?, note = ?, updated_at = ? WHERE id = ?',
      ).run(
        name, pick('teacher', 80), pick('room', 80), pick('term', 64),
        Number.isFinite(credits) && b.credit !== undefined ? credits : cur.credits,
        typeof b.color === 'string' ? b.color.trim().replace(/^#/, '').slice(0, 32) : cur.color,
        pick('note', 2000), Date.now(), id,
      )
      const c = countsOf(me.id)
      ok(res, { course: dto(one(id)!, c) })
    }),
  )

  r.delete(
    '/:id',
    wrap(async (req, res) => {
      const me = getUser(req)
      const id = Number(param(req, 'id'))
      const cur = one(id)
      if (!cur || cur.owner_id !== me.id) throw notFound('这门课程不存在')
      // 课表格会跟着删（ON DELETE CASCADE）。附件不删，只变成"未归类"。
      db.prepare('DELETE FROM courses WHERE id = ?').run(id)
      ok(res, { done: true })
    }),
  )

  r.delete(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const n = db.prepare('SELECT COUNT(*) AS n FROM courses WHERE owner_id = ?').get(me.id) as { n: number }
      db.prepare('DELETE FROM courses WHERE owner_id = ?').run(me.id)
      ok(res, { removed: n.n })
    }),
  )

  return r
}

/* ------------------------------ 成绩单 ------------------------------
   grades 表见 db.ts 的 v11 迁移。这里只做四件事：读、手工加、改、删。

   几条刻意的选择：
    · 读接口顺带把「课程关联」重新解析一次（listGrades 里做），
      这样"先导成绩、后导课表"也能对上号。
    · **改一条就回整张表**。学分/绩点改了，汇总（已修学分、平均绩点）
      跟着变 —— 只回一条记录的话，前端要么自己重算（两份逻辑），
      要么再拉一次（多一个来回）。数据量很小（几百行），直接回全量最省心，
      也顺手消掉了"汇总和明细对不上"这类 bug。
    · 任何手工改动都把 edited 置 1：之后的导入只补空字段，不覆盖。
      用户要的是"能改"，改完被下一次导入顶回去就等于不能改。
    · 不写 activity_log —— 热力图统计的是学习活动，成绩单不是。
   ------------------------------------------------------------------- */

export function gradeRoutes(db: Db): Router {
  const r = Router()
  r.use(requireAuth(db))

  const rowOf = (id: number) => db.prepare('SELECT * FROM grades WHERE id = ?').get(id) as unknown as
    | import('../lib/grades.ts').GradeRow
    | undefined

  /** 读当前行并套用 PATCH 的字段。`'gpa' in body` 用来区分"没传"和"传了 null"。 */
  const applyPatch = (cur: import('../lib/grades.ts').GradeRow, b: Record<string, unknown>) => {
    const pickStr = (k: string, c: string, max: number) =>
      typeof b[k] === 'string' ? (b[k] as string).replace(/\s+/g, ' ').trim().slice(0, max) : c
    /** PATCH 里显式传 null / '' 表示"清空这个值" */
    const pickNum = (k: string, c: number | null) => {
      if (!(k in b)) return c
      const v = b[k]
      if (v === null || v === '') return null
      const n = Number(v)
      return Number.isFinite(n) ? n : c
    }
    return normalizeGrade({
      /* 课程名不能改成空：它参与唯一键（课程号+课程名+学期+重修），
         置空会让两条不同的成绩撞成同一个键。不传就保持原值。 */
      name: pickStr('courseName', cur.course_name, 200),
      code: cur.course_code,
      term: pickStr('term', cur.term, 64),
      score: pickStr('score', cur.score, 40),
      scoreNum: 'scoreNum' in b ? b.scoreNum : ('score' in b ? null : cur.score_num),
      credit: pickNum('credit', cur.credit) ?? 0,
      gpa: pickNum('gpa', cur.gpa),
      category: pickStr('category', cur.category, 64),
      nature: pickStr('nature', cur.nature, 40),
      mode: pickStr('mode', cur.mode, 40),
      isMajor: 'isMajor' in b ? b.isMajor : cur.is_major === 1,
      examDate: pickStr('examDate', cur.exam_date, 40),
      retake: pickStr('retake', cur.retake, 40),
    })
  }

  /** 写完统一从这里回包：永远回整张表 + 汇总 */
  const reply = (res: Parameters<typeof ok>[0], me: number, extra: Record<string, unknown> = {}) => {
    const data = listGrades(db, me)
    ok(res, { ...data, ...extra })
  }

  r.get(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      reply(res, me.id)
    }),
  )

  /** 手工加一条（学校页面拿不到的课、或者只想自己记一笔） */
  r.post(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const b = (req.body ?? {}) as Record<string, unknown>
      const v = normalizeGrade(b)
      if (!v) throw badRequest('课程名不能为空')
      const now = Date.now()
      const idx = courseIndexOf(db, me.id)
      const code = typeof b.courseId === 'string' ? b.courseId.trim() : ''
      const linked = code && idx.courses.some((c) => c.id === code) ? code : matchCourseId(idx, v).id
      // edited=1：这是用户自己填的，导入不该覆盖
      try {
        const info = db
          .prepare(
            `INSERT INTO grades (owner_id, course_id, course_code, course_name, term, score, score_num, credit,
               gpa, category, nature, mode, is_major, exam_date, retake, edited, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .run(
            me.id, linked, v.courseCode, v.courseName, v.term, v.score, v.scoreNum, v.credit, v.gpa,
            v.category, v.nature, v.mode, v.isMajor, v.examDate, v.retake, now, now,
          )
        reply(res, me.id, { id: Number(info.lastInsertRowid) })
      } catch (e) {
        // 撞唯一键 = 同一门课、同一学期、同一重修状态已经有一条了
        if (isUniqueViolation(e)) throw badRequest('这门课在这个学期已经有一条成绩了', 'GRADE_EXISTS')
        throw e
      }
    }),
  )

  r.patch(
    '/:id',
    wrap(async (req, res) => {
      const me = getUser(req)
      const id = Number(param(req, 'id'))
      const cur = rowOf(id)
      // 归属校验：不能凭 id 改别人的成绩
      if (!cur || cur.owner_id !== me.id) throw notFound('这条成绩不存在')

      const b = (req.body ?? {}) as Record<string, unknown>
      const v = applyPatch(cur, b)
      if (!v) throw badRequest('课程名不能为空')

      /* 关联到哪门课：显式给 courseId 就听它的（空串 = 取消关联），
         否则保留原来的，原来没有就按课程号再试一次。 */
      let courseId = cur.course_id
      if (typeof b.courseId === 'string') {
        const want = b.courseId.trim()
        courseId = want && courseIndexOf(db, me.id).courses.some((c) => c.id === want) ? want : ''
      }
      if (!courseId) courseId = matchCourseId(courseIndexOf(db, me.id), v).id

      try {
        db.prepare(
          `UPDATE grades SET course_id = ?, course_code = ?, course_name = ?, term = ?, score = ?, score_num = ?,
             credit = ?, gpa = ?, category = ?, nature = ?, mode = ?, is_major = ?, exam_date = ?, retake = ?,
             edited = 1, updated_at = ?
           WHERE id = ?`,
        ).run(
          courseId, cur.course_code, v.courseName, v.term, v.score, v.scoreNum, v.credit, v.gpa,
          v.category, v.nature, v.mode, v.isMajor, v.examDate, v.retake, Date.now(), id,
        )
      } catch (e) {
        /* 改名/改学期改成和另一条一样的键就会撞唯一索引。
           这是**输入问题**（改个名字或者先删那条就行），
           不该兜底成"服务器内部错误" —— 那只会让人以为程序坏了。 */
        if (isUniqueViolation(e)) {
          throw badRequest('这个学期已经有一条同名成绩了，换个名字或先删掉那条', 'GRADE_EXISTS')
        }
        throw e
      }
      reply(res, me.id)
    }),
  )
  r.delete(
    '/:id',
    wrap(async (req, res) => {
      const me = getUser(req)
      const id = Number(param(req, 'id'))
      const cur = rowOf(id)
      if (!cur || cur.owner_id !== me.id) throw notFound('这条成绩不存在')
      db.prepare('DELETE FROM grades WHERE id = ?').run(id)
      reply(res, me.id, { done: true })
    }),
  )

  /** 清空整张成绩单。放在 /:id 之前 —— 集合级操作先于单条操作 */
  r.delete(
    '/',
    wrap(async (req, res) => {
      const me = getUser(req)
      const n = db.prepare('SELECT COUNT(*) AS n FROM grades WHERE owner_id = ?').get(me.id) as { n: number }
      db.prepare('DELETE FROM grades WHERE owner_id = ?').run(me.id)
      reply(res, me.id, { removed: n.n })
    }),
  )

  return r
}
