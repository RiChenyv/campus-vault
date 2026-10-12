/**
 * 「教务系统导出的成绩表格（xlsx）」→ GradeValues。
 *
 * 为什么单独一层：xlsx.ts 只负责"把 zip 解成字符串表格"，它不知道
 * 哪一列是课程名、`95.0` 要写成 `95`。**列名 → 字段的映射规则**放这里，
 * 于是它可以脱离 zip 单独测（拿一个二维数组就能跑）。
 *
 * 数据来源：教务系统能导出的 `全部成绩查询.xlsx`。
 * 实测表头 20 列（2026-10）：
 *   学年学期 | 课程号 | 课程名 | 总成绩 | 课序号 | 课程类别 | 课程性质 | 学分 |
 *   学时 | 修读方式 | 是否主修 | 考试日期 | 绩点 | 重修重考 | 等级成绩类型 |
 *   考试类型 | 开课单位 | 是否及格 | 是否有效 | 特殊原因
 * 我们**只要 12 个字段**，其余列（课序号 / 学时 / 等级成绩类型 / 考试类型 /
 * 开课单位 / 是否及格 / 是否有效 / 特殊原因）故意忽略 ——
 * 但"忽略了哪几列"要**告诉用户**，见 `ignoredColumns`。
 *
 * ⚠️ 两条硬规则（都踩过）：
 *  1. **缺必须列要报错，不许猜**。课程名或总成绩认不出来时，
 *     按位置硬凑出来的数据看起来完全正常（课程名对、分数对，但整体错位），
 *     用户根本发现不了。宁可报错让他去核对表头。
 *  2. **列名匹配先完全相等，再退回包含**。只按"包含"找的话，
 *     学校加一列「绩点排名」会让「绩点」命中名次（实测 3.85 读成 1）。
 *     这条规则和 `server/inject/parse.js` 的 `GRADE_COLS` 是同一套，
 *     改动时两边都要改（网页版和表格版是同一份成绩单的两种形态）。
 */

import type { GradeValues } from './grades.ts'

/* ============================ 列定义 ============================ */

export interface GradeCol {
  field: keyof GradeValues
  /** 表头文字里的候选名，**按优先级**排 */
  names: string[]
  /** 认不出来时要不要直接报错（必修列） */
  required: boolean
  /** 报错时给用户看的人话 */
  label: string
}

/**
 * 12 个需要的字段 + 别名表。
 *
 * 顺序就是"别名优先级"：`总成绩` 在 `成绩` 前面，否则表头里同时有
 * 「总成绩」和「等级成绩类型」时，只按包含匹配可能先命中后者（含"成绩"）。
 */
export const GRADE_COLS: GradeCol[] = [
  { field: 'term', names: ['学年学期', '学期'], required: false, label: '学年学期' },
  { field: 'courseName', names: ['课程名', '课程名称'], required: true, label: '课程名' },
  { field: 'courseCode', names: ['课程号', '课程代码'], required: false, label: '课程号' },
  { field: 'score', names: ['总成绩', '成绩'], required: true, label: '总成绩' },
  { field: 'credit', names: ['学分'], required: false, label: '学分' },
  { field: 'gpa', names: ['绩点', '绩点成绩'], required: false, label: '绩点' },
  { field: 'category', names: ['课程类别'], required: false, label: '课程类别' },
  { field: 'nature', names: ['课程性质'], required: false, label: '课程性质' },
  { field: 'mode', names: ['修读方式'], required: false, label: '修读方式' },
  { field: 'isMajor', names: ['是否主修'], required: false, label: '是否主修' },
  { field: 'examDate', names: ['考试日期'], required: false, label: '考试日期' },
  { field: 'retake', names: ['重修重考'], required: false, label: '重修重考' },
]

/* ============================ 工具 ============================ */

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()

/**
 * 把表格里的数字写法归一化：`95.0` → `95`，`2.0` → `2`，`3.95` 保持。
 *
 * ⚠️ 只对**纯数字**做。`优秀`、`通过`、`2025-2026学年 秋季学期` 一律原样返回 ——
 * 正则只认 `-?digits(.digits)?`，别写成"去尾零"的字符串操作：
 * 那样 `"2026-01-05"` 会被削成 `"2026-1-5"`，考试日期就废了。
 */
