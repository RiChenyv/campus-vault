import { useEffect, useState } from 'react'

const BASE_W = 1440
const MAX_SCALE = 1.72
/** 顶部统计条占用的高度。实测统计条只占约 60px，
 *  之前留 190px 导致短屏（如 2535×740）下 vScale 被过度压低，内容缩得很小。 */
const TOP_RESERVED = 96
/**
 * 簇在 scale = 1 时的总高。
 * 对应头像 + 四周功能名区域：canvas 440，四周再留一点余量。
 * 这个值越大 → 缩放越保守 → 四周文字离视口边缘越远。
 */
const CLUSTER_H = 470
/** 超过这个宽高比就认为屏幕"极宽"，改为让胶囊横向撑满 */
const FILL_ASPECT = 2.0

export interface HomeLayout {
  /** 纵向缩放：决定圆环直径、胶囊高度与字号 */
  vScale: number
  /** 是否让胶囊横向撑满剩余空间（极宽屏幕） */
  fill: boolean
}

/**
 * 首页「圆环 + 胶囊」簇的自适应布局。
 *
 * 起因：尺寸原本全是固定值（圆环 320、胶囊 520），在 1440×900 下刚好，
 * 但在 2535×740 这类超宽屏上只占 930px，右侧空了 1600px。
 *
 * 关键认识：极端宽高比下**纯等比缩放解决不了问题** ——
 * 按宽度放大到 1.72 就被高度卡死，右侧照样空。
 * 所以拆成两个自由度：
 *   vScale 受高度约束，控制纵向尺寸；
 *   fill 让胶囊宽度 flex-grow 撑满剩余空间（上限由宽高比 4.4 兜住，避免拉成细长条）。
 *
 * 结果同时写入 CSS 变量 --ui-scale，方便 CSS 侧复用。
 */
export function useHomeLayout(): HomeLayout {
  const compute = (): HomeLayout => {
    if (typeof window === 'undefined') return { vScale: 1, fill: false }
    const vw = window.innerWidth
    const vh = window.innerHeight
    const byWidth = vw / BASE_W
    const byHeight = (vh - TOP_RESERVED - 40) / CLUSTER_H
    const vScale = Math.max(0.82, Math.min(MAX_SCALE, byWidth, byHeight))
    return { vScale, fill: vw / vh > FILL_ASPECT }
  }

  const [layout, setLayout] = useState<HomeLayout>(compute)

  useEffect(() => {
    const apply = () => {
      const next = compute()
      setLayout(next)
      document.documentElement.style.setProperty('--ui-scale', next.vScale.toFixed(3))
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [])

  return layout
}
