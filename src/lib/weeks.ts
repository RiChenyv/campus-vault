/**
 * 周次文本的解析与匹配。
 *
 * 后端 `schedule_slots.weeks` 存的是人类可读的文本，因为它是从多个来源
 * （WakeUp 备份 / ICS / 截图提取）汇总来的，各来源的单双周表示法不同。
 * 这里把它解析成"第 N 周上不上"。
 *
 * 支持的写法：
 *   `1-17周`        连续区间
 *   `1-17周(单)`    区间 + 单周
 *   `1-17周(双)`    区间 + 双周
 *   `5-7周,10周`    多段，逗号 / 顿号 / 分号分隔
 *   `第3周`         "第"字可省略
 *   空字符串        视为全程有效（老数据可能没填）
 */

/** 把 weeks 文本解析成若干 [起, 止, 单双] 段；单双 0=不限 1=单 2=双 */
function parseSegments(text: string): { from: number; to: number; parity: number }[] {
  const raw = (text ?? '').trim()
  if (!raw) return []

  // 整体单双周标记：`...(单)` / `...(双)` / `...单周` / `...双周`
  const globalParity = /单/.test(raw) ? 1 : /双/.test(raw) ? 2 : 0

  const out: { from: number; to: number; parity: number }[] = []
  // 先按分隔符切段，再逐段解析
  for (const part of raw.split(/[,，、;；]+/)) {
    const s = part.trim()
    if (!s) continue

    const parity = /单/.test(s) ? 1 : /双/.test(s) ? 2 : globalParity

    // `1-17周` / `1~17` / `1—17`
    const range = s.match(/(\d{1,2})\s*[-–—~至]\s*(\d{1,2})/)
    if (range) {
      out.push({ from: Number(range[1]), to: Number(range[2]), parity })
      continue
    }
    // `第5周` / `5周`
    const single = s.match(/(\d{1,2})/)
    if (single) {
      const n = Number(single[1])
      out.push({ from: n, to: n, parity })
    }
  }
  return out
}

/** 第 week 周是否要上这门课 */
export function weeksInclude(text: string, week: number): boolean {
  const segs = parseSegments(text)
  // 解析不出任何区间（含空文本）→ 视为全程有效，宁可显示也不要漏课
  if (!segs.length) return true
  for (const s of segs) {
    if (week < s.from || week > s.to) continue
    if (s.parity === 1 && week % 2 === 0) continue
    if (s.parity === 2 && week % 2 === 1) continue
    return true
  }
  return false
}

/** 该课在给定周次范围内的所有有效周（用于统计与调试） */
export function weeksList(text: string, maxWeek = 30): number[] {
  const out: number[] = []
  for (let w = 1; w <= maxWeek; w++) if (weeksInclude(text, w)) out.push(w)
  return out
}

/** 把 weeks 文本压缩成短的展示形式，列表里用 */
export function weeksLabel(text: string): string {
  const raw = (text ?? '').trim()
  return raw || '全程'
}

/* ------------------------------ 学期与当前周 ------------------------------ */

/**
 * 本学期第 1 周的周一。
 * 取自 WakeUp 截图里第 1 周的日期（9/7–9/13）。
 */
export const TERM_START = '2026-09-07'
export const TERM_WEEKS = 17

/** 今天属于第几周（第 1 周起算；放假后返回大于 TERM_WEEKS 的值） */
export function currentWeek(today = new Date()): number {
  const start = new Date(`${TERM_START}T00:00:00`)
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.floor((t.getTime() - start.getTime()) / 86400000)
  return Math.floor(days / 7) + 1
}

/** 第 n 周周一的日期 */
export function weekStartDate(week: number): Date {
  const d = new Date(`${TERM_START}T00:00:00`)
  d.setDate(d.getDate() + (week - 1) * 7)
  return d
}

/** 第 n 周对应的 7 个日期（周一 … 周日） */
export function weekDates(week: number): Date[] {
  const mon = weekStartDate(week)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon)
    d.setDate(d.getDate() + i)
    return d
  })
}
