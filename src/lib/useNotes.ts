import { useCallback, useEffect, useState } from 'react'
import { api, errText } from './api'

/**
 * 手写笔记。
 *
 * 「我的笔记」原来只是**文件的视图**（按课程分组），用户没法自己写一条。
 * 但很多笔记根本没有对应的文件 —— 课上随手记的两行、复习时的提纲。
 * 这类内容必须能在应用里直接写、直接改。
 *
 * 正文按 Markdown 存，渲染时复用同一套 mdToHtml（含数学公式）。
 */
export interface Note {
  id: number
  courseId: string
  title: string
  body: string
  createdAt: number
  updatedAt: number
}

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const d = await api.get<{ notes: Note[] }>('/notes')
      setNotes(d.notes)
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

  /** 新建或更新。传 id 就是改，不传就是新建 */
  const save = useCallback(async (v: { id?: number; title: string; body: string; courseId: string }) => {
    if (!v.title.trim()) {
      setError('标题不能为空')
      return null
    }
    setBusy(true)
    try {
      const payload = { title: v.title, body: v.body, courseId: v.courseId }
      if (v.id != null) {
        const d = await api.patch<{ note: Note }>(`/notes/${v.id}`, payload)
        // 更新后按"最近修改"重排，和服务端的排序保持一致
        setNotes((prev) => [d.note, ...prev.filter((x) => x.id !== d.note.id)])
        setError(null)
        return d.note
      }
      const d = await api.post<{ note: Note }>('/notes', payload)
      setNotes((prev) => [d.note, ...prev])
      setError(null)
      return d.note
    } catch (e) {
      setError(errText(e))
      return null
    } finally {
      setBusy(false)
    }
  }, [])

  /** 删除。乐观更新：先从列表移除，失败再补回来 */
  const remove = useCallback(async (id: number) => {
    let snapshot: Note[] = []
    setNotes((prev) => {
      snapshot = prev
      return prev.filter((x) => x.id !== id)
    })
    try {
      await api.del(`/notes/${id}`)
      setError(null)
    } catch (e) {
      setNotes(snapshot)
      setError(`删除失败：${errText(e)}`)
    }
  }, [])

  /**
   * 全部删掉。
   * 不可逆操作，所以调用方必须先过 ConfirmDialog —— 这里只负责执行。
   * 先清空本地列表再请求：失败时由调用方重新拉取恢复（比在这里存快照简单，
   * 因为清空是"全没了"，快照的意义不大）。
   */
  const clearAll = useCallback(async () => {
    setBusy(true)
    try {
      const d = await api.del<{ removed: number }>('/notes')
      setNotes([])
      setError(null)
      return d.removed
    } catch (e) {
      setError(`清空失败：${errText(e)}`)
      await reload()
      return null
    } finally {
      setBusy(false)
    }
  }, [reload])

  return { notes, loading, busy, error, save, remove, clearAll, reload }
}
