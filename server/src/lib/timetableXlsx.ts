/**
 * 教务系统导出的课表 xlsx → 课程 + 时间段。
 *
 * ── 这个文件长什么样（2026-10 实测 `timeTableForStu12.xlsx`）──
 *
 *   [0]  2026-2027学年 秋季学期课表          ← 标题（学期就在这一行）
 *   [3]  · 星期一 · · 星期二 · · 星期三 ……   ← 星期表头，在第 1/4/7/10/13/16/19 列
 *   [6]  1-2节 | 各天的格子                   ← 网格行：第 0 列是节次标签
 *   [9]  3-4节 …
 *   [24] 温馨提示：… [26] 送单人：… [27] 打印日期：…
 *   [28] 上课时间未确定  [29] 无
 *   [30] 调课信息        [31] 【调课】…
 *
 * 格子内容：`课程号-课程名[课序号] 教师 周次,星期N,N-M节,教室`
 * 一格可以塞**多条**（用逗号接在一起），例如同一门课一周里
 * 单双周在不同教室、或者线上线下不同安排：
 *
 *   1131010002-通识示例课程二[13] 甲老师 1-9周(单),星期1,5-6节,四十八教208,
 *   1131010002-通识示例课程二[13] 甲老师 2-8周(双),星期1,5-6节,混合式教学…
 *
 * ⚠️ **不能按逗号直接切条目** —— 条目内部的周次本身就用逗号分隔
 * （`10周,12-13周,15-17周(单)`）。切分点是"逗号后面紧跟 6 位以上课程号"。
 *
 * ⚠️ 同一个条目会在**多个网格行重复出现**：`9-12节` 的课同时落在
 * `9-10节` 和 `11-12节` 两行里，`5-8节` 的课落在三行里。所以必须按
 * 「课程 + 星期 + 节次 + 周次 + 教室」去重，否则时间段条数会翻倍。
 */

/** 一个时间段（写进 schedule_slots 的形状） */
export interface TimetableSlot {
  /** 1=周一 … 7=周日 */
  day: number
  /** 起始节（第几节开始） */
  from: number
  /** 连上几节 */
  span: number
  room: string
  /** 周次原文，如 `1-9周(单)` / `10周,12-13周,15-17周(单)` —— 原样保留 */
  weeks: string
}

export interface TimetableCourse {
  code: string
  /** 带课序号后缀，和库里现有的课程名形态一致（`专业示例课程一[01]`） */
  name: string
  teacher: string
  room: string
  slots: TimetableSlot[]
}

export interface TimetableParse {
  /** 规范化后的学期：`2026-2027第1学期`（与课程导入的写法一致） */
  term: string
  /** 标题原文，界面上显示给用户核对 */
  title: string
  courses: TimetableCourse[]
  slotCount: number
  /** 提示（不阻断导入），例如调课信息、上课时间未确定的课程 */
  notes: string[]
  /** 同一个条目在多行重复、被去掉的份数 */
  deduped: number
  /** 解析不了的格子原文（绝不静默丢掉） */
  badCells: string[]
  /** 网格行数（表头之外真正有内容的行），排查用 */
  gridRows: number
}

/* ------------------------------ 小工具 ------------------------------ */

const clean = (s: string) => s.replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim()

const WEEKDAY_CN: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }

/** 单个周次片段：`1-17周` / `10周` / `1-17周(单)` / `2-8周(双)` */
const WEEK_PART = /^\d+(?:-\d+)?周(?:\([单双]\))?$/

/** 节次片段：`9-12节` / `1-2节`；也接受单个 `5节` */
const SECTION_PART = /^(\d+)\s*(?:-\s*(\d+))?\s*节$/

/** 星期片段：`星期2` / `星期一` */
const WEEKDAY_PART = /^星期\s*([一二三四五六日天1-7])$/

/**
 * 学期：`2026-2027学年 秋季学期课表` → `2026-2027第1学期`。
 *
 * 为什么非要转成这个写法：课程去重键是 (课程号, 课程名, 学期)，而库里
 * 现有课程是**课程导入**写进去的 `2026-2027第1学期`。这里若原样用
 * `2026-2027学年 秋季学期`，同一门课就会因为学期字符串不同而**多出一条**。
 * （匹配有"归一化名 + 学期"这一层，学期对不上就落到下一层，容易出岔子。）
 */
