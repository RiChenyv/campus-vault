/**
 * 导入时的课程匹配。
 *
 * ── 为什么需要它 ──
 * 同一门课从不同来源导进来时，名字形态不一样：
 *   截图/WakeUp：`基础示例课程二[02]`      （带班号）
 *   学校课程页：  `基础示例课程二`          （去掉了班号）
 * 而去重键是 (课程号, 课程名, 学期)。名字差一个 `[02]` 就被当成两门课，
 * 结果是**同一个学期出现两条记录，一条有课表一条没有**。
 *
 * ── 匹配顺序 ──
 *   1. 精确键 (code, name, term)      —— 最可靠，重复导入走这条
 *   2. 归一化名 + 学期                —— 把学校页的课程合并到已有课程上
 *   3. 归一化名（学期不同时），但**仅当只有一个候选**才用
 *      —— 多个候选说明无法判断，宁可新建一条让用户看见，也不猜
 *
 * 合并时只**补空字段**（课程号、学分、教师），不覆盖已有值：
 * 已有数据往往来自更具体的来源（比如课表截图），不该被一个笼统的列表冲掉。
 */

import type { Db } from '../db.ts'

/**
 * 去掉班号后缀：`基础示例课程二[02]` → `基础示例课程二`。
 *
 * ⚠️ **只删方括号，不删圆括号。**
 * 一开始我连 `（数字）` 一起删了，结果 `体育(3)` 变成 `体育` ——
 * 但这里的 `(3)` 是课程名的一部分（"体育(3)"），不是班号。
 * 真正的班号一律用方括号：`基础示例课程二[02]`、`形势与政策(3)[31]`。
 * 学校课程页给的也是这个形态（`体育(3)`、`形势与政策(3)`），两边正好对上。
 *
 * 另外去空白与全角/半角差异，避免因排版不同而匹配失败。
 */
export function normalizeCourseName(name: string): string {
  return name
    .replace(/[\[［]\s*\d+\s*[\]］]\s*$/, '')
    .replace(/[\s\u3000]+/g, '')
    .trim()
}

export interface ExistingCourse {
  id: number
  code: string
  name: string
  term: string
}

export interface MatchResult {
  /** 命中的已有课程；null 表示需要新建 */
  id: number | null
  /** 命中的方式，写进日志便于排查"为什么合并到了这门课" */
  how: 'exact' | 'name+term' | 'name' | 'prefix' | 'none'
}

export function buildIndex(rows: ExistingCourse[]) {
  const byKey = new Map<string, number>()
  const byNormTerm = new Map<string, number[]>()
  const byNorm = new Map<string, number[]>()
  // 前缀匹配时要回查学期，所以留一份按 id 的索引
  const rowsById = new Map<number, ExistingCourse>()

  for (const r of rows) {
    byKey.set(`${r.code}|${r.name}|${r.term}`, r.id)
    const nk = `${normalizeCourseName(r.name)}|${r.term}`
    byNormTerm.set(nk, [...(byNormTerm.get(nk) ?? []), r.id])
    const nn = normalizeCourseName(r.name)
    byNorm.set(nn, [...(byNorm.get(nn) ?? []), r.id])
    rowsById.set(r.id, r)
  }
  return { byKey, byNormTerm, byNorm, rowsById }
}

export function matchCourse(
  index: ReturnType<typeof buildIndex>,
  incoming: { code: string; name: string; term: string },
): MatchResult {
  const exact = index.byKey.get(`${incoming.code}|${incoming.name}|${incoming.term}`)
  if (exact != null) return { id: exact, how: 'exact' }

  const norm = normalizeCourseName(incoming.name)
  const kt = index.byNormTerm.get(`${norm}|${incoming.term}`)
  if (kt?.length === 1) return { id: kt[0]!, how: 'name+term' }

  const kn = index.byNorm.get(norm)
  // 只有一个候选才敢用 —— 多个同名课程无法判断是哪一门，宁可新建
  if (kn?.length === 1) return { id: kn[0]!, how: 'name' }

  /* 最后一层：前缀关系。
     真实例子：已有 `体育(3)(示例项目)`，学校页给 `体育(3)` —— 后缀不同但显然是同一门。
     风险是 `大学物理` 会同时前缀匹配 `基础示例课程二` 和 `基础示例课程一`，
     所以**必须唯一命中**才采用；有歧义就返回 none，让用户自己看见多出来的一条，
     而不是我们猜错了把两门课搅在一起。 */
  if (norm.length >= 3) {
    const hits: number[] = []
    for (const [existingNorm, ids] of index.byNorm) {
      if (existingNorm.length < 3) continue
      if (!existingNorm.startsWith(norm) && !norm.startsWith(existingNorm)) continue
      // 还要学期对得上，否则可能跨学期误合并
      for (const id of ids) {
        const row = index.rowsById.get(id)
        if (row && row.term === incoming.term) hits.push(id)
      }
    }
    if (hits.length === 1) return { id: hits[0]!, how: 'prefix' }
  }

  return { id: null, how: 'none' }
}

/** 读该用户的全部课程，建好索引 */
export function loadIndex(db: Db, ownerId: number) {
  const rows = db
    .prepare('SELECT id, code, name, term FROM courses WHERE owner_id = ?')
    .all(ownerId) as unknown as ExistingCourse[]
  return { rows, index: buildIndex(rows) }
}

/**
 * 把导进来的课程写进已有的那一行（只补空字段）。
 * 这样学校页提供的课程号/学分/教师会填到截图导入的那门课上，
 * 而不是另起一条没有课表的空壳。
 */
export function enrichCourse(
  db: Db,
  id: number,
  incoming: { code: string; name: string; teacher: string; credits: number; room: string },
  now: number,
): void {
  db.prepare(
    `UPDATE courses SET
       code       = CASE WHEN code = ''    THEN ? ELSE code    END,
       teacher    = CASE WHEN teacher = '' THEN ? ELSE teacher END,
       credits    = CASE WHEN credits = 0  THEN ? ELSE credits END,
       room       = CASE WHEN room = ''    THEN ? ELSE room    END,
       updated_at = ?
     WHERE id = ?`,
  ).run(incoming.code, incoming.teacher, incoming.credits, incoming.room, now, id)
}
