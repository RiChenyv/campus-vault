import type { Quality } from '../types'

export type WallpaperId = 'night' | 'dream' | 'mission' | 'archive' | 'connect' | 'login' | 'qbank' | 'retro'

/**
 * 首页各屏的壁纸，**下标 = 屏序**，顺序必须与 App.tsx 的 HOME_PAGES 一致。
 * 当前：主页 / 灵感 / 任务 / 题库 / 日历 / 网址 / GitHub
 */
export const WALL_BY_SECTION: WallpaperId[] = [
  'night',   // 1 主页
  'dream',   // 2 灵感
  'mission', // 3 任务
  'qbank',   // 4 题库
  'retro',   // 5 日历与热力图
  'archive', // 6 宝藏网址
  'connect', // 7 GitHub
]

const WALL_CLASS: Record<WallpaperId, string> = {
  night: 'wall-img--night',
  dream: 'wall-img--dream',
  mission: 'wall-img--mission',
  archive: 'wall-img--archive',
  connect: 'wall-img--connect',
  qbank: 'wall-img--qbank',
  retro: 'wall-img--retro',
  login: 'wall-img--login',
}

/**
 * 环境层，自下而上共 7 层。
 * 关键在于**壁纸在最底下**、被上层渐变雾化，而不是直接贴在最前面：
 *   1 .wall        壁纸照片（三张交叉淡入，见 WALL_BY_SECTION）
 *   2 .wall-fog    雾化层：白色径向柔光，制造「隔着雾看」的效果
 *   3 .amb-mesh    原本的 mesh 渐变，半透明叠加，壁纸从缝里透出来
 *   4 .wall-grade  暗角调色，压住右侧巫师剪影，保证 UI 可读
 *   5 .amb-blob    缓慢流动的彩色光团，给玻璃提供"折射对象"
 *   6 .grid-faint  极细网格
 *   7 .grain       噪点，消除大面积渐变的色带
 *
 * 没有第 3~5 层，玻璃就是一块灰板 —— 它们是 backdrop-filter 采样与折射的对象。
 */
export default function Background({
  quality,
  wallpaper,
  active = 0,
  variant,
}: {
  quality: Quality
  wallpaper: boolean
  /** 当前停在首页的第几屏（0 主页 / 1 灵感 / 2 任务…），决定显示哪张壁纸 */
  active?: number
  /** 直接指定壁纸（登录页用，与首页分页无关） */
  variant?: WallpaperId
}) {
  const on = variant ?? WALL_BY_SECTION[active] ?? 'night'
  const ids: WallpaperId[] = ['night', 'dream', 'mission', 'archive', 'connect', 'qbank', 'retro', 'login']

  return (
    <div
      className={`amb ${wallpaper ? 'has-wall' : 'no-wall'}`}
      aria-hidden="true"
      data-quality={quality}
      /* 灵感页 / 任务页要"亮出来"，CSS 里按这个属性单独压薄雾化与调色层 */
      data-focus={on === 'night' ? undefined : on}
    >
      <div className="wall">
        {/* 全部壁纸常驻，只切 opacity —— 交叉淡入比换 background-image 平滑 */}
        {ids.map((id) => (
          <div key={id} className={`wall-img ${WALL_CLASS[id]} ${on === id ? 'is-on' : ''}`} />
        ))}
      </div>
      <div className="wall-fog" />
      <div className="amb-mesh" />
      <div className="wall-grade" />
      <div className="amb-blob b1" />
      <div className="amb-blob b2" />
      <div className="amb-blob b3" />
      <div className="amb-blob b4" />
      <div className="grid-faint" />
      <div className="grain" />
    </div>
  )
}
