/**
 * 成绩单：迁移 v11 的 grades 表，接口与导入共用这一份逻辑。
 *
 * 为什么单独一个 lib 而不是写在路由里：
 * 三条路径都要用它 —— 界面上的增删改（routes/data.ts）、
 * 从教务系统导入（routes/import.ts）、以及撤销导入时的快照还原。
 * 抄三份的话，"学分怎么校验""怎么跟课程对上"迟早会出现三套答案。
 *
 * 两个关键决定：
 *
 *  ① **成绩和课程是两件事**。grades 独立成表，靠课程号软关联到 courses。
 *     一门课重修两次就是两条成绩 —— 塞进 courses 会被唯一键吞掉一条。
 *
 *  ② **手填优先于导入**。`edited = 1` 的行，导入只补空字段。
 *     学分和绩点用户明确要求能手动改（学校给的数偶尔就是错的），
 *     改完再导一次就被顶回去的话，这个"能改"等于没有。
 */

import type { Db } from '../db.ts'

/* ============================ 类型 ============================ */

/** 库里的一行（列名原样，snake_case） */
export interface GradeRow {
  id: number
  owner_id: number
  course_id: string
  course_code: string
  course_name: string
  term: string
  score: string
  score_num: number | null
  credit: number
  gpa: number | null
  category: string
  nature: string
  mode: string
  is_major: number
  exam_date: string
  retake: string
  edited: number
  created_at: number
  updated_at: number
}

/** 规范化之后的成绩值（导入与手工新增都先过这里） */
export interface GradeValues {
  courseCode: string
  courseName: string
  term: string
  score: string
  scoreNum: number | null
  credit: number
  gpa: number | null
  category: string
  nature: string
  mode: string
  isMajor: number
  examDate: string
  retake: string
}

export interface UpsertResult {
  created: number
  updated: number
  /** 因为用户手改过而**没被覆盖**的条数 */
  kept: number
  linked: number
  unlinked: number
  createdNames: string[]
  updatedNames: string[]
}

/* ============================ 工具 ============================ */

const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''

/** 数值字段：不是有限数就返回 null，不用 0 混过去（0 和"没有"是两回事） */
const numOrNull = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const m = v.trim().match(/^-?\d+(?:\.\d+)?$/)
    if (m) return Number(m[0])
  }
  return null
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * 学期的排序键。
 *
 * 页面上的写法是 `2025-2026学年第一学期`，但也可能是
 * `2025-2026学年第1学期` / `2024-2025 秋`（旧数据）。
 * 用「结束年份 × 10 + 学期序号」当键：2025-2026 第一学期 = 20261，
 * 比 2024-2025 第二学期（20252）大 —— 直接按数字倒排就是"新的在前"。
 * 认不出来的学期返回 0，排到最后（宁可排错位置，也别丢数据）。
 */
const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8 }

export function termRank(term: string): number {
  const t = String(term ?? '')
  const span = t.match(/(\d{4})\s*[-–—~]\s*(\d{4})/)
  let year = span ? Number(span[2]) : 0
  if (!year) {
    const one = t.match(/(\d{4})/)
    year = one ? Number(one[1]) : 0
  }
  let part = 0
  const n = t.match(/第\s*([一二三四五六七八1-8])\s*学期/)
  if (n) part = CN_NUM[n[1]!] ?? Number(n[1]) ?? 0
  else if (/秋/.test(t)) part = 1
  else if (/春/.test(t)) part = 2
  else if (/夏/.test(t)) part = 3
  else if (/冬/.test(t)) part = 4
  return year * 10 + (part || 0)
}

