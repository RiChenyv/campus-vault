import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { PILLS, liveSub } from '../data/nav'
import { useCourses } from '../lib/useCourses'
import { currentWeek } from '../lib/weeks'
import { api } from '../lib/api'
import type { RouteId } from '../types'
import { ICON_MAP } from './Icons'
import { setSpot, tiltFrom } from '../lib/utils'
import type { CSSProperties, MouseEvent } from 'react'

const EASE = [0.22, 1, 0.36, 1] as const

/** 基准尺寸（vScale = 1 时的值） */
const BASE = { w: 520, h: 72, gap: 22, radius: 36, icon: 44, font: 17, sub: 12 }

/**
 * 右侧三条玻璃胶囊。
 *
 * 尺寸策略（配合超宽屏）：
 *   vScale 由视口高度决定 → 控制高度与字号；
 *   fill 模式让宽度自动撑满剩余空间 → 解决 21:9 / 32:9 屏幕上右侧大片空白。
 * 两者分开，是因为极端宽高比（例如 2535×740）下纯等比放大会被高度卡死，
 * 只能靠宽度伸展来填满画面。
 *
 * 交互要点：hover 不是简单放大 —— 相邻胶囊会被"水波"推开，
 * 玻璃本体随鼠标轻微倾斜，并有一道镜面高光扫过。
 */
/** 胶囊副标题需要的实时数字。一次性拉齐，避免每个胶囊各发一次请求 */
function useLiveSubs() {
  const { courses } = useCourses()
  const [noteFiles, setNoteFiles] = useState(0)
  const [writtenNotes, setWrittenNotes] = useState(0)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [files, notes] = await Promise.all([
          api.get<{ files: unknown[] }>('/files?scope=note'),
          api.get<{ notes: unknown[] }>('/notes'),
        ])
        if (!alive) return
        setNoteFiles(files.files.length)
        setWrittenNotes(notes.notes.length)
      } catch {
        /* 拿不到就不显示数字 —— 宁可空着，也不要显示错的 */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  return {
    courseCount: courses.length,
    week: currentWeek(),
    noteFiles,
    writtenNotes,
  }
}

