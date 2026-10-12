import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { NAV } from '../data/nav'
import { STATS } from '../data/mock'
import type { RouteId } from '../types'
import { polar, setSpot } from '../lib/utils'
import AvatarFace from './AvatarFace'

/* ------------------------------ 几何常量 ------------------------------ */

/**
 * 布局：头像在正中，四个功能名分布在四周（上 / 右 / 下 / 左）。
 *
 * 历史：这里原本是 SVG 圆环导航（四瓣扇区 + 折射滤镜）。
 * 后来去掉了扇区，只保留文字 —— 理由：
 *   1. 圆环的尺寸/位置在超宽屏与短屏上很难同时摆对；
 *   2. 悬停文字放大 + 点击，比"点击弧段"更直观，也更省性能
 *      （少了一层 feDisplacementMap 折射滤镜，那是最贵的一层）。
 */
const CANVAS = 440
const CX = CANVAS / 2
const CY = CANVAS / 2
/** 头像直径 */
const AVATAR = 300
/** 四个功能名距中心的半径 */
const LABEL_R = 196

/**
 * 四象限命中区（四分环带）。
 * 用户的真实痛点：文字本身只有约 73×52 的命中区，很难点中。
 * 所以四个功能各占一份"扇形环带"，**整块区域都可点击**。
 *
 * 为什么是"环带"而不是简单矩形：
 *   矩形会盖住头像圆形的四个边角，导致点头像时好时坏
 *   （实测：圆内 (459,455) 命中头像、(214,700) 却命中区块）。
 *   给每份挖掉头像所在的圆孔后，两者边界完全吻合，互不侵占。
 *
 * 为什么不是"内缘 190 / 外缘 250"那种窄环带：
 *   窄环带的归属取决于**角度**，而 clip-path 切的是**直线**，
 *   两者在 45° 对角线附近必然错位（实测：点上方却触发了左 / 右功能）。
 *   抠圆孔的四分环带没有这个问题 —— 每份严格只覆盖自己那 90°。
 *
 * 头像 DOM 在区块之后、层级更高，中心那点仍由头像接管。
 */
/**
 * 四象限命中区 —— 分割线沿**上下左右**（网页的竖直/水平方向），
 * 因此四个扇形分别朝四个斜角：右上 / 右下 / 左下 / 左上。
 *
 * （早期版本把扇形中心放在上下左右、分割线落在对角线上，用户要求改成对角分布。）
 * 屏幕上：0° 正右、90° 正下、-90° 正上，于是四份分别是
 *   dir 0 → 正上~正右（右上）   dir 1 → 正右~正下（右下）
 *   dir 2 → 正下~正左（左下）   dir 3 → 正左~正上（左上）
 * 与 NAV 顺序（题库 / 灵感 / 待办 / 日历）一一对应。
 *
 * 尺寸：half = 230。再大会让右下 / 左下的构图过于贴近右侧胶囊。
 */
const ZONE_HALF = 230
/** 挖掉的圆孔半径 = 头像半径，边界刚好贴合 */
const HOLE_R = 150

/**
 * 生成一个"四分之一圆环"路径（用户建议的形状：以头像为圆心的扇形区块）。
 * 坐标基于外层容器，x 向右、y 向下，起点为左上角。
 *   dir 0 上 / 1 右 / 2 下 / 3 左；ox、oy 为圆心（容器中点）
 * 路径由两段圆弧 + 两条直线围成：
 *   外弧 R（象限外沿）→ 直边 → 内弧 r（抠掉头像）→ 直边
 */
function quarterRing(dir: number, ox: number, oy: number, R: number, r: number) {
  /**
   * 每份从"正上"开始，按顺时针各占 90°，分割线正好落在上下左右。
   * ⚠️ sweep 方向踩过坑：SVG 里 y 轴向下，sweep=1 是屏幕上的顺时针。
   * 外弧写成 0 会绕到别的象限去（实测 270~338° 命中的是「题库」）。
   * 所以外弧沿象限走（sweep=1），内弧反向回来（sweep=0）。
   */
  const P = (a: number, rad: number) =>
    `${(ox + rad * Math.cos(a)).toFixed(1)} ${(oy + rad * Math.sin(a)).toFixed(1)}`
  const UP = -Math.PI / 2 // 正上
  const a0 = UP + (dir * Math.PI) / 2 // 本份起始角
  const a1 = a0 + Math.PI / 2 // 结束角
  return [
    `M ${P(a0, R)}`,
    `A ${R} ${R} 0 0 1 ${P(a1, R)}`,
    `L ${P(a1, r)}`,
    `A ${r} ${r} 0 0 0 ${P(a0, r)}`,
    'Z',
  ].join(' ')
}
/**
 * 发白高光：以头像为圆心的径向渐变。
 * 因为外面套了四分环带的 clip-path，矩形渐变会被裁成扇形；
 * 用径向渐变则从内缘向外自然增亮，更像玻璃被"扫过一层光"，
 * 也不会像之前的矩形那样在方块里突兀地亮一大片。
 */