/** 把导入/新增的原始对象规范化。没有课程名的一律丢掉（不做猜测） */
export function normalizeGrade(raw: Record<string, unknown>): GradeValues | null {
  const courseName = str(raw.name ?? raw.courseName, 200)
  if (!courseName) return null

  const score = str(raw.score, 40)
  /* scoreNum 优先用解析器给的；它没给就**只在成绩是纯数字时**才推。
     '优秀' 推成 90 分是编数据 —— 平均分会被算错，而且看不出来。 */
  let scoreNum = numOrNull(raw.scoreNum)
  if (scoreNum === null && /^-?\d+(?:\.\d+)?$/.test(score)) scoreNum = Number(score)

  const creditRaw = numOrNull(raw.credit)
  const credit = creditRaw === null ? 0 : Math.min(30, Math.max(0, creditRaw))

  const gpaRaw = numOrNull(raw.gpa)
  const gpa = gpaRaw === null ? null : Math.min(10, Math.max(0, gpaRaw))

  const majorRaw = raw.major ?? raw.isMajor
  const isMajor = majorRaw === true || majorRaw === 1 || majorRaw === '是' || majorRaw === 'true' ? 1 : 0

  return {
    courseCode: str(raw.code ?? raw.courseCode, 64),
    courseName,
    term: str(raw.term, 64),
    score,
    scoreNum,
    credit,
    gpa,
    category: str(raw.category, 64),
    nature: str(raw.nature, 40),
    mode: str(raw.mode, 40),
    isMajor,
    examDate: str(raw.examDate, 40),
    retake: str(raw.retake, 40),
  }
}

/** 幂等键：课程号 + 课程名 + 学期 + 重修标记。**不带成绩** ——
 *  带了的话"未出分 → 出分"会变成两条记录。 */
/**
 * 成绩的"身份"：**一门课 + 一个学期**。
 *
 * ⚠️ 这里**不能**带上 `retake`（重修重考），也不能把课程名当身份的一部分：
 * 它们是展示字段，会随抓取质量变化。踩过的坑：唯一键原来含 `retake`，
 * 而解析器写错列时它落到空串、修好之后变成「正常」——
 * 同一门课重导一次就**新增一行**（用户实测：重导后数据翻倍）。
 * 课程号为空时才退回用课程名（少数课在教务里没有课程号）。
 */
export const gradeKey = (v: Pick<GradeValues, 'courseCode' | 'courseName' | 'term'>) =>
  `${v.term}|${v.courseCode || v.courseName}`

/**
 * 是不是撞了唯一键。
 *
 * 用途：把课程名/学期改到和另一条成绩重复时，SQLite 会抛
 * `UNIQUE constraint failed` —— 那是**用户能理解也能改**的输入问题，
 * 不该兜底成"服务器内部错误"（用户看到那个只会以为程序坏了）。
 */
export const isUniqueViolation = (e: unknown): boolean =>
  /UNIQUE constraint failed/i.test(e instanceof Error ? e.message : String(e))

/* ====================== 跟课程对上号 ====================== */

export interface CourseRef {
  id: string
  code: string
  name: string
  term: string
}

/**
 * 课程索引。匹配分三档，从"确定"到"尽量"：
 *   ① 课程号**完全相等** —— 教务系统的成绩页和课表页用的是同一个课程号，最可靠
 *   ② 课程号是对方的子串且**只匹配到一门** —— 课程页导来的课程号是
 *      `学号+课程号` 拼起来的长串（202620271213101000602），完全相等对不上
 *   ③ 课程号为空时按课程名（同名多门就要求学期也相同）
 *
 * ②③ 都要求"只匹配到一门"：匹配到两门说明这个判据不足以下结论，
 * 那就宁可让它留在"仅成绩"里 —— 显示成没关联，好过关联到错的课上。
 */
export function buildCourseIndex(courses: CourseRef[]) {
  const byCode = new Map<string, CourseRef[]>()
  for (const c of courses) {
    if (!c.code) continue
    const list = byCode.get(c.code)
    if (list) list.push(c)
    else byCode.set(c.code, [c])
  }
  return { courses, byCode }
}

export type CourseIndex = ReturnType<typeof buildCourseIndex>

