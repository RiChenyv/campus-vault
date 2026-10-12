/**
 * 课表数据的统一入口。
 *
 * 数据来自服务端（`/api/courses` + `/api/schedule`），这些是
 * 从 WakeUp 备份 / ICS / 学校网站 / 截图提取导入的真实课表。
 * 服务端为空或连不上时**回退到 mock**，这样纯前端调试仍然可用 ——
 * 但会把 `source` 报出来，UI 据此显示"演示数据"标记，不假装是真的。
 *
 * 两处需要转换：
 *   · day：后端 1=周一…7=周日，前端 0=周一…6=周日
 *   · rgb：后端不存颜色，这里按课程 id 稳定分配，保证同一门课每次颜色一致
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { COURSES as MOCK_COURSES, SCHEDULE as MOCK_SCHEDULE } from '../data/mock'
import type { Course, ScheduleItem } from '../types'
import { api } from './api'
import { weeksInclude } from './weeks'

/** 玻璃风格下能看清楚的配色，取自既有视觉语言 */
const PALETTE: { color: string; rgb: string }[] = [
  { color: 'rose', rgb: '255 143 177' },
  { color: 'sky', rgb: '143 178 255' },
  { color: 'mint', rgb: '126 214 190' },
  { color: 'amber', rgb: '240 186 120' },
  { color: 'violet', rgb: '186 155 255' },
  { color: 'coral', rgb: '250 150 130' },
  { color: 'teal', rgb: '120 200 220' },
  { color: 'lime', rgb: '178 214 130' },
  { color: 'pink', rgb: '232 160 220' },
  { color: 'indigo', rgb: '150 160 245' },
]

/** 由课程 id 稳定映射到配色 —— 不能用数组下标，否则增删课程会整体串色 */
function paletteOf(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]!
}

interface ServerCourse {
  id: number
  code: string
  name: string
  teacher: string
  credits: number
  term: string
  room: string
}

interface ServerSlot {
  id: number
  course_id: number | null
  course_name: string | null
  day: number
  from_slot: number
  span: number
  room: string
  weeks: string
}

/** 带周次的排课项 —— 前端比 mock 多一个 weeks 字段 */
export interface ScheduleEntry extends ScheduleItem {
  weeks: string
  room: string
}

export interface ScheduleData {
  courses: Course[]
  schedule: ScheduleEntry[]
  courseOf: (id: string) => Course | undefined
  loading: boolean
  source: 'server' | 'mock'
}

const EMPTY: Course[] = []

export function useSchedule(): ScheduleData {
  const [serverCourses, setServerCourses] = useState<Course[] | null>(null)
  const [serverSchedule, setServerSchedule] = useState<ScheduleEntry[] | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([
        api.get<{ courses: ServerCourse[] }>('/courses'),
        api.get<{ slots: ServerSlot[] }>('/schedule'),
      ])

      const courses: Course[] = c.courses.map((x) => {
        const p = paletteOf(String(x.id))
        return {
          id: String(x.id),
          name: x.name,
          teacher: x.teacher,
          room: x.room,
          term: x.term,
          credit: x.credits,
          color: p.color,
          rgb: p.rgb,
          files: 0,
          notes: 0,
          progress: 0,
        }
      })

      const schedule: ScheduleEntry[] = s.slots
        .filter((x) => x.course_id != null)
        .map((x) => ({
          // 后端 1=周一 → 前端 0=周一
          day: x.day - 1,
          from: x.from_slot,
          span: x.span,
          courseId: String(x.course_id),
          weeks: x.weeks ?? '',
          room: x.room ?? '',
        }))

      // 只有真的拿到课程才算成功；空课表要回退，否则界面会是一片空白，
      // 让人以为"课表没了"而不是"还没导入"
      if (courses.length) {
        setServerCourses(courses)
        setServerSchedule(schedule)
      }
      return courses.length > 0
    } catch {
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // 导入课表后其它页面会派发这个事件，用来让课表页立刻刷新
    const onChanged = () => void load()
    window.addEventListener('cv:schedule-changed', onChanged)
    return () => window.removeEventListener('cv:schedule-changed', onChanged)
  }, [load])

  // 服务端没数据时回退 mock，并标出来源
  const usingServer = serverCourses != null && serverCourses.length > 0

  const courses = usingServer ? serverCourses : MOCK_COURSES
  const schedule: ScheduleEntry[] = usingServer
    ? serverSchedule!
    : MOCK_SCHEDULE.map((s) => ({ ...s, weeks: '', room: '' }))

  const courseOf = useCallback(
    (id: string) => (courses === EMPTY ? undefined : courses.find((c) => c.id === id)),
    [courses],
  )

  return useMemo(
    () => ({
      courses,
      schedule,
      courseOf,
      loading,
      source: usingServer ? ('server' as const) : ('mock' as const),
    }),
    [courses, schedule, courseOf, loading, usingServer],
  )
}

/** 取出某个学生在第 week 周真正要上的课 */
export function scheduleAtWeek(schedule: ScheduleEntry[], week: number): ScheduleEntry[] {
  return schedule.filter((s) => weeksInclude(s.weeks, week))
}
