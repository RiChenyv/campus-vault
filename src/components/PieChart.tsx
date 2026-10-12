import { useState } from 'react'
import { motion } from 'framer-motion'

export interface Slice {
  label: string
  value: number
  rgb: string
}

/** 极坐标转直角坐标，0° 在 12 点方向，顺时针递增 */
const pt = (cx: number, cy: number, r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

/** 生成一段圆环扇形路径（甜甜圈切片） */
const ringSlice = (cx: number, cy: number, rOut: number, rIn: number, a0: number, a1: number) => {
  // 单块占满 360° 时圆弧起终点重合，SVG 画不出来，退化成两个半圆
  const sweep = a1 - a0
  if (sweep >= 359.999) {
    return [
      `M ${cx} ${cy - rOut}`,
      `A ${rOut} ${rOut} 0 1 1 ${cx} ${cy + rOut}`,
      `A ${rOut} ${rOut} 0 1 1 ${cx} ${cy - rOut}`,
      `M ${cx} ${cy - rIn}`,
      `A ${rIn} ${rIn} 0 1 0 ${cx} ${cy + rIn}`,
      `A ${rIn} ${rIn} 0 1 0 ${cx} ${cy - rIn}`,
      'Z',
    ].join(' ')
  }
  const o0 = pt(cx, cy, rOut, a0)
  const o1 = pt(cx, cy, rOut, a1)
  const i1 = pt(cx, cy, rIn, a1)
  const i0 = pt(cx, cy, rIn, a0)
  const large = sweep > 180 ? 1 : 0
  return [
    `M ${o0.x.toFixed(2)} ${o0.y.toFixed(2)}`,
    `A ${rOut} ${rOut} 0 ${large} 1 ${o1.x.toFixed(2)} ${o1.y.toFixed(2)}`,
    `L ${i1.x.toFixed(2)} ${i1.y.toFixed(2)}`,
    `A ${rIn} ${rIn} 0 ${large} 0 ${i0.x.toFixed(2)} ${i0.y.toFixed(2)}`,
    'Z',
  ].join(' ')
}

/**
 * 学分占比扇形图（甜甜圈）。
 * 自己用 SVG 画圆弧，不引图表库 —— 只需要这一段几何，依赖不值当。
 * 悬停时切片向外弹出一小段，中心显示对应数值。
 */
export default function PieChart({
  slices,
  size = 240,
  thickness = 46,
  centerTitle,
  centerValue,
}: {
  slices: Slice[]
  size?: number
  thickness?: number
  centerTitle?: string
  centerValue?: string
}) {
  const [active, setActive] = useState<number | null>(null)
  const cx = size / 2
  const cy = size / 2
  const rOut = size / 2 - 6
  const rIn = rOut - thickness

  const total = slices.reduce((s, x) => s + x.value, 0) || 1
  let acc = 0

  const shown = active != null ? slices[active] : null

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="学分占比">
        {/* 底环 */}
        <circle cx={cx} cy={cy} r={(rOut + rIn) / 2} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={thickness} />
        {slices.map((s, i) => {
          const a0 = (acc / total) * 360
          acc += s.value
          const a1 = (acc / total) * 360
          const isActive = active === i
          // 悬停时沿中分角向外平移，做出"弹出"的手感
          const mid = (a0 + a1) / 2
          const p = pt(0, 0, isActive ? 6 : 0, mid)
          return (
            <motion.path
              key={s.label}
              d={ringSlice(cx, cy, rOut, rIn, a0, Math.max(a1 - 0.6, a0 + 0.2))}
              fill={`rgb(${s.rgb})`}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: active == null || isActive ? 1 : 0.5, scale: 1, x: p.x, y: p.y }}
              transition={{
                opacity: { duration: 0.2 },
                x: { type: 'spring', stiffness: 420, damping: 30 },
                y: { type: 'spring', stiffness: 420, damping: 30 },
                scale: { delay: i * 0.05, duration: 0.4 },
              }}
              style={{ transformOrigin: `${cx}px ${cy}px`, cursor: 'pointer' }}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              <title>{`${s.label}：${s.value} 学分（${((s.value / total) * 100).toFixed(1)}%）`}</title>
            </motion.path>
          )
        })}
      </svg>

      {/* 中心读数：默认显示总量，悬停某块时切换成该块的数值 */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-[11px] text-ink-faint">{shown ? shown.label : centerTitle}</div>
          <div className="mt-1 text-[24px] font-semibold leading-none text-white">
            {shown ? shown.value : centerValue}
            <span className="ml-1 text-[12px] font-normal text-ink-dim">学分</span>
          </div>
          {shown && (
            <div className="mt-1 text-[11px]" style={{ color: `rgb(${shown.rgb})` }}>
              占比 {((shown.value / total) * 100).toFixed(1)}%
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