export function matchCourseId(
  idx: CourseIndex,
  v: { courseCode: string; courseName: string; term: string },
): { id: string; how: 'code' | 'code-partial' | 'name' | '' } {
  if (v.courseCode) {
    const exact = idx.byCode.get(v.courseCode)
    if (exact && exact.length === 1) return { id: exact[0]!.id, how: 'code' }
    if (exact && exact.length > 1) {
      // 同课程号多门（不同学期）：学期能对上就用它，否则取第一门
      const same = exact.find((c) => c.term && v.term && c.term === v.term)
      return { id: (same ?? exact[0]!).id, how: 'code' }
    }
    const partial = idx.courses.filter((c) => c.code.includes(v.courseCode))
    if (partial.length === 1) return { id: partial[0]!.id, how: 'code-partial' }
    return { id: '', how: '' }
  }
  const byName = idx.courses.filter((c) => c.name === v.courseName)
  if (byName.length === 1) return { id: byName[0]!.id, how: 'name' }
  if (byName.length > 1) {
    const same = byName.find((c) => c.term && v.term && c.term === v.term)
    if (same) return { id: same.id, how: 'name' }
  }
  return { id: '', how: '' }
}

/** 读该用户的课程索引（成绩关联/重新关联都用它） */
export function courseIndexOf(db: Db, ownerId: number): CourseIndex {
  const rows = db
    .prepare('SELECT id, code, name, term FROM courses WHERE owner_id = ?')
    .all(ownerId) as { id: number; code: string; name: string; term: string }[]
  return buildCourseIndex(rows.map((r) => ({ id: String(r.id), code: r.code, name: r.name, term: r.term })))
}

/* ====================== 写入（导入 / 新增） ====================== */

const COLS =
  'owner_id, course_id, course_code, course_name, term, score, score_num, credit, gpa, ' +
  'category, nature, mode, is_major, exam_date, retake, edited, created_at, updated_at'

/**
 * 批量写入（导入用）。
 *
 * 已存在的行：
 *   · 用户没改过 → 整行按新数据更新（成绩补出来、绩点修正都属于这种）
 *   · 用户改过（edited=1）→ **只补空字段**，改过的值一律保留
 *
 * 不在本次数据里的旧行**不删**：导入不该有删除语义 ——
 * 学校页面上少一行（比如换了个筛选条件）不该让本地记录消失。
 */
