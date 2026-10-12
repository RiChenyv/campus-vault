import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, errText } from './api'

/**
 * 课程。数据来自 `courses` 表 —— 既有**从教务系统导入的**，
 * 也有用户**自己建的**（`manual` 区分）。
 *
 * 产出对象的字段刻意和 `src/data/mock.ts` 的 `Course` 保持一致
 * （`id` 字符串、`rgb` 空格分隔、`color` 十六进制…），
 * 这样原来读 mock 的渲染代码可以原样用，不必大改。
 */
export interface Course {
  id: string
  name: string
  teacher: string
  room: string
  term: string
  credit: number
  code: string
  note: string
  /** true = 自己建的，false = 从教务系统导入的 */
  manual: boolean
  /** 十六进制，如 '#5cd6be'；没配色时是空串 */
  color: string
  /** 空格分隔，如 '92 214 190'；给 `rgb(... / .2)` 用 */
  rgb: string
  /** 归属到这门课的文件数 / 笔记数（服务端算好的） */
  files: number
  notes: number
  createdAt: number
  updatedAt: number
}

/** 没配色的课程用这个兜底，避免界面上出现没有颜色的课程 */
export const DEFAULT_RGB = '143 178 255'

export function useCourses() {
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const d = await api.get<{ courses: Course[] }>('/courses')
      setCourses(d.courses)
      setError(null)
    } catch (e) {
      setError(errText(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const add = useCallback(
    async (v: { name: string; teacher?: string; room?: string; term?: string; credit?: number; note?: string }) => {
      if (!v.name.trim()) {
        setError('课程名不能为空')
        return null
      }
      setBusy(true)
      try {
        const d = await api.post<{ course: Course }>('/courses', v)
        setCourses((prev) => [...prev, d.course].sort((a, b) => a.name.localeCompare(b.name, 'zh')))
        setError(null)
        return d.course
      } catch (e) {
        setError(errText(e))
        return null
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const update = useCallback(async (id: string, patch: Partial<Course>) => {
    setBusy(true)
    try {
      const d = await api.patch<{ course: Course }>(`/courses/${id}`, patch)
      setCourses((prev) => prev.map((c) => (c.id === id ? d.course : c)))
      setError(null)
      return d.course
    } catch (e) {
      setError(errText(e))
      return null
    } finally {
      setBusy(false)
    }
  }, [])

  const remove = useCallback(async (id: string) => {
    let snapshot: Course[] = []
    setCourses((prev) => {
      snapshot = prev
      return prev.filter((c) => c.id !== id)
    })
    try {
      await api.del(`/courses/${id}`)
      setError(null)
      return true
    } catch (e) {
      setCourses(snapshot)
      setError(`删除失败：${errText(e)}`)
      return false
    }
  }, [])

  /** id -> Course，给"按课程分组"用 */
  const byId = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses])

  return { courses, byId, loading, busy, error, add, update, remove, reload }
}
