import { useState } from 'react'
import { motion } from 'framer-motion'
import type { Quality } from '../types'
import { IconGauge } from './Icons'
import { setSpot } from '../lib/utils'

const LEVELS: { id: Quality; label: string; hint: string }[] = [
  { id: 'high', label: '高', hint: '完整液态玻璃：折射滤镜 + 流动背景 + 镜面高光' },
  { id: 'mid', label: '中', hint: '减弱模糊与动画强度，适合集显笔记本' },
  { id: 'eco', label: '省电', hint: '关闭 backdrop-filter 与动画，退化为纯色面板' },
]

/**
 * 画质档位开关。
 * 液态玻璃的代价是每帧重新采样背景，多面板叠加在集显上会掉帧，
 * 所以把"效果强度"做成用户可见的开关，而不是偷偷降级。
 */
export default function QualityControl({
  quality,
  onChange,
  wallpaper,
  onWallpaper,
}: {
  quality: Quality
  onChange: (q: Quality) => void
  wallpaper: boolean
  onWallpaper: (v: boolean) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      {/* 紧凑按钮：只留图标，尺寸缩到 32px。
          档位信息在 aria-label 与展开菜单里，不再常驻文字 */}
      <button
        onClick={() => setOpen((v) => !v)}
        onMouseMove={setSpot}
        className="glass spec grid h-8 w-8 place-items-center rounded-full text-ink-faint transition hover:text-white"
        aria-label={`显示设置（当前画质：${LEVELS.find((l) => l.id === quality)?.label}）`}
        aria-expanded={open}
        title="显示设置"
      >
        <IconGauge className="h-[15px] w-[15px]" />
      </button>

      {open && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 28 }}
          className="deco absolute bottom-11 right-0 z-40 w-[280px] rounded-2xl p-2"
        >
          {LEVELS.map((l) => (
            <button
              key={l.id}
              onClick={() => {
                onChange(l.id)
                setOpen(false)
              }}
              className="block w-full rounded-xl px-3 py-2.5 text-left transition hover:bg-white/8"
              style={{ background: quality === l.id ? 'rgba(143,178,255,.14)' : undefined }}
            >
              <span className="flex items-center gap-2">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    background: quality === l.id ? 'rgb(143,178,255)' : 'rgba(255,255,255,.25)',
                  }}
                />
                <span className="text-[13px] text-white">{l.label}画质</span>
              </span>
              <span className="mt-1 block pl-3.5 text-[11.5px] leading-relaxed text-ink-faint">
                {l.hint}
              </span>
            </button>
          ))}

          <div className="my-1.5 h-px bg-white/10" />

          <button
            onClick={() => onWallpaper(!wallpaper)}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/8"
            aria-pressed={wallpaper}
          >
            <span
              className="relative h-4 w-7 shrink-0 rounded-full transition"
              style={{ background: wallpaper ? 'rgba(143,178,255,.55)' : 'rgba(255,255,255,.16)' }}
              aria-hidden="true"
            >
              <span
                className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
                style={{ left: wallpaper ? 14 : 2 }}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] text-white">壁纸背景</span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-faint">
                关闭后退回纯渐变，界面更干净
              </span>
            </span>
          </button>
        </motion.div>
      )}
    </div>
  )
}