export function upsertGrades(
  db: Db,
  ownerId: number,
  items: GradeValues[],
  now = Date.now(),
): UpsertResult {
  const idx = courseIndexOf(db, ownerId)
  const existing = db
    .prepare(`SELECT * FROM grades WHERE owner_id = ?`)
    .all(ownerId) as unknown as GradeRow[]
  const byKey = new Map(existing.map((r) => [gradeKey({
    courseCode: r.course_code, courseName: r.course_name, term: r.term,
  }), r]))

  const ins = db.prepare(`INSERT INTO grades (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const upd = db.prepare(
    `UPDATE grades SET course_id = ?, course_code = ?, course_name = ?, term = ?, score = ?, score_num = ?,
       credit = ?, gpa = ?, category = ?, nature = ?, mode = ?, is_major = ?, exam_date = ?, retake = ?,
       updated_at = ?
     WHERE id = ?`,
  )

  const out: UpsertResult = {
    created: 0, updated: 0, kept: 0, linked: 0, unlinked: 0,
    createdNames: [], updatedNames: [],
  }

  for (const v of items) {
    const m = matchCourseId(idx, v)
    if (m.id) out.linked++
    else out.unlinked++
    const key = gradeKey(v)
    const cur = byKey.get(key)

    if (!cur) {
      // 手工新增的行（edited=1）由调用方决定；导入进来的都是 0
      ins.run(
        ownerId, m.id, v.courseCode, v.courseName, v.term, v.score, v.scoreNum, v.credit, v.gpa,
        v.category, v.nature, v.mode, v.isMajor, v.examDate, v.retake, 0, now, now,
      )
      out.created++
      if (out.createdNames.length < 20) out.createdNames.push(v.courseName)
      continue
    }

    if (cur.edited === 1) {
      /* 用户手改过：只补空字段。哪些算"空"要按字段类型分别判断 ——
         学分 0 和绩点 null 都是"没有值"，而成绩空串也是。 */
      const fill = {
        score: cur.score === '' ? v.score : cur.score,
        scoreNum: cur.score_num === null ? v.scoreNum : cur.score_num,
        credit: cur.credit === 0 ? v.credit : cur.credit,
        gpa: cur.gpa === null ? v.gpa : cur.gpa,
        course_id: cur.course_id === '' ? m.id : cur.course_id,
        term: cur.term === '' ? v.term : cur.term,
        category: cur.category === '' ? v.category : cur.category,
        nature: cur.nature === '' ? v.nature : cur.nature,
        mode: cur.mode === '' ? v.mode : cur.mode,
        exam_date: cur.exam_date === '' ? v.examDate : cur.exam_date,
      }
      upd.run(
        fill.course_id, cur.course_code, cur.course_name, fill.term, fill.score, fill.scoreNum,
        fill.credit, fill.gpa, fill.category, fill.nature, fill.mode, cur.is_major, fill.exam_date,
        cur.retake, now, cur.id,
      )
      out.kept++
      continue
    }

    upd.run(
      cur.course_id || m.id, v.courseCode, v.courseName, v.term, v.score, v.scoreNum, v.credit, v.gpa,
      v.category, v.nature, v.mode, v.isMajor, v.examDate, v.retake, now, cur.id,
    )
    out.updated++
    if (out.updatedNames.length < 20) out.updatedNames.push(v.courseName)
  }

  return out
}

/* ====================== 试运行（dry-run） ====================== */

export interface GradePlan {
  total: number
  create: number
  update: number
  /** 已存在、且用户手改过 —— 这次导入只会补空字段 */
  kept: number
  linked: number
  unlinked: number
  createNames: string[]
  updateNames: string[]
}

/**
 * 只算不改：这次导入会新增几条、更新几条、几条因为手改过而不动。
 * 导入接口的预览走这里 —— 解析错了要能在**写库之前**看见。
 */
export function planGrades(db: Db, ownerId: number, items: GradeValues[]): GradePlan {
  const idx = courseIndexOf(db, ownerId)
  const rows = db
    .prepare('SELECT course_code, course_name, term, retake, edited FROM grades WHERE owner_id = ?')
    .all(ownerId) as { course_code: string; course_name: string; term: string; retake: string; edited: number }[]
  const have = new Map(rows.map((x) => [gradeKey({
    courseCode: x.course_code, courseName: x.course_name, term: x.term,
  }), x.edited === 1]))

  const out: GradePlan = {
    total: items.length, create: 0, update: 0, kept: 0, linked: 0, unlinked: 0,
    createNames: [], updateNames: [],
  }
  for (const v of items) {
    const hit = have.get(gradeKey(v))
    if (hit === undefined) {
      out.create++
      if (out.createNames.length < 20) out.createNames.push(v.courseName)
    } else if (hit) {
      out.kept++
    } else {
      out.update++
      if (out.updateNames.length < 20) out.updateNames.push(v.courseName)
    }
    if (matchCourseId(idx, v).id) out.linked++
    else out.unlinked++
  }
  return out
}

/* ====================== 读取 ====================== */
export interface GradeDto {
  id: number
  courseId: string
  courseCode: string
  courseName: string
  term: string
  score: string
  scoreNum: number | null
  credit: number
  gpa: number | null
  category: string
  nature: string
  mode: string
  isMajor: boolean
  examDate: string
  retake: string
  /** 用户手动改过（界面上要让他看得出来） */
  edited: boolean
  /** 关联到的课程配色（空格分隔的 rgb），没关联时是空串 */
  courseRgb: string
  createdAt: number
  updatedAt: number
}

export interface GradeSummary {
  total: number
  /** 已出分的门数 / 学分 */
  count: number
  credit: number
  /** 还没出分的门数 / 学分 */
  pendingCount: number
  pendingCredit: number
  /** 加权平均绩点；一条都算不出来时是 null（不回退成 0） */
  avgGpa: number | null
  /** 加权平均分（按学分加权） */
  avgScore: number | null
  /** 参与绩点加权的学分，用来解释上面那个平均是怎么来的 */
  gpaCredit: number
}

/**
 * 读出该用户的成绩，按「学期新→旧、课程名」排序。
 *
 * course_id 在这里**重新解析一次**：先导入成绩、后导入课表是很自然的顺序
 * （成绩页有成绩的时候，课表早就导过了；反过来则常见于新账号）。
 * 只认导入那一刻的匹配结果的话，那些成绩会永远显示成"仅成绩"。
 */
export function listGrades(db: Db, ownerId: number): { grades: GradeDto[]; summary: GradeSummary } {
  const rows = db
    .prepare(`SELECT * FROM grades WHERE owner_id = ?`)
    .all(ownerId) as unknown as GradeRow[]

  const idx = courseIndexOf(db, ownerId)
  const byId = new Map(idx.courses.map((c) => [c.id, c]))
  const rgbById = new Map(
    (db.prepare('SELECT id, color FROM courses WHERE owner_id = ?').all(ownerId) as { id: number; color: string }[])
      .map((r) => [String(r.id), r.color]),
  )

  const grades: GradeDto[] = rows.map((r) => {
    let courseId = r.course_id && byId.has(r.course_id) ? r.course_id : ''
    if (!courseId) {
      courseId = matchCourseId(idx, {
        courseCode: r.course_code, courseName: r.course_name, term: r.term,
      }).id
    }
    return {
      id: r.id,
      courseId,
      courseCode: r.course_code,
      courseName: r.course_name,
      term: r.term,
      score: r.score,
      scoreNum: r.score_num,
      credit: r.credit,
      gpa: r.gpa,
      category: r.category,
      nature: r.nature,
      mode: r.mode,
      isMajor: r.is_major === 1,
      examDate: r.exam_date,
      retake: r.retake,
      edited: r.edited === 1,
      courseRgb: courseId ? (rgbById.get(courseId) ?? '') : '',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }
  })

  grades.sort((a, b) => termRank(b.term) - termRank(a.term) || a.courseName.localeCompare(b.courseName, 'zh'))
  return { grades, summary: summarize(grades) }
}

/**
 * 汇总。
 *
 * 「已出分」= 成绩栏有内容（数字或"优秀"这类都算）；
 * 空的算「未出分」，单独统计 —— 在读课程的学分不能算进已修学分里，
 * 否则"还差多少学分毕业"会凭空少一截。
 *
 * 平均绩点按**学分加权**（学校就是这么算的），
 * 且只在有绩点的课程上加权 —— 把没出分的按 0 分算进去会拉低平均。
 */
export function summarize(grades: GradeDto[]): GradeSummary {
  let credit = 0
  let count = 0
  let pendingCredit = 0
  let pendingCount = 0
  let gpaSum = 0
  let gpaCredit = 0
  let scoreSum = 0
  let scoreCredit = 0

  for (const g of grades) {
    const done = g.score !== '' || g.scoreNum !== null
    if (!done) {
      pendingCount++
      pendingCredit += g.credit
      continue
    }
    count++
    credit += g.credit
    if (g.gpa !== null && g.credit > 0) {
      gpaSum += g.gpa * g.credit
      gpaCredit += g.credit
    }
    if (g.scoreNum !== null && g.credit > 0) {
      scoreSum += g.scoreNum * g.credit
      scoreCredit += g.credit
    }
  }

  return {
    total: grades.length,
    count,
    credit: round2(credit),
    pendingCount,
    pendingCredit: round2(pendingCredit),
    avgGpa: gpaCredit > 0 ? round2(gpaSum / gpaCredit) : null,
    avgScore: scoreCredit > 0 ? round2(scoreSum / scoreCredit) : null,
    gpaCredit: round2(gpaCredit),
  }
}
