/**
 * ICS（iCalendar，RFC 5545）课程表解析。
 *
 * 为什么加这条路径：WakeUp 等课表 App 普遍支持「导出为日历」，
 * 这个入口在 UI 里通常比「导出备份文件」好找，而且是**标准格式** ——
 * 不像私有备份格式那样随版本变。
 *
 * 需要处理的几个 RFC 细节（不处理就会解析错）：
 *  · **折行**：长行会以「空格或 Tab 开头」续行，必须先展开再解析。
 *  · **转义**：`\,` `\;` `\n` `\\` 在值里是转义的，要还原。
 *  · **DTSTART 形态多样**：`20260907T080000`（本地）/ `...Z`（UTC）/
 *    `DTSTART;TZID=Asia/Shanghai:...` / 纯日期 `VALUE=DATE:20260907`。
 *  · **RRULE**：`FREQ=WEEKLY;COUNT=16` / `UNTIL=...` / `INTERVAL=2`（隔周）。
 */

export interface IcsSlot {
  /** 1=周一 … 7=周日 */
  day: number
  startTime: string
  endTime: string
  room: string
  /** 人类可读的重复规则，如 `每周 16 次` / `每 2 周` */
  repeat: string
  /** 首次上课日期（YYYY-MM-DD），用作学期起点推断 */
  firstDate: string
}

export interface IcsCourse {
  name: string
  teacher: string
  room: string
  slots: IcsSlot[]
}

export interface IcsParseResult {
  courses: IcsCourse[]
  /** 所有事件里最早的一天，可当学期起始日 */
  termStart: string
  notes: string[]
}

/** 展开折行、还原转义 */
function unfold(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const out: string[] = []
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1)
    } else {
      out.push(line)
    }
  }
  return out
}

const unescape = (v: string) =>
  v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')

/** 解析一行 `NAME;PARAM=1;PARAM2=2:VALUE` */
function splitLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  // 冒号要跳过被引号包裹的部分（TZID 里可能带引号）
  let inQuote = false
  let idx = -1
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inQuote = !inQuote
    else if (c === ':' && !inQuote) {
      idx = i
      break
    }
  }
  if (idx < 0) return null
  const left = line.slice(0, idx)
  const value = line.slice(idx + 1)
  const parts = left.split(';')
  const name = (parts.shift() ?? '').toUpperCase()
  const params: Record<string, string> = {}
  for (const p of parts) {
    const eq = p.indexOf('=')
    if (eq < 0) continue
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name, params, value }
}

