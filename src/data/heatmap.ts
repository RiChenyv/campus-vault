/**
 * 热力图数据：每天一个 push 计数。
 *
 * 一次 push 的定义（与产品约定一致）：
 *   · 上传/新建一份笔记
 *   · 完成一项待办
 *   · 上传/新建一道题（题库）
 *   三种动作都写一条 activity_log，热力图按天聚合计数。
 *
 * 用确定性伪随机生成，保证刷新前后看到的是同一张图；
 * 接入后端后把 buildHeatmap() 换成 GET /api/activity 即可，调用方不用改。
 */

export const WEEKDAYS_SHORT = ['一', '二', '三', '四', '五', '六', '日']
export const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

export interface HeatDay {
  /** YYYY-MM-DD */
  date: string
  /** 该天的 push 次数 */
  count: number
  /** 颜色档位 0~4，由 count 换算 */
  level: number
  /** 是否属于未来（未到的日子不参与统计） */
  future: boolean
}

/** 档位阈值：0 / 1-2 / 3-5 / 6-9 / 10+ */
export const LEVEL_THRESHOLDS = [1, 3, 6, 10]

export const levelOf = (count: number) => {
  if (count <= 0) return 0
  if (count < LEVEL_THRESHOLDS[1]) return 1
  if (count < LEVEL_THRESHOLDS[2]) return 2
  if (count < LEVEL_THRESHOLDS[3]) return 3
  return 4
}

export const LEVEL_RGB = [
  /* 0 档 = 空格子。这里是**网格骨架**：26 周 × 7 天全靠它显形。
     原来 .05 太淡，实测在卡片上只比底色亮 ~10（亮度 60 → 70），
     壁纸一亮就彻底看不见 —— 于是整张图只剩几个亮点飘在「一/三/五」旁边，
     看起来像标签和格子对不上。提到 .09（亮度差 ~17）让骨架读得出来，
     仍然比 1 档（.30）淡得多，不抢有数据的格子。 */
  'rgba(255,255,255,.09)',
  'rgba(92,214,190,.30)',
  'rgba(92,214,190,.50)',
  'rgba(92,214,190,.72)',
  'rgba(92,214,190,.95)',
]

/**
 * 数据锚点 = **真实的今天**。
 *
 * 原来这里写死 `new Date(2026, 9, 4)`，后果不只是"图看起来旧"：
 * `buildFromCounts` 用它判断 `future`，于是**今天之后的所有格子都被当成未来、
 * 真实计数被丢掉**（10 月 5 日、6 日 push 过也显示 0），
 * 而且"近 26 周"这个窗口整体钉在 10 月 4 日那一周，越往后越不对。
 *
 * 现在每次调用都取当前时间（函数参数可注入，便于测试传固定日期）。
 */
const anchor = (now?: Date) => now ?? new Date()

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** 稳定哈希：同一个日期永远得到同一个值 */
const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

/**
 * 生成近 WEEKS 周的数据（含今天所在的那一周，从周一开始）。
 * 活跃度做了两端处理：越靠近今天越活跃（模拟期中/期末），周末偏低。
 */
function buildHeatmap(weeks = 26, now?: Date): HeatDay[][] {
  const TODAY = anchor(now)
  // 找到今天所在周的周一
  const dow = (TODAY.getDay() + 6) % 7 // 周一 = 0
  const start = new Date(TODAY)
  start.setDate(TODAY.getDate() - dow - (weeks - 1) * 7)

  const cols: HeatDay[][] = []
  for (let w = 0; w < weeks; w++) {
    const col: HeatDay[] = []
    for (let d = 0; d < 7; d++) {
      const day = new Date(start)
      day.setDate(start.getDate() + w * 7 + d)
      const key = iso(day)
      const future = day > TODAY

      // 学期进度：越靠后越忙；周末打七折；再叠一点随机
      const recency = 0.35 + (w / (weeks - 1)) * 0.85
      const weekend = d >= 5 ? 0.6 : 1
      const r = hash(key)
      const raw = recency * weekend * r * 16 - 1.2

      // 偶尔来一个"空白天"，让图看起来更像真实使用痕迹
      const idle = r < 0.16
      const count = future || idle ? 0 : Math.max(0, Math.round(raw))

      col.push({ date: key, count, level: levelOf(count), future })
    }
    cols.push(col)
  }
  return cols
}

export const HEATMAP_DAYS: HeatDay[][] = buildHeatmap()

/**
 * 用**真实计数**重建同一形状的网格（接后端用）。
 *
 * 网格的骨架（哪一周、哪一天、是否未来）与假数据完全一致，
 * 只有 count / level 来自服务端。这样渲染层一行都不用改，
 * 也不会出现"换成真数据后某天位置跳了"的问题。
 *
 * @param counts  YYYY-MM-DD → 当天 push 次数
 */
export function buildFromCounts(counts: Map<string, number>, weeks = 26, now?: Date): HeatDay[][] {
  const TODAY = anchor(now)
  const dow = (TODAY.getDay() + 6) % 7
  const start = new Date(TODAY)
  start.setDate(TODAY.getDate() - dow - (weeks - 1) * 7)

  const cols: HeatDay[][] = []
  for (let w = 0; w < weeks; w++) {
    const col: HeatDay[] = []
    for (let d = 0; d < 7; d++) {
      const day = new Date(start)
      day.setDate(start.getDate() + w * 7 + d)
      const key = iso(day)
      const future = day > TODAY
      const count = future ? 0 : (counts.get(key) ?? 0)
      col.push({ date: key, count, level: levelOf(count), future })
    }
    cols.push(col)
  }
  return cols
}

/** 与 HEATMAP_STATS 同口径，但基于传入的网格 */
export function statsOf(cols: HeatDay[][]) {
  const flat = cols.flat().filter((d) => !d.future)
  const total = flat.reduce((s, d) => s + d.count, 0)
  const active = flat.filter((d) => d.count > 0).length
  const best = flat.reduce((m, d) => (d.count > m.count ? d : m), flat[0]!)
  return { total, active, best }
}

export const HEATMAP_STATS = statsOf(HEATMAP_DAYS)

/** 从包含该日期的星期列里取月份标签，供顶部表头用 */
export function monthLabelsFor(cols: HeatDay[][]) {
  const out: { index: number; label: string }[] = []
  let last = -1
  cols.forEach((col, i) => {
    const first = col[0]
    const m = Number(first.date.slice(5, 7)) - 1
    if (m !== last) {
      // 同一个月只在第一列标注，且跳过太靠前的（避免和上一标签挤在一起）
      if (i === 0 || i - (out[out.length - 1]?.index ?? -99) > 2) {
        out.push({ index: i, label: MONTH_LABELS[m] })
        last = m
      } else {
        last = m
      }
    }
  })
  return out
}

/** 中文日期，用于 aria-label */
export const prettyDate = (dateIso: string) => {
  const [, m, d] = dateIso.split('-')
  return `${Number(m)} 月 ${Number(d)} 日`
}

/** 英文序数后缀：1st / 2nd / 3rd / 4th，11~13 特殊处理为 th */
export const ordinal = (n: number) => {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th'
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
}

/** 英文月份（气泡文案用） */
const MONTH_LABELS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/**
 * 气泡文案：`N push on Month Dth`。
 * 复数用 pushes（不是 pushs —— 以 sh 结尾要加 es）。
 */
export const pushLabel = (count: number, dateIso: string) => {
  const [, m, d] = dateIso.split('-').map(Number)
  return `${count} ${count === 1 ? 'push' : 'pushes'} on ${MONTH_LABELS_EN[m - 1]} ${d}${ordinal(d)}`
}
