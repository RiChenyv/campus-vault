import { Router } from 'express'
import { randomBytes } from 'node:crypto'
import multer from 'multer'
import type { Request, Response, NextFunction } from 'express'
import type { Db } from '../db.ts'
import { currentUser, getUser, requireAuth, rateLimit, type SessionUser } from '../lib/auth.ts'
import { badRequest, ok, unauthorized, wrap } from '../lib/http.ts'
import { parseWakeupBackup, weeksLabel } from '../lib/wakeup.ts'
import { parseIcs } from '../lib/ics.ts'
import { captureSnapshot, logImport } from '../lib/importSnapshot.ts'
import { buildIndex, enrichCourse, loadIndex, matchCourse } from '../lib/courseMatch.ts'
import { gradeKey, normalizeGrade, planGrades, upsertGrades } from '../lib/grades.ts'
import { looksLikeXlsx, readXlsx } from '../lib/xlsx.ts'
import { parseGradesTable } from '../lib/gradesXlsx.ts'
import { parseTimetableTable } from '../lib/timetableXlsx.ts'
import { writeTimetableImport, type IncomingCourse } from '../lib/timetableImport.ts'
import { fixFilename } from '../lib/storage.ts'
import { makeFlexAuth, makeImportAuth, userOfToken } from '../lib/importAuth.ts'
import { importTokenOf } from '../lib/http.ts'

/**
 * 在校信息导入。
 *
 * 数据从哪来：**用户自己的浏览器**。
 * 学校页面在 SSO 后面，后端拿不到；也不该拿 —— 那需要保存用户的学校凭据。
 * 所以走「油猴脚本」：用户在自己已登录的浏览器里点一下，
 * 脚本把页面上的结构化数据 POST 到这里。凭据全程不离开用户的浏览器。
 *
 * 三个设计要点：
 *
 * ① **幂等**。同一份数据导入两次不该产生两门重复课程。
 *    用 `(owner_id, code, name, term)` 做唯一键，冲突时更新而不是插入。
 *    没有课程号时退化成「名称 + 学期」，仍然能挡住重复。
 *
 * ② **dry-run**。脚本先问一次"如果我导，会变成什么样"，
 *    用户确认后才真正写库。学校页面结构随时可能变，
 *    没有试运行的话，解析错了会直接把脏数据写进去。
 *
 * ③ **可追溯**。每次导入都写一条 import_log，
 *    出问题时能回答"上次导了什么、什么时候、结果如何"。
 */

interface ImportProfile {
  realName?: string
  studentId?: string
  college?: string
  major?: string
  grade?: string
  className?: string
}

interface ImportCourse {
  code?: string
  name?: string
  teacher?: string
  credits?: number | string
  term?: string
  room?: string
  /** 原始行文本，便于排查解析问题 */
  raw?: string
  /** 这门课的课表位置（可选） */
  slots?: { day?: number; from?: number; span?: number; room?: string; weeks?: string }[]
}

interface ImportPayload {
  profile?: ImportProfile
  courses?: ImportCourse[]
  /** 数据来源标记，如 'userscript@courses.cuc.edu.cn' / 'grades-xlsx' */
  source?: string
  /** 只回报会做什么，不写库 */
  dryRun?: boolean
}

const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const m = v.match(/-?\d+(?:\.\d+)?/)
    if (m) return Number(m[0])
  }
  return 0
}

