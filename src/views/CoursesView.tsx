import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useCourses } from '../lib/useCourses'
import { currentWeek, TERM_WEEKS } from '../lib/weeks'
import { SectionTitle } from '../components/Bits'
import { IconFolder, IconNotes, IconSparkle, IconUpload } from '../components/Icons'
import { setSpot } from '../lib/utils'
import { api } from '../lib/api'
import { kindLabel, type VaultItem } from '../lib/vault'
import * as store from '../lib/vaultStore'
import type { Course } from '../lib/useCourses'

/* --------------------------- 顶部统计小片 --------------------------- */
function Tile({
  label,
  value,
  sub,
  rgb,
  onClick,
  hint,
}: {
  label: string
  value: string
  sub: string
  rgb: string
  onClick?: () => void
  hint?: string
}) {
  const clickable = !!onClick
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      aria-label={clickable ? `${label}：${value}，点击查看详情` : undefined}
      className={`deco group relative overflow-hidden rounded-2xl px-4 py-3 text-left transition ${
        clickable ? 'cursor-pointer hover:border-white/18' : 'cursor-default'
      }`}
      style={{
        borderColor: clickable ? `rgb(${rgb} / .28)` : undefined,
      }}
    >
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-ink-faint">
        {label}
        {/* 可点击的卡片给一个明确的入口提示，避免"能点但看不出来" */}
        {clickable && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[9.5px] normal-case tracking-normal opacity-0 transition group-hover:opacity-100"
            style={{ background: `rgb(${rgb} / .2)`, color: `rgb(${rgb})` }}
          >
            {hint ?? '查看详情'} →
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-end gap-2">
        <span className="text-[22px] font-semibold leading-none text-white">{value}</span>
        <span className="text-[11.5px]" style={{ color: `rgb(${rgb})` }}>
          {sub}
        </span>
      </div>
    </button>
  )
}

