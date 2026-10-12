import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Background from './components/Background'
import AvatarNav from './components/LiquidRing'
import AvatarFace from './components/AvatarFace'
import ProfileCenter from './components/ProfileCenter'
import { useProfile } from './lib/useProfile'
import { useHomeLayout } from './lib/useUiScale'
import PillNav from './components/PillNav'
import Shell from './components/Shell'
import CommandPalette from './components/CommandPalette'
import QualityControl from './components/QualityControl'
import CoursesView from './views/CoursesView'
import CourseDetail from './views/CourseDetail'
import CreditsView from './views/CreditsView'
import ImportView from './views/ImportView'
import ScheduleView from './views/ScheduleView'
import NotesView from './views/NotesView'
import { CalendarView, IdeasView, TodosView } from './views/CombinedViews'
import QuestionBankView from './views/QuestionBankView'
import MissionView from './views/MissionView'
import BookmarksView from './views/BookmarksView'
import GithubView from './views/GithubView'
import LoginView from './views/LoginView'
import { useAuth } from './lib/useAuth'
import { NAV, PILLS } from './data/nav'
import type { Quality, RouteId } from './types'

const RING_ORDER: RouteId[] = [...NAV.map((n) => n.id), ...PILLS.map((p) => p.id)]

/**
 * 首页的纵向分页。
 * 用滚轮下拉进入下一屏，而不是靠路由跳转 —— 这几屏是"同一个首页的三页"，
 * 顶部栏和用户名在各屏之间保持不动，只换标语、壁纸与主视觉。
 */
/**
 * 首页各屏。
 * ⚠️ 这个数组的顺序**必须**与下面 <motion.div> 里 <section> 的 DOM 顺序一致 ——
 * 翻页是靠 translateY(-page * 100%) 做的，DOM 顺序错了就会翻到错误的屏。
 * 同时每一屏的 animate 条件（page === N）也要跟着改，三处必须同步。
 */
const HOME_PAGES = [
  { id: 'main', slogan: 'Recording every curious soul', sloganCn: '记录每一位求知的灵魂' },
  { id: 'ideas', slogan: 'Record every sudden flash of insight', sloganCn: '记录每一次灵光乍现' },
  { id: 'mission', slogan: 'Try best to responsibly complete every mission', sloganCn: '尽力完成每一项使命' },
  { id: 'qbank', slogan: 'Cherish every invisible treasure', sloganCn: '珍惜每一处无形的宝藏' },
  { id: 'retro', slogan: 'Looking back at every tear-filled moment', sloganCn: '回望每一个泪光闪烁的瞬间' },
  { id: 'archive', slogan: 'Document each unknown place you arrive at', sloganCn: '记录每次抵达的未知之境' },
  { id: 'connect', slogan: 'Connecting every soul with shared interests', sloganCn: '链接每一个志趣相投的灵魂' },
] as const