export function normalizeTerm(title: string): { term: string; title: string } {
  const t = clean(title)
  const m = t.match(/(\d{4})\s*-\s*(\d{4})\s*学年\s*([春夏秋冬季])\s*季?\s*学期/)
  if (!m) return { term: t.replace(/课表$/, '').trim(), title: t }
  const year = `${m[1]}-${m[2]}`
  const seasonNo = m[3] === '秋' ? 1 : m[3] === '春' ? 2 : 3
  return { term: `${year}第${seasonNo}学期`, title: t }
}

/* ------------------------------ 解析 ------------------------------ */

/**
 * @param rows readXlsx() 解出来的二维字符串表
 */
export function parseTimetableTable(rows: string[][]): TimetableParse {
  if (!rows.length) {
    throw new Error('这张表格是空的 —— 里面一行都没有。请确认导出的是教务系统的「学生课表」。')
  }

  const badCells: string[] = []
  const notes: string[] = []

  /* ---- 标题 + 学期 ---- */
  const titleRow = rows.find((r) => r.some((c) => /课表/.test(c))) ?? []
  const title = clean(titleRow.find((c) => /课表/.test(c)) ?? '')
  if (!title) {
    throw new Error(
      '读不到课表标题（第 1 行应该是「2026-2027学年 秋季学期课表」这样的文字）。\n' +
        '请确认导出的是教务系统的课表，而不是别的东西。',
    )
  }
  const { term } = normalizeTerm(title)

  /* ---- 星期表头：决定哪几列是星期几 ---- */
  const colDay = new Map<number, number>()
  let headerRow = -1
  for (let ri = 0; ri < rows.length; ri++) {
    let hit = 0
    const local = new Map<number, number>()
    rows[ri]!.forEach((cell, ci) => {
      const m = clean(cell).match(/^星期\s*([一二三四五六日天])$/)
      if (m && WEEKDAY_CN[m[1]!]) {
        local.set(ci, WEEKDAY_CN[m[1]!]!)
        hit++
      }
    })
    if (hit >= 3) {
      for (const [k, v] of local) colDay.set(k, v)
      headerRow = ri
      break
    }
  }
  if (!colDay.size) {
    throw new Error(
      '找不到「星期一 … 星期日」这一行，认不出哪一列是星期几。\n' +
        '请确认导出的是教务系统的课表（表头里应当有星期几）。',
    )
  }

  /* ---- 逐行走网格 ----
     从**表头下一行**开始：表头那一行的「星期一…」也在星期列里，
     不排掉的话会被当成 7 个解析不了的格子。 */
  const courses = new Map<string, TimetableCourse>() // key = code|name
  const seenSlot = new Set<string>()
  let slotCount = 0
  let deduped = 0
  let gridRows = 0

  for (let ri = headerRow + 1; ri < rows.length; ri++) {
    const row = rows[ri]!
    const label = clean(row[0] ?? '')
    const sectionLabel = label.match(SECTION_PART)
    const hasDayCell = [...colDay.keys()].some((ci) => clean(row[ci] ?? '') !== '')

    /* 页脚：只提示、不解析 */
    if (/^调课信息$/.test(label)) continue // 小节标题本身不提示，下面那行才是内容
    if (/调课/.test(label)) {
      notes.push('调课信息（本次不导入，避免把其它周也改错）：' + label)
      continue
    }
    if (/上课时间未确定/.test(label)) {
      const v = clean(rows[ri + 1]?.[0] ?? '')
      /* 教务系统没标出具体课程时写的是「无」—— 那就没有可提示的 */
      if (v && v !== '无') notes.push('上课时间未确定的课程：' + v)
      continue
    }
    /* 网格行：第 0 列是「N-M节」，或这一天里有格子 */
    if (!sectionLabel && !hasDayCell) continue
    gridRows++

    /* 节次标签只作兜底：条目自己写的节次更准
       （`5-6节` 那一行里就有 `5-7节`、`5-8节` 的课） */
    const fallbackFrom = sectionLabel ? Number(sectionLabel[1]) : 0
    const fallbackSpan = sectionLabel?.[2] ? Number(sectionLabel[2]) - fallbackFrom + 1 : 1

    for (const [ci, day] of colDay) {
      const raw = clean(row[ci] ?? '')
      if (!raw) continue
      for (const piece of splitEntries(raw)) {
        const parsed = parseEntry(piece)
        if (!parsed) {
          badCells.push(piece)
          continue
        }
        if (parsed.day !== day) {
          /* 格子所在列与条目自称的星期不一致 —— 说明版面被改过，
             以**条目自己**为准，但要说出来（不静默） */
          notes.push(`第 ${parsed.day} 列的格子里写着「星期${parsed.day}」但它在星期${day}那一列，已按条目内容处理：${piece.slice(0, 40)}`)
        }
        const from = parsed.from || fallbackFrom
        const span = parsed.span || fallbackSpan
        if (!from) {
          badCells.push(piece)
          continue
        }

        const key = `${parsed.code}|${parsed.name}|${parsed.day}|${from}|${span}|${parsed.weeks}|${parsed.room}`
        if (seenSlot.has(key)) {
          deduped++
          continue
        }
        seenSlot.add(key)

        const ckey = `${parsed.code}|${parsed.name}`
        let course = courses.get(ckey)
        if (!course) {
          course = { code: parsed.code, name: parsed.name, teacher: parsed.teacher, room: '', slots: [] }
          courses.set(ckey, course)
        }
        if (!course.teacher && parsed.teacher) course.teacher = parsed.teacher
        course.slots.push({ day: parsed.day, from, span, room: parsed.room, weeks: parsed.weeks })
        slotCount++
      }
    }
  }

  if (!courses.size) {
    throw new Error(
      '这张课表里没有解析出任何课程。\n' +
        '读到的标题是：' + title + '\n' +
        '请确认文件是教务系统导出的「学生课表」，并且里面有课。',
    )
  }

  /* 课程的上课地点取它第一个时间段的教室，供课程列表显示 */
  for (const c of courses.values()) c.room = c.slots[0]?.room ?? ''

  return {
    term,
    title,
    courses: [...courses.values()],
    slotCount,
    notes,
    deduped,
    badCells,
    gridRows,
  }
}

