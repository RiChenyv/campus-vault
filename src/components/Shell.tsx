import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'
import type { RouteId } from '../types'
import { NAV_BY_ID } from '../data/nav'
import { IconBack } from './Icons'

const EASE = [0.22, 1, 0.36, 1] as const

/**
 * 详情外壳：圆环收缩到左侧，内容区以"玻璃被推开"的方式展开。
 * 长文本全部落在 .deco（不透明深色面板）里，玻璃只保留标题栏。
 */
export default function Shell({
  route,
  onBack,
  children,
}: {
  route: RouteId
  onBack: () => void
  children: ReactNode
}) {
  const meta = NAV_BY_ID[route]
  const rgb = meta?.rgb ?? '143 178 255'

  return (
    <motion.section
      initial={{ opacity: 0, x: 40, scale: 0.985 }}
      animate={{ opacity: 1, x: 0, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, x: 26, scale: 0.99, filter: 'blur(12px)' }}
      transition={{ duration: 0.5, ease: EASE }}
      className="glass absolute bottom-6 left-[392px] right-9 top-7 z-30 flex flex-col overflow-hidden rounded-[30px]"
      aria-label={meta?.label}
    >
      {/* 顶部彩色氛围 */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-40"
        style={{
          background: `radial-gradient(120% 100% at 12% 0%, rgb(${rgb} / .2), rgb(${rgb} / 0) 70%)`,
        }}
      />

      <header className="relative flex shrink-0 items-center gap-4 border-b border-white/8 px-6 py-4">
        <button
          onClick={onBack}
          className="group flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/6 text-ink-dim transition hover:bg-white/12 hover:text-white"
          aria-label="返回首页"
        >
          <IconBack className="h-[18px] w-[18px] transition group-hover:-translate-x-0.5" />
        </button>

        <div className="min-w-0">
          <h2 className="font-cn-title flex items-center gap-2.5 text-[19px] font-semibold tracking-wide text-white">
            {meta?.label}
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: `rgb(${rgb})`, boxShadow: `0 0 12px rgb(${rgb})` }}
            />
          </h2>
          <p className="mt-0.5 truncate text-[12px] text-ink-faint">{meta?.sub}</p>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="hidden rounded-full border border-white/12 bg-white/5 px-3 py-1 text-[11.5px] text-ink-faint lg:inline">
            已连接服务器
          </span>
        </div>
      </header>

      <div className="@container relative flex-1 overflow-y-auto overscroll-contain px-6 py-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={route}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.34, ease: EASE }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.section>
  )
}