export default function App() {

  const [route, setRoute] = useState<RouteId>('home')
  /**
   * 当前打开的课程（'course-detail' 路由靠它决定展示哪一门）。
   * 路由与参数分开存：RouteId 保持纯标识符，不把 courseId 编进字符串，
   * 这样圆环/胶囊的导航顺序表不用为详情页做特殊处理。
   */
  const [courseId, setCourseId] = useState('c1')
  const [hover, setHover] = useState<RouteId | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  // 顺序有讲究：profile 现在以会话为唯一真相，所以 auth 必须先建
  const auth = useAuth()
  const profile = useProfile({ user: auth.session?.user ?? null, refreshUser: auth.refreshUser })
  // 首页簇按视口自适应布局，避免超宽屏右侧留大片空白
  const { vScale, fill } = useHomeLayout()

  /**
   * 氛围光晕：颜色随 hover 变化，位置跟随鼠标。
   *
   * ⚠️ 两个踩过的坑：
   *  1. 颜色必须用**逗号分隔**的 rgba(143,178,255,.12)。
   *     项目里 rgb 是空格分隔的 "143 178 255"，直接拼进 rgba() 里
   *     （rgba(143 178 255,.12)）会被 CSS 解析器**整条拒绝**，
   *     背景渲染成 none（实测本机 Chrome 不接受这种写法）。
   *  2. 背景要挂在**普通 div** 上：framer-motion 的 style 会过滤掉
   *     它不认识的属性，写在 motion.div 上不会落到 DOM。
   */
  const [glowPos, setGlowPos] = useState({ x: 30, y: 46 })
  const glowRgb = ([...NAV, ...PILLS].find((n) => n.id === hover)?.rgb ?? '143 178 255')
    .trim()
    .replace(/\s+/g, ',')
  const glowBg = `radial-gradient(70% 60% at ${glowPos.x}% ${glowPos.y}%, rgb(${glowRgb} / .12), rgba(0,0,0,0) 70%)`

  useEffect(() => {
    let raf = 0
    const onMove = (e: MouseEvent) => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setGlowPos({
          x: Math.round((e.clientX / window.innerWidth) * 1000) / 10,
          y: Math.round((e.clientY / window.innerHeight) * 1000) / 10,
        })
      })
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => {
      window.removeEventListener('mousemove', onMove)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  const [quality, setQuality] = useState<Quality>(() => {
    const saved = localStorage.getItem('cv.quality') as Quality | null
    return saved ?? 'high'
  })
  const [wallpaper, setWallpaper] = useState<boolean>(
    () => localStorage.getItem('cv.wallpaper') !== 'off',
  )

  useEffect(() => localStorage.setItem('cv.quality', quality), [quality])
  useEffect(() => localStorage.setItem('cv.wallpaper', wallpaper ? 'on' : 'off'), [wallpaper])

  /* 全局快捷键：Ctrl/Cmd+K 命令面板 · Esc 返回首页 · 方向键在圆环与胶囊间移动 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      if (paletteOpen) return

      // 个人面板打开时，Esc 只关面板，不退出当前分区
      if (profileOpen) return

      if (e.key === 'Escape') {
        setRoute('home')
        return
      }
      if (route !== 'home') return

      const tag = (document.activeElement?.tagName ?? '').toLowerCase()
      const typing =
        tag === 'input' || tag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable
      if (typing) return

      const back = e.key === 'ArrowUp' || e.key === 'ArrowLeft'
      const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight'
      if (!back && !fwd) return

      e.preventDefault()
      const cur = hover ? RING_ORDER.indexOf(hover) : -1
      const len = RING_ORDER.length
      const next = back
        ? cur <= 0
          ? len - 1
          : cur - 1
        : cur === -1
          ? 0
          : (cur + 1) % len
      setHover(RING_ORDER[next])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [route, hover, paletteOpen, profileOpen])

  const go = useCallback((r: RouteId) => {
    setRoute(r)
    setHover(null)
  }, [])

  const home = route === 'home'

  /**
   * 首页当前停在第几屏（0 = 主页，1 = 灵感）。
   * 翻页由这里的状态驱动：容器用 transform 位移，不依赖原生滚动。
   */
  const [page, setPage] = useState(0)
  const ideasRef = useRef<HTMLDivElement>(null)
  const missionRef = useRef<HTMLDivElement>(null)
  const archiveRef = useRef<HTMLDivElement>(null)
  const connectRef = useRef<HTMLDivElement>(null)
  const qbankRef = useRef<HTMLDivElement>(null)
  const retroRef = useRef<HTMLDivElement>(null)

  /**
   * 当前屏的镜像。
   * 滚轮处理函数在 effect 里长期存活，直接读 `page` 会拿到闭包里的旧值 ——
   * 边界判断（⑤）就会失准，所以用 ref 同步一份。
   */
  const pageRef = useRef(0)
  useEffect(() => {
    pageRef.current = page
  }, [page])

  /**
   * 滚轮翻页。
   *
   * 这一版修掉了 5 个会让滚轮「有时失灵」的真问题：
   *
   *  ① 原来用 `lockedUntil = now + 620` 一把盲锁：锁窗内**所有**滚轮事件
   *     全部丢弃。但触控板的惯性滑动会持续发事件 1~2 秒，用户在惯性还没停时
   *     再滚一下 → 被吞掉 → 表现就是「滚了没反应」。
   *  ② 原来有 `Math.abs(e.deltaY) < 8` 的过滤。触控板慢速滑动的单次增量
   *     常常只有 1~5，**全被丢掉**，于是完全滚不动。改成累加器，不按单次值过滤。
   *  ③ 面板内滚动委托原来只查第一个 `.overflow-y-auto`。任务页有两列、
   *     个人中心有多个，查错容器就会做出相反的决定。改成遍历所有内部滚动容器。
   *  ④ 弹层（个人中心 / 命令面板）打开时，滚轮仍会翻动**背后的**页面。
   *  ⑤ 已到首/尾屏时仍然上锁，导致反向滚动的合法输入被吃掉 620ms。
   */
  useEffect(() => {
    if (!home) return

    /** 归一化不同 deltaMode：0=像素 1=行 2=页 */
    const norm = (e: WheelEvent) =>
      e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY

    /** 手势间隔超过这个毫秒数，视为「新手势」，累加器清零 */
    const GESTURE_GAP = 160
    /** 累计到这个量才翻页（鼠标一格约 100~120，触控板靠累加） */
    const THRESHOLD = 60
    /** 与翻页动画时长对齐（transition 0.62s + 余量） */
    const ANIM_MS = 660

    let acc = 0
    let lastAt = 0
    let animatingUntil = 0
    /** 动画期间收到过输入 → 必须等一次手势中断，避免惯性尾巴连续翻页 */
    let needBreak = false

    /**
     * 事件是否落在某个**仍能同向滚动**的内部容器里。
     *
     * ⚠️ 不能只认 `.overflow-y-auto` 这个类名。
     * 第一版就是按类名找的，而文件查看器的内容区用的是 `overflow-auto`
     * （横向也要能滚，宽表格不能被裁）—— 类名对不上，于是滚轮被翻页逻辑
     * 整个吃掉，用户看 markdown / PDF 时怎么滚都不动。
     *
     * 所以改成从事件目标**往上走**，用计算样式判断，不依赖任何类名：
     * 只要某个祖先纵向可滚、且在这个方向上还有余量，就把滚轮让给它。
     */
    const insideScrollable = (target: Node, dy: number) => {
      let el: Element | null = target instanceof Element ? target : target.parentElement
      // 走到 body 就停：再往上就是 html，那是整页滚动，不属于"内部容器"
      while (el && el !== document.body) {
        const oy = getComputedStyle(el).overflowY
        if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 2) {
          const canDown = el.scrollTop + el.clientHeight < el.scrollHeight - 2
          const canUp = el.scrollTop > 2
          if ((dy > 0 && canDown) || (dy < 0 && canUp)) return true
        }
        el = el.parentElement
      }
      return false
    }

    const onWheel = (e: WheelEvent) => {
      // ④ 弹层打开时交给弹层自己滚，不翻页
      if (paletteOpen || profileOpen) return
      const dy = norm(e)
      if (!dy) return
      // 让位给面板内部列表
      if (insideScrollable(e.target as Node, dy)) return

      e.preventDefault()

      const now = performance.now()
      const fresh = now - lastAt > GESTURE_GAP
      lastAt = now
      if (fresh) {
        acc = 0
        needBreak = false
      }

      // 动画进行中：完全忽略，并标记"需要一次手势中断"
      if (now < animatingUntil) {
        needBreak = true
        return
      }
      // 惯性尾巴：等用户真正停一下再接受
      if (needBreak) return

      acc += dy
      if (Math.abs(acc) < THRESHOLD) return

      const dir = acc > 0 ? 1 : -1
      const next = pageRef.current + dir
      // ⑤ 到边界就直接返回，不锁窗，反向滚动立刻可用
      if (next < 0 || next > HOME_PAGES.length - 1) return

      acc = 0
      animatingUntil = now + ANIM_MS
      setPage(next)
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [home, paletteOpen, profileOpen])

  // 方向键 / PageUp·PageDown 也能翻页，键盘用户不至于卡在第一屏
  useEffect(() => {
    if (!home) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault()
        setPage((p) => Math.min(HOME_PAGES.length - 1, p + 1))
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        setPage((p) => Math.max(0, p - 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [home])

  // 离开首页时回到第一屏，避免下次进来停在中途
  useEffect(() => {
    if (!home) setPage(0)
  }, [home])

  /* ------------------------------ 登录门禁 ------------------------------
     未登录时整站只渲染登录页 —— 用 early return 而不是条件包裹，
     这样键盘监听、分页状态等一堆 effect 都不会在未登录时白跑。 */

  /* 启动时先向服务端确认登录态。这一步没完成之前不能渲染登录页 ——
     否则已登录的用户会看到登录页闪一下再跳走。
     后端不可用时也走这里：给一条明确提示，而不是停在空白页。 */
  if (auth.booting) {
    return (
      <div className="relative h-screen w-screen overflow-hidden" data-quality={quality}>
        <Background quality={quality} wallpaper={wallpaper} variant="login" />
        <div className="relative z-10 grid h-full w-full place-items-center">
          <div className="text-center">
            <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
            <p className="mt-4 text-[13px] text-white/70">正在连接服务器…</p>
          </div>
        </div>
      </div>
    )
  }

  if (!auth.session) {
    return (
      <div className="relative h-screen w-screen overflow-hidden" data-quality={quality}>
        <Background quality={quality} wallpaper={wallpaper} variant="login" />
        <LoginView
          onSignIn={auth.signIn}
          onSignUp={auth.signUp}
          pending={auth.pending}
          onConfirmPending={auth.confirmPending}
          onCancelPending={() => auth.setPending(null)}
        />
      </div>
    )
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden" data-quality={quality}>
      <Background quality={quality} wallpaper={wallpaper} active={page} />

      {/* 氛围光晕：颜色跟随当前悬停的功能，位置跟随鼠标。
          用 motion value + spring 而不是直接写 CSS 变量 ——
          渐变每帧重算比较贵，spring 顺带把它变成"有重量的光"，跟手感反而更好。 */}
      <AnimatePresence>
        {hover && (
          <motion.div
            key={hover}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7 }}
            className="pointer-events-none fixed inset-0 z-[1]"
          >
            {/* ⚠️ 背景必须放在内层**普通 div** 上。
                framer-motion 的 style 会过滤掉它不认识的属性 ——
                实测把 background / backgroundImage 写在 motion.div 的 style 里
                都不会落到 DOM（元素只剩 opacity，背景渲染为 none）。 */}
            <div className="h-full w-full" style={{ backgroundImage: glowBg }} data-glow={glowBg} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------------------- 顶部栏 ----------------------------
          左：用户名（Gabriola，WPS 同款字体）
          右：个人中心入口（头像 + 文字），点击打开整页浮层

          只在首页显示。进入任何详情面板后自动隐去 ——
          面板右上角本身有「本地数据 · 未连接后端」徽标，
          两个玻璃元素叠在同一位置会互相压住（截图反馈过）。
          带动画进出，避免切换分区时元素突然闪现。 */}
      <AnimatePresence>
        {home && (
          <motion.header
            key="topbar"
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-center justify-between gap-4 px-[clamp(20px,2.4vw,52px)] py-[clamp(14px,1.4vh,24px)]"
          >
            <div className="pointer-events-auto min-w-0">
              <span
                className="block truncate text-white"
                style={{
                  fontFamily: "'Gabriola','Segoe Script','Brush Script MT',cursive",
                  // 随视口轻微放大并设上限，避免超宽屏上大得突兀
                  fontSize: 'clamp(26px, 2vw, 38px)',
                  lineHeight: 1.15,
                  letterSpacing: '0.02em',
                  textShadow: '0 2px 18px rgba(0,0,0,.45)',
                }}
                title={profile.username}
              >
                {profile.username}
              </span>

              {/* Slogan。字体用 Segoe Script（Windows 自带的手写体）；
                  颜色比用户名淡一档，形成主次，不抢视觉重心。
                  两屏各有一句，随滚动切页交叉淡入。
                  字号从 21px 提到 32px —— 手写体的实际字面比同号常规体小一截，
                  按视觉重量对齐而不是按 font-size 数字对齐。 */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={HOME_PAGES[page].slogan}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="mt-2"
                >
                  <span
                    className="block truncate"
                    style={{
                      fontFamily: "'Segoe Script','Bradley Hand','Brush Script MT',cursive",
                      fontSize: 'clamp(21px, 1.75vw, 32px)',
                      lineHeight: 1.4,
                      letterSpacing: '0.01em',
                      color: 'rgba(228,234,255,.78)',
                      textShadow: '0 2px 14px rgba(0,0,0,.5)',
                    }}
                  >
                    {HOME_PAGES[page].slogan}
                  </span>

                  {/* 中文翻译。字体用义启手写体（WPS 同款手写体），
                      它不是系统自带字体，本机没装时按后面的中文手写体回退 ——
                      注意**不能回退到 Segoe Script / cursive**：
                      那些是拉丁手写体，没有汉字字形，中文会掉成默认黑体。 */}
                  <span
                    className="font-cn-title mt-0.5 block truncate font-bold text-white"
                    style={{
                      fontSize: 'clamp(14px, 1.05vw, 20px)',
                      lineHeight: 1.5,
                      letterSpacing: '0.06em',
                      textShadow: '0 2px 14px rgba(0,0,0,.62)',
                    }}
                  >
                    {HOME_PAGES[page].sloganCn}
                  </span>
                </motion.div>
              </AnimatePresence>
            </div>

            <button
              onClick={() => setProfileOpen(true)}
              aria-label={`打开个人中心（${profile.username}）`}
              className="glass-airy spec pointer-events-auto group flex shrink-0 items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-4 transition hover:border-white/30"
            >
              <AvatarFace dataUrl={profile.avatar.dataUrl} name={profile.username} size={34} />
              <span className="flex flex-col items-start leading-tight">
                <span className="font-cn-title text-[12.5px] font-semibold text-white">个人中心</span>
                <span className="text-[10.5px] text-ink-faint">头像 · 用户名</span>
              </span>
            </button>
          </motion.header>
        )}
      </AnimatePresence>

      {/* 首页分页容器：纵向滚动吸附，一屏一页。
          滚轮下拉到第二屏 = 灵感页；顶部栏在两屏之间固定不动。 */}
      <AnimatePresence>
        {home && (
          <motion.div
            key="pager"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.94, x: -28, filter: 'blur(12px)' }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="home-pager relative z-10 h-full w-full"
          >
            {/* 两屏并排纵向排布，靠 transform 平移切换。
                用 transform 而不是 scrollTop：位移量完全可控，
                也不会和原生滚动吸附打架。 */}
            <motion.div
              className="h-full w-full"
              animate={{ y: `-${page * 100}%` }}
              transition={{ duration: 0.62, ease: [0.22, 1, 0.36, 1] }}
            >
            {/* ============================ 第一屏：主页 ============================ */}
            <section
              className="layout-shell relative flex h-full w-full items-center"
              style={{
                // 左右留白随视口增长，但增长得比内容慢，这样超宽屏上内容占比更高
                paddingLeft: 'clamp(36px, calc(2.4vw + 20px), 200px)',
                paddingRight: 'clamp(24px, 1.6vw, 120px)',
              }}
              aria-label="主页"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.86, filter: 'blur(18px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                className="shrink-0"
              >
                <AvatarNav
                  selected={route}
                  onSelect={go}
                  onOpenProfile={() => setProfileOpen(true)}
                  avatarUrl={profile.avatar.dataUrl}
                  scale={vScale}
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, scale: 0.94, filter: 'blur(14px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                transition={{ duration: 0.7, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
                className={fill ? 'min-w-0 flex-1' : 'shrink-0'}
                style={{ marginLeft: 16 * vScale }}
              >
                <PillNav
                  active={route}
                  hovered={hover}
                  onHover={setHover}
                  onSelect={go}
                  vScale={vScale}
                  fill={fill}
                />
              </motion.div>
            </section>
 
           {/* ============================ 第二屏：灵感 ============================ */}
            <section
              className="layout-shell relative flex h-full w-full items-stretch"
              style={{
                paddingLeft: 'clamp(24px, 1.8vw, 96px)',
                paddingRight: 'clamp(24px, 1.6vw, 96px)',
                /* 顶部让出固定顶栏（用户名 + 标语）的高度 ——
                   顶栏是绝对定位、不占流，
                   不让位的话标语会压在两栏标题上（截图反馈过）。 */
                paddingTop: 'clamp(176px, 12.4vh, 226px)',
                paddingBottom: 'clamp(24px, 3vh, 56px)',
              }}
              aria-label="灵感页"
            >
              <motion.div
                ref={ideasRef}
                initial={{ opacity: 0, y: 24, filter: 'blur(14px)' }}
                animate={page === 1 ? { opacity: 1, y: 0, filter: 'blur(0px)' } : { opacity: 0, y: 24 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                /* 用 @container 包住视图：IdeasView 内部用的是容器查询，
                   没有这个祖先，多列布局会静默退化成单列。
                   外壳用 .glass-clear（比 .glass 更透），让梦境壁纸透上来 ——
                   这一屏的主题就是那张背景图。 */
                className="@container glass-clear spec relative h-full w-full overflow-hidden rounded-[30px] p-6"
              >
                <IdeasView />
              </motion.div>
            </section>
 
           {/* ============================ 第三屏：任务 ============================ */}
            <section
              className="layout-shell relative flex h-full w-full items-stretch"
              style={{ padding: '176px clamp(24px,1.8vw,96px) clamp(24px,3vh,56px)' }}
              aria-label="任务页"
            >
              <motion.div
                ref={missionRef}
                initial={{ opacity: 0, y: 24, filter: 'blur(14px)' }}
                animate={page === 2 ? { opacity: 1, y: 0, filter: 'blur(0px)' } : { opacity: 0, y: 24 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="@container glass-clear spec relative h-full w-full overflow-hidden rounded-[30px] p-6"
              >
                <MissionView />
              </motion.div>
            </section>
 
           {/* ============================ 第四屏：题库 ============================ */}
            <section
              className="layout-shell relative flex h-full w-full items-stretch"
              style={{ padding: '176px clamp(24px,1.8vw,96px) clamp(24px,3vh,56px)' }}
              aria-label="题库页"
            >
              <motion.div
                ref={qbankRef}
                initial={{ opacity: 0, y: 24, filter: 'blur(14px)' }}
                animate={page === 3 ? { opacity: 1, y: 0, filter: 'blur(0px)' } : { opacity: 0, y: 24 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="@container glass-clear spec relative h-full w-full overflow-hidden rounded-[30px] p-6"
              >
                {/* mode="page"：外层已是确定高度的容器，用 h-full 铺满，
                    不要再套 Shell 那个基于视口的 calc 高度 */}
                <QuestionBankView mode="page" />
              </motion.div>
            </section>
 
           {/* ============================ 第五屏：日历与热力图 ============================ */}
            <section
              className="layout-shell relative flex h-full w-full items-stretch"
              style={{ padding: '176px clamp(24px,1.8vw,96px) clamp(24px,3vh,56px)' }}
              aria-label="日历页"
            >
              <motion.div
                ref={retroRef}
                initial={{ opacity: 0, y: 24, filter: 'blur(14px)' }}
                animate={page === 4 ? { opacity: 1, y: 0, filter: 'blur(0px)' } : { opacity: 0, y: 24 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="@container glass-clear spec relative h-full w-full overflow-hidden rounded-[30px] p-6"
              >
                <CalendarView mode="page" />
              </motion.div>
            </section>
            {/* ============================ 第六屏：宝藏网址 ============================ */}
            <section
              className="layout-shell relative flex h-full w-full items-stretch"
              style={{ padding: '176px clamp(24px,1.8vw,96px) clamp(24px,3vh,56px)' }}
              aria-label="网址页"
            >
              <motion.div
                ref={archiveRef}
                initial={{ opacity: 0, y: 24, filter: 'blur(14px)' }}
                animate={page === 5 ? { opacity: 1, y: 0, filter: 'blur(0px)' } : { opacity: 0, y: 24 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="@container glass-clear spec relative h-full w-full overflow-hidden rounded-[30px] p-6"
              >
                <BookmarksView />
              </motion.div>
            </section>
 
           {/* ============================ 第七屏：GitHub ============================ */}
            <section
              className="layout-shell relative flex h-full w-full items-stretch"
              style={{ padding: '176px clamp(24px,1.8vw,96px) clamp(24px,3vh,56px)' }}
              aria-label="GitHub 页"
            >
              <motion.div
                ref={connectRef}
                initial={{ opacity: 0, y: 24, filter: 'blur(14px)' }}
                animate={page === 6 ? { opacity: 1, y: 0, filter: 'blur(0px)' } : { opacity: 0, y: 24 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="@container glass-clear spec relative h-full w-full overflow-hidden rounded-[30px] p-6"
              >
                <GithubView login={profile.github} onConfigure={() => setProfileOpen(true)} />
              </motion.div>
            </section>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 详情页：圆环退为左侧浮标 */}
      <AnimatePresence>
        {!home && (
          <>
            <motion.div
              key="ring-float"
              initial={{ opacity: 0, scale: 0.4, x: 60 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.4, x: 60 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="absolute left-[-8px] top-1/2 z-30 -translate-y-1/2"
            >
              <AvatarNav
                selected={route}
                onSelect={go}
                onOpenProfile={() => setProfileOpen(true)}
                avatarUrl={profile.avatar.dataUrl}
              />
            </motion.div>
            <Shell route={route} onBack={() => setRoute('home')}>
              {route === 'courses' ? (
                <CoursesView
                  onOpenCourse={(id) => {
                    setCourseId(id)
                    setRoute('course-detail')
                  }}
                  onOpenCredits={() => setRoute('credits')}
              onOpenImport={() => setRoute('import')}
                />
              ) : route === 'course-detail' ? (
                <CourseDetail
                  courseId={courseId}
                  onBack={() => setRoute('courses')}
                  onNav={go}
                  onOpenNotes={() => setRoute('notes')}
                />
              ) : route === 'credits' ? (
                <CreditsView onBack={() => setRoute('courses')} onOpenImport={() => setRoute('import')} />
              ) : route === 'import' ? (
                <ImportView />
              ) : route === 'schedule' ? (
                <ScheduleView />
              ) : route === 'notes' ? (
                <NotesView />
              ) : route === 'questions' ? (
                <QuestionBankView />
              ) : route === 'ideas' ? (
                <IdeasView />
              ) : route === 'todos' ? (
                <TodosView />
              ) : route === 'calendar' ? (
                <CalendarView />
              ) : null}
            </Shell>
          </>
        )}
      </AnimatePresence>

      {/* 左下角提示 */}
      <div className="pointer-events-none absolute bottom-5 left-6 z-40 space-y-1.5">
        <div className="flex items-center gap-2 text-[11px] text-ink-faint">
          <kbd className="rounded-md border border-white/12 bg-white/6 px-1.5 py-0.5 text-[10px] tracking-wide">
            Ctrl K
          </kbd>
          全局搜索课程 · 笔记 · 待办 · 题目
        </div>
        <div className="text-[10.5px] text-ink-faint/70">
          方向键在圆环与胶囊之间移动 · Esc 返回首页 · 数据均为原型假数据
        </div>
      </div>

      {/* 显示设置：右下角，紧凑图标按钮。菜单向上展开，不会被视口裁掉 */}
      <div className="absolute bottom-5 right-6 z-40">
        <QualityControl
          quality={quality}
          onChange={setQuality}
          wallpaper={wallpaper}
          onWallpaper={setWallpaper}
        />
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onGo={go} />

      {/* 个人中心：整页浮层，由右上角入口打开。
          放在顶层是因为环形导航内部有 transform 动画，
          会把 position:fixed 的包含块改成那个元素，导致居中/铺满失效 */}
      <AnimatePresence>
        {profileOpen && (
          <ProfileCenter
            onClose={() => setProfileOpen(false)}
            avatarUrl={profile.avatar.dataUrl}
            avatarBusy={profile.busy}
            avatarError={profile.error}
            onPickAvatar={profile.pick}
            onResetAvatar={profile.reset}
            onAvatarFile={profile.onFile}
            avatarInputRef={profile.inputRef}
            username={profile.username}
            onUsername={profile.setUsername}
            github={profile.github}
            onGithub={profile.setGithub}
            account={auth.session.account}
            isAdmin={auth.session.admin}
            signOut={auth.signOut}
            // 在校信息来自服务端（手填或导入的都存那边）
            school={profile.school}
            onSchoolSave={profile.setSchool}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
