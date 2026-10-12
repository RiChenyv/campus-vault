import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  HEATMAP_DAYS,
  HEATMAP_STATS,
  LEVEL_RGB,
  buildFromCounts,
  levelOf,
  monthLabelsFor,
  prettyDate,
  pushLabel,
  statsOf,
  type HeatDay,
} from '../data/heatmap'
import { activity } from '../lib/dataApi'

/** 悬停状态：日期 + 该格相对容器的坐标（用于把气泡定位到格子上方） */
interface HoverState {
  day: HeatDay
  x: number
  y: number
}

/** 画多少周。改这里的话，请求区间会自动跟着走（见下面的 useEffect） */
const HEATMAP_WEEKS = 26

/**
 * 学习热力图（GitHub 贡献图样式）。
 *
 * 语义：一格 = 一天，颜色深浅 = 当天 push 次数。
 *   一次 push = 上传笔记 / 完成待办 / 上传题目（三者都写 activity_log）。
 *
 * 交互：鼠标落在一格上，会浮出「N 次 push · M 月 D 日」的气泡。
 * 不用原生 title —— 原生提示样式不可控，也没有箭头与淡入。
 */
export default function Heatmap({
  cell = 13,
  gap = 4,
  showLegend = true,
  showStats = true,
}: {
  cell?: number
  gap?: number
  showLegend?: boolean
  showStats?: boolean
}) {
  const [hover, setHover] = useState<HoverState | null>(null)
  /**
   * 真实计数。初始用假数据占位，拿到服务端结果后替换 ——
   * 这样首屏不会是一片空白，接口失败时也还有图可看（而不是崩掉）。
   */
  const [counts, setCounts] = useState<Map<string, number> | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        /* 只请求**这张图真正要画的那段区间**。
           服务端的默认区间是"近 180 天"，而网格最左边那一列可能落到 181~182 天前 ——
           不显式给 from 的话，最左边几天会显示成 0（其实可能有记录）。
           骨架用同一个函数生成，两边算的区间必然一致。 */
        const skeleton = buildFromCounts(new Map(), HEATMAP_WEEKS)
        const firstDay = skeleton[0]?.[0]?.date
        const from = firstDay ? new Date(`${firstDay}T00:00:00`).getTime() : undefined
        const d = await activity.heatmap(from, Date.now())
        if (!alive) return
        setCounts(new Map(d.days.map((x) => [x.date, x.count])))
      } catch {
        /* 拿不到就继续用占位数据，不打断页面 */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const cols = useMemo(() => (counts ? buildFromCounts(counts, HEATMAP_WEEKS) : HEATMAP_DAYS), [counts])
  const stats = useMemo(() => (counts ? statsOf(cols) : HEATMAP_STATS), [counts, cols])
  const months = monthLabelsFor(cols)
  const rowLabels = ['一', '', '三', '', '五', '', '']

  /* ---------------------------- 网格几何 ----------------------------
     表头和格子行必须用**同一套**算式，否则月份标签会和格子列错开（这个位置错过一次）：

     · 表头要留出「星期标签列」的宽度：文字 labelW + 右侧内边距 labelPad，
       再加上网格行自己的 gap。原来写死 26（少算了那个 gap），于是每个月份
       标签都比它标注的那一列偏左 2px。
     · 表头内宽 = 每格 cell + **格与格之间**的 gap。
       `cols.length * (cell + gap)` 把 26 列算成了 26 个间距（实际只有 25 个），
       算出来比格子行宽 4px；多出来的宽度会让最后一个标签顶到容器右边缘，
       容器一窄就被裁成「10」。 */
  const labelW = 18
  const labelPad = 6
  const headerPadLeft = labelW + labelPad + gap
  const gridWidth = cols.length * cell + Math.max(0, cols.length - 1) * gap

  /**
   * 兜底清理气泡：滚轮/缩放会让已记录的坐标失效，一律清掉。
   * ⚠️ 这里**不能**监听全局 mousemove 来清理 ——
   * 鼠标停在格子上时 mousemove 持续触发，清空后又被 onMouseMove 设回来，
   * 气泡会疯狂闪烁。离开网格由容器的 onMouseLeave 负责，更准确。
   */
  useEffect(() => {
    if (!hover) return
    const clear = () => setHover(null)
    window.addEventListener('scroll', clear, { passive: true, capture: true })
    window.addEventListener('resize', clear, { passive: true })
    return () => {
      window.removeEventListener('scroll', clear, { capture: true })
      window.removeEventListener('resize', clear)
    }
  }, [hover])

  /** 由格子事件算出气泡坐标 */
  const place = (el: HTMLElement): { x: number; y: number } => {
    const host = el.closest('[data-heat-host]') as HTMLElement | null
    const c = el.getBoundingClientRect()
    const h = host?.getBoundingClientRect()
    return { x: h ? c.left - h.left + c.width / 2 : 0, y: h ? c.top - h.top : 0 }
  }

  return (
    <div>
      {showStats && (
        <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px]">
          <span className="text-ink-dim">
            近 26 周共 <b className="text-white">{stats.total}</b> 次 push
          </span>
          <span className="text-ink-faint">活跃 {stats.active} 天</span>
          <span className="text-ink-faint">
            最勤的一天 {prettyDate(stats.best.date)} · {stats.best.count} 次
          </span>
        </div>
      )}

      <div className="relative" data-heat-host>
        <div className="overflow-x-auto pb-1">
          <div className="inline-block">
            {/* 月份表头：左侧留出星期标签的宽度，与格子列对齐。
                这两个尺寸都取自上面那套常量，别再写死字面量。 */}
            <div className="mb-1 flex" style={{ paddingLeft: headerPadLeft }}>
              <div className="relative h-[14px]" style={{ width: gridWidth }}>
                {months.map((m) => {
                  /* 落在最后一列的那个标签要**靠右**定位：
                     它按 left 排的话右边缘会超出网格宽度（425 + 标签宽 > 438），
                     容器的 overflow-x-auto 一裁就变成「10」。 */
                  const atLastCol = m.index === cols.length - 1
                  return (
                    <span
                      key={`${m.label}-${m.index}`}
                      className="absolute text-[10.5px] text-ink-faint"
                      style={atLastCol ? { right: 0 } : { left: m.index * (cell + gap) }}
                    >
                      {m.label}
                    </span>
                  )
                })}
              </div>
            </div>

            <div className="flex" style={{ gap }} onMouseLeave={() => setHover(null)}>
              {/* 星期标签列：宽度 + 右侧内边距必须和表头的 paddingLeft 对上。
                  原来右内边距走的是 Tailwind 的 pr-1.5，和表头那个写死的 26 是
                  两处各写一遍的同一个数 —— 所以改成显式常量，免得再漂。 */}
              <div className="flex flex-col" style={{ gap, paddingRight: labelPad }}>
                {rowLabels.map((t, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-end text-[10px] leading-none text-ink-faint"
                    style={{ height: cell, width: labelW }}
                  >
                    {t}
                  </div>
                ))}
              </div>

              {cols.map((week, wi) => (
                <div key={wi} className="flex flex-col" style={{ gap }}>
                  {week.map((day) => (
                    <motion.button
                      key={day.date}
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: Math.min(wi * 0.012, 0.8), duration: 0.28 }}
                      onMouseMove={(e) => {
                        // 用 mousemove 而不是 mouseenter：位置信息拿得到，
                        // 且从相邻格滑过时也能正确切换目标
                        const p = place(e.currentTarget)
                        setHover((s) => (s?.day.date === day.date ? s : { day, ...p }))
                      }}
                      onMouseLeave={() => setHover((s) => (s?.day.date === day.date ? null : s))}
                      onFocus={(e) => setHover({ day, ...place(e.currentTarget) })}
                      onBlur={() => setHover((s) => (s?.day.date === day.date ? null : s))}
                      aria-label={`${prettyDate(day.date)}：${day.count} 次 push`}
                      className="cursor-pointer rounded-[3px] outline-none"
                      style={{
                        width: cell,
                        height: cell,
                        background: LEVEL_RGB[levelOf(day.count)],
                        // 悬停格加描边，便于在密格子里定位
                        boxShadow: hover?.day.date === day.date ? '0 0 0 1.5px rgba(255,255,255,.8)' : undefined,
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 气泡：常驻节点，只切换可见性与内容。
            ⚠️ 两条关键经验（都是实测出来的）：
            1. **不要用 AnimatePresence** —— 每次切换格子都卸载+挂载，
               鼠标扫过时反复"退场→入场"，实测 400ms 级卡顿。
            2. **不要给 opacity 加过渡** —— React 更新文字只要 ~10ms，
               但 60~90ms 的 opacity 过渡会把"看起来出现"推迟到 ~120ms，
               手感就是"慢半拍"。直接瞬显，移动时也是纯 style 更新。
            left/top 加过渡会让气泡在两格之间滑行，反而看不清，所以也不加。 */}
        <div
          className="pointer-events-none absolute z-20 whitespace-nowrap rounded-lg bg-[#1b1f2a] px-2.5 py-1.5 text-[11.5px] text-white shadow-[0_8px_24px_-8px_rgba(0,0,0,.9)] ring-1 ring-white/12"
          style={{
            left: hover?.x ?? 0,
            top: hover?.y ?? 0,
            transform: 'translate(-50%, calc(-100% - 7px))',
            opacity: hover ? 1 : 0,
          }}
          data-heat-tip={hover?.day.date ?? ''}
          aria-hidden={!hover}
          role="status"
        >
          {hover ? pushLabel(hover.day.count, hover.day.date) : ''}
        </div>
      </div>

      {showLegend && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[10.5px] text-ink-faint">
          <span>少</span>
          {LEVEL_RGB.map((c, i) => (
            <span key={i} className="h-[11px] w-[11px] rounded-[3px]" style={{ background: c }} />
          ))}
          <span>多</span>
          <span className="ml-2">
            一次 push = 一次上传（不管这次传了几个文件）/ 完成一项待办 / 记一条灵感
          </span>
        </div>
      )}
    </div>
  )
}

