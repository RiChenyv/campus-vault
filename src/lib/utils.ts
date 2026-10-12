/* --------------------------- 通用小工具 --------------------------- */

/** 让玻璃元素记录鼠标位置，驱动 .spec 的镜面高光（用 CSS 变量避免 React 重渲染） */
export function setSpot(e: { currentTarget: HTMLElement; clientX: number; clientY: number }) {
  const el = e.currentTarget
  const r = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`)
  el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`)
}

/** 极坐标转直角坐标，0° = 12 点方向，顺时针递增 */
export function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

/** 生成圆环扇形路径 */
export function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  start: number,
  end: number,
) {
  const o1 = polar(cx, cy, rOuter, start)
  const o2 = polar(cx, cy, rOuter, end)
  const i1 = polar(cx, cy, rInner, end)
  const i2 = polar(cx, cy, rInner, start)
  const big = end - start > 180 ? 1 : 0
  return [
    `M ${o1.x.toFixed(2)} ${o1.y.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${big} 1 ${o2.x.toFixed(2)} ${o2.y.toFixed(2)}`,
    `L ${i1.x.toFixed(2)} ${i1.y.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${big} 0 ${i2.x.toFixed(2)} ${i2.y.toFixed(2)}`,
    'Z',
  ].join(' ')
}

/** 跟随鼠标的倾斜（液体跟随感）—— 返回 transform 所需的旋转值 */
export function tiltFrom(e: { currentTarget: HTMLElement; clientX: number; clientY: number }, max = 7) {
  const r = e.currentTarget.getBoundingClientRect()
  const px = (e.clientX - r.left) / r.width - 0.5
  const py = (e.clientY - r.top) / r.height - 0.5
  return { rx: -py * max, ry: px * max * 1.5 }
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

/** 节数 → 时间文本 */
export function slotLabel(from: number, span: number) {
  const start = ['08:00', '08:55', '10:10', '11:05', '14:00', '14:55', '16:10', '17:05', '19:00', '19:55']
  const end = ['08:50', '09:45', '11:00', '11:55', '14:50', '15:45', '17:00', '17:55', '19:50', '20:45']
  const last = Math.min(from + span - 2, 9)
  return `${start[from - 1]} – ${end[last]}`
}