/* --------------------------- 课程卡片 --------------------------- */
function CourseCard({
  c,
  i,
  active,
  onPick,
  onOpen,
}: {
  c: Course
  i: number
  active: boolean
  onPick: () => void
  onOpen: () => void
}) {
  /* 进度不再是写死的数字 —— 按"第几周 / 总周数"算真实的学期进度 */
  const progress = Math.min(1, currentWeek() / TERM_WEEKS)
  const [hover, setHover] = useState(false)

  return (
    /*
     * 交互设计：卡片本身是按钮 → 点击进入课程详情（主路径）。
     * 不在这里放嵌套 button（HTML 不允许 button 套 button），
     * 所以"选中看文件"改为悬停即生效：鼠标移上去右侧文件区就跟着切换，
     * 点击才进详情。这样两种意图都不丢，且语义合法。
     */
    <motion.button
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.05, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      onMouseEnter={() => {
        setHover(true)
        onPick()
      }}
      onMouseLeave={() => setHover(false)}
      onMouseMove={setSpot}
      onClick={onOpen}
      aria-label={`${c.name}：${c.teacher}，${c.room}，${c.credit} 学分，点击查看课程详情`}
      /* 固定高度：高度不一的话网格里会参差不齐。
         166px 是按"标题两行内 + 元信息一行 + 进度条"量出来的。 */
      /* ⚠️ 必须有 w-full。
         <button> 的 width:auto 是**按内容收缩**的，加 display:flex 也不会撑满 ——
         于是每张卡片宽度都随课程名长短而不同（实测 392/306/309/267…），
         而外层包壳是撑满的，绝对定位的编辑按钮就落到卡片外面去了。
         w-full + h-full 让卡片和外层严丝合缝。 */
      className="deco spec group relative flex h-full w-full flex-col overflow-hidden rounded-3xl p-4 text-left"
      style={{
        borderColor: active || hover ? `rgb(${c.rgb} / .5)` : undefined,
        boxShadow:
          active || hover
            ? `0 22px 50px -26px rgb(${c.rgb} / .85), inset 0 1px 0 rgba(255,255,255,.12)`
            : undefined,
        transition: 'border-color .3s ease, box-shadow .3s ease',
      }}
    >
      {/* 左侧色带 */}
      <span
        className="absolute inset-y-4 left-0 w-[3px] rounded-r"
        style={{ background: `linear-gradient(180deg, rgb(${c.rgb} / .95), rgb(${c.rgb} / .25))` }}
      />
      {/* 角落氛围 */}
      <span
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full"
        style={{ background: `radial-gradient(circle, rgb(${c.rgb} / .22), rgb(${c.rgb} / 0) 70%)` }}
      />

      <div className="relative flex items-start gap-3 pl-2">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-[15px] font-semibold"
          style={{
            background: `linear-gradient(150deg, rgb(${c.rgb} / .34), rgb(${c.rgb} / .1))`,
            border: '1px solid rgba(255,255,255,.14)',
            color: `rgb(${c.rgb})`,
          }}
        >
          {c.name.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          {/* 长名称流动显示。滚动距离由 MarqueeText 量出来后写进 CSS 变量 */}
          <MarqueeText text={c.name} className="text-[15px] font-semibold text-white" />
          <div className="mt-1 truncate text-[11.5px] text-ink-faint">
            {c.teacher} · {c.room}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-white/6 px-2 py-0.5 text-[10.5px] text-ink-faint">
          {c.credit} 学分
        </span>
      </div>

      <div className="relative mt-3.5 flex items-center gap-4 pl-2 text-[11.5px] text-ink-dim">
        <span className="flex items-center gap-1.5">
          <IconFolder className="h-3.5 w-3.5" />
          {c.files} 文件
        </span>
        <span className="flex items-center gap-1.5">
          <IconNotes className="h-3.5 w-3.5" />
          {c.notes} 笔记
        </span>
        <span
          className="ml-auto rounded-full px-2 py-0.5 text-[10.5px] opacity-0 transition-opacity group-hover:opacity-100"
          style={{ background: `rgb(${c.rgb} / .2)`, color: `rgb(${c.rgb})` }}
        >
          查看详情 →
        </span>
      </div>

      {/* 进度条 */}
      <div className="relative mt-3 pl-2">
        <div className="h-1 overflow-hidden rounded-full bg-white/8">
          <motion.span
            initial={{ width: 0 }}
            animate={{ width: `${progress * 100}%` }}
            transition={{ delay: 0.2 + i * 0.05, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="block h-full rounded-full"
            style={{ background: `linear-gradient(90deg, rgb(${c.rgb} / .5), rgb(${c.rgb}))` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-ink-faint">
          <span>学期进度 {Math.round(progress * 100)}%</span>
          {/* 原来这里显示"最近：<文件名>"，读的是 mock 的 FILES。
              卡片上不做文件列表 —— 那是课程详情页的职责，卡片空间也放不下。 */}
          {hover && c.files > 0 && (
            <motion.span
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              className="truncate pl-3 text-right"
              style={{ color: `rgb(${c.rgb})` }}
            >
              共 {c.files} 个文件
            </motion.span>
          )}
        </div>
      </div>
    </motion.button>
  )
}

/* --------------------------- 主视图 --------------------------- */
/**
 * 一门课程下的文件。
 * 从真实的 files 表读（题库 + 笔记两个范围），按 courseId 过滤。
 * 原来这里是 mock 的 `FILES[picked]`，删不掉也打不开。
 */
function CourseFiles({ courseId, rgb }: { courseId: string; rgb: string }) {
  const [items, setItems] = useState<VaultItem[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    void (async () => {
      const lists = await Promise.all(['qbank', 'note'].map((s) => store.loadAll(s as 'qbank' | 'note')))
      if (alive) {
        setItems(lists.flat().filter((x) => x.courseId === courseId))
        setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [courseId])

  if (loading) return <div className="py-8 text-center text-[12px] text-ink-faint">正在读取…</div>
  if (!items.length) {
    return (
      <div className="mat-clear rounded-2xl px-4 py-10 text-center text-[12px] leading-relaxed text-white/55">
        这门课程下还没有资料
        <br />
        去题库或笔记上传时选中它即可
      </div>
    )
  }
  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li key={it.id}>
          <div className="mat-clear spec flex items-center gap-2.5 rounded-2xl px-3 py-2.5">
            <IconFolder className="h-4 w-4 shrink-0" style={{ color: `rgb(${rgb})` }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] text-white/92" title={it.name}>
                {it.name}
              </span>
              <span className="mt-0.5 block text-[10.5px] text-white/40">
                {kindLabel[it.kind]} · {it.size}
              </span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * 长文本流动显示。
 *
 * 直接 truncate 会把关键信息截掉（"通识示例课程一：一门名字很长的通识课…"），
 * 换行又会让卡片高度不一致。所以：**悬停时横向滚动**。
 *
 * 滚动距离不能写死百分比 —— 文字越长需要的位移越大。
 * 这里量出"文字宽 - 容器宽"写进 CSS 变量，长度不同的名字都能恰好滚到底。
 */
function MarqueeText({ text, className = '' }: { text: string; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)

  const measure = () => {
    const box = boxRef.current
    const span = textRef.current
    if (!box || !span) return
    const shift = span.scrollWidth - box.clientWidth
    // 放得下就别滚 —— 否则鼠标一放上去文字会莫名动一下
    if (shift <= 1) {
      box.style.removeProperty('--marquee-shift')
      box.style.removeProperty('--marquee-dur')
      return
    }
    box.style.setProperty('--marquee-shift', `-${shift}px`)
    // 距离越长给的时间越多，速度才稳定
    box.style.setProperty('--marquee-dur', `${Math.max(2, shift / 26)}s`)
  }

  return (
    <div ref={boxRef} className={`marquee ${className}`} onMouseEnter={measure} title={text}>
      <span ref={textRef}>{text}</span>
    </div>
  )
}

export default function CoursesView({
  onOpenCourse,
  onOpenCredits,
  onOpenImport,
}: {
  /** 点课程卡片 → 进入该课程详情 */
  onOpenCourse: (courseId: string) => void
  /** 点学分小片 → 进入学分总览 */
  onOpenCredits: () => void
  /** 进入导入中心 */
  onOpenImport: () => void
}) {
  const { courses, loading, busy, error, add, update, remove } = useCourses()
  const [picked, setPicked] = useState<string | null>(null)
  const pickedCourse = courses.find((c) => c.id === picked)
  const [making, setMaking] = useState(false)
  const [draft, setDraft] = useState({ name: '', teacher: '', room: '', term: '', credit: '' })

  /* 编辑已有课程。
     导入的课程也能改 —— 教务系统里的名字常带 [01] 这种班号后缀，
     教师/教室也偶尔有错，用户应该能自己修。 */
  const [editing, setEditing] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState({ name: '', teacher: '', room: '', term: '', credit: '' })

  /**
   * 两个统计数字（资料总量 / 本周新增）。
   *
   * 原来这两格是**写死的**（158 份文件、9 份笔记）—— 不管用户实际有多少资料，
   * 界面上永远是这两个数。假数字比空白更糟：它看起来是真的。
   * 现在从接口算：资料 = 题库 + 笔记两类文件；本周新增 = 最近 7 天新增的笔记
   * （手写的 + 上传的，和胶囊副标题的口径一致）。
   * 拿不到就保持 null → 界面显示「—」，不编数字。
   */
  const [stats, setStats] = useState<{ files: number; weekNotes: number } | null>(null)
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [f, n] = await Promise.all([
          api.get<{ files: { scope: string; createdAt: number }[] }>('/files'),
          api.get<{ notes: { createdAt: number }[] }>('/notes'),
        ])
        if (!alive) return
        const weekAgo = Date.now() - 7 * 86400000
        const docs = (f.files ?? []).filter((x) => x.scope === 'qbank' || x.scope === 'note')
        setStats({
          files: docs.length,
          weekNotes:
            docs.filter((x) => x.scope === 'note' && x.createdAt >= weekAgo).length +
            (n.notes ?? []).filter((x) => x.createdAt >= weekAgo).length,
        })
      } catch {
        /* 拿不到就不显示数字 */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const startEdit = (c: { id: string; name: string; teacher: string; room: string; term: string; credit: number }) => {
    setEditing(c.id)
    setEditDraft({
      name: c.name,
      teacher: c.teacher ?? '',
      room: c.room ?? '',
      term: c.term ?? '',
      credit: c.credit ? String(c.credit) : '',
    })
  }

  const saveEdit = async () => {
    if (!editing || !editDraft.name.trim()) return
    const okDone = await update(editing, {
      name: editDraft.name,
      teacher: editDraft.teacher,
      room: editDraft.room,
      term: editDraft.term,
      credit: Number(editDraft.credit) || 0,
    })
    if (okDone) setEditing(null)
  }

  return (
    <div className="grid gap-5 @5xl:grid-cols-[1.5fr_1fr]">
      <div>
        {/* 导入入口。放在统计片上方：用户看到"6 门在修"时最可能想问"我怎么把自己的课导进来" */}
        <button
          onClick={onOpenImport}
          className="mb-3 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition hover:brightness-110"
          style={{
            background: 'linear-gradient(100deg, rgb(143 178 255 / .16), rgb(186 155 255 / .08), rgb(255 255 255 / .03))',
            border: '1px solid rgb(143 178 255 / .32)',
          }}
        >
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[15px] text-white"
            style={{ background: 'linear-gradient(135deg, rgb(143 178 255 / .9), rgb(186 155 255 / .9))' }}
          >
            ↓
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-white">导入课程 · 课表 · 成绩</span>
            <span className="mt-0.5 block truncate text-[11.5px] text-white/55">
              从学校网站一键导入（成绩按页导入）· 支持 ICS / WakeUp 文件 · 也能手动添加
            </span>
          </span>
          <span className="shrink-0 text-white/35">›</span>
        </button>

        {/* 新建课程。放在导入入口下面：导入是"从学校拿"，
            新建是"自己加一门"（选修、网课、旁听），两条路都要有。 */}
        {!making ? (
          <button
            onClick={() => setMaking(true)}
            aria-label="新建课程"
            className="mb-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/22 px-4 py-2.5 text-[12.5px] text-ink-dim transition hover:border-white/40 hover:bg-white/6 hover:text-white"
          >
            ＋ 新建课程
          </button>
        ) : (
          <div className="mat-clear mb-3 rounded-2xl p-3">
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['name', '课程名 *', '例如：算法设计与分析'],
                  ['teacher', '教师', '选填'],
                  ['room', '教室', '选填'],
                  ['term', '学期', '例如：2026-2027第1学期'],
                  ['credit', '学分', '选填'],
                ] as const
              ).map(([key, label, ph]) => (
                <label key={key} className={key === 'name' ? 'col-span-2' : ''}>
                  <span className="mb-1 block text-[10.5px] text-white/45">{label}</span>
                  <input
                    value={draft[key]}
                    onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                    placeholder={ph}
                    aria-label={label}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && draft.name.trim()) {
                        void add({
                          name: draft.name,
                          teacher: draft.teacher,
                          room: draft.room,
                          term: draft.term,
                          credit: Number(draft.credit) || 0,
                        }).then((c) => {
                          if (c) {
                            setDraft({ name: '', teacher: '', room: '', term: '', credit: '' })
                            setMaking(false)
                          }
                        })
                      }
                    }}
                    className="w-full rounded-xl px-3 py-2 text-[12.5px] text-white outline-none placeholder:text-white/30"
                    style={{ background: 'rgb(0 0 0 / .28)', border: '1px solid rgb(255 255 255 / .14)' }}
                  />
                </label>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                disabled={busy || !draft.name.trim()}
                onClick={() =>
                  void add({
                    name: draft.name,
                    teacher: draft.teacher,
                    room: draft.room,
                    term: draft.term,
                    credit: Number(draft.credit) || 0,
                  }).then((c) => {
                    if (c) {
                      setDraft({ name: '', teacher: '', room: '', term: '', credit: '' })
                      setMaking(false)
                    }
                  })
                }
                aria-label="保存课程"
                className="rounded-xl px-3.5 py-2 text-[12.5px] font-semibold text-white transition disabled:opacity-40"
                style={{
                  background: 'linear-gradient(135deg, rgb(143 178 255 / .9), rgb(186 155 255 / .9))',
                  boxShadow: '0 10px 26px -14px rgb(143 178 255 / .95)',
                }}
              >
                保存
              </button>
              <button
                onClick={() => setMaking(false)}
                aria-label="取消新建课程"
                className="rounded-xl px-3.5 py-2 text-[12.5px] font-semibold text-ink-dim"
                style={{ background: 'rgb(255 255 255 / .05)', border: '1px solid rgb(255 255 255 / .1)' }}
              >
                取消
              </button>
              <span className="ml-auto text-[10.5px] text-white/35">课程名必填</span>
            </div>
          </div>
        )}

        {error && (
          <div
            className="mb-3 rounded-xl px-3 py-2 text-[11.5px]"
            style={{ background: 'rgba(255,120,120,.16)', color: '#ffb3b3' }}
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="mb-4 grid grid-cols-3 gap-3">
          <Tile
            label="在修课程"
            value={String(courses.length)}
            sub={`${courses.reduce((s, c) => s + (Number(c.credit) || 0), 0)} 学分`}
            rgb="143 178 255"
            hint="查看学分"
            onClick={onOpenCredits}
          />
          {/* 这两个数字原来写死在代码里（158 / 9）—— 和真实资料量毫无关系，
              用户看到的是假数据。改成从接口算：拿不到就显示「—」，
              不拿假数字充数（项目里「宁可空着，也不显示错的」那条）。 */}
          <Tile label="资料总量" value={stats ? String(stats.files) : '—'} sub="份文件" rgb="196 148 255" />
          <Tile label="本周新增" value={stats ? String(stats.weekNotes) : '—'} sub="份笔记" rgb="92 214 190" />
        </div>

        <SectionTitle kicker="courses" title="本学期课程" rgb="143 178 255" />

        {/* 编辑表单。放在列表**上方**而不是右栏 ——
            点卡片上的"编辑"时选中态未必已经切过去，
            右栏可能还显示着别的课程，表单就会出现在看不见的地方。 */}
        {editing && (
          <div className="mat-clear mb-3 rounded-2xl p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[12.5px] font-semibold text-white">
                编辑「{courses.find((x) => x.id === editing)?.name ?? ''}」
              </span>
              <span className="ml-auto text-[10.5px] text-white/35">回车即可保存</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['name', '课程名 *', '例如：算法设计与分析'],
                  ['teacher', '教师', '选填'],
                  ['room', '教室', '选填'],
                  ['term', '学期', '例如：2026-2027第1学期'],
                  ['credit', '学分', '选填'],
                ] as const
              ).map(([key, label, ph]) => (
                <label key={key} className={key === 'name' ? 'col-span-2' : ''}>
                  <span className="mb-1 block text-[10.5px] text-white/45">{label}</span>
                  <input
                    value={editDraft[key]}
                    onChange={(e) => setEditDraft((d) => ({ ...d, [key]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveEdit()
                    }}
                    placeholder={ph}
                    aria-label={`编辑 ${label}`}
                    className="w-full rounded-xl px-3 py-2 text-[12.5px] text-white outline-none placeholder:text-white/30"
                    style={{ background: 'rgb(0 0 0 / .28)', border: '1px solid rgb(255 255 255 / .14)' }}
                  />
                </label>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                disabled={busy || !editDraft.name.trim()}
                onClick={() => void saveEdit()}
                aria-label="保存课程修改"
                className="rounded-xl px-3.5 py-2 text-[12.5px] font-semibold text-white transition disabled:opacity-40"
                style={{
                  background: 'linear-gradient(135deg, rgb(143 178 255 / .9), rgb(186 155 255 / .9))',
                  boxShadow: '0 10px 26px -14px rgb(143 178 255 / .95)',
                }}
              >
                保存修改
              </button>
              <button
                onClick={() => setEditing(null)}
                aria-label="取消编辑课程"
                className="rounded-xl px-3.5 py-2 text-[12.5px] font-semibold text-ink-dim"
                style={{ background: 'rgb(255 255 255 / .05)', border: '1px solid rgb(255 255 255 / .1)' }}
              >
                取消
              </button>
            </div>
          </div>
        )}
        <div className="grid gap-3 @3xl:grid-cols-2">
          {courses.map((c, i) => (
            <div key={c.id} className="group relative h-[166px]">
              <CourseCard
                c={c}
                i={i}
                active={picked === c.id}
                onPick={() => setPicked(c.id)}
                onOpen={() => onOpenCourse(c.id)}
              />
              {/* 编辑：hover 才显形，平时不干扰浏览 */}
              <button
                onClick={() => {
                  setPicked(c.id)
                  startEdit(c)
                }}
                aria-label={`编辑课程 ${c.name}`}
                title="编辑课程信息"
                className="absolute bottom-2.5 right-2.5 rounded-lg px-2 py-1 text-[11px] text-white/55 opacity-0 transition hover:bg-white/15 hover:text-white focus:opacity-100 group-hover:opacity-100"
                style={{ background: 'rgb(0 0 0 / .45)', border: '1px solid rgb(255 255 255 / .14)' }}
              >
                编辑
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 右侧：选中课程的文件区（对应"拖文件进来"的落点） */}
      <div className="min-w-0">
        <SectionTitle
          kicker="drop zone"
          title={pickedCourse ? `${pickedCourse.name} · 文件` : '选择一个课程'}
          rgb={pickedCourse?.rgb ?? '143 178 255'}
        />

        {/* 选中课程后给出「编辑 / 删除」。
            放在右栏而不是卡片上：卡片本身是 <button>，
            里面再嵌按钮是非法 HTML，点击行为也会打架。 */}
        {pickedCourse && editing !== pickedCourse.id && (
          <div className="mb-3 flex items-center gap-2">
            <button
              onClick={() => startEdit(pickedCourse)}
              aria-label={`编辑课程 ${pickedCourse.name}`}
              className="rounded-xl px-3 py-1.5 text-[11.5px] text-white/70 transition hover:bg-white/10 hover:text-white"
              style={{ background: 'rgb(255 255 255 / .05)', border: '1px solid rgb(255 255 255 / .12)' }}
            >
              编辑课程信息
            </button>
            <button
              onClick={() => {
                void remove(pickedCourse.id).then((okDone) => {
                  if (okDone) setPicked(null)
                })
              }}
              aria-label={`删除课程 ${pickedCourse.name}`}
              className="rounded-xl px-3 py-1.5 text-[11.5px] text-rose-200/70 transition hover:bg-rose-400/10 hover:text-rose-100"
            >
              删除这门课程
            </button>
            <span className="ml-auto text-[10.5px] text-white/35">
              {pickedCourse.manual ? '自己建的' : '导入的'}
            </span>
          </div>
        )}

        <div
          className="deco mb-3 flex flex-col items-center justify-center gap-2 rounded-2xl border-dashed py-5 text-center"
          style={{ borderColor: `rgb(${pickedCourse?.rgb ?? '143 178 255'} / .4)`, borderWidth: 1, borderStyle: 'dashed' }}
        >
          <IconUpload className="h-5 w-5" style={{ color: `rgb(${pickedCourse?.rgb ?? '143 178 255'})` }} />
          <div className="text-[12.5px] text-ink-dim">把文件拖到这里存入该课程</div>
          <div className="text-[11px] text-ink-faint">
            支持 .md .txt .py .js .java .cpp .docx .pdf .pptx（原型阶段不实际上传）
          </div>
        </div>

        {/* 右栏：选中课程的文件。
            数据来自真实文件表 —— 按课程归属过滤，不再读 mock 的 FILES。 */}
        {!pickedCourse && (
          <div className="mat-clear rounded-2xl px-4 py-10 text-center text-[12px] leading-relaxed text-white/55">
            选一门课程，看它下面的资料
          </div>
        )}
        {pickedCourse && <CourseFiles courseId={pickedCourse.id} rgb={pickedCourse.rgb} />}

        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-white/4 px-3.5 py-2.5 text-[11.5px] text-ink-faint">
          <IconSparkle className="h-4 w-4 text-[rgb(143,178,255)]" />
          后端接入后，这里会显示真实目录树，并支持文件拖拽排序与回收站
        </div>
      </div>
    </div>
  )
}
