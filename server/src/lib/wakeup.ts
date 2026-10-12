/**
 * WakeUp 课程表备份文件（`.wakeup_schedule`）解析。
 *
 * 为什么走文件而不是它的「分享口令」接口：
 *  我们实测过 `https://i.wakeup.fun/share_schedule/get?key=…` ——
 *  用**乱编的口令**和**真实口令**得到的错误完全一样（都是「当前版本过低」），
 *  而不带 key 时报的是参数校验错。说明请求进到了业务逻辑，
 *  被**版本门禁**挡下：该接口已经不对第三方开放（试过十几组版本参数与 UA 均无效）。
 *
 *  备份文件则是纯本地的：没有接口、没有门禁、不会 30 分钟过期。
 *  格式也稳定（多行 JSON），是更可靠的导入来源。
 *
 * 文件格式（5 行，每行一个 JSON；整体可能被转义过）：
 *   [0] 时间元数据（用不到）
 *   [1] timeTable     [{ node, startTime, endTime }]        节次 → 起止时间
 *   [2] tableInfo     { startDate, tableName, ... }         学期起始日
 *   [3] courseInfos   [{ id, courseName }]                  课程 id → 名称
 *   [4] courseDetails [{ id, day, startNode, step,         课程安排
 *                        startWeek, endWeek, type, room, ownTime }]
 *
 *   type: 0=每周  1=单周  2=双周
 *   ownTime=true 表示该条自带时间（自定义时间课程），本解析器跳过。
 */

export interface WakeupSlot {
  day: number
  startNode: number
  step: number
  room: string
  startWeek: number
  endWeek: number
  /** 0=每周 1=单周 2=双周 */
  weekType: number
  startTime: string
  endTime: string
}

export interface WakeupCourse {
  name: string
  room: string
  /** 该课程的所有上课安排 */
  slots: WakeupSlot[]
  /** 学期起始日，来自 tableInfo.startDate */
  termStart: string
  /** 课表名称，来自 tableInfo.tableName */
  tableName: string
}

export interface WakeupParseResult {
  courses: WakeupCourse[]
  termStart: string
  tableName: string
  /** 解析过程中的提示，返回给用户看 */
  notes: string[]
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 节次时间形如 "08:00" 或 "08:00:00"，统一取前 5 位 */
const hhmm = (s: unknown): string => {
  const v = String(s ?? '').trim()
  const m = v.match(/^(\d{1,2}):(\d{2})/)
  return m ? `${pad(Number(m[1]))}:${m[2]}` : v.slice(0, 5)
}

/** 把 (起始周, 结束周, 单双周) 变成可读文本，如 `1-16周(单)` */
export function weeksLabel(startWeek: number, endWeek: number, weekType: number): string {
  const base = startWeek === endWeek ? `${startWeek}周` : `${startWeek}-${endWeek}周`
  if (weekType === 1) return `${base}(单)`
  if (weekType === 2) return `${base}(双)`
  return base
}

/**
 * 解析备份文件内容。
 * 失败时抛带中文原因的 Error —— 上层直接把它作为用户提示返回，
 * 不做"尽力而为"的部分解析（宁可明确失败，也不要导入半份课表）。
 */
export function parseWakeupBackup(raw: string): WakeupParseResult {
  if (!raw || !raw.trim()) throw new Error('文件是空的')

  // 备份文件整体可能是被转义过的（外面套了一层 JSON 字符串）
  const normalized = raw.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  const lines = normalized
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .split('\n')
    .filter((l) => l.trim())

  if (lines.length < 5) {
    throw new Error(
      `这不是 WakeUp 备份文件（需要 5 行 JSON，实际 ${lines.length} 行）。\n` +
        '请确认导出的是「备份文件」而不是分享口令。',
    )
  }

  const parseLine = (i: number, what: string) => {
    try {
      return JSON.parse(lines[i]!)
    } catch {
      throw new Error(`第 ${i + 1} 行（${what}）不是合法 JSON，文件可能已损坏`)
    }
  }

  const timeTable = parseLine(1, '节次时间') as { node: number; startTime: string; endTime: string }[]
  const tableInfo = parseLine(2, '课表信息') as { startDate?: string; tableName?: string }
  const courseInfos = parseLine(3, '课程定义') as { id: number | string; courseName: string }[]
  const courseDetails = parseLine(4, '课程安排') as {
    id: number | string
    day: number
    startNode: number
    step: number
    startWeek: number
    endWeek: number
    type: number
    room?: string
    ownTime?: boolean
  }[]

  if (!Array.isArray(timeTable) || !Array.isArray(courseInfos) || !Array.isArray(courseDetails)) {
    throw new Error('文件结构不对：节次时间 / 课程定义 / 课程安排应该是数组')
  }

  const notes: string[] = []
  const slotOf = new Map(timeTable.map((t) => [Number(t.node), t]))

  /** 课程名 → 课程（按名称聚合，同一门课多个时间段合并到一起） */
  const byName = new Map<string, WakeupCourse>()
  let skippedOwnTime = 0
  let skippedNoTime = 0
  let skippedNoInfo = 0

  for (const d of courseDetails) {
    if (d.ownTime) {
      skippedOwnTime++
      continue
    }
    const info = courseInfos.find((c) => String(c.id) === String(d.id))
    if (!info?.courseName) {
      skippedNoInfo++
      continue
    }
    const day = Number(d.day)
    if (!(day >= 1 && day <= 7)) continue

    // 把「起始节次 ~ 起始节次+连堂数」映射成实际起止时间
    let startTime = ''
    let endTime = ''
    for (let n = Number(d.startNode); n < Number(d.startNode) + Math.max(1, Number(d.step) || 1); n++) {
      const slot = slotOf.get(n)
      if (!slot) continue
      if (!startTime) startTime = hhmm(slot.startTime)
      endTime = hhmm(slot.endTime)
    }
    if (!startTime || !endTime) {
      skippedNoTime++
      continue
    }

    const name = info.courseName.trim()
    let course = byName.get(name)
    if (!course) {
      course = {
        name,
        room: d.room ?? '',
        slots: [],
        termStart: tableInfo.startDate ?? '',
        tableName: tableInfo.tableName ?? '',
      }
      byName.set(name, course)
    }

    course.slots.push({
      day,
      startNode: Number(d.startNode),
      step: Math.max(1, Number(d.step) || 1),
      room: d.room ?? course.room,
      startWeek: Number(d.startWeek) || 1,
      endWeek: Number(d.endWeek) || Number(d.startWeek) || 1,
      weekType: Number(d.type) || 0,
      startTime,
      endTime,
    })
  }

  const courses = [...byName.values()]
  if (!courses.length) {
    throw new Error('没能从文件里解析出任何课程。可能这份课表是空的，或格式与预期不符。')
  }

  if (skippedOwnTime) notes.push(`${skippedOwnTime} 条「自定义时间」的课程已跳过（本解析器只处理标准节次）`)
  if (skippedNoTime) notes.push(`${skippedNoTime} 条课程找不到对应节次时间，已跳过`)
  if (skippedNoInfo) notes.push(`${skippedNoInfo} 条课程缺少名称定义，已跳过`)

  // 按课程名排序，输出稳定
  courses.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return {
    courses,
    termStart: tableInfo.startDate ?? '',
    tableName: tableInfo.tableName ?? '',
    notes,
  }
}