export function importRoutes(db: Db): Router {
  const r = Router()

  /* 导入接口的鉴权。规则见 lib/importAuth.ts：
     带令牌就只认令牌，站外来源一律要求令牌，本机前端才用 cookie。 */
  const authImport = makeImportAuth(db)
  /* 前端也会调的只读接口用它（会话优先、导入令牌兜底）。见 lib/importAuth.ts */
  const authFlex = makeFlexAuth(db)

  /* xlsx 上传（课表 / 成绩）用**内存**存储：文件只用来解析一次，解析完就丢，
     落磁盘没有任何意义。routes/files.ts 那边用自定义流式引擎是因为要长期
     保存 200MB 的视频，这里不一样 —— 一份表格也就几十 KB。
     ⚠️ 必须定义在**所有**用到它的路由之前：课表 xlsx 那条路在成绩 xlsx 之前注册。 */
  const xlsxUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: 5 },
  })

  /* ---------------------------- 令牌管理（需要登录） ---------------------------- */

  r.get(
    '/import/token',
    requireAuth(db),
    wrap(async (req, res) => {
      const me = getUser(req)
      const rows = db
        .prepare('SELECT token, label, created_at, last_used_at FROM import_tokens WHERE user_id = ? ORDER BY created_at DESC')
        .all(me.id) as { token: string; label: string; created_at: number; last_used_at: number | null }[]
      ok(res, { tokens: rows })
    }),
  )

  r.post(
    '/import/token',
    requireAuth(db),
    wrap(async (req, res) => {
      const me = getUser(req)
      const label = typeof req.body?.label === 'string' ? req.body.label.trim().slice(0, 60) : ''
      const token = `cvi_${randomBytes(24).toString('hex')}`
      db.prepare('INSERT INTO import_tokens (token, user_id, label, created_at) VALUES (?, ?, ?, ?)').run(
        token,
        me.id,
        label,
        Date.now(),
      )
      ok(res, { token })
    }),
  )

  r.delete(
    '/import/token',
    requireAuth(db),
    wrap(async (req, res) => {
      const me = getUser(req)
      const n = db.prepare('DELETE FROM import_tokens WHERE user_id = ?').run(me.id)
      ok(res, { removed: Number(n.changes) })
    }),
  )

  /* ============================== 导入 ============================== */

  /**
   * 预览。油猴脚本先打这个接口，把"识别到哪些字段、哪些是新的、
   * 哪些会更新"回报给用户，确认后再走真正的导入。
   */
  r.post(
    '/import',
    authImport,
    wrap(async (req, res) => {
      const me = getUser(req)
      rateLimit(`import:${me.id}`, 60, 10 * 60 * 1000)

      const body = (req.body ?? {}) as ImportPayload
      /**
       * **缺省是预览，不是写入。**
       *
       * 只有显式传 `dryRun: false` 才真正落库。反过来的话（缺省即写），
       * 一个拼错的请求、一次手滑的 curl 就会把脏数据写进库 ——
       * 而导入的数据来自学校网站，用户很难分辨哪条是解析错的。
       *
       * 油猴脚本两次调用都显式传这个字段，所以对它没有影响。
       */
      const dryRun = body.dryRun !== false
      const source = str(body.source, 200) || 'unknown'

      /* ---------------- 个人资料 ----------------
       *
       * **手填优先**：导入只填补空字段，已有的值一律不动。
       *
       * 之前的逻辑是"非空就覆盖"，结果是用户手填的姓名会被学校页面导来的值顶掉 ——
       * 而界面文案写的是"导入只填补空字段"。两边不一致，用户会以为数据被改了。
       * 这些字段本来就应该由用户说了算（学校门户只给姓名和学院，
       * 学号/专业/年级/班级那边根本没有，只能手填）。
       *
       * 想用学校的数据刷新手填的内容？先把那个字段清空再导一次。
       */
      const p = body.profile ?? {}
      const profileFields: Record<string, string> = {}
      const FIELD_MAP: [keyof ImportProfile, string][] = [
        ['realName', 'real_name'],
        ['studentId', 'student_id'],
        ['college', 'college'],
        ['major', 'major'],
        ['grade', 'grade'],
        ['className', 'class_name'],
      ]

      const curProfile = db
        .prepare(
          `SELECT real_name, student_id, college, major, grade, class_name,
                  (real_name = '' AND student_id = '' AND college = '' AND major = '' AND grade = '' AND class_name = '') AS is_empty
             FROM profiles WHERE user_id = ?`,
        )
        .get(me.id) as Record<string, unknown> | undefined

      const skippedFilled: string[] = []
      for (const [src, col] of FIELD_MAP) {
        const v = str(p[src], 100)
        if (!v) continue // 来的是空值：不覆盖
        // 以及：本机已经有值了就跳过。第一次填（整行全空）时才允许写入。
        const cur = curProfile?.[col]
        if (typeof cur === 'string' && cur !== '') {
          skippedFilled.push(col)
          continue
        }
        profileFields[col] = v
      }

      /* ---------------- 课程 ---------------- */
      const incoming = Array.isArray(body.courses) ? body.courses.slice(0, 200) : []
      const prepared: {
        code: string
        name: string
        teacher: string
        credits: number
        term: string
        room: string
        raw: string
        slots: { day: number; from: number; span: number; room: string; weeks: string }[]
      }[] = []

      for (const c of incoming) {
        const name = str(c.name, 200)
        if (!name) continue // 没名字的行直接丢，不做猜测
        prepared.push({
          code: str(c.code, 64),
          name,
          teacher: str(c.teacher, 100),
          credits: num(c.credits),
          term: str(c.term, 64),
          room: str(c.room, 100),
          raw: str(c.raw, 500),
          slots: (Array.isArray(c.slots) ? c.slots : [])
            .map((s) => ({
              day: Math.min(7, Math.max(1, num(s.day) || 1)),
              from: Math.max(1, num(s.from) || 1),
              span: Math.max(1, Math.min(6, num(s.span) || 1)),
              room: str(s.room, 100),
              weeks: str(s.weeks, 100),
            }))
            .slice(0, 10),
        })
      }

      const existingRows = db
        .prepare('SELECT id, code, name, term FROM courses WHERE owner_id = ?')
        .all(me.id) as { id: number; code: string; name: string; term: string }[]
      const existing = new Map(existingRows.map((x) => [`${x.code}|${x.name}|${x.term}`, x.id]))

      const willCreate: string[] = []
      const willUpdate: string[] = []
      for (const c of prepared) {
        const key = `${c.code}|${c.name}|${c.term}`
        if (existing.has(key)) willUpdate.push(c.name)
        else willCreate.push(c.name)
      }

      const plan = {
        profile: {
          fields: Object.keys(profileFields).length,
          // 只回报字段名，不回报值 —— 预览日志不该把学号这些写进附件
          keys: Object.keys(profileFields),
          // 因为"本机已有值"而跳过的字段。用户手填过什么、导入没动什么，
          // 应当在确认之前就看得见
          skipped: skippedFilled,
        },
        courses: { total: prepared.length, create: willCreate.length, update: willUpdate.length, createNames: willCreate.slice(0, 20), updateNames: willUpdate.slice(0, 20) },
        slots: prepared.reduce((n, c) => n + c.slots.length, 0),
        dryRun,
      }

      if (dryRun) {
        ok(res, plan)
        return
      }

      /* ---------------- 真正写库 ---------------- */
      // 写库前先抓一份快照 —— 导入会覆盖同名课程的旧课表位置，
      // 没有快照的话用户没有任何退路（见 lib/importSnapshot.ts）
      const snapshot = captureSnapshot(db, me.id)

      /* 给用户的提示（比如"合并到了已有课程"）。声明在事务外，
         因为要在最后的 ok(res, ...) 里返回。 */
      const notes: string[] = []

      const now = Date.now()
      let created = 0
      let updated = 0
      let slotsWritten = 0

      db.exec('BEGIN')
      try {
        if (Object.keys(profileFields).length) {
          const cols = Object.keys(profileFields)
          // 列名来自上面的白名单常量，不是外部输入
          const setSql = cols.map((c) => `${c} = ?`).join(', ')
          db.prepare(
            `INSERT INTO profiles (user_id) VALUES (?)
             ON CONFLICT(user_id) DO NOTHING`,
          ).run(me.id)
          db.prepare(`UPDATE profiles SET ${setSql}, imported_at = ? WHERE user_id = ?`).run(
            ...cols.map((c) => profileFields[c]!),
            now,
            me.id,
          )
        }

        /* 匹配顺序：精确键 → 归一化名(去班号)+学期 → 归一化名(唯一时)。
           第二三条是为了把学校课程页导来的 `基础示例课程二` 合并到
           截图导入的 `基础示例课程二[02]` 上，而不是另起一条没有课表的空壳。
           详见 lib/courseMatch.ts。 */
        const idx = buildIndex(existingRows)
        const merged: string[] = []

        const doInsert = db.prepare(
          `INSERT INTO courses (owner_id, code, name, teacher, credits, term, room, raw, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        const delSlots = db.prepare('DELETE FROM schedule_slots WHERE course_id = ?')
        const insSlot = db.prepare(
          `INSERT INTO schedule_slots (owner_id, course_id, day, from_slot, span, room, weeks, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )

        for (const c of prepared) {
          const m = matchCourse(idx, c)
          let id: number

          if (m.id != null) {
            // 命中已有课程：只补空字段，不覆盖 —— 已有数据通常来自更具体的来源
            enrichCourse(db, m.id, c, now)
            id = m.id
            if (m.how === 'exact') updated++
            else {
              updated++
              merged.push(`${c.name} → 已有课程`)
            }
          } else {
            const r = doInsert.run(me.id, c.code, c.name, c.teacher, c.credits, c.term, c.room, c.raw, now, now)
            id = Number(r.lastInsertRowid)
            created++
            // 新建的要立刻进索引，否则同一批里的重复行会各建一条
            existingRows.push({ id, code: c.code, name: c.name, term: c.term })
            Object.assign(idx, buildIndex(existingRows))
          }

          if (c.slots.length) {
            // 重导时先清掉这门课的旧课表位置，避免每次导入都追加一遍
            delSlots.run(id)
            for (const s of c.slots) {
              insSlot.run(me.id, id, s.day, s.from, s.span, s.room || c.room, s.weeks, now)
              slotsWritten++
            }
          }
        }
        if (merged.length) {
          notes.push(`合并到已有课程 ${merged.length} 门：${merged.slice(0, 5).join('、')}`)
        }

        logImport(
          db,
          me.id,
          source,
          `资料 ${Object.keys(profileFields).length} 字段 · 课程新增 ${created} 更新 ${updated} · 课表 ${slotsWritten} 条`,
          { created, updated, slots: slotsWritten, fields: Object.keys(profileFields) },
          snapshot,
        )

        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }

      ok(res, {
        ...plan,
        dryRun: false,
        notes,
        applied: { created, updated, slots: slotsWritten, profileFields: Object.keys(profileFields).length },
      })
    }),
  )

  /* ---------------------------- WakeUp 备份文件 ----------------------------
     比分享口令可靠：本地文件，没有接口门禁、不会过期。
     接收原始文件内容，服务端解析。 */
  r.post(
    '/import/wakeup',
    authImport,
    wrap(async (req, res) => {
      const me = getUser(req)
      rateLimit(`import:${me.id}`, 60, 10 * 60 * 1000)

      // 两种传法都支持：原始文本体，或 JSON 里的 content 字段
      const anyBody = req.body as { content?: unknown; dryRun?: unknown } | string
      const raw =
        typeof anyBody === 'string'
          ? anyBody
          : typeof anyBody?.content === 'string'
            ? anyBody.content
            : ''
      if (!raw.trim()) throw badRequest('没有收到文件内容')

      const dryRun = typeof anyBody === 'string' ? true : anyBody?.dryRun !== false

      /**
       * 解析失败要变成 **400 + 原始中文原因**，而不是 500。
       * 这个接口的报错是写给用户看的（"这不是备份文件""第 2 行不是合法 JSON"），
       * 被兜底成"服务器内部错误"等于把唯一的排查线索丢了。
       */
      let parsed: ReturnType<typeof parseWakeupBackup>
      try {
        parsed = parseWakeupBackup(raw)
      } catch (e) {
        throw badRequest(e instanceof Error ? e.message : '课表文件解析失败', 'BAD_WAKEUP_FILE')
      }

      const payloadCourses = parsed.courses.map((c) => ({
        code: '', // 备份文件里没有课程号，靠「名称 + 学期」做幂等键
        name: c.name,
        term: parsed.tableName || parsed.termStart || '',
        room: c.room,
        slots: c.slots.map((s) => ({
          day: s.day,
          from: s.startNode,
          span: s.step,
          room: s.room,
          weeks: weeksLabel(s.startWeek, s.endWeek, s.weekType),
        })),
      }))

      const summary = {
        tableName: parsed.tableName,
        termStart: parsed.termStart,
        courses: parsed.courses.length,
        slots: payloadCourses.reduce((n, c) => n + c.slots.length, 0),
        notes: parsed.notes,
        dryRun,
      }

      if (dryRun) {
        ok(res, {
          ...summary,
          preview: parsed.courses.map((c) => ({
            name: c.name,
            room: c.room,
            times: c.slots.map((s) => `周${s.day} ${s.startTime}-${s.endTime} ${weeksLabel(s.startWeek, s.endWeek, s.weekType)}`),
          })),
        })
        return
      }

      /* 落库走共用函数：快照 / 事务 / 先删后插 / 导入历史都在里面
         （见 lib/timetableImport.ts，三条课表导入路共用同一套规则） */
      const applied = writeTimetableImport(
        db,
        me.id,
        payloadCourses,
        'wakeup-file',
        (r) => `课表「${parsed.tableName || '未命名'}」：课程新增 ${r.created} 更新 ${r.updated} · 课表 ${r.slots} 条`,
        { tableName: parsed.tableName },
      )

      ok(res, { ...summary, dryRun: false, applied })
    }),
  )

  /* ---------------------------- ICS 日历文件 ----------------------------
     课表 App 普遍支持「导出为日历」，这个入口通常比「导出备份」好找，
     而且是标准格式（RFC 5545），不会随 App 版本变。 */
  r.post(
    '/import/ics',
    authImport,
    wrap(async (req, res) => {
      const me = getUser(req)
      rateLimit(`import:${me.id}`, 60, 10 * 60 * 1000)

      const anyBody = req.body as { content?: unknown; dryRun?: unknown } | string
      const raw = typeof anyBody === 'string' ? anyBody : typeof anyBody?.content === 'string' ? anyBody.content : ''
      if (!raw.trim()) throw badRequest('没有收到文件内容')

      const dryRun = typeof anyBody === 'string' ? true : anyBody?.dryRun !== false

      let parsed: ReturnType<typeof parseIcs>
      try {
        parsed = parseIcs(raw)
      } catch (e) {
        throw badRequest(e instanceof Error ? e.message : 'ICS 解析失败', 'BAD_ICS_FILE')
      }

      const payloadCourses = parsed.courses.map((c) => ({
        code: '',
        name: c.name,
        teacher: c.teacher,
        term: parsed.termStart || '',
        room: c.room,
        slots: c.slots.map((s) => ({
          day: s.day,
          from: 0,
          span: 0,
          room: s.room,
          weeks: s.repeat,
        })),
      }))

      const summary = {
        termStart: parsed.termStart,
        courses: parsed.courses.length,
        slots: payloadCourses.reduce((n, c) => n + c.slots.length, 0),
        notes: parsed.notes,
        dryRun,
      }

      if (dryRun) {
        ok(res, {
          ...summary,
          preview: parsed.courses.map((c) => ({
            name: c.name,
            teacher: c.teacher,
            room: c.room,
            times: c.slots.map((s) => `周${s.day} ${s.startTime}-${s.endTime}${s.repeat ? ' ' + s.repeat : ''}`),
          })),
        })
        return
      }

      /* 同上：ICS 也走共用落库。它的 from_slot 存 0 表示"按钟点而非节次"，
         这个语义由 payloadCourses 自己带着，共用函数不需要知道。 */
      const applied = writeTimetableImport(
        db,
        me.id,
        payloadCourses,
        'ics-file',
        (r) => `ICS 课表：课程新增 ${r.created} 更新 ${r.updated} · 时间段 ${r.slots} 条`,
      )

      ok(res, { ...summary, dryRun: false, applied })
    }),
  )

  /* ---------------------- 教务导出的课表 xlsx ----------------------
     来源：教务系统「课表查看」页的导出（`timeTableForStu12.xlsx` 这种）。

     为什么改成走文件而不是让油猴脚本去啃页面：那一页一个格子里塞了
     4~6 个不同周次 / 不同教室 / 线上线下不同的时段，还靠固定表头把表
     拆成两张，版面一改就全乱。导出的表格是**结构化**的，同一份内容
     解析起来稳得多。

     写库走 writeTimetableImport（和 WakeUp / ICS 共用一套规则），
     所以照样有快照、可撤销、先删后插。 */
  r.post(
    '/import/timetable-xlsx',
    requireAuth(db),
    xlsxUpload.array('files', 5),
    wrap(async (req, res) => {
      const me = getUser(req)
      rateLimit(`import-timetable-xlsx:${me.id}`, 60, 10 * 60 * 1000)

      const files = (req.files as Express.Multer.File[] | undefined) ?? []
      if (!files.length) {
        throw badRequest('没有收到文件。请到教务系统的课表页点「导出」，拿到课表 .xlsx 再上传。', 'NO_FILE')
      }
      const file = files[0]!
      /* multer/busboy 按 latin1 解文件名，中文会乱码 —— 和成绩那边同一个坑 */
      const fileName = fixFilename(file.originalname)
      const buf = file.buffer
      if (!buf?.length) throw badRequest('收到的是一个空文件，里面没有内容。', 'EMPTY_FILE')
      if (!looksLikeXlsx(buf)) {
        throw badRequest(
          '这个文件不是 .xlsx 表格（可能传成了 .xls / .csv，或者文件已经损坏）。\n' +
            '请到教务系统的课表页点「导出」，拿到课表 .xlsx 再上传。',
          'NOT_XLSX',
        )
      }

      let parsed: ReturnType<typeof parseTimetableTable>
      try {
        parsed = parseTimetableTable(readXlsx(buf).rows)
      } catch (e) {
        /* 解析类错误用户看得懂、也能自己换文件，原样抛出；
           兜底成"服务器内部错误"等于把唯一的排查线索丢了 */
        throw badRequest(e instanceof Error ? e.message : String(e), 'XLSX_PARSE_FAILED')
      }

      /* ---- 把文件里的课程对到已有课程上 ----
         教务导出的学期写法是 `2026-2027学年 秋季学期`，而库里现有课程是
         课程导入写的 `2026-2027第1学期`；课名还可能多出后缀
         （`体育(3)[25]` vs `体育(3)(示例项目)[25]`）。
         直接照 (code,name,term) 写就会**多出一整套重复课程**，
         所以先用 courseMatch 认一遍，认到了就用**已有那条的身份**去写。 */
      const { rows: existingRows, index } = loadIndex(db, me.id)
      const byId = new Map(existingRows.map((r) => [r.id, r]))

      const payload: IncomingCourse[] = []
      const merged: { from: string; into: string }[] = []
      for (const c of parsed.courses) {
        const m = matchCourse(index, { code: c.code, name: c.name, term: parsed.term })
        const target = m.id != null ? byId.get(m.id) : undefined
        if (target) {
          if (target.name !== c.name) merged.push({ from: c.name, into: target.name })
          payload.push({ code: target.code, name: target.name, term: target.term, teacher: c.teacher, room: c.room, slots: c.slots })
        } else {
          payload.push({ code: c.code, name: c.name, term: parsed.term, teacher: c.teacher, room: c.room, slots: c.slots })
        }
      }

      const notes = [...parsed.notes]
      if (merged.length) {
        notes.push(
          `${merged.length} 门课合并到了已有课程上（学期写法 / 课名后缀和教务导出的不一致）：` +
            merged.slice(0, 3).map((x) => `${x.from} → ${x.into}`).join('；') +
            (merged.length > 3 ? `…等 ${merged.length} 门` : ''),
        )
      }
      if (parsed.deduped) notes.push(`同一节课在多个节次行里重复出现，已去掉重复的 ${parsed.deduped} 条`)
      if (parsed.badCells.length) {
        /* 读不懂的格子**要说出来**，不能静默丢 —— 否则用户会以为课表导全了 */
        notes.push(`有 ${parsed.badCells.length} 个格子没读懂，已跳过：${parsed.badCells.slice(0, 3).join(' / ')}`)
      }
      if (files.length > 1) notes.push(`这次上传了 ${files.length} 个文件，只导入了第一个：${fileName}`)

      /* dryRun **默认 true**：上传即预览，确认后才写库。
         multipart 里 dryRun 是字符串，'false' 和 false 两种都认。 */
      const body = (req.body ?? {}) as { dryRun?: unknown }
      const dryRun = body.dryRun !== 'false' && body.dryRun !== false

      const summary = {
        fileName,
        title: parsed.title,
        term: parsed.term,
        courses: payload.length,
        slots: parsed.slotCount,
        deduped: parsed.deduped,
        gridRows: parsed.gridRows,
        notes,
        dryRun,
      }

      if (dryRun) {
        ok(res, {
          ...summary,
          preview: payload.map((c) => ({
            name: c.name,
            teacher: c.teacher,
            room: c.room,
            times: c.slots.map((s) => `周${s.day} ${s.from}-${s.from + s.span - 1}节 ${s.weeks}`),
          })),
          merged,
          badCells: parsed.badCells,
        })
        return
      }

      const applied = writeTimetableImport(
        db,
        me.id,
        payload,
        'timetable-xlsx',
        (r) => `课表「${parsed.term}」：课程新增 ${r.created} 更新 ${r.updated} · 时间段 ${r.slots} 条`,
        { fileName, term: parsed.term, merged: merged.length },
      )

      ok(res, { ...summary, dryRun: false, applied })
    }),
  )

  /* ---------------------------- 成绩单 ----------------------------
     数据来源：教务系统的「成绩查询」页（bkjw.cuc.edu.cn）。
     那一页是**分页**的（每页 10 条 / 共 29 条），所以脚本会在页面上
     自动翻页收齐之后再一次性 POST 过来 —— 服务端只负责"这一批怎么写"。

     三条刻意的规则：
      · **不新建课程**。成绩里的课程号对不上已有课程时，就存一条
        "仅成绩"记录（course_id 空）。凭空建课程会把"我的课程"
        塞满一堆没课表的空壳，而成绩单本来就可以只有分数。
      · **幂等**。唯一键 = 课程号+课程名+学期+重修标记，重复导入不会翻倍；
        "未出分 → 出分"也走同一条更新路径。
      · **手填优先**。edited=1 的行只补空字段 —— 用户改过的学分/绩点
        不能被下一次导入顶回去。
     ---------------------------------------------------------------- */
  r.post(
    '/import/grades',
    authImport,
    wrap(async (req, res) => {
      const me = getUser(req)
      rateLimit(`import:${me.id}`, 60, 10 * 60 * 1000)

      const body = (req.body ?? {}) as { grades?: unknown; source?: unknown; dryRun?: unknown }
      const incoming = Array.isArray(body.grades) ? body.grades.slice(0, 2000) : []
      if (!incoming.length) throw badRequest('没有收到成绩数据', 'NO_GRADES')

      const dryRun = body.dryRun !== false
      const source = str(body.source, 200) || 'unknown'

      /* 规范化 + 批内去重。翻页采集有可能把同一行收两次
         （最后一页点了没反应、或者学校页面有重复行），
         在这里合掉，免得写库时才撞唯一键。 */
      const uniq = new Map<string, ReturnType<typeof normalizeGrade>>()
      for (const raw of incoming) {
        const v = normalizeGrade((raw ?? {}) as Record<string, unknown>)
        if (!v) continue
        uniq.set(gradeKey(v), v)
      }
      const items = [...uniq.values()].filter((v): v is NonNullable<typeof v> => !!v)
      if (!items.length) throw badRequest('成绩里没有可用的行（课程名都是空的）', 'NO_GRADES')

      const plan = planGrades(db, me.id, items)
      const notes: string[] = []
      const dropped = incoming.length - items.length
      if (dropped > 0) notes.push(`有 ${dropped} 行重复或缺少课程名，已合并/跳过`)
      if (plan.unlinked) {
        notes.push(`${plan.unlinked} 条对不上已有课程（课程号不同），会存成「仅成绩」记录 —— 不会自动新建课程`)
      }
      if (plan.kept) notes.push(`${plan.kept} 条你手动改过，这次只补空字段、不覆盖你改的值`)

      if (dryRun) {
        ok(res, { ...plan, dryRun, notes })
        return
      }

      // 写库前抓快照：成绩导入也是覆盖式的（已存在的行会被更新），
      // 解析错了要能整批撤回来（见 lib/importSnapshot.ts）
      const snapshot = captureSnapshot(db, me.id)
      const now = Date.now()
      let applied: ReturnType<typeof upsertGrades>
      db.exec('BEGIN')
      try {
        applied = upsertGrades(db, me.id, items, now)
        logImport(
          db,
          me.id,
          source,
          `成绩单：新增 ${applied.created} 更新 ${applied.updated} · 手改保留 ${applied.kept} · 关联课程 ${applied.linked}`,
          {
            created: applied.created, updated: applied.updated, kept: applied.kept,
            linked: applied.linked, unlinked: applied.unlinked, total: plan.total,
          },
          snapshot,
        )
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }

      ok(res, { ...plan, dryRun: false, notes, applied })
    }),
  )

  /* ---------------------------- 成绩单（xlsx 表格） ----------------------------
     数据来源：教务系统导出的 `全部成绩查询.xlsx`（用户在成绩查询页点「导出」拿到）。

     和上面那条 `/import/grades` 的关系：
      · 上面那条给**学校页面上的脚本**用，走导入令牌（X-Import-Token）；
      · 这一条给**本机前端**用（用户自己选文件上传），所以走**会话鉴权**
        requireAuth —— 文件是从用户自己电脑传上来的，没有"站外来源"这回事。
      · 两者最终都汇到 **planGrades / upsertGrades**：白拿"按学期+课程号去重"、
        "手改行不被覆盖"、"自动关联课程"这三条规则，不用维护两套。

     xlsx 的解析在 lib/xlsx.ts（解 zip）+ lib/gradesXlsx.ts（列名→字段）。
     两条刻意的规则：
      · **缺必须列就报错**（课程名 / 总成绩）。按位置硬凑出来的成绩
        看起来完全正常，用户发现不了。
      · **多余的列忽略，但要报数** —— 预览里写"已忽略 N 列不需要的信息"。
     ---------------------------------------------------------------------- */

  /* 上传用**内存**存储，落到磁盘没有意义：文件只用来解析一次，解析完就丢。
     routes/files.ts 那边用自定义流式引擎是因为要长期保存 200MB 的视频，
     这里不一样 —— 一份表格也就几十 KB。

     ⚠️ 定义在文件顶部（见 importRoutes 开头）：课表 xlsx 那条路在成绩 xlsx
     之前注册，放这里会 ReferenceError。 */

  r.post(
    '/import/grades-xlsx',
    requireAuth(db),
    xlsxUpload.array('files', 5),
    wrap(async (req, res) => {
      const me = getUser(req)
      rateLimit(`import-grades-xlsx:${me.id}`, 60, 10 * 60 * 1000)

      const files = (req.files as Express.Multer.File[] | undefined) ?? []
      if (!files.length) {
        throw badRequest('没有收到文件。请选择教务系统导出的「全部成绩查询.xlsx」再上传。', 'NO_FILE')
      }
      /* 传了多个时只认第一个，但**要说清楚** —— 静默忽略用户选的其他文件更糟 */
      const file = files[0]!
      /* ⚠️ multer/busboy 按 latin1 解 multipart 的文件名，中文会变成
         `å¨é¨æç»©æ¥è¯¢.xlsx` 这种乱码。routes/files.ts 早就修过这个
         （lib/storage.ts 的 fixFilename），这里也要修 ——
         不然界面上和导入历史里显示的文件名全是乱码。 */
      const fileName = fixFilename(file.originalname)
      const buf = file.buffer
      if (!buf?.length) throw badRequest('收到的是一个空文件，里面没有内容。', 'EMPTY_FILE')
      if (!looksLikeXlsx(buf)) {
        throw badRequest(
          '这个文件不是 .xlsx 表格（可能传成了 .xls / .csv，或者文件已经损坏）。\n' +
          '请到教务系统的成绩查询页点「导出」，拿到「全部成绩查询.xlsx」再上传。',
          'NOT_XLSX',
        )
      }

      let parsed
      try {
        const sheet = readXlsx(buf)
        parsed = parseGradesTable(sheet.rows, { stringMode: sheet.stringMode, sheetName: sheet.name })
      } catch (e) {
        /* 解析类错误是**用户能看懂也能自己改**的（表头不对、文件损坏），
           所以原样把 message 抛出去；不要兜底成"服务器内部错误"。 */
        throw badRequest(e instanceof Error ? e.message : String(e), 'XLSX_PARSE_FAILED')
      }

      if (!parsed.grades.length) {
        throw badRequest(
          '表格里一条成绩都没读到（只有表头？）。请确认文件里有数据行，' +
          '并且「课程名」「总成绩」两列不是空的。',
          'NO_GRADES',
        )
      }

      /* 走和网页脚本导入同一条路：规范化 + 批内去重 */
      const uniq = new Map<string, ReturnType<typeof normalizeGrade>>()
      for (const raw of parsed.grades) {
        const v = normalizeGrade(raw as unknown as Record<string, unknown>)
        if (!v) continue
        uniq.set(gradeKey(v), v)
      }
      const items = [...uniq.values()].filter((v): v is NonNullable<typeof v> => !!v)
      if (!items.length) throw badRequest('表格里的行都没有课程名，没法导入。', 'NO_GRADES')

      const plan = planGrades(db, me.id, items)
      const notes = [...parsed.notes]
      const dropped = parsed.grades.length - items.length
      if (dropped > 0) notes.push(`有 ${dropped} 行重复或缺少课程名，已合并/跳过`)
      if (files.length > 1) notes.push(`这次上传了 ${files.length} 个文件，只导入了第一个：${fileName}`)
      if (plan.unlinked) {
        notes.push(`${plan.unlinked} 条对不上已有课程（课程号不同），会存成「仅成绩」记录 —— 不会自动新建课程`)
      }
      if (plan.kept) notes.push(`${plan.kept} 条你手动改过，这次只补空字段、不覆盖你改的值`)

      /* dryRun **默认 true**：上传即预览，用户确认后才写库。
         反过来的话（缺省即写），选错文件就把脏数据写进去了。
         ⚠️ 这个接口是 multipart，`dryRun` 从表单字段来，所以是**字符串**
         `'false'`；但测试/curl 也可能传 JSON 布尔值，两种都认。 */
      const body = (req.body ?? {}) as { dryRun?: unknown }
      const dryRun = body.dryRun !== 'false' && body.dryRun !== false

      const meta = {
        fileName,
        sheetName: parsed.sheetName,
        stringMode: parsed.stringMode,
        totalRows: parsed.totalRows,
        headers: parsed.headers,
        usedColumns: parsed.usedColumns,
        ignoredColumns: parsed.ignoredColumns,
        ignoredCount: parsed.ignoredColumns.length,
        missingFields: parsed.missingFields,
        /** 解析出来的每一条（预览列表要用，确认时前端把它原样传回来） */
        grades: items,
      }

      if (dryRun) {
        ok(res, { ...plan, dryRun: true, notes, parse: meta })
        return
      }

      const snapshot = captureSnapshot(db, me.id)
      const now = Date.now()
      let applied: ReturnType<typeof upsertGrades>
      db.exec('BEGIN')
      try {
        applied = upsertGrades(db, me.id, items, now)
        logImport(
          db,
          me.id,
          'grades-xlsx',
          `成绩表格：新增 ${applied.created} 更新 ${applied.updated} · 手改保留 ${applied.kept} · 关联课程 ${applied.linked}`,
          {
            created: applied.created, updated: applied.updated, kept: applied.kept,
            linked: applied.linked, unlinked: applied.unlinked, total: plan.total,
            file: fileName, ignoredColumns: parsed.ignoredColumns.length,
          },
          snapshot,
        )
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }

      ok(res, { ...plan, dryRun: false, notes, applied, parse: meta })
    }),
  )

  /* ---------------------------- 读取已导入的数据 ---------------------------- */

  r.get(
    '/courses',
    authImport,
    wrap(async (req, res) => {
      const me = getUser(req)
      const rows = db
        .prepare(
          'SELECT id, code, name, teacher, credits, term, room, updated_at FROM courses WHERE owner_id = ? ORDER BY term DESC, name',
        )
        .all(me.id) as {
        id: number
        code: string
        name: string
        teacher: string
        credits: number
        term: string
        room: string
        updated_at: number
      }[]
      ok(res, { courses: rows })
    }),
  )

  r.get(
    '/schedule',
    /* 前端也会调这个接口，所以用"会话优先、令牌兜底"：
       只用 authImport 的话，按标签页独立的会话令牌（走 Authorization）
       会被忽略 —— 第二个标签页登录别的账号时这里会返回**别人的课表**。 */
    authFlex,
    wrap(async (req, res) => {
      const me = getUser(req)
      const rows = db
        .prepare(
          `SELECT s.id, s.course_id, c.name AS course_name, s.day, s.from_slot, s.span, s.room, s.weeks
             FROM schedule_slots s LEFT JOIN courses c ON c.id = s.course_id
            WHERE s.owner_id = ? ORDER BY s.day, s.from_slot`,
        )
        .all(me.id)
      ok(res, { slots: rows })
    }),
  )

  r.get(
    '/import/log',
    /* 同上：导入历史也是前端在读（导入页那一栏），不能只认 cookie */
    authFlex,
    wrap(async (req, res) => {
      const me = getUser(req)
      const rows = db
        .prepare('SELECT id, source, summary, created_at FROM import_log WHERE owner_id = ? ORDER BY created_at DESC LIMIT 20')
        .all(me.id)
      ok(res, { logs: rows })
    }),
  )

  /* 清空导入的课程与课表（重来一遍用） */
  r.delete(
    '/courses',
    // 这条路由原来漏了鉴权中间件 —— getUser(req) 会因为没有 req.user 直接抛 401，
    // 所以「清空课程」从来没能用过。补上 authImport。
    authImport,
    wrap(async (req, res) => {
      const me = getUser(req)
      const n = (db.prepare('SELECT COUNT(*) AS n FROM courses WHERE owner_id = ?').get(me.id) as { n: number }).n
      db.exec('BEGIN')
      try {
        db.prepare('DELETE FROM schedule_slots WHERE owner_id = ?').run(me.id)
        db.prepare('DELETE FROM courses WHERE owner_id = ?').run(me.id)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
      ok(res, { removed: n })
    }),
  )

  return r
}

