import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BOOKMARKS, BOOKMARK_KINDS, faviconOf, hostOf, normalizeUrl } from '../data/bookmarks'
import { GlassX } from '../components/ImagePad'
import { IconEdit, IconExternal, IconLink, IconTrash } from '../components/Icons'
import { setSpot } from '../lib/utils'
import * as dataApi from '../lib/dataApi'
import { errText } from '../lib/api'
import type { Bookmark } from '../types'

const EASE = [0.22, 1, 0.36, 1] as const

/** 编辑中的草稿 */
interface Draft {
  id?: string
  title: string
  url: string
  desc: string
  kind: string
  rgb: string
}

const emptyDraft = (): Draft => ({ title: '', url: '', desc: '', kind: '文档', rgb: '111 156 255' })

const nowLabel = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/* ------------------------------------------------------------------ */
/*                              书签卡片                               */
/* ------------------------------------------------------------------ */
function BookmarkCard({
  b,
  onEdit,
  onDelete,
  onOpen,
}: {
  b: Bookmark
  onEdit: () => void
  onDelete: () => void
  onOpen: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const [iconOk, setIconOk] = useState(true)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
      transition={{ duration: 0.34, ease: EASE }}
      onMouseMove={setSpot}
      className="mat-clear spec group relative flex flex-col rounded-3xl p-4"
      style={{ borderColor: `rgb(${b.rgb} / .3)` }}
    >
      {/* 操作区：编辑 / 删除，平时隐形 */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
        {confirm ? (
          <div className="flex items-center gap-1.5 rounded-full border border-red-300/40 bg-[#1b0f14]/85 px-2 py-1 backdrop-blur-sm">
            <span className="text-[10.5px] text-red-200">删除？</span>
            <button
              onClick={onDelete}
              className="rounded-full bg-red-400/25 px-2 py-0.5 text-[10.5px] text-red-100 transition hover:bg-red-400/40"
              aria-label="确认删除这个网址"
            >
              确认
            </button>
            <button
              onClick={() => setConfirm(false)}
              className="rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] text-white/80 transition hover:bg-white/20"
              aria-label="取消删除"
            >
              取消
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
            <button
              onClick={onEdit}
              aria-label={`编辑网址：${b.title}`}
              title="编辑"
              className="grid h-7 w-7 place-items-center rounded-full border border-white/20 bg-[#0b0d18]/60 text-white/70 backdrop-blur-sm transition hover:border-white/45 hover:text-white"
            >
              <IconEdit className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setConfirm(true)}
              aria-label={`删除网址：${b.title}`}
              title="删除"
              className="grid h-7 w-7 place-items-center rounded-full border border-white/20 bg-[#0b0d18]/60 text-white/70 backdrop-blur-sm transition hover:border-red-300/50 hover:bg-[#1b0f14]/85 hover:text-red-200"
            >
              <IconTrash className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* 主体是 <a>：真实链接才能保证「新标签打开」由浏览器接管，
          不用 window.open（会被部分环境当弹窗拦截）。 */}
      <a
        href={b.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          // 中键 / Ctrl 点击交给浏览器默认行为
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
          e.preventDefault()
          onOpen()
        }}
        className="flex min-w-0 flex-1 flex-col outline-none"
        aria-label={`打开网址 ${b.title}（新标签页）`}
      >
        <div className="flex items-start gap-2.5 pr-16">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl text-[13px] font-semibold"
            style={{
              background: `linear-gradient(150deg, rgb(${b.rgb} / .32), rgb(${b.rgb} / .1))`,
              border: '1px solid rgba(255,255,255,.14)',
              color: `rgb(${b.rgb})`,
            }}
          >
            {iconOk && faviconOf(b.url) ? (
              <img
                src={faviconOf(b.url)}
                alt=""
                className="h-5 w-5"
                onError={() => setIconOk(false)}
                draggable={false}
              />
            ) : (
              b.title.slice(0, 1).toUpperCase()
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-medium text-white">{b.title}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/55">
              <IconLink className="h-3 w-3 shrink-0" />
              <span className="truncate">{hostOf(b.url)}</span>
            </span>
          </span>
        </div>

        {b.desc && (
          <p className="mt-2.5 line-clamp-2 text-[12px] leading-[1.7] text-white/70">{b.desc}</p>
        )}

        <div className="mt-auto flex items-center gap-2 pt-3">
          <span
            className="rounded-full px-2 py-0.5 text-[10px]"
            style={{ background: `rgb(${b.rgb} / .16)`, color: `rgb(${b.rgb})` }}
          >
            {b.kind}
          </span>
          <span className="text-[10.5px] text-white/45">{b.at}</span>
          <span className="ml-auto flex items-center gap-1 text-[10.5px] text-white/45 transition group-hover:text-white/80">
            <IconExternal className="h-3 w-3" />
            新标签打开
          </span>
        </div>
      </a>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*                              主视图                                 */
/* ------------------------------------------------------------------ */
export default function BookmarksView() {
  const [items, setItems] = useState<Bookmark[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  /** 待确认跳转的网址（点卡片后先确认，再新开标签） */
  const [go, setGo] = useState<{ title: string; url: string } | null>(null)

  /* 进页面时从服务端拉取。原来是 useState(BOOKMARKS) —— 假数据在内存里，刷新即丢。 */
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const rows = await dataApi.bookmarks.list()
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

  const list = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k) return items
    return items.filter(
      (b) =>
        b.title.toLowerCase().includes(k) ||
        b.url.toLowerCase().includes(k) ||
        b.desc.toLowerCase().includes(k) ||
        b.kind.includes(k),
    )
  }, [items, q])

  const save = async () => {
    if (!draft) return
    const title = draft.title.trim()
    if (!title) {
      setErr('名称不能为空')
      return
    }
    const { url, error } = normalizeUrl(draft.url)
    if (error) {
      setErr(error)
      return
    }
    setErr(null)
    const payload = { title, url, desc: draft.desc.trim(), kind: draft.kind }
    try {
      if (draft.id) {
        // 乐观更新，失败回滚
        const snapshot = items
        setItems((p) => p.map((b) => (b.id === draft.id ? { ...b, ...payload } : b)))
        setDraft(null)
        try {
          await dataApi.bookmarks.update(draft.id, payload)
        } catch (e) {
          setItems(snapshot)
          setErr(`保存失败：${errText(e)}`)
        }
      } else {
        const created = await dataApi.bookmarks.create(payload)
        setItems((p) => [created, ...p])
        setDraft(null)
      }
    } catch (e) {
      setErr(errText(e))
    }
  }

  const remove = async (id: string) => {
    const snapshot = items
    setItems((p) => p.filter((b) => b.id !== id))
    try {
      await dataApi.bookmarks.remove(id)
    } catch (e) {
      setItems(snapshot)
      setErr(`删除失败：${errText(e)}`)
    }
  }

  /** 新标签打开：用真实 <a target="_blank"> 点击，避免 window.open 被拦 */
  const openInNewTab = (url: string) => {
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const editing = !!draft?.id

  return (
    <div className="grid h-full min-h-0 gap-6 lg:grid-cols-[380px_minmax(0,1320px)]">
      {/* ========================= 左：收录 ========================= */}
      <section className="flex min-h-0 flex-col" aria-label="网址收录">
        <div className="mb-3 flex items-baseline gap-2.5">
          <h3 className="font-cn-title flex items-center gap-2 text-[15px] font-semibold text-white">
            <IconLink className="h-4 w-4 text-[rgb(111,156,255)]" />
            {editing ? '编辑网址' : '收录新网址'}
          </h3>
          <span className="text-[11.5px] text-ink-faint">
            {editing ? '改完点保存' : '攒下来，之后不用再翻历史记录'}
          </span>
        </div>

        <div className="mat-clear rounded-3xl p-4">
          <label className="block">
            <span className="mb-1.5 block text-[11px] text-white/60">名称</span>
            <input
              value={draft?.title ?? ''}
              onChange={(e) => setDraft((d) => ({ ...(d ?? emptyDraft()), title: e.target.value }))}
              placeholder="例如：MDN Web Docs"
              className="w-full rounded-xl border border-white/15 bg-white/8 px-3 py-2 text-[13px] text-white outline-none transition placeholder:text-white/40 focus:border-white/35"
              aria-label="网址名称"
            />
          </label>

          <label className="mt-3 block">
            <span className="mb-1.5 block text-[11px] text-white/60">网址</span>
            <input
              value={draft?.url ?? ''}
              onChange={(e) => setDraft((d) => ({ ...(d ?? emptyDraft()), url: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
              }}
              placeholder="example.com（不用写 https://）"
              className="w-full rounded-xl border border-white/15 bg-white/8 px-3 py-2 text-[13px] text-white outline-none transition placeholder:text-white/40 focus:border-white/35"
              aria-label="网址"
              inputMode="url"
            />
          </label>

          <label className="mt-3 block">
            <span className="mb-1.5 block text-[11px] text-white/60">备注（可选）</span>
            <textarea
              value={draft?.desc ?? ''}
              onChange={(e) => setDraft((d) => ({ ...(d ?? emptyDraft()), desc: e.target.value }))}
              rows={2}
              placeholder="为什么值得收藏？下次什么时候会用到？"
              className="w-full resize-none rounded-xl border border-white/15 bg-white/8 px-3 py-2 text-[12.5px] leading-relaxed text-white outline-none transition placeholder:text-white/40 focus:border-white/35"
              aria-label="备注"
            />
          </label>

          <div className="mt-3">
            <span className="mb-1.5 block text-[11px] text-white/60">分类</span>
            <div className="flex flex-wrap gap-1.5">
              {BOOKMARK_KINDS.map((k) => {
                const on = (draft?.kind ?? '文档') === k.kind
                return (
                  <button
                    key={k.kind}
                    onClick={() => setDraft((d) => ({ ...(d ?? emptyDraft()), kind: k.kind, rgb: k.rgb }))}
                    className="rounded-full px-3 py-1.5 text-[11.5px] transition"
                    style={{
                      background: on ? `rgb(${k.rgb} / .22)` : 'rgba(255,255,255,.06)',
                      color: on ? `rgb(${k.rgb})` : 'rgba(255,255,255,.72)',
                      border: `1px solid ${on ? `rgb(${k.rgb} / .45)` : 'transparent'}`,
                    }}
                  >
                    {k.kind}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={save}
              disabled={!draft?.title.trim() || !draft?.url.trim()}
              className="flex items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-medium transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
              style={{
                background: 'rgba(111,156,255,.22)',
                color: 'rgb(140,175,255)',
                border: '1px solid rgba(111,156,255,.45)',
              }}
            >
              <IconLink className="h-4 w-4" />
              {editing ? '保存修改' : '收进宝藏'}
            </button>
            {draft && (
              <button
                onClick={() => {
                  setDraft(null)
                  setErr(null)
                }}
                className="rounded-full bg-white/8 px-3.5 py-2 text-[12px] text-white/75 transition hover:bg-white/16 hover:text-white"
              >
                {editing ? '取消编辑' : '清空'}
              </button>
            )}
          </div>

          {err && (
            <div
              className="mt-2 rounded-xl px-3 py-2 text-[11.5px]"
              style={{ background: 'rgba(255,120,120,.16)', color: '#ffb3b3' }}
              role="alert"
            >
              {err}
            </div>
          )}

          <p className="mt-2 text-[10.5px] leading-snug text-white/55">
            数据保存在服务器。点击卡片会**新开标签页**打开，不会离开本页。
          </p>
        </div>

        {/* 检索 */}
        <div className="mat-clear mt-4 rounded-3xl p-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索名称 / 网址 / 备注 / 分类…"
            className="w-full bg-transparent px-2 py-1.5 text-[12.5px] text-white outline-none placeholder:text-white/45"
            aria-label="搜索网址"
          />
          <div className="mt-1 flex items-center justify-between px-2 text-[10.5px] text-white/50">
            <span>
              共 {items.length} 个 · 命中 {list.length}
            </span>
            {q && (
              <button onClick={() => setQ('')} className="transition hover:text-white">
                清空搜索
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ========================= 右：宝藏墙 ========================= */}
      <section className="flex min-h-0 flex-col" aria-label="宝藏墙">
        <div className="mb-3 flex items-baseline gap-2.5">
          <h3 className="font-cn-title flex items-center gap-2 text-[15px] font-semibold text-white">
            <IconExternal className="h-4 w-4 text-[rgb(255,143,177)]" />
            宝藏墙
          </h3>
          <span className="text-[11.5px] text-ink-faint">
            {q ? `筛选结果 ${list.length} 个` : `收录 ${items.length} 个网址`}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence initial={false}>
              {list.map((b) => (
                <BookmarkCard
                  key={b.id}
                  b={b}
                  onOpen={() => setGo({ title: b.title, url: b.url })}
                  onEdit={() =>
                    setDraft({ id: b.id, title: b.title, url: b.url, desc: b.desc, kind: b.kind, rgb: b.rgb })
                  }
                  onDelete={() => remove(b.id)}
                />
              ))}
            </AnimatePresence>
          </div>

          {!list.length && (
            <div className="mat-clear rounded-3xl px-6 py-12 text-center text-[13px] text-white/70">
              {q ? '没有匹配的网址' : '宝藏墙还是空的 —— 左边收一个进来'}
            </div>
          )}
        </div>
      </section>

      {/* ========================= 跳转确认 ========================= */}
      <AnimatePresence>
        {go && (
          <motion.div
            className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setGo(null)}
            role="dialog"
            aria-modal="true"
            aria-label="确认打开网址"
          >
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 340, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="glass w-[min(520px,92vw)] rounded-3xl p-6"
            >
              <div className="flex items-start gap-3">
                <span
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl"
                  style={{ background: 'rgba(111,156,255,.2)', border: '1px solid rgba(111,156,255,.4)' }}
                >
                  <IconExternal className="h-5 w-5 text-[rgb(140,175,255)]" />
                </span>
                <div className="min-w-0">
                  <h4 className="truncate text-[15px] font-semibold text-white">{go.title}</h4>
                  <p className="mt-1 break-all text-[11.5px] text-white/60">{go.url}</p>
                </div>
                <div className="ml-auto">
                  <GlassX onClick={() => setGo(null)} label="关闭" />
                </div>
              </div>

              <p className="mt-4 text-[12.5px] leading-relaxed text-white/75">
                将在**新标签页**打开这个网址，当前页面保持不动。
              </p>

              <div className="mt-5 flex items-center gap-2">
                <button
                  onClick={() => {
                    openInNewTab(go.url)
                    setGo(null)
                  }}
                  className="flex items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-medium transition hover:brightness-110"
                  style={{
                    background: 'rgba(111,156,255,.24)',
                    color: 'rgb(150,182,255)',
                    border: '1px solid rgba(111,156,255,.5)',
                  }}
                >
                  <IconExternal className="h-4 w-4" />
                  新标签打开
                </button>
                <button
                  onClick={() => setGo(null)}
                  className="rounded-full bg-white/8 px-3.5 py-2 text-[12px] text-white/75 transition hover:bg-white/16 hover:text-white"
                >
                  取消
                </button>
                <span className="ml-auto text-[10.5px] text-white/45">Esc 或点背景关闭</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
