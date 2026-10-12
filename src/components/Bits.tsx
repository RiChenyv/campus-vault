import { motion } from 'framer-motion'
import { NAV, PILLS } from '../data/nav'
import type { RouteId } from '../types'
import { ICON_MAP } from './Icons'

export function SectionTitle({ kicker, title, rgb }: { kicker: string; title: string; rgb: string }) {
  return (
    <div className="mb-4 flex items-end justify-between">
      <div>
        <div
          className="text-[11px] uppercase tracking-[0.22em]"
          style={{ color: `rgb(${rgb})` }}
        >
          {kicker}
        </div>
        <h3 className="font-cn-title mt-1.5 text-[16px] font-semibold text-white">{title}</h3>
      </div>
    </div>
  )
}

/** 空态提示 */
export function Empty({ text }: { text: string }) {
  return (
    <div className="deco grid place-items-center rounded-2xl px-6 py-14 text-[13px] text-ink-faint">
      {text}
    </div>
  )
}

/** 首页点击胶囊后，圆环旁浮出的说明气泡（让用户知道要去哪） */
export function HoverToast({ id }: { id: RouteId | null }) {
  if (!id) return null
  const meta = [...NAV, ...PILLS].find((n) => n.id === id)
  if (!meta) return null
  const Icon = ICON_MAP[meta.icon as keyof typeof ICON_MAP]
  return (
    <motion.div
      initial={{ opacity: 0, x: -16, filter: 'blur(8px)' }}
      animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, x: -10, filter: 'blur(6px)' }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      className="glass spec pointer-events-none absolute left-1/2 top-[172px] z-30 flex -translate-x-1/2 items-center gap-2.5 rounded-full py-2 pl-2.5 pr-4"
      style={{ borderColor: `rgb(${meta.rgb} / .45)` }}
    >
      <span
        className="grid h-7 w-7 place-items-center rounded-full"
        style={{ background: `rgb(${meta.rgb} / .2)`, color: `rgb(${meta.rgb})` }}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="whitespace-nowrap text-[12.5px] text-white">{meta.label}</span>
      <span className="whitespace-nowrap text-[11.5px] text-ink-faint">{meta.sub}</span>
    </motion.div>
  )
}