export default function PillNav({
  active,
  hovered,
  onHover,
  onSelect,
  vScale,
  fill = false,
}: {
  active: RouteId
  hovered: RouteId | null
  onHover: (id: RouteId | null) => void
  onSelect: (id: RouteId) => void
  /** 纵向缩放（按视口高度） */
  vScale: number
  /** 撑满父容器剩余宽度 */
  fill?: boolean
}) {
  // 副标题里的数字来自数据库（课程数 / 周次 / 笔记数），不用 NAV 里的静态串
  const live = useLiveSubs()
  const iconSize = BASE.icon * vScale

  // fill 模式下胶囊均分剩余宽度，上限取三者的最小值：
  //   1. 内容最低需求 —— 低于这个值文字会被挤成竖排（踩过坑：早先用 iconSize*4.4
  //      算出 211px，比「我的课程 / 6 门在修 · 本学期第 12 周」需要的还窄）
  //   2. 视口宽度的一定比例 —— 保证超宽屏上胶囊真的变大，而不是留一堆空隙
  //   3. 高度 × 4.2 —— 避免宽高比失衡，变成细长条
  const contentMin = (BASE.h * 0.62 + 14 * vScale) * 2 + 300 * vScale
  const fillMax = Math.max(contentMin, Math.min(window.innerWidth * 0.36, BASE.h * vScale * 4.2))

  const widthStyle: CSSProperties = fill
    ? { flexGrow: 1, flexShrink: 1, flexBasis: 0, maxWidth: fillMax }
    : { width: BASE.w * vScale, flexShrink: 0 }

  const shiftFor = (i: number) => {
    if (!hovered) return 0
    const h = PILLS.findIndex((p) => p.id === hovered)
    if (h < 0 || h === i) return 0
    return i < h ? -4 * vScale : 4 * vScale
  }

  const handleTilt = (e: MouseEvent<HTMLButtonElement>) => {
    setSpot(e)
    const { rx, ry } = tiltFrom(e, 6)
    e.currentTarget.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(0)`
  }

  const resetTilt = (e: MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.transform = 'perspective(900px) rotateX(0deg) rotateY(0deg)'
  }

  return (
    <nav
      className="flex w-full flex-col"
      style={{
        // 不做 space-between：间隙一旦可以无限分配，就会出现
        // 「间隙比胶囊还宽」的松散观感（实测 197px 间隙 vs 482px 胶囊）。
        // 改为固定间隙 + 胶囊自己 flex-grow 撑宽度。
        gap: BASE.gap * vScale,
        minWidth: fill ? BASE.w * vScale : undefined,
      }}
      aria-label="课程知识库导航"
    >
      {PILLS.map((p, i) => {
        // 副标题里的数字来自数据库，不用 NAV 里那个静态串
        const sub = liveSub(p.id, live) || p.sub
        const Icon = ICON_MAP[p.icon as keyof typeof ICON_MAP]
        const isActive = active === p.id
        const isHover = hovered === p.id

        return (
          <motion.button
            key={p.id}
            initial={{ opacity: 0, x: 46 }}
            animate={{
              opacity: 1,
              x: 0,
              y: shiftFor(i),
              scale: isHover ? 1.018 : 1,
            }}
            transition={{
              delay: 0.08 + i * 0.09,
              duration: 0.62,
              ease: EASE,
              y: { type: 'spring', stiffness: 420, damping: 30 },
              scale: { type: 'spring', stiffness: 380, damping: 26 },
            }}
            onMouseEnter={() => onHover(p.id)}
            onMouseLeave={() => onHover(null)}
            onMouseMove={handleTilt}
            onMouseOut={resetTilt}
            onFocus={() => onHover(p.id)}
            onBlur={() => onHover(null)}
            onClick={() => onSelect(p.id)}
            aria-current={isActive}
            aria-label={sub ? `${p.label}：${sub}` : p.label}
            className="glass-airy spec relative flex items-center text-left outline-none"
            style={{
              ...widthStyle,
              height: BASE.h * vScale,
              borderRadius: BASE.radius * vScale,
              paddingLeft: 24 * vScale,
              paddingRight: 18 * vScale,
              gap: 16 * vScale,
              borderColor: isActive ? `rgb(${p.rgb} / .55)` : undefined,
              boxShadow: isActive
                ? `inset 0 1px 0 rgba(255,255,255,.34), 0 0 0 1px rgb(${p.rgb} / .28), 0 18px 50px -22px rgb(${p.rgb} / .75)`
                : undefined,
              transition: 'border-color .4s ease, box-shadow .4s ease, background .4s ease',
              willChange: 'transform',
            }}
          >
            {/* 左侧彩色玻璃质感的图标 */}
            <span
              className="relative grid shrink-0 place-items-center rounded-full"
              style={{
                width: iconSize,
                height: iconSize,
                background: `linear-gradient(150deg, rgb(${p.rgb} / .42), rgb(${p.rgb} / .12))`,
                boxShadow: `inset 0 1px 0 rgba(255,255,255,.4), inset 0 0 18px rgb(${p.rgb} / .28)`,
                border: '1px solid rgba(255,255,255,.16)',
              }}
            >
              <Icon
                style={{ color: `rgb(${p.rgb})`, width: iconSize * 0.48, height: iconSize * 0.48 }}
              />
            </span>

            <span className="min-w-0 flex-1">
              <span
                className="font-cn-title block font-semibold tracking-wide text-white"
                style={{ fontSize: BASE.font * vScale }}
              >
                {p.label}
              </span>
              <span
                className="pill-sub mt-0.5 block truncate text-ink-dim"
                style={{ fontSize: BASE.sub * vScale }}
              >
                {sub}
              </span>
            </span>

            {/* 右侧箭头：悬停时右移探出 */}
            <motion.span
              animate={{ x: isHover ? 5 * vScale : 0, opacity: isHover || isActive ? 1 : 0.45 }}
              transition={{ type: 'spring', stiffness: 420, damping: 26 }}
              className="grid shrink-0 place-items-center"
              style={{
                width: 32 * vScale,
                height: 32 * vScale,
                color: isActive ? `rgb(${p.rgb})` : 'rgba(255,255,255,.7)',
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ width: 18 * vScale, height: 18 * vScale }}
              >
                <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
              </svg>
            </motion.span>

            {/* 选中态：底部一道流动的光带 */}
            {isActive && (
              <motion.span
                layoutId="pill-active-underlay"
                className="pointer-events-none absolute -bottom-px h-[2px] rounded-full"
                style={{
                  left: 24 * vScale,
                  right: 24 * vScale,
                  background: `linear-gradient(90deg, rgb(${p.rgb} / 0), rgb(${p.rgb} / .95), rgb(${p.rgb} / 0))`,
                }}
              />
            )}
          </motion.button>
        )
      })}
    </nav>
  )
}
