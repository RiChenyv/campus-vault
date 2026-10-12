import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  // CAL_EVENTS 不再直接用 —— 日历节点改从服务端读（见 lib/useEvents.ts）
  // CAL_MONTH 也不用了 —— 月份改为按**真实日期**算（见 lib/monthGrid.ts）
  COURSES,
  IDEAS,
  STATS,
  TODOS,
} from '../data/mock'
import { buildMonthGrid, monthCells } from '../lib/monthGrid'
import { SectionTitle } from '../components/Bits'
import ConfirmDialog from '../components/ConfirmDialog'
import Heatmap from '../components/Heatmap'
import { useEvents } from '../lib/useEvents'
import { AttachedImageBox, CardImage, GlassX } from '../components/ImagePad'
import { IconFlame, IconImage, IconSparkle, IconTrash } from '../components/Icons'
import { fileToImage, imageFromClipboard, type AttachedImage } from '../lib/image'
import { setSpot } from '../lib/utils'
import * as dataApi from '../lib/dataApi'
import { errText } from '../lib/api'
import type { Idea, Todo } from '../types'

const EASE = [0.22, 1, 0.36, 1] as const

/* ============================== 待办 ============================== */
export function TodosView() {
  const [items, setItems] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<'pending' | 'done'>('pending')

  /* 从服务端拉取。原来是 useState(TODOS) —— 假数据放内存，刷新即丢。 */
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const rows = await dataApi.todos.list()
        if (alive) setItems(rows)
      } catch (e) {
        if (alive) setErr(errText(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const list = items.filter((t) => (tab === 'pending' ? !t.done : t.done))
  const left = items.filter((t) => !t.done).length
  const [clearOpen, setClearOpen] = useState(false)

  /** 清空全部待办 —— 详情页与首页任务页共用同一个接口 */
  const clearAll = async () => {
    const snapshot = items
    setClearOpen(false)
    setItems([])
    try {
      await dataApi.todos.clearAll()
    } catch (e) {
      setItems(snapshot)
      setErr(`清空失败：${errText(e)}`)
    }
  }

  const toggle = async (id: string) => {
    const cur = items.find((t) => t.id === id)
    if (!cur) return
    const next = !cur.done
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, done: next } : t)))
    try {
      await dataApi.todos.setDone(id, next)
    } catch (e) {
      setItems((prev) => prev.map((t) => (t.id === id ? { ...t, done: cur.done } : t)))
      setErr(`更新失败：${errText(e)}`)
    }
  }

  return (
    <div className="grid gap-5 @4xl:grid-cols-[1fr_320px]">
      <div className="min-w-0">
        <SectionTitle kicker="todo" title={`未完成 ${left} 项`} rgb="92 214 190" />

        <div className="mb-3 flex gap-1.5">
          {(['pending', 'done'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className="rounded-full px-3.5 py-1.5 text-[12px] transition"
              style={{
                background: tab === k ? 'rgba(92,214,190,.18)' : 'rgba(255,255,255,.05)',
                color: tab === k ? 'rgb(92,214,190)' : '#9aa1c2',
                border: `1px solid ${tab === k ? 'rgba(92,214,190,.4)' : 'transparent'}`,
              }}
            >
              {k === 'pending' ? `未完成 ${left}` : `已完成 ${items.length - left}`}
            </button>
          ))}

          {/* 详情页也放一个清空，和首页任务页保持一致 —— 用户在哪儿看到列表，就能在哪儿清 */}
          {items.length > 0 && (
            <button
              onClick={() => setClearOpen(true)}
              className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-white/14 bg-white/6 px-3 py-1.5 text-[11.5px] text-white/70 transition hover:border-red-300/50 hover:bg-red-400/12 hover:text-red-200"
              aria-label="清空全部待办"
              title={`清空全部 ${items.length} 项待办`}
            >
              <IconTrash className="h-3.5 w-3.5" />
              清空
            </button>
          )}
        </div>

        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {list.map((t) => {
              const c = COURSES.find((x) => x.id === t.courseId)
              const tone =
                t.dueTone === 'danger' ? '#ff8f8f' : t.dueTone === 'warn' ? '#ffc07a' : '#9aa1c2'
              return (
                <motion.li
                  key={t.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.32, ease: EASE }}
                  className="mat flex items-center gap-3 rounded-2xl px-3.5 py-3"
                >
                  <button
                    onClick={() => toggle(t.id)}
                    aria-label={t.done ? '标记为未完成' : '标记为已完成'}
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-md border transition"
                    style={{
                      borderColor: t.done ? 'transparent' : 'rgba(255,255,255,.3)',
                      background: t.done ? 'linear-gradient(140deg,#5cd6be,#8fb2ff)' : 'transparent',
                    }}
                  >
                    {t.done && (
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="#08111a" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                        <path d="m5 12.5 4.5 4.5L19 7" />
                      </svg>
                    )}
                  </button>

                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-[13.5px]"
                      style={{
                        color: t.done ? '#7e85a6' : '#fff',
                        textDecoration: t.done ? 'line-through' : 'none',
                      }}
                    >
                      {t.title}
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-[11px] text-ink-faint">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: `rgb(${c?.rgb})` }}
                      />
                      {c?.name}
                    </span>
                  </span>

                  <span className="shrink-0 text-right">
                    <span className="block text-[11.5px]" style={{ color: tone }}>
                      {t.due}
                    </span>
                    <span
                      className="mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9.5px]"
                      style={{
                        background:
                          t.priority === '高' ? 'rgba(255,120,120,.18)' : 'rgba(255,255,255,.07)',
                        color: t.priority === '高' ? '#ff9c9c' : '#9aa1c2',
                      }}
                    >
                      {t.priority}优先
                    </span>
                  </span>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>

        {list.length === 0 && (
          <div className="deco mt-2 rounded-2xl py-12 text-center text-[12.5px] text-ink-faint">
            这个列表是空的 —— 挺好
          </div>
        )}
      </div>

      <aside className="min-w-0">
        <SectionTitle kicker="insight" title="本周节奏" rgb="92 214 190" />
        <div className="deco space-y-3 rounded-3xl p-4">
          <div className="flex items-center gap-3">
            <IconFlame className="h-5 w-5 text-orange-300" />
            <div>
              <div className="text-[14px] font-semibold text-white">连续 {STATS.streak} 天有记录</div>
              <div className="text-[11px] text-ink-faint">最长纪录 31 天</div>
            </div>
          </div>
          <div className="h-px bg-white/8" />
          {[
            ['今天到期', '1 项', '#ff8f8f'],
            ['本周到期', '4 项', '#ffc07a'],
            ['无截止日期', '1 项', '#9aa1c2'],
          ].map(([k, v, color]) => (
            <div key={k} className="flex items-center justify-between text-[12.5px]">
              <span className="text-ink-dim">{k}</span>
              <span style={{ color }}>{v}</span>
            </div>
          ))}
          <div className="h-px bg-white/8" />
          <div className="text-[11.5px] leading-relaxed text-ink-faint">
            后端接入后，作业文件上传时可自动生成一条待办，DDL 从文件名或手动选择。
          </div>
        </div>
      </aside>

      <ConfirmDialog
        open={clearOpen}
        title="清空全部待办？"
        message={`将删除 ${items.length} 项待办（含已完成 ${items.length - left} 项），此操作无法撤销。`}
        detail="已完成待办在热力图上产生的记录也会同步回退，附件会一并删除。"
        confirmText={`清空 ${items.length} 项`}
        onConfirm={() => void clearAll()}
        onCancel={() => setClearOpen(false)}
      />
    </div>
  )
}

/* ============================== 灵感 ============================== */
export function IdeasView() {
  const [text, setText] = useState('')
  const [list, setList] = useState<Idea[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<AttachedImage | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lightbox, setLightbox] = useState<{ dataUrl: string; name?: string } | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  /* 进页面时从服务端拉取。原来这里是 useState(IDEAS) —— 假数据放内存，刷新即丢。 */
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const rows = await dataApi.ideas.list()
        if (alive) setList(rows)
      } catch (e) {
        if (alive) setErr(errText(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const attach = async (f?: File | Blob | null) => {
    if (!f) return
    setBusy(true)
    setErr(null)
    try {
      // 先在前端压到 1280px / WebP，减少上传体积；上传时再由 create() 转成文件
      setDraft(await fileToImage(f))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '处理图片失败')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const add = async () => {
    if (!text.trim() && !draft) return
    setBusy(true)
    setErr(null)
    try {
      const created = await dataApi.ideas.create(text.trim() || '（图片）', draft?.dataUrl)
      setList((p) => [created, ...p])
      setText('')
      setDraft(null)
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    const snapshot = list
    setList((p) => p.filter((it) => it.id !== id))
    setConfirmId(null)
    try {
      await dataApi.ideas.remove(id)
    } catch (e) {
      setList(snapshot) // 失败就把条目放回去，不能假装删掉了
      setErr(`删除失败：${errText(e)}`)
    }
  }

  /** 清空全部灵感。服务端会连带回收配图文件并回退热力图计数 */
  const clearAll = async () => {
    const snapshot = list
    setClearOpen(false)
    setList([])
    try {
      await dataApi.ideas.clearAll()
    } catch (e) {
      setList(snapshot)
      setErr(`清空失败：${errText(e)}`)
    }
  }

  const withImage = list.filter((it) => it.image).length

  return (
    <div className="grid h-full min-h-0 gap-6 lg:grid-cols-[360px_minmax(0,1120px)]">
      {/* ---------------------------- 左：灵感收集 ---------------------------- */}
      <section className="flex min-h-0 flex-col" aria-label="灵感收集">
        <div className="mb-3 flex items-baseline gap-2.5">
          <h3 className="font-cn-title flex items-center gap-2 text-[15px] font-semibold text-white">
            <IconSparkle className="h-4 w-4 text-[rgb(255,168,120)]" />
            灵感收集
          </h3>
          <span className="text-[11.5px] text-ink-faint">随手记 · 不必先归类</span>

          {/* 清空全部：只在真的有内容时出现，空列表上摆个删除按钮没有意义 */}
          {list.length > 0 && (
            <button
              onClick={() => setClearOpen(true)}
              className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-white/14 bg-white/6 px-3 py-1.5 text-[11.5px] text-white/70 transition hover:border-red-300/50 hover:bg-red-400/12 hover:text-red-200"
              aria-label="清空全部灵感"
              title={`清空全部 ${list.length} 条灵感`}
            >
              <IconTrash className="h-3.5 w-3.5" />
              清空
            </button>
          )}
        </div>

        {/* 拖拽落图：整块面板都是投放区 */}
        <div
          className="mat-clear rounded-3xl p-3"
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={(e) => {
            e.preventDefault()
            const f = imageFromClipboard(e.dataTransfer) ?? e.dataTransfer.files?.[0]
            void attach(f)
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add()
            }}
            onPaste={(e) => {
              // 直接 Ctrl+V 粘截图
              const f = imageFromClipboard(e.clipboardData)
              if (f) {
                e.preventDefault()
                void attach(f)
              }
            }}
            rows={draft ? 4 : 9}
            placeholder={'想到什么就先写下来…\n\nCtrl + Enter 保存 · 可直接粘贴或拖入图片'}
            /* 占位文字用亮灰。
               注意这块玻璃很透，底色是**模糊后的粉色壁纸**（实测中位亮度 122），
               不是常见的暗底 —— 所以 /70 的半透明亮灰对比度只有 70 左右，偏糊。
               提到 /85 后实测对比差 ~105。 */
            className="w-full resize-none bg-transparent px-2 py-1.5 text-[13.5px] leading-[1.9] text-white outline-none placeholder:text-[#e8ecf7]/85"
            aria-label="新建灵感"
          />

          {draft && (
            <AttachedImageBox
              dataUrl={draft.dataUrl}
              ratio={draft.ratio}
              name={draft.name}
              bytes={draft.bytes}
              onRemove={() => setDraft(null)}
            />
          )}

          <div className="flex items-end justify-between gap-2 px-2 pt-2">
            <div className="min-w-0">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-[11.5px] text-white/80 transition hover:bg-white/14 hover:text-white disabled:opacity-50"
              >
                <IconImage className="h-3.5 w-3.5" />
                {busy ? '处理中…' : draft ? '换一张' : '添加图片'}
              </button>
              <div className="mt-1.5 truncate text-[10.5px] leading-snug text-[#dfe3f0]/90">
                数据保存在服务器 · 换设备也能看到
              </div>
            </div>

            <button
              onClick={add}
              disabled={!text.trim() && !draft}
              className="flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-medium transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
              style={{
                background: 'rgba(255,168,120,.2)',
                color: 'rgb(255,168,120)',
                border: '1px solid rgba(255,168,120,.4)',
              }}
            >
              <IconSparkle className="h-4 w-4" />
              收进收件箱
            </button>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => void attach(e.target.files?.[0])}
          />

          {err && (
            <div
              className="mt-2 rounded-xl px-3 py-2 text-[11.5px]"
              style={{ background: 'rgba(255,120,120,.16)', color: '#ffb3b3' }}
              role="alert"
            >
              {err}
            </div>
          )}
        </div>

        {/* 收集侧的轻提示：说明这条灵感之后会去哪。
            文字色比默认的 ink-faint 亮 —— 这块玻璃很透，
            默认那档灰色压在彩色壁纸上会糊。 */}
        <ul className="mt-4 space-y-2 text-[11.5px] text-[#c3c9dd]/85">
          {[
            ['写完先落这里', '不做必填字段，降低记录门槛'],
            ['支持配图', '粘贴、拖入或点「添加图片」'],
            ['右侧是回顾区', '可以删掉不再需要的想法'],
          ].map(([k, v]) => (
            <li key={k} className="flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-white/50" />
              <span>
                <b className="font-normal text-white/90">{k}</b> · {v}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* 清空确认：把"将删除多少条 / 其中多少条带图"说清楚再让用户决定 */}
      <ConfirmDialog
        open={clearOpen}
        title="清空全部灵感？"
        message={`将删除 ${list.length} 条灵感，此操作无法撤销。`}
        detail={
          withImage > 0
            ? `其中 ${withImage} 条带配图，图片文件会一并删除；这些灵感产生的热力图记录也会同步回退。`
            : '这些灵感产生的热力图记录也会同步回退。'
        }
        confirmText={`清空 ${list.length} 条`}
        onConfirm={() => void clearAll()}
        onCancel={() => setClearOpen(false)}
      />

      {/* ---------------------------- 右：心流回顾 ----------------------------
          右栏内容整体收敛：卡片单列宽上限 520px，列间距自然撑开。
          2.5:1 的超宽屏上如果让卡片铺满，一行 90 多个字没法读。 */}
      <section className="flex min-h-0 flex-col" aria-label="心流回顾">
        <div className="mb-3 flex items-baseline gap-2.5">
          <h3 className="font-cn-title flex items-center gap-2 text-[15px] font-semibold text-white">
            <IconFlame className="h-4 w-4 text-[rgb(196,148,255)]" />
            心流回顾
          </h3>
          <span className="text-[11.5px] text-ink-faint">已经写下的想法 · {list.length} 条</span>
        </div>

        {/* 列表自己滚，面板整体不滚 —— 这样左栏的输入框始终可见 */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          <div className="flex flex-wrap gap-3">
            <AnimatePresence initial={false}>
              {list.map((it, i) => (
                <motion.div
                  key={it.id}
                  layout
                  initial={{ opacity: 0, y: 18, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.22 } }}
                  transition={{ delay: Math.min(i, 8) * 0.035, duration: 0.4, ease: EASE }}
                  onMouseMove={setSpot}
                  className="mat-clear spec group relative w-full max-w-[520px] rounded-3xl p-4"
                  style={{ borderColor: `rgb(${it.color} / .3)` }}
                >
                  <div
                    className="mb-2.5 h-[3px] w-9 rounded-full"
                    style={{ background: `rgb(${it.color})` }}
                  />

                  {/* 删除：平时隐形，悬停/聚焦时出现。两步确认，避免误删 */}
                  <div className="absolute right-3 top-3 z-10">
                    {confirmId === it.id ? (
                      <div className="flex items-center gap-1.5 rounded-full border border-red-300/40 bg-[#1b0f14]/85 px-2 py-1 backdrop-blur-sm">
                        <span className="text-[10.5px] text-red-200">删除？</span>
                        <button
                          onClick={() => remove(it.id)}
                          className="rounded-full bg-red-400/25 px-2 py-0.5 text-[10.5px] text-red-100 transition hover:bg-red-400/40"
                          aria-label="确认删除这条灵感"
                        >
                          确认
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] text-white/80 transition hover:bg-white/20"
                          aria-label="取消删除"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmId(it.id)}
                        aria-label={`删除灵感：${it.text.slice(0, 12)}`}
                        title="删除"
                        className="grid h-7 w-7 place-items-center rounded-full border border-white/20 bg-[#0b0d18]/60 text-white/70 opacity-0 backdrop-blur-sm transition hover:border-red-300/50 hover:bg-[#1b0f14]/85 hover:text-red-200 focus:opacity-100 group-hover:opacity-100"
                      >
                        <IconTrash className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <p className="pr-8 text-[13px] leading-[1.8] text-[#e4e8fb]">{it.text}</p>

                  {it.image && (
                    <CardImage
                      dataUrl={it.image.dataUrl}
                      ratio={it.image.ratio}
                      onOpen={() => setLightbox({ dataUrl: it.image!.dataUrl, name: it.image!.name })}
                    />
                  )}

                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-[10.5px] text-ink-faint">{it.at}</span>
                    <span className="ml-auto flex gap-1.5">
                      {it.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-full px-2 py-0.5 text-[10px]"
                          style={{ background: `rgb(${it.color} / .16)`, color: `rgb(${it.color})` }}
                        >
                          {t}
                        </span>
                      ))}
                    </span>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {!list.length && (
              <div className="mat-clear w-full rounded-3xl px-6 py-12 text-center text-[13px] text-white/70">
                收件箱空了 —— 左边写一条试试
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 大图查看：整页只有一处，避免每张卡片各挂一个 */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
            role="dialog"
            aria-modal="true"
            aria-label="查看大图"
          >
            <img
              src={lightbox.dataUrl}
              alt={lightbox.name ?? '灵感配图'}
              className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="absolute right-6 top-6">
              <GlassX onClick={() => setLightbox(null)} label="关闭大图" size={34} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ============================== 日历 + 热力图 ============================== */
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

/**
 * 日历与热力图。
 * mode="page" 时用于首页第七屏 —— 外层是确定高度的面板，用 h-full 铺满；
 * 默认（详情路由）走 Shell 的自适应滚动容器，保持内容高度即可。
 */
export function CalendarView({ mode = 'panel' }: { mode?: 'panel' | 'page' }) {
  /* 本月重要节点：可增可删（原来写死在 mock 里） */
  const { events, busy: evBusy, error: evErr, add: addEvent, remove: removeEvent } = useEvents()
  const [evDraft, setEvDraft] = useState({ day: 1, label: '', tone: 'ddl' as 'ddl' | 'exam' | 'activity' })
  const { year, month, firstWeekday, days, today } = buildMonthGrid()
  const cells = monthCells({ year, month, firstWeekday, days, today })
  // 标签色在「薄暗底」上要够亮才读得清：
  // DDL 原来用 255/120/120，实测在亮壁纸区域只有 4.36 对比度，提亮一档。
  const toneRgb = (t: string) =>
    t === 'exam' ? '255 186 118' : t === 'ddl' ? '255 148 148' : t === 'activity' ? '150 184 255' : '102 220 196'

  return (
    <div
      className={
        'grid gap-5 @5xl:grid-cols-[minmax(0,1fr)_340px]' + (mode === 'page' ? ' h-full min-h-0' : '')
      }
    >
      <div
        className={
          'min-w-0' +
          (mode === 'page' ? ' flex min-h-0 flex-col overflow-y-auto overscroll-contain pr-1' : '')
        }
      >
        <SectionTitle kicker="calendar" title={`${year} 年 ${month} 月`} rgb="196 148 255" />

        {/* 材质不用 .deco（不透明深色）——那会把背景图整个盖住；
            但纯 .mat-clear（半透明白）也不行：右上角那块壁纸本身很亮，
            浅色日期数字压上去实测对比度只有 2.2。
            所以用「半透明白 + 薄暗底」两层：壁纸仍透出约六成，
            同时把底色亮度压到 60 以下，给文字一个对比度下限。 */}
        <div
          className="mat-clear spec rounded-3xl p-4"
          style={{ background: 'linear-gradient(rgba(11,14,30,.42), rgba(11,14,30,.5))' }}
        >
          <div className="mb-2 grid grid-cols-7 gap-1.5">
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-center text-[11px] text-white/70">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((d, i) => {
              const evs = d ? events.filter((e) => e.day === d) : []
              /* 「今天」按**真实日期**判断（原来写死 `d === 3`：
                 不管今天几号，3 号永远亮着）。 */
              const isToday = d !== null && d === today
              return (
                <div
                  key={i}
                  className="relative min-h-[74px] rounded-2xl p-2"
                  /* 无障碍标签顺带让测试能精确断言"这一格是几月几号" ——
                     光看数字，测试分不清是 3 号还是"第 3 格"。
                     带上**年份**是有意的：热力图那边也在用「N 月 N 日」这种标签，
                     只写月日两边会撞在一起（测试按前缀选元素时会连热力图一起选中）。 */
                  aria-label={d ? `${year} 年 ${month} 月 ${d} 日${isToday ? '（今天）' : ''}` : undefined}
                  data-today={isToday ? '1' : undefined}
                  style={{
                    // 格子用「暗色半透明」而不是「白色半透明」：
                    // 白色叠加会让底色更亮，浅色日期数字反而更糊
                    background: d ? 'rgba(13,16,34,.34)' : 'transparent',
                    border: isToday
                      ? '1px solid rgba(196,148,255,.62)'
                      : `1px solid rgba(255,255,255,${d ? 0.13 : 0.05})`,
                    boxShadow: isToday ? '0 0 26px -10px rgba(196,148,255,.9)' : undefined,
                  }}
                >
                  {d && (
                    <>
                      <div
                        className="text-[11.5px]"
                        style={{ color: isToday ? 'rgb(214,176,255)' : 'rgba(232,236,252,.92)' }}
                      >
                        {d}
                      </div>
                      <div className="mt-1 space-y-1">
                        {evs.slice(0, 2).map((e) => (
                          <div
                            key={e.label}
                            className="truncate rounded-md px-1.5 py-0.5 text-[9.5px] leading-tight"
                            style={{
                              background: `rgb(${toneRgb(e.tone)} / .16)`,
                              color: `rgb(${toneRgb(e.tone)})`,
                            }}
                          >
                            {e.label}
                          </div>
                        ))}
                        {evs.length > 2 && (
                          <div className="px-1.5 text-[9.5px] text-white/55">+{evs.length - 2}</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="mt-5">
          <SectionTitle kicker="heatmap" title="学习热力图 · 近 26 周" rgb="92 214 190" />
          <div
            className="mat-clear spec rounded-3xl p-4"
            style={{ background: 'linear-gradient(rgba(11,14,30,.42), rgba(11,14,30,.5))' }}
          >
            {/* 热力图抽成了公共组件：个人中心用的是同一份，避免两处配色/粒度不一致 */}
            <Heatmap />
          </div>
        </div>
      </div>

      <aside className={'min-w-0' + (mode === 'page' ? ' min-h-0 overflow-y-auto overscroll-contain pr-1' : '')}>
        <SectionTitle kicker="agenda" title="本月重要节点" rgb="255 179 107" />

        {/* 添加表单。原来这一栏只能看不能改 —— 而"本月重点"本来就是用户自己的东西。 */}
        <div className="mat-clear mb-3 rounded-2xl p-3">
          <div className="flex items-center gap-2">
            <input
              type="number" min={1} max={31} value={evDraft.day}
              onChange={(e) => setEvDraft((d) => ({ ...d, day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) }))}
              aria-label="几号"
              className="w-14 rounded-xl px-2 py-1.5 text-center text-[12px] text-white outline-none"
              style={{ background: 'rgb(0 0 0 / .28)', border: '1px solid rgb(255 255 255 / .14)' }}
            />
            <span className="shrink-0 text-[11.5px] text-white/50">号</span>
            <select
              value={evDraft.tone}
              onChange={(e) => setEvDraft((d) => ({ ...d, tone: e.target.value as typeof d.tone }))}
              aria-label="类型"
              className="shrink-0 rounded-xl px-2 py-1.5 text-[11.5px] text-white outline-none"
              style={{ background: 'rgb(0 0 0 / .28)', border: '1px solid rgb(255 255 255 / .14)' }}
            >
              <option value="ddl">DDL</option>
              <option value="exam">考试</option>
              <option value="activity">活动</option>
            </select>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={evDraft.label}
              onChange={(e) => setEvDraft((d) => ({ ...d, label: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                void addEvent(evDraft).then((okDone) => { if (okDone) setEvDraft((d) => ({ ...d, label: '' })) })
              }}
              placeholder="例如：操作系统 期中考试"
              aria-label="安排内容"
              maxLength={120}
              className="min-w-0 flex-1 rounded-xl px-3 py-1.5 text-[12px] text-white outline-none placeholder:text-white/35"
              style={{ background: 'rgb(0 0 0 / .28)', border: '1px solid rgb(255 255 255 / .14)' }}
            />
            <button
              disabled={evBusy || !evDraft.label.trim()}
              onClick={() => void addEvent(evDraft).then((okDone) => { if (okDone) setEvDraft((d) => ({ ...d, label: '' })) })}
              aria-label="添加安排"
              className="shrink-0 rounded-xl px-3 py-1.5 text-[12px] font-semibold text-white transition disabled:opacity-40"
              style={{
                background: 'linear-gradient(135deg, rgb(255 179 107 / .85), rgb(255 140 140 / .85))',
                boxShadow: '0 8px 22px -14px rgb(255 179 107 / .9)',
              }}
            >
              添加
            </button>
          </div>
        </div>

        {evErr && (
          <div
            className="mb-3 rounded-xl px-3 py-2 text-[11.5px]"
            style={{ background: 'rgba(255,120,120,.16)', color: '#ffb3b3' }}
            role="alert"
          >
            {evErr}
          </div>
        )}

        {!events.length && !evErr && (
          <div className="mat-clear rounded-2xl px-4 py-8 text-center text-[12px] leading-relaxed text-white/55">
            这个月还没有安排
            <br />
            在上面加一条试试
          </div>
        )}

        <ul className="space-y-2">
          {events.map((e, i) => (
            <motion.li
              key={e.label}
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04, duration: 0.34 }}
              className="mat flex items-center gap-3 rounded-2xl px-3.5 py-3"
            >
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[13px] font-semibold"
                style={{
                  background: `rgb(${toneRgb(e.tone)} / .16)`,
                  color: `rgb(${toneRgb(e.tone)})`,
                  border: `1px solid rgb(${toneRgb(e.tone)} / .3)`,
                }}
              >
                {e.day}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-white">{e.label}</span>
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[10px]"
                style={{ background: `rgb(${toneRgb(e.tone)} / .14)`, color: `rgb(${toneRgb(e.tone)})` }}
              >
                {e.tone === 'exam' ? '考试' : e.tone === 'ddl' ? 'DDL' : '活动'}
              </span>
              {/* 删除：就地一个 ✕，不做二次确认 —— 单条且容易重加。
                  ConfirmDialog 是给"清空"这类不可逆操作准备的，这里用太重。 */}
              <button
                onClick={() => void removeEvent(e.id)}
                aria-label={`删除安排 ${e.label}`}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[13px] leading-none text-white/35 transition hover:bg-white/10 hover:text-white"
                title="删除"
              >
                ✕
              </button>
            </motion.li>
          ))}
        </ul>
      </aside>
    </div>
  )
}