/**
 * 把一个格子切成若干条目。
 *
 * 切分点是「逗号 + 紧跟 6 位以上课程号」，**不能**直接按逗号切 ——
 * 条目内部的周次自己就带逗号（`10周,12-13周,15-17周(单)`）。
 */
export function splitEntries(cell: string): string[] {
  return cell
    .split(/,(?=\s*\d{6,}\s*-)/)
    .map((s) => s.trim())
    .filter(Boolean)
}

interface ParsedEntry {
  code: string
  name: string
  teacher: string
  day: number
  from: number
  span: number
  room: string
  weeks: string
}

/**
 * `2121030179-专业示例课程一[01] 戊老师 1-17周,星期2,1-2节,四十八教603`
 *   → code / name(带课序号) / teacher / day / from / span / room / weeks
 *
 * 各片段**按内容识别**而不是按位置，这样学校调换字段顺序也不会读错。
 */
export function parseEntry(piece: string): ParsedEntry | null {
  const head = piece.match(/^(\d{6,})\s*-\s*(.+?)\s*\[([^\]]*)\]\s*(\S*)\s*(.*)$/)
  if (!head) return null
  const [, code, base, classNo, maybeTeacher, maybeRest] = head

  /* 正则里第 4 组吞掉的是"教师"，但教师名不是必须的；
     判据：剩下的部分里还得能找到 星期/节次，否则把第 4 组还回去当正文 */
  let teacher = maybeTeacher ?? ''
  let rest = maybeRest ?? ''
  if (!/星期/.test(rest) && /星期/.test(teacher + ' ' + rest)) rest = `${teacher} ${rest}`.trim()
  if (!/星期/.test(rest)) return null
  if (teacher && /星期|节|周|教/.test(teacher)) {
    rest = `${teacher} ${rest}`.trim()
    teacher = ''
  }

  const parts = rest.split(',').map((s) => s.trim()).filter(Boolean)
  const weekParts: string[] = []
  const rooms: string[] = []
  let day = 0
  let from = 0
  let span = 0

  for (const p of parts) {
    const wd = p.match(WEEKDAY_PART)
    if (wd) {
      day = WEEKDAY_CN[wd[1]!] ?? Number(wd[1]) ?? 0
      continue
    }
    const sec = p.match(SECTION_PART)
    if (sec) {
      from = Number(sec[1])
      span = sec[2] ? Number(sec[2]) - from + 1 : 1
      continue
    }
    if (WEEK_PART.test(p)) {
      weekParts.push(p)
      continue
    }
    rooms.push(p)
  }

  if (!day || !from || !weekParts.length) return null

  const name = classNo ? `${base}[${classNo}]` : base!
  return {
    code: code!,
    name,
    teacher: clean(teacher),
    day,
    from,
    span: span || 1,
    /* 教室原样保留（含"混合式教学（白杨课堂），按老师要求完成线上课程"这种长文本）；
       多段时用顿号接起来，避免和上面的周次逗号混淆 */
    room: rooms.join('；'),
    weeks: weekParts.join(','),
  }
}
