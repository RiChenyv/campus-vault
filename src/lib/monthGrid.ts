/**
 * 日历的月份网格 —— **按真实日期算**，一个数字都不写死。
 *
 * 原来这张网格写死在 `data/mock.ts`：
 *
 *     export const CAL_MONTH = { year: 2025, month: 11, firstWeekday: 6, days: 30 }
 *
 * 于是不管今天几号，界面上永远显示「2025 年 11 月」，
 * 「今天」的高亮也写死在第 3 格（`isToday = d === 3`）。
 * 这种假数据比空着更糟 —— 它看起来是对的，用户得盯着屏幕算一遍才发现不对。
 *
 * 抽成纯函数是为了能**真的测**：传一个日期进去，年份/月份/天数/起始星期/
 * 今天几号都能逐项核对（见 server/test/calendar-month.mjs）。
 */

export interface MonthGrid {
  year: number
  /** 1~12。界面上就是「N 月」，不用再 +1 */
  month: number
  /**
   * 这个月 1 号落在第几列：**0 = 周一 … 6 = 周日**。
   * 网格是周一起始的（表头 一 二 三 四 五 六 日），
   * 而 JS 的 getDay() 是周日 = 0，所以要做一次平移。
   */
  firstWeekday: number
  /** 这个月的天数（闰年自动正确） */
  days: number
  /** 今天是几号（`now` 所在月份里的号数） */
  today: number
}

/**
 * 生成 `now` 所在月份的网格。默认就是"现在"。
 *
 * 两个容易写错的地方，这里都用 Date 自己的算法兜住，不手工判断：
 *   · 天数：`new Date(y, m, 0)` 是"下个月的第 0 天"= 本月最后一天。
 *     闰年、大小月、世纪年（1900 不是闰年、2000 是）全由 Date 处理 ——
 *     自己写 `y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)` 迟早写错一个。
 *   · 起始星期：`getDay()` 是 0=周日，网格要 0=周一 → `(getDay() + 6) % 7`。
 */
export function buildMonthGrid(now: Date = new Date()): MonthGrid {
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  return {
    year,
    month,
    firstWeekday: (new Date(year, month - 1, 1).getDay() + 6) % 7,
    days: new Date(year, month, 0).getDate(),
    today: now.getDate(),
  }
}

/**
 * 网格的单元格：前面补 `firstWeekday` 个空位，然后是 1…days。
 * 渲染和测试都用它，免得"补几个空位"这件事在两处各写一遍。
 */
export function monthCells(g: MonthGrid): (number | null)[] {
  return [
    ...Array.from({ length: g.firstWeekday }, () => null),
    ...Array.from({ length: g.days }, (_, i) => i + 1),
  ]
}
