import { motion } from 'framer-motion'
import { DAYS, SCHEDULE, SLOTS, courseOf } from '../data/mock'
import { slotLabel } from '../lib/utils'

const ROW_H = 34

/**
 * 单门课程的课表位置（迷你版）。
 * 只高亮目标课程，其余格子留空/淡化 —— 目的是回答"这门课在课表的哪个位置"，
 * 而不是再展示一次完整课表。
 */
export default function MiniSchedule({
  courseId,
  rgb,
  room,
  teacher,
}: {
  courseId: string
  rgb: string
  room: string
  teacher: string
}) {
  const mine = SCHEDULE.filter((s) => s.courseId === courseId)
  const others = SCHEDULE.filter((s) => s.courseId !== courseId)
  const totalPeriods = mine.reduce((n, s) => n + s.span, 0)

  return (
    <div className="deco rounded-3xl p-4">
      {/* 概览：这门课一周上几次、共几节、在哪些教室 */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11.5px]">
        <span className="rounded-full px-2.5 py-1" style={{ background: `rgb(${rgb} / .16)`, color: `rgb(${rgb})` }}>
          每周 {mine.length} 次 · 共 {totalPeriods} 节
        </span>
        <span className="rounded-full bg-white/6 px-2.5 py-1 text-ink-dim">授课：{teacher}</span>
        <span className="rounded-full bg-white/6 px-2.5 py-1 text-ink-dim">地点：{room}</span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          {/* 表头 */}
          <div className="grid gap-1.5 pl-[58px]" style={{ gridTemplateColumns: `repeat(${DAYS.length}, minmax(0,1fr))` }}>
            {DAYS.map((d, i) => {
              const has = mine.some((s) => s.day === i)
              return (
                <div
                  key={d}
                  className="rounded-lg py-1 text-center text-[11.5px]"
                  style={{
                    color: has ? '#fff' : '#7c839f',
                    background: has ? `rgb(${rgb} / .16)` : 'transparent',
                  }}
                >
                  {d}
                </div>
              )
            })}
          </div>

          {/* 网格 */}
          <div className="relative mt-1 flex">
            <div className="w-[58px] shrink-0">
              {SLOTS.map((s, i) => (
                <div
                  key={s}
                  className="pr-2 text-right text-[10px] leading-none text-ink-faint"
                  style={{ height: ROW_H, paddingTop: i % 2 === 0 ? 2 : 0 }}
                >
                  {i % 2 === 0 ? s : ''}
                </div>
              ))}
            </div>

            <div
              className="relative grid min-w-0 flex-1 gap-1.5"
              style={{ gridTemplateColumns: `repeat(${DAYS.length}, minmax(0,1fr))` }}
            >
              {SLOTS.map((_, i) => (
                <div
                  key={`l-${i}`}
                  className="pointer-events-none absolute left-0 right-0 border-t border-white/6"
                  style={{ top: i * ROW_H }}
                />
              ))}

              {DAYS.map((_, day) => (
                <div key={day} className="relative min-w-0" style={{ height: SLOTS.length * ROW_H }}>
                  {/* 同一天的其它课程：淡化占位，帮助定位 */}
                  {others
                    .filter((s) => s.day === day)
                    .map((s, k) => (
                      <div
                        key={`o-${k}`}
                        className="absolute left-0 right-0 rounded-lg"
                        style={{
                          top: (s.from - 1) * ROW_H + 2,
                          height: s.span * ROW_H - 5,
                          background: 'rgba(255,255,255,.035)',
                          border: '1px solid rgba(255,255,255,.05)',
                        }}
                      />
                    ))}

                  {/* 本人课程：高亮 + 教室 */}
                  {mine
                    .filter((s) => s.day === day)
                    .map((s, k) => (
                      <motion.div
                        key={`m-${k}`}
                        initial={{ opacity: 0, scale: 0.94 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.06 * (day + k), duration: 0.35 }}
                        className="absolute left-0 right-0 overflow-hidden rounded-lg px-1.5 py-1"
                        style={{
                          top: (s.from - 1) * ROW_H + 2,
                          height: s.span * ROW_H - 5,
                          background: `linear-gradient(155deg, rgb(${rgb} / .36), rgb(${rgb} / .14))`,
                          border: `1px solid rgb(${rgb} / .55)`,
                          boxShadow: `inset 0 1px 0 rgba(255,255,255,.22)`,
                        }}
                      >
                        <div className="truncate text-[10.5px] font-medium text-white">{room}</div>
                        <div className="truncate text-[9.5px] text-white/60">{slotLabel(s.from, s.span)}</div>
                      </motion.div>
                    ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 这几次课的时间清单，便于扫读 */}
      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {mine.map((s, i) => (
          <li key={i} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-[11.5px]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: `rgb(${rgb})` }} />
            <span className="text-white">{DAYS[s.day]}</span>
            <span className="text-ink-dim">
              第 {s.from}–{s.from + s.span - 1} 节
            </span>
            <span className="ml-auto text-ink-faint">{slotLabel(s.from, s.span)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
