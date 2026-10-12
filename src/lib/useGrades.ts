import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, errText } from './api'

/**
 * 成绩单。数据来自 `grades` 表 —— 从教务系统的「成绩查询」页导进来，
 * 之后由这里改（用户明确要求：**学分和绩点可以手动改**）。
 *
 * 和 useCourses 的一个区别：这里所有写操作（改一条 / 删一条）都由服务端
 * 返回**整张表 + 汇总**。因为改了学分或绩点，已修学分与平均绩点都会跟着变 ——
 * 只回一条记录的话，前端要么自己重算（等于把汇总逻辑抄两份），
 * 要么再拉一次（多一个来回）。数据量很小（几百行），回全量最省心。
 */

export interface Grade {
  id: number
  /** 关联到的课程 id（'' = 这条只是成绩，没有对应课程） */
  courseId: string
  courseCode: string
  courseName: string
  term: string
  /** 原始成绩文本：'91' / '优秀' / '及格' */
  score: string
  /** 只有数字成绩才有值 */
  scoreNum: number | null
  credit: number
  gpa: number | null
  category: string
  nature: string
  mode: string
  isMajor: boolean
  examDate: string
  retake: string
  /** 用户手动改过（导入不会再覆盖） */
  edited: boolean
  /** 关联课程的配色（空格分隔 rgb），没关联时是空串 */
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
  /** 加权平均绩点；算不出来时是 null（不回退成 0） */
  avgGpa: number | null
  avgScore: number | null
  gpaCredit: number
}

export const EMPTY_SUMMARY: GradeSummary = {
  total: 0, count: 0, credit: 0, pendingCount: 0, pendingCredit: 0, avgGpa: null, avgScore: null, gpaCredit: 0,
}

/** 已出分 = 成绩栏有内容（数字或"优秀"这类都算） */
export const isDone = (g: Grade): boolean => g.score !== '' || g.scoreNum !== null

/**
 * 学期的排序键，和 server/src/lib/grades.ts 的 termRank 保持同一套算法。
 * 前端要用它把旧学期排到后面（服务端已经排好了，这里只是给分组兜底）。
 * 认不出来的返回 0，排最后 —— 宁可位置靠后，也别把数据藏起来。
 */
const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8 }
export function termRank(term: string): number {
  const t = term ?? ''
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
  return year * 10 + (year ? part : 0)
}

/** 没配色的课程用一组预设色轮着取，避免界面上出现没有颜色的条目 */
export const GRADE_RGB = ['143 178 255', '92 214 190', '196 148 255', '255 179 107', '255 143 177', '142 224 106']

export function useGrades() {
  const [grades, setGrades] = useState<Grade[]>([])
  const [summary, setSummary] = useState<GradeSummary>(EMPTY_SUMMARY)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 服务端所有写操作都回 { grades, summary }，统一在这里落到 state */
  const apply = useCallback((d: { grades: Grade[]; summary: GradeSummary }) => {
    setGrades(d.grades ?? [])
    setSummary(d.summary ?? EMPTY_SUMMARY)
  }, [])

  const reload = useCallback(async () => {
    try {
      const d = await api.get<{ grades: Grade[]; summary: GradeSummary }>('/grades')
      apply(d)
      setError(null)
    } catch (e) {
      setError(errText(e))
    } finally {
      setLoading(false)
    }
  }, [apply])

  useEffect(() => {
    void reload()
  }, [reload])

  /** 改一条（学分 / 绩点 / 成绩 / 学期…）。服务端会把 edited 置 1。 */
  const update = useCallback(
    async (id: number, patch: Partial<Pick<Grade, 'score' | 'scoreNum' | 'credit' | 'gpa' | 'term' | 'courseName' | 'category' | 'nature' | 'mode' | 'examDate' | 'retake' | 'courseId'>>) => {
      setBusy(true)
      try {
        const d = await api.patch<{ grades: Grade[]; summary: GradeSummary }>(`/grades/${id}`, patch)
        apply(d)
        setError(null)
        return true
      } catch (e) {
        setError(errText(e))
        return false
      } finally {
        setBusy(false)
      }
    },
    [apply],
  )

  /** 手动补一条（学校页面拿不到的课，或者只想自己记一笔） */
  const add = useCallback(
    async (v: { name: string; code?: string; term?: string; score?: string; credit?: number; gpa?: number | null }) => {
      if (!v.name.trim()) {
        setError('课程名不能为空')
        return false
      }
      setBusy(true)
      try {
        const d = await api.post<{ grades: Grade[]; summary: GradeSummary }>('/grades', v)
        apply(d)
        setError(null)
        return true
      } catch (e) {
        setError(errText(e))
        return false
      } finally {
        setBusy(false)
      }
    },
    [apply],
  )

  const remove = useCallback(
    async (id: number) => {
      setBusy(true)
      try {
        const d = await api.del<{ grades: Grade[]; summary: GradeSummary }>(`/grades/${id}`)
        apply(d)
        setError(null)
        return true
      } catch (e) {
        setError(errText(e))
        return false
      } finally {
        setBusy(false)
      }
    },
    [apply],
  )

  /** 按学期分组。服务端已经按「学期新→旧」排好，这里保持插入顺序即可。 */
  const byTerm = useMemo(() => {
    const m = new Map<string, Grade[]>()
    for (const g of grades) {
      const key = g.term || '未标学期'
      const list = m.get(key)
      if (list) list.push(g)
      else m.set(key, [g])
    }
    return [...m.entries()]
  }, [grades])

  return { grades, summary, byTerm, loading, busy, error, add, update, remove, reload }
}
