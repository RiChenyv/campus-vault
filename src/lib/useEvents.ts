import { useCallback, useEffect, useState } from 'react'
import { api, errText } from './api'

/**
 * 日历「本月重要节点」。
 *
 * 这些事件原来写死在 `src/data/mock.ts` 的 `CAL_EVENTS` 里，
 * 用户既不能加也不能删 —— 而"本月重点"天生就是用户自己的东西。
 *
 * 字段和原模型一一对应（day / label / tone），所以换数据源不用改渲染逻辑。
 */
export type CalTone = 'ddl' | 'exam' | 'activity'

export interface CalEvent {
  id: number
  /** 几号，1~31 */
  day: number
  label: string
  tone: CalTone
  createdAt: number
}

interface RawEvent {
  id: number
  day: number
  label: string
  tone: string
  createdAt: number
}

const toEvent = (e: RawEvent): CalEvent => ({
  id: e.id,
  day: e.day,
  label: e.label,
  tone: (['ddl', 'exam', 'activity'].includes(e.tone) ? e.tone : 'activity') as CalTone,
  createdAt: e.createdAt,
})

export function useEvents() {
  const [events, setEvents] = useState<CalEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const d = await api.get<{ events: RawEvent[] }>('/events')
      setEvents(d.events.map(toEvent))
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

  /** 新增。返回是否成功，方便调用方清空输入框 */
  const add = useCallback(
    async (v: { day: number; label: string; tone: CalTone }) => {
      if (!v.label.trim()) {
        setError('内容不能为空')
        return false
      }
      setBusy(true)
      try {
        const d = await api.post<{ event: RawEvent }>('/events', v)
        // 插到正确位置，而不是无脑 push —— 列表是按 day 排的
        setEvents((prev) => [...prev, toEvent(d.event)].sort((a, b) => a.day - b.day || a.id - b.id))
        setError(null)
        return true
      } catch (e) {
        setError(errText(e))
        return false
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  /** 删除。乐观更新：先从列表移除，失败再补回来 */
  const remove = useCallback(async (id: number) => {
    let snapshot: CalEvent[] = []
    setEvents((prev) => {
      snapshot = prev
      return prev.filter((x) => x.id !== id)
    })
    try {
      await api.del(`/events/${id}`)
      setError(null)
    } catch (e) {
      setEvents(snapshot)
      setError(`删除失败：${errText(e)}`)
    }
  }, [])

  return { events, loading, busy, error, add, remove, reload }
}