const ZONE_GLOW =
  'radial-gradient(circle at 50% 50%, rgba(255,255,255,.10) 0%, rgba(255,255,255,.16) 36%, rgba(255,255,255,.34) 74%, rgba(255,255,255,.20) 100%)'
/** 默认（未选中）文字大小基准 */
const FONT = 20

/* ------------------------------ 头像 + 四周功能名 ------------------------------ */

/** 由坐标推导所属扇形序号：分割线在上下左右，扇形朝四个斜角 */
const sectorAt = (dx: number, dy: number, R: number, hole: number) => {
  const dist = Math.hypot(dx, dy)
  if (dist < hole || dist > R) return -1
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI // 0=正右，90=正下，-90=正上
  if (deg < -90 || deg >= 180) return 3 // 正上 ~ 正左
  if (deg < 0) return 0 // 正上 ~ 正右
  if (deg < 90) return 1 // 正右 ~ 正下
  return 2 // 正下 ~ 正左
}

export default function AvatarNav({
  selected,
  onSelect,
  onOpenProfile,
  avatarUrl,
  scale = 1,
}: {
  selected: RouteId
  onSelect: (id: RouteId) => void
  /** 个人面板由 App 顶层渲染：它内部有 transform 动画，会把 fixed 定位的包含块改掉 */
  onOpenProfile: () => void
  /** 自定义头像（data URL）；为空则显示默认的「我」字头像 */
  avatarUrl?: string | null
  /** 整体缩放（来自视口宽高） */
  scale?: number
}) {
  /** 四个功能名默认收起，鼠标进入该区域后淡入；触屏点头像时也会切出来 */
  const [revealed, setRevealed] = useState(false)
  const [hover, setHover] = useState<string | null>(null)

  const activeIdx = Math.max(
    0,
    NAV.findIndex((n) => n.id === selected),
  )
  /**
   * 旋转量恒为 0：文字与扇形都固定在屏幕空间，四个扇形朝四个斜角。
   *
   * 历史：早先会整体旋转 -90°×activeIdx 做"选中项转到正上方"的转盘效果，
   * 但那和"整块区域可点击"根本冲突 —— 旋转把文字搬到别的方位，
   * 而命中区是屏幕空间固定的，于是"看到的"和"能点的"永远对不上。
   * 改为固定布局后，选中态用发白 + 下划线表达。
   */
  const rotation = 0

  const Av = AVATAR * scale
  const Rz = ZONE_HALF * scale
  const Rh = HOLE_R * scale

  /**
   * 四个功能名的位置由扇形中分角推导（斜角），文字与扇形因此不可能错位。
   * 扇形 dir i 覆盖 [-90+45+90i, -45+90i]，中分角 = -45 + 90i。
   */
  const labelOf = (i: number) => {
    const a = (-Math.PI / 2) + (i * Math.PI) / 2 + Math.PI / 4
    return {
      x: CANVAS * scale * 0.5 + LABEL_R * scale * Math.cos(a),
      y: CANVAS * scale * 0.5 + LABEL_R * scale * Math.sin(a),
    }
  }

  /**
   * 命中判定完全用几何计算，不依赖任何元素的命中区。
   *
   * 为什么放弃元素命中区：`<button>` 的命中区是**矩形**（即使视觉是圆的），
   * 而 CSS `clip-path` / `border-radius` 对兄弟元素遮挡的处理反复不可靠 ——
   * 实测头像的矩形把四个斜角全吃掉（(633,526) 距圆心 317px 仍判给头像），
   * 导致扇形完全点不到。几何判定没有这个问题。
   */
  const hitTest = (e: { currentTarget: HTMLElement; clientX: number; clientY: number }) => {
    const r = e.currentTarget.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = e.clientY - (r.top + r.height / 2)
    const dist = Math.hypot(dx, dy)
    if (dist <= Av / 2) return { kind: 'avatar' as const, id: null }
    if (dist > Rz || dist < Rh) return { kind: 'none' as const, id: null }
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI
    const idx = deg < -90 || deg >= 180 ? 3 : deg < 0 ? 0 : deg < 90 ? 1 : 2
    return { kind: 'zone' as const, id: NAV[idx]?.id ?? null, idx }
  }

  return (
    <div
      className="relative"
      style={{ width: CANVAS * scale, height: CANVAS * scale }}
      onMouseEnter={() => setRevealed(true)}
      onMouseLeave={() => {
        setRevealed(false)
        setHover(null)
      }}
      onMouseMove={(e) => {
        if (!revealed) return
        const hit = hitTest(e)
        const id = hit.kind === 'zone' ? hit.id : null
        setHover((cur) => (cur === id ? cur : id))
      }}
      onClick={(e) => {
        const hit = hitTest(e)
        if (hit.kind === 'avatar') {
          // 触屏没有 hover，点头像时顺便把功能名切出来，否则永远看不到入口
          setRevealed((v) => !v)
          onOpenProfile()
          return
        }
        if (hit.kind === 'zone' && hit.id) onSelect(hit.id)
      }}
    >
      {/* 头像背后的柔光，展开时更亮 */}
      <div
        className="pointer-events-none absolute rounded-full transition-all duration-500"
        style={{
          inset: 6,
          background: 'radial-gradient(circle at 38% 28%, rgba(140,160,255,.24), rgba(0,0,0,0) 62%)',
          filter: 'blur(28px)',
          opacity: revealed ? 1 : 0.4,
          transform: revealed ? 'scale(1)' : 'scale(0.82)',
        }}
      />

      {/* ---------------------- 四个扇形（SVG 绘制，朝四个斜角） ----------------------
          用户的真实痛点：文字本身只有约 73×52 的命中区，很难点中，
          所以整块扇形都可点击。
          交互与视觉共用同一套几何：扇形由 quarterRing 画，命中由 hitTest 算，
          两者不可能对不上（不再依赖任何元素的命中区）。 */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2"
        style={{
          width: ZONE_HALF * 2 * scale,
          height: ZONE_HALF * 2 * scale,
          transform: 'translate(-50%, -50%)',
          opacity: revealed ? 1 : 0,
          transition: 'opacity .3s ease',
        }}
        aria-hidden="true"
      >
        <svg width="100%" height="100%" aria-hidden="true">
          <defs>
            {/* 以圆心为原点的径向渐变：从内缘向外自然增亮，像玻璃扫过一层光 */}
            {NAV.map((_, i) => (
              <radialGradient
                key={i}
                id={`zone-glow-${i}`}
                gradientUnits="userSpaceOnUse"
                cx={ZONE_HALF * scale}
                cy={ZONE_HALF * scale}
                r={ZONE_HALF * scale}
              >
                <stop offset="24%" stopColor="#fff" stopOpacity="0.10" />
                <stop offset="52%" stopColor="#fff" stopOpacity="0.20" />
                <stop offset="86%" stopColor="#fff" stopOpacity="0.34" />
                <stop offset="100%" stopColor="#fff" stopOpacity="0.16" />
              </radialGradient>
            ))}
          </defs>
          {NAV.map((n, i) => {
            const big = hover === n.id || selected === n.id
            return (
              <path
                key={n.id}
                d={quarterRing(i, ZONE_HALF * scale, ZONE_HALF * scale, ZONE_HALF * scale, HOLE_R * scale)}
                fill={`url(#zone-glow-${i})`}
                style={{ opacity: big ? 1 : 0, transition: 'opacity .3s ease' }}
              />
            )
          })}
        </svg>

        {/* 键盘可达：每个扇形一个透明按钮，位置在各扇形中分角上（也就是斜角） */}
        {NAV.map((n, i) => {
          const a = -Math.PI / 2 + (i * Math.PI) / 2 + Math.PI / 4
          return (
            <button
              key={`kbd-${n.id}`}
              tabIndex={revealed ? 0 : -1}
              aria-label={n.sub ? `${n.label}：${n.sub}` : n.label}
              aria-current={selected === n.id}
              onFocus={() => {
                setRevealed(true)
                setHover(n.id)
              }}
              onBlur={() => setHover(null)}
              /* ⚠️ 必须同时绑 onClick：这几颗是**无障碍入口**，
                 而读屏软件"激活按钮"发的是 **click 事件**，不是 keydown。
                 只绑 onKeyDown 的话，读屏用户按下去毫无反应（等于没有入口）。
                 它是 0×0 的透明元素，鼠标点不到，所以加 onClick 不影响鼠标体验。 */
              onClick={() => onSelect(n.id)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
                  ev.preventDefault()
                  onSelect(n.id)
                }
              }}
              className="absolute h-0 w-0 opacity-0"
              style={{
                left: ZONE_HALF * scale + LABEL_R * scale * Math.cos(a),
                top: ZONE_HALF * scale + LABEL_R * scale * Math.sin(a),
              }}
            />
          )
        })}
      </div>

      {/* 四个功能名。位置由扇形中分角推导（斜角），所以文字永远落在自己扇形的正中 */}
      <div className="pointer-events-none absolute inset-0">
        {NAV.map((n, i) => {
          const p = labelOf(i)
          const isActive = n.id === selected
          const isHover = n.id === hover
          const big = isHover || isActive

          return (
            <div
              key={n.id}
              className="absolute"
              style={{
                left: p.x,
                top: p.y,
                // 单独一层做外移，避免与内部的 scale 动画互相覆盖 transform
                transform: 'translate(-50%, -50%)',
                transformOrigin: 'center',
              }}
            >
              {/* 出现动画：从中心向外滑出，按顺序延迟。
                  文字本身不接收指针事件 —— 命中交给上层的扇形区块，
                  这样"点到文字附近的空白"也能触发，不必精确点在字上 */}
              <motion.div
                initial={false}
                animate={
                  revealed
                    ? { opacity: 1, scale: 1, x: 0, filter: 'blur(0px)' }
                    : { opacity: 0, scale: 0.7, x: 0, filter: 'blur(6px)' }
                }
                transition={{
                  type: 'spring',
                  stiffness: 260,
                  damping: 26,
                  delay: revealed ? i * 0.06 : (3 - i) * 0.03,
                }}
                className="pointer-events-none"
              >
                <motion.span
                  animate={{ scale: big ? 1.24 : 1 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 24 }}
                  className="font-cn-title relative block whitespace-nowrap"
                  style={{
                    fontSize: FONT * scale,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    // 文字本身是玻璃上的短标签，符合"玻璃只承载短文本"的约束
                    color: '#ffffff',
                    textShadow: big
                      ? '0 0 18px rgba(160,190,255,.75), 0 2px 10px rgba(0,0,0,.5)'
                      : '0 1px 8px rgba(0,0,0,.45)',
                    textDecoration: isActive ? 'underline' : 'none',
                    textDecorationColor: 'rgba(255,255,255,.5)',
                    textUnderlineOffset: '6px',
                    transition: 'color .28s ease, text-shadow .28s ease',
                  }}
                >
                  {n.label}
                  {/* 悬停时浮出说明副标题 */}
                  <AnimatePresence>
                    {isHover && (
                      <motion.span
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -3 }}
                        transition={{ duration: 0.18 }}
                        className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/55 px-2.5 py-0.5 font-normal tracking-normal text-white backdrop-blur-md"
                        style={{ fontSize: (FONT * scale) / 1.75 }}
                      >
                        {n.sub}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.span>
              </motion.div>
            </div>
          )
        })}
      </div>

      {/* ---------------------------- 中心头像 ----------------------------
          ⚠️ 头像层放在扇区**之后**，让它的圆形事件层压在扇区之上。
          关键教训：按钮的命中区是**矩形**，即使视觉是圆的。
          之前头像矩形（约 516×516）把四个斜角全吃掉了 ——
          实测 (633,526) 距圆心 317px 仍被判给头像，斜角因此完全点不到。
          现在拆成两层：视觉本体不接事件，事件交给一个正圆按钮。 */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="relative" style={{ width: AVATAR * scale, height: AVATAR * scale }}>
          <div className="glass-airy spec pointer-events-none absolute inset-0 grid place-items-center rounded-full">
            <span
              className="breathe pointer-events-none absolute -inset-3 rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(198,214,255,.32), rgba(198,214,255,0) 68%)',
                filter: 'blur(14px)',
              }}
            />
            <AvatarFace dataUrl={avatarUrl} size={AVATAR * 0.82 * scale} />
          </div>

          {/* 纯展示层，不接事件 —— 点击由外层容器的几何判定接管，
              避免"元素命中区是矩形"这类问题再次出现 */}
          <motion.div
            whileHover={{ scale: 1.03 }}
            transition={{ type: 'spring', stiffness: 340, damping: 20 }}
            className="pointer-events-none absolute inset-0 rounded-full"
            aria-hidden="true"
          />
        </div>
      </div>

      {/* 无障碍：一个真正可聚焦的按钮，键盘用户 Tab 到它按 Enter 即可打开面板 */}
      <button
        className="absolute h-0 w-0 opacity-0"
        aria-label="打开个人面板"
        style={{ left: CANVAS * scale * 0.5, top: CANVAS * scale * 0.5 }}
        onClick={() => {
          setRevealed((v) => !v)
          onOpenProfile()
        }}
        onFocus={() => setRevealed(true)}
      />
    </div>
  )
}