/** `20260907T080000` / `20260907T080000Z` / `20260907` → { date, time } */
function parseDt(value: string, params: Record<string, string>): { date: string; time: string } | null {
  const v = value.trim()
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/)
  if (!m) return null
  const date = `${m[1]}-${m[2]}-${m[3]}`
  let time = m[4] && m[5] ? `${m[4]}:${m[5]}` : ''

  // UTC 要转成本地时间，否则整张课表会偏 8 小时
  if (time && m[7] === 'Z') {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])))
    const p = (n: number) => String(n).padStart(2, '0')
    return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` }
  }
  // 纯日期（VALUE=DATE）没有时间
  if (params.VALUE === 'DATE') time = ''
  return { date, time }
}

/** 由 YYYY-MM-DD 求 ISO 星期（1=周一 … 7=周日） */
function isoDay(date: string): number {
  const d = new Date(`${date}T00:00:00`)
  return ((d.getDay() + 6) % 7) + 1
}

function describeRule(rrule: string): { repeat: string; interval: number } {
  if (!rrule) return { repeat: '', interval: 1 }
  const get = (k: string) => {
    const m = rrule.match(new RegExp(`${k}=([^;]+)`, 'i'))
    return m ? m[1]!.trim() : ''
  }
  const interval = Number(get('INTERVAL')) || 1
  const count = get('COUNT')
  const until = get('UNTIL')
  const parts: string[] = []
  if (interval > 1) parts.push(`每 ${interval} 周`)
  else parts.push('每周')
  if (count) parts.push(`共 ${count} 次`)
  else if (until) {
    const m = until.match(/^(\d{4})(\d{2})(\d{2})/)
    if (m) parts.push(`至 ${m[1]}-${m[2]}-${m[3]}`)
  }
  return { repeat: parts.join(' '), interval }
}

export function parseIcs(raw: string): IcsParseResult {
  if (!raw || !raw.trim()) throw new Error('文件是空的')
  if (!/BEGIN:VCALENDAR/i.test(raw)) {
    throw new Error('这不是 ICS 日历文件（缺少 BEGIN:VCALENDAR）。请确认导出的是「日历 / ICS」格式。')
  }

  const lines = unfold(raw)
  const events: { fields: { name: string; params: Record<string, string>; value: string }[] }[] = []
  let cur: { name: string; params: Record<string, string>; value: string }[] | null = null

  for (const line of lines) {
    const t = line.trim()
    if (/^BEGIN:VEVENT/i.test(t)) {
      cur = []
      continue
    }
    if (/^END:VEVENT/i.test(t)) {
      if (cur) events.push({ fields: cur })
      cur = null
      continue
    }
    if (!cur) continue
    const f = splitLine(t)
    if (f) cur.push(f)
  }

  if (!events.length) throw new Error('日历里没有任何日程（VEVENT）。这份文件可能是空的。')

  const notes: string[] = []
  const byName = new Map<string, IcsCourse>()
  let noTime = 0
  let noSummary = 0
  let allDay = 0
  let minDate = ''

  for (const ev of events) {
    const get = (n: string) => ev.fields.find((f) => f.name === n)
    const summary = get('SUMMARY')
    if (!summary?.value) {
      noSummary++
      continue
    }

    const dtStart = get('DTSTART')
    if (!dtStart) {
      noTime++
      continue
    }
    const start = parseDt(dtStart.value, dtStart.params)
    if (!start) {
      noTime++
      continue
    }
    if (!start.time) {
      // 全天事件不是课，跳过
      allDay++
      continue
    }

    const dtEnd = get('DTEND')
    const end = dtEnd ? parseDt(dtEnd.value, dtEnd.params) : null
    const endTime = end?.time ?? ''

    const name = unescape(summary.value).trim()
    const location = get('LOCATION')?.value ? unescape(get('LOCATION')!.value).trim() : ''
    const desc = get('DESCRIPTION')?.value ? unescape(get('DESCRIPTION')!.value) : ''
    const rrule = get('RRULE')?.value ?? ''
    const { repeat } = describeRule(rrule)

    // 教师常放在 DESCRIPTION 里，形如 "教师：张三" 或直接是名字
    let teacher = ''
    const tm = desc.match(/(?:教师|老师|授课教师)\s*[:：]\s*([^\n;]{1,20})/)
    if (tm) teacher = tm[1]!.trim()

    let course = byName.get(name)
    if (!course) {
      course = { name, teacher, room: location, slots: [] }
      byName.set(name, course)
    }
    if (!course.room && location) course.room = location
    if (!course.teacher && teacher) course.teacher = teacher

    // 同一门课同一时间重复出现（RRULE 展开后的多次事件）只保留一条
    const dup = course.slots.some((s) => s.day === isoDay(start.date) && s.startTime === start.time)
    if (!dup) {
      course.slots.push({
        day: isoDay(start.date),
        startTime: start.time,
        endTime: endTime || start.time,
        room: location || course.room,
        repeat,
        firstDate: start.date,
      })
    }
    if (!minDate || start.date < minDate) minDate = start.date
  }

  const courses = [...byName.values()].filter((c) => c.slots.length)
  if (!courses.length) {
    throw new Error('日历里没有解析出任何带时间的课程。如果导出的是全天事件，本解析器暂不支持。')
  }

  if (allDay) notes.push(`${allDay} 条全天事件已跳过（不是课程）`)
  if (noTime) notes.push(`${noTime} 条缺少开始时间，已跳过`)
  if (noSummary) notes.push(`${noSummary} 条没有标题，已跳过`)

  courses.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return { courses, termStart: minDate, notes }
}
