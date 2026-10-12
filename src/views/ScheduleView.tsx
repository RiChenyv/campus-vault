import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { DAYS, SLOTS } from '../data/mock'
import { currentWeek, TERM_WEEKS, weekDates, weeksLabel } from '../lib/weeks'
import { scheduleAtWeek, useSchedule } from '../lib/useSchedule'
import { SectionTitle } from '../components/Bits'
import { slotLabel } from '../lib/utils'

const ROW_H = 54
const GAP = 6

/**
 * 周视图课表：格子完全由课程数据生成。
 * 顶部左侧是"第几周"的横幅，右侧是本周概览。
 */
export default function ScheduleView() {
  const { courses, schedule, courseOf, source } = useSchedule()

  /* 默认停在当前周，可前后翻。
     翻周不是装饰 —— 同一门课在不同周次的上课时间会变（第 10 周起课表换过版面），
     所以必须按周过滤，否则显示的是"所有周次的并集"，那是错的。 */
  const [week, setWeek] = useState(() => Math.min(Math.max(currentWeek(), 1), TERM_WEEKS))

  const thisWeek = useMemo(() => scheduleAtWeek(schedule, week), [schedule, week])
  const total = thisWeek.length
  const dates = weekDates(week)

  const blocksPerDay = DAYS.map((_, d) => thisWeek.filter((s) => s.day === d).length)
  const busiestIdx = blocksPerDay.indexOf(Math.max(...blocksPerDay))
  const busiestCount = blocksPerDay[busiestIdx] * 2
  const busiestDay = DAYS[busiestIdx]
  const weekendCount = blocksPerDay.slice(5).reduce((a, b) => a + b, 0) * 2
  // 学分按"本学期出现过的课程"去重求和，不是按格子数
  const totalCredits = useMemo(
    () => [...new Set(schedule.map((s) => s.courseId))].reduce((n, id) => n + (courseOf(id)?.credit ?? 0), 0),
    [schedule, courseOf],
  )

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <div className="deco flex items-center gap-4 rounded-2xl px-5 py-3">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">本学期</span>
              {/* 演示数据要说出来 —— 否则用户会以为课表已经导进来了 */}
              {source === 'mock' && (
                <span
                  className="rounded-full px-1.5 py-px text-[9.5px] text-amber-200/90"
                  style={{ background: 'rgb(240 186 120 / .16)', border: '1px solid rgb(240 186 120 / .3)' }}
                  title="还没导入课表，当前显示的是示例数据"
                >
                  示例
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <button
                aria-label="上一周"
                onClick={() => setWeek((w) => Math.max(1, w - 1))}
                disabled={week <= 1}
                className="grid h-5 w-5 place-items-center rounded-md text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-25 disabled:hover:bg-transparent"
              >
                ‹
              </button>
              <span className="text-[19px] font-semibold text-white">第 {week} 周</span>
              <button
                aria-label="下一周"
                onClick={() => setWeek((w) => Math.min(TERM_WEEKS, w + 1))}
                disabled={week >= TERM_WEEKS}
                className="grid h-5 w-5 place-items-center rounded-md text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-25 disabled:hover:bg-transparent"
              >
                ›
              </button>
              {week === currentWeek() && (
                <span className="rounded-full bg-white/10 px-1.5 py-px text-[9.5px] text-white/70">本周</span>
              )}
            </div>
          </div>
          <span className="h-9 w-px bg-white/12" />
          <div className="text-[11.5px] text-ink-dim">
            <div>
              {dates[0]!.getMonth() + 1}/{dates[0]!.getDate()} – {dates[6]!.getMonth() + 1}/{dates[6]!.getDate()}
            </div>
            <div className="mt-0.5 text-ink-faint">
              共 {TERM_WEEKS} 周 · 已进行 {Math.round((week / TERM_WEEKS) * 100)}%
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="deco rounded-full px-3.5 py-2 text-[12px] text-ink-dim">
            本周 <b className="text-white">{total}</b> 节课
          </span>
          <span className="deco rounded-full px-3.5 py-2 text-[12px] text-ink-dim">
            最满：<b className="text-white">{busiestDay}</b> {busiestCount} 节
          </span>
          <span className="deco rounded-full px-3.5 py-2 text-[12px] text-ink-dim">
            周末 <b className="text-white">{weekendCount}</b> 节
          </span>
          <span className="deco rounded-full px-3.5 py-2 text-[12px] text-ink-dim">
            总学分 <b className="text-white">{totalCredits}</b>
          </span>
        </div>
      </div>

      <SectionTitle kicker="timetable" title="周课表" rgb="92 214 190" />

      <div className="deco overflow-hidden rounded-3xl p-3">
        {/* 7 天 × 10 节在这块面板里必然很挤，给一个最小宽度：
            空间不足时横向滚动，而不是把内容压扁或裁掉 */}
        <div className="overflow-x-auto">
        <div className="min-w-[880px]">
        {/* 表头 */}
        <div
          className="grid items-center gap-1.5 pl-[74px] pb-2"
          style={{ gridTemplateColumns: `repeat(${DAYS.length}, minmax(0,1fr))` }}
        >
          {DAYS.map((d, i) => {
            /* 原来这里写死 `i === 2`（周三），跟真实日期无关 ——
               所以无论今天星期几，周三永远被高亮。
               现在按"当前翻到的那一周里的今天"判断：翻到别的周时不该有任何高亮。 */
            const today = new Date()
            const isToday =
              today >= dates[0]! &&
              today < new Date(dates[6]!.getTime() + 86400000) &&
              (today.getDay() + 6) % 7 === i
            const isWeekend = i >= 5
            return (
              <div
                key={d}
                className="rounded-xl py-1.5 text-center text-[12px]"
                style={{
                  color: isToday ? '#fff' : isWeekend ? '#7c839f' : '#9aa1c2',
                  background: isToday
                    ? 'rgba(92,214,190,.14)'
                    : isWeekend
                      ? 'rgba(255,255,255,.035)'
                      : 'transparent',
                }}
              >
                {d}
              </div>
            )
          })}
        </div>

        <div className="relative flex">
          {/* 时间轴 */}
          <div className="w-[74px] shrink-0 pt-[2px]">
            {SLOTS.map((s, i) => (
              <div
                key={s}
                className="pr-2 text-right text-[10.5px] leading-none text-ink-faint"
                style={{ height: i % 2 === 0 ? ROW_H : ROW_H, paddingTop: i % 2 === 0 ? 3 : 0 }}
              >
                {i % 2 === 0 ? s : ''}
              </div>
            ))}
          </div>

          {/* 网格 */}
          <div
            className="relative grid min-w-0 flex-1 gap-1.5"
            style={{ gridTemplateColumns: `repeat(${DAYS.length}, minmax(0,1fr))` }}
          >
            {/* 横线 */}
            {SLOTS.map((_, i) => (
              <div
                key={`line-${i}`}
                className="pointer-events-none absolute left-0 right-0 border-t border-white/6"
                style={{ top: i * ROW_H }}
              />
            ))}

            {DAYS.map((_, day) => (
              <div key={day} className="relative min-w-0" style={{ height: SLOTS.length * ROW_H }}>
                {thisWeek.filter((s) => s.day === day).map((s, k) => {
                  const c = courseOf(s.courseId)
                  if (!c) return null
                  return (
                    <motion.div
                      key={`${day}-${s.from}-${k}`}
                      initial={{ opacity: 0, scale: 0.94 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: day * 0.05 + k * 0.03, duration: 0.4 }}
                      whileHover={{ scale: 1.025, zIndex: 5 }}
                      className="group absolute left-0 right-0 cursor-pointer overflow-hidden rounded-xl px-2 py-1.5"
                      style={{
                        top: (s.from - 1) * ROW_H + 2,
                        height: s.span * ROW_H - GAP,
                        background: `linear-gradient(155deg, rgb(${c.rgb} / .26), rgb(${c.rgb} / .09))`,
                        border: `1px solid rgb(${c.rgb} / .4)`,
                        boxShadow: `inset 0 1px 0 rgba(255,255,255,.2), 0 12px 26px -18px rgb(${c.rgb} / .9)`,
                      }}
                    >
                      <div className="truncate text-[11.5px] font-semibold text-white">{c.name}</div>
                      <div className="mt-0.5 truncate text-[10px] text-white/70">{c.room}</div>
                      <div className="truncate text-[9.5px] text-white/50">{slotLabel(s.from, s.span)}</div>
                      {s.weeks && <div className="truncate text-[9px] text-white/38">{weeksLabel(s.weeks)}</div>}
                    </motion.div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
        </div>
        </div>
      </div>

      {/* 图例 */}
      <div className="mt-4 flex flex-wrap gap-2">
        {courses.map((c) => (
          <span
            key={c.id}
            className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-[11.5px] text-ink-dim"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: `rgb(${c.rgb})`, boxShadow: `0 0 8px rgb(${c.rgb} / .8)` }}
            />
            {c.name}
          </span>
        ))}
      </div>
    </div>
  )
}