export function normalizeNumberText(raw: string): string {
  const s = clean(raw)
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return s
  const n = Number(s)
  if (!Number.isFinite(n)) return s
  /* toFixed(10) 再削尾零：`95.0`→`95`、`3.95`→`3.95`。
     直接 String(n) 也对（95.0 → "95"），但 1e21 那种会变成科学计数法，
     走定点更稳。 */
  return n.toFixed(10).replace(/\.?0+$/, '')
}

/** 这一列的数字值；不是数字就是 null（**不用 0 混过去**：0 和"没有"是两回事） */
function numOrNull(raw: string): number | null {
  const s = normalizeNumberText(raw)
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * 在表头行里按候选名找列下标。
 *
 * 两趟，顺序**不能换**：
 *   ① 完全相等（对所有列都做）—— 这一步挡住"绩点"命中"绩点排名"
 *   ② 包含（**只对可选列做**）—— 兜住"课程名称"这类没进别名表的写法
 *
 * ⚠️ 第二趟为什么必须排除必修列：真实表头里有「等级成绩类型」和「考试类型」
 * 两列，它们都含"成绩"两个字。必修列「总成绩」找不到时会退回包含匹配，
 * 于是**默默命中「等级成绩类型」**—— 表里明明没有总成绩这一列，
 * 却导进来一批看起来正常的数据（分数位置是"百分制"），用户根本发现不了。
 * 必修列认不出来就必须报错（见 parseGradesTable），这才是安全的默认。
 */
export function findColumn(headers: string[], names: string[], allowPartial = true): number {
  const h = headers.map((x) => clean(x).replace(/\s+/g, ''))
  for (const n of names) {
    for (let j = 0; j < h.length; j++) {
      if (h[j] === n) return j
    }
  }
  if (!allowPartial) return -1
  for (const n of names) {
    for (let j = 0; j < h.length; j++) {
      if (h[j]!.includes(n)) return j
    }
  }
  return -1
}

/* ============================ 映射 ============================ */

export interface GradesXlsxParse {
  grades: GradeValues[]
  /** 表格里一共多少数据行（表头之外） */
  totalRows: number
  /** 表头文字，原样，便于报错时说清"我看到了什么" */
  headers: string[]
  /** 字段 → 列下标（-1 = 表里没有这一列） */
  columnIndex: Record<string, number>
  /** 用到了哪几列（表头文字） */
  usedColumns: string[]
  /** 被忽略的列（表头文字）—— 界面上要写"已忽略 N 列不需要的信息" */
  ignoredColumns: string[]
  /** 表里缺的字段（中文名）—— 这些字段在界面上会显示「未收集」 */
  missingFields: string[]
  /** 提醒（不阻断导入） */
  notes: string[]
  /** 用的是内联字符串还是共享字符串，排查用 */
  stringMode: string
  sheetName: string
}

/** 表头行之后的数据行里，是不是一行有效数据（全空的行跳过） */
const isBlankRow = (cells: string[]) => cells.every((c) => clean(c) === '')

/**
 * 表格 → 成绩。
 *
 * @param rows xlsx 解出来的二维字符串数组（第 1 行是表头）
 */
export function parseGradesTable(rows: string[][], meta: { stringMode?: string; sheetName?: string } = {}): GradesXlsxParse {
  if (!rows.length) {
    throw new Error('这张表格是空的 —— 里面一行都没有。请确认导出的是「全部成绩查询」，并且没有把数据删掉。')
  }

  const headers = (rows[0] ?? []).map(clean)
  if (!headers.filter(Boolean).length) {
    throw new Error('表格的第 1 行是空的，读不到表头。请确认第 1 行是列名（学年学期 / 课程名 / 总成绩 …），数据从第 2 行开始。')
  }

  /* ---- 定位每一列 ----
     必修列**不许**退回"包含"匹配：那段宽松规则是为了兜住"课程名称"
     这类别名，但用在「总成绩」上会默默命中「等级成绩类型」——
     表里没有总成绩却导进一批看着正常的错数据。 */
  const columnIndex: Record<string, number> = {}
  for (const col of GRADE_COLS) columnIndex[col.field] = findColumn(headers, col.names, !col.required)

  /* ---- 缺必须列 → 明确报错，绝不猜 ---- */
  const missingRequired = GRADE_COLS.filter((c) => c.required && columnIndex[c.field] === -1)
  if (missingRequired.length) {
    const want = missingRequired.map((c) => c.label + '（' + c.names.join(' / ') + '）').join('、')
    throw new Error(
      '这份表格里找不到必需的列：' + want + '。\n' +
      '读到的表头是：' + (headers.filter(Boolean).join(' | ') || '(空)') + '\n' +
      '请确认导出的是教务系统的「全部成绩查询」表格；' +
      '如果表头名和上面不一样，把表头文字发回来，加上别名即可。' +
      '（这一条故意做成报错：按位置硬凑出来的成绩看起来完全正常，你发现不了。）',
    )
  }

  /* ---- 哪些列被忽略 ---- */
  const usedIdx = new Set(Object.values(columnIndex).filter((i) => i >= 0))
  const usedColumns: string[] = []
  const ignoredColumns: string[] = []
  headers.forEach((h, i) => {
    if (!h) return
    if (usedIdx.has(i)) usedColumns.push(h)
    else ignoredColumns.push(h)
  })

  const missingFields = GRADE_COLS.filter((c) => columnIndex[c.field] === -1).map((c) => c.label)

  /* ---- 逐行映射 ---- */
  const grades: GradeValues[] = []
  let skipped = 0
  const badScores: string[] = []
  const rowsArr = rows.slice(1)
  for (const raw of rowsArr) {
    if (isBlankRow(raw)) continue
    const at = (f: keyof GradeValues) => {
      const i = columnIndex[f]!
      return i >= 0 ? clean(raw[i] ?? '') : ''
    }

    const courseName = at('courseName')
    /* 没有课程名的行无法成为一条成绩（grades.ts 的 normalizeGrade 也会丢掉它）。
       与其静默丢，不如数出来告诉用户 —— 静默少几条最难查。 */
    if (!courseName) {
      skipped++
      continue
    }

    const score = normalizeNumberText(at('score'))
    const credit = numOrNull(at('credit'))
    const gpa = numOrNull(at('gpa'))
    const majorText = at('isMajor')

    if (credit === null && at('credit') !== '') badScores.push(`学分「${at('credit')}」不是数字`)
    if (gpa === null && at('gpa') !== '') badScores.push(`绩点「${at('gpa')}」不是数字`)

    grades.push({
      courseCode: at('courseCode'),
      courseName,
      term: at('term'),
      score,
      /* 数字成绩才给 scoreNum；「优秀」这种等级成绩保持 null ——
         编成 90 分会让平均分算错，而且看不出来（项目原则：宁可空着）。 */
      scoreNum: /^-?\d+(?:\.\d+)?$/.test(score) ? Number(score) : null,
      /* 学分/绩点缺了就是 0 / null（库里就是这两个"没有值"的写法）。
         normalizeGrade 对没给的字段也是这么办的，这里显式写出来，
         免得走 raw 对象那条路时被 numOrNull("2 学分") 之类误判。 */
      credit: credit === null ? 0 : credit,
      gpa,
      category: at('category'),
      nature: at('nature'),
      mode: at('mode'),
      /* 「是」= 主修。**空着也是 0**（不是"未知"）—— 库里只有 0/1 两态，
         真实文件里春季学期那几行的「是否主修」就是空的。 */
      isMajor: majorText === '是' ? 1 : 0,
      examDate: at('examDate'),
      retake: at('retake'),
    })
  }

  const notes: string[] = []
  if (ignoredColumns.length) {
    notes.push(`已忽略 ${ignoredColumns.length} 列不需要的信息：${ignoredColumns.join('、')}`)
  }
  if (skipped) {
    notes.push(`有 ${skipped} 行没有课程名，已跳过（没法确定是哪门课）`)
  }
  if (majorTextNote(rows, columnIndex)) {
    notes.push('「是否主修」有格子是空的，这些行按「否」处理 —— 需要的话可以在学分总览里核对')
  }
  const uniqBad = [...new Set(badScores)]
  if (uniqBad.length) {
    notes.push(`有 ${uniqBad.length} 处数值读不出来（${uniqBad.slice(0, 3).join('；')}），这些格子按"没有值"处理`)
  }

  return {
    grades,
    totalRows: rowsArr.filter((r) => !isBlankRow(r)).length,
    headers,
    columnIndex,
    usedColumns,
    ignoredColumns,
    missingFields,
    notes,
    stringMode: meta.stringMode ?? '',
    sheetName: meta.sheetName ?? '',
  }
}

/** 「是否主修」列里有没有空格子（用来决定要不要提醒） */
function majorTextNote(rows: string[][], columnIndex: Record<string, number>): boolean {
  const i = columnIndex.isMajor ?? -1
  if (i < 0) return false
  let blank = 0
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!
    if (isBlankRow(row)) continue
    if (clean(row[i] ?? '') === '') blank++
  }
  return blank > 0
}
