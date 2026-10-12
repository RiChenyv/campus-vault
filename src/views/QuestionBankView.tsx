import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COURSES } from '../data/mock'
import FileViewer from '../components/FileViewer'
import ConfirmDialog from '../components/ConfirmDialog'
import { GlassX } from '../components/ImagePad'
import { IconFile, IconImage, IconSearch, IconTrash, IconUpload } from '../components/Icons'
import { kindLabel, kindRgb, type VaultItem, type VaultKind } from '../lib/vault'
import * as store from '../lib/vaultStore'
import { errText, api } from '../lib/api'
import { setSpot } from '../lib/utils'

const EASE = [0.22, 1, 0.36, 1] as const

/* ------------------------------------------------------------------ */
/*                         文件条目（左栏）                            */
/* ------------------------------------------------------------------ */
/** 列表里每一行的动画外壳。散装文件和文件夹内的文件共用。 */
function RowWrap({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
      transition={{ duration: 0.3, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

function FileRow({
  item,
  active,
  courseName,
  courseRgb,
  subPath,
  onPick,
  onDelete,
}: {
  item: VaultItem
  active: boolean
  courseName?: string
  courseRgb?: string
  /** 文件夹内的子路径（如 `第一章`）。有值时显示在文件名下方 ——
      否则「第一章/笔记.md」和「第二章/笔记.md」在列表里长得一模一样 */
  subPath?: string
  onPick: () => void
  onDelete: () => void
}) {
  const rgb = kindRgb[item.kind]
  const [confirm, setConfirm] = useState(false)

  return (
    <div
      className="mat-clear spec group relative overflow-hidden rounded-2xl transition-all duration-300"
      style={
        active
          ? {
              /* 选中态要一眼看出来。原来只改了 borderColor（55% 透明度），
                 在深色玻璃上几乎不可见 —— 用户的原话是"与其他文件无差别"。
                 现在三处一起变：左侧色条 + 底色染成该类型的主色 + 外发光，
                 另外整体右移 2px，做出"被抽出来"的感觉。 */
              background: `linear-gradient(100deg, rgb(${rgb} / .26) 0%, rgb(${rgb} / .09) 45%, rgba(255,255,255,.03) 100%)`,
              border: `1px solid rgb(${rgb} / .62)`,
              boxShadow: `inset 3px 0 0 rgb(${rgb}), 0 10px 30px -18px rgb(${rgb} / .95)`,
              transform: 'translateX(3px)',
            }
          : undefined
      }
      onMouseMove={setSpot}
    >
      <button onClick={onPick} className="flex w-full items-start gap-2.5 p-3 text-left" aria-current={active}>
        <span
          className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl transition"
          style={{
            background: active ? `rgb(${rgb} / .32)` : `rgb(${rgb} / .18)`,
            border: `1px solid rgb(${rgb} / ${active ? 0.55 : 0.3})`,
          }}
        >
          {item.kind === 'image' ? (
            <IconImage className="h-4 w-4" style={{ color: `rgb(${rgb})` }} />
          ) : (
            <IconFile className="h-4 w-4" style={{ color: `rgb(${rgb})` }} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block truncate transition"
            style={{
              fontSize: active ? 12.8 : 12.5,
              fontWeight: active ? 600 : 400,
              color: active ? '#fff' : 'rgba(255,255,255,.92)',
            }}
            title={item.name}
          >
            {item.name}
          </span>
          {subPath && (
            <span className="mt-0.5 block truncate text-[10px] text-white/40" title={subPath}>
              {subPath}/
            </span>
          )}
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-white/55">
            <span className="rounded px-1.5 py-0.5" style={{ background: `rgb(${rgb} / .16)`, color: `rgb(${rgb})` }}>
              {kindLabel[item.kind]}
            </span>
            <span>{item.size}</span>
            {courseName && (
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: `rgb(${courseRgb})` }} />
                {courseName}
              </span>
            )}
          </span>
        </span>
      </button>

      <div className="absolute right-2 top-2">
        {confirm ? (
          <div className="flex items-center gap-1 rounded-full border border-red-300/40 bg-[#1b0f14]/90 px-1.5 py-0.5 backdrop-blur-sm">
            <button
              onClick={onDelete}
              className="rounded-full bg-red-400/25 px-1.5 py-0.5 text-[10px] text-red-100 transition hover:bg-red-400/40"
              aria-label={`确认删除 ${item.name}`}
            >
              确认
            </button>
            <button
              onClick={() => setConfirm(false)}
              className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/80 transition hover:bg-white/20"
              aria-label="取消删除"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirm(true)}
            aria-label={`删除文件：${item.name}`}
            className="grid h-6 w-6 place-items-center rounded-full border border-white/18 bg-[#0b0d18]/60 text-white/60 opacity-0 backdrop-blur-sm transition hover:border-red-300/50 hover:text-red-200 focus:opacity-100 group-hover:opacity-100"
          >
            <IconTrash className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*                              主视图                                 */
/* ------------------------------------------------------------------ */
/**
 * 题库 —— 以文件为核心的资料库。
 *
 * 只做两件事：**把资料存进来**、**在站内看**。
 * 曾有一个「错题本」页签（结构化录题 + 掌握度 + SM-2 复习排期），
 * 但录题成本高、数据只能靠手填，实际价值不如直接传原始资料，已整体移除。
 * 结构化题目数据仍保留在 data/mock.ts，供课程详情页与搜索面板使用。
 *
 * 两种挂载方式决定了高度怎么算：
 *  · mode="panel" —— 走 Shell 详情路由时，内容区是**自适应高度**的滚动容器，
 *    `h-full` 撑不开（会缩成内容高度、下面留一大片空白），所以用视口高度估算。
 *  · mode="page"  —— 作为首页分页的一屏时，外层是确定高度的面板，直接 h-full 铺满。
 */
export default function QuestionBankView({ mode = 'panel' }: { mode?: 'panel' | 'page' }) {
  const [items, setItems] = useState<VaultItem[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  /**
   * 用户是否主动取消了选中。
   *
   * 为什么要单独一位：`current` 的兜底是 `filtered[0]`（没选过就默认展示第一个），
   * 于是"没选过"和"选了又取消"分不开 —— 取消后会被兜底立刻又填上。
   * 有了这一位，取消才能真正落到"右侧无展示"。
   */
  const [deselected, setDeselected] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [fKind, setFKind] = useState<VaultKind | 'all'>('all')
  const [fCourse, setFCourse] = useState<string | 'all' | 'none'>('all')
  const [loading, setLoading] = useState(true)
  const [persist, setPersist] = useState<boolean | null>(null)
  /** 允许上传的扩展名（后端给的）。选文件夹时按它前置过滤 ——
      文件夹里常混着 .exe/.dll/.DS_Store，不过滤会发一堆注定被拒的请求。 */
  const [allowed, setAllowed] = useState<Set<string>>(() => new Set())
  const fileRef = useRef<HTMLInputElement>(null)
  const dirRef = useRef<HTMLInputElement>(null)

  /* ---------------- 进入页面：从 IndexedDB 恢复 ---------------- */
  useEffect(() => {
    let alive = true
    ;(async () => {
      const ok = await store.available()
      if (!alive) return
      setPersist(ok)
      if (!ok) {
        setErr('连接不到服务器，请先启动后端（pnpm --filter campus-vault-server dev）')
        setLoading(false)
        return
      }
      try {
        const list = await store.loadAll('qbank')
        if (alive) setItems(list)
      } catch (e) {
        if (alive) setErr(errText(e))
      } finally {
        if (alive) setLoading(false)
      }
      // 允许上传的扩展名：选文件夹时按它前置过滤。
      // 拿不到也不影响单个文件上传（后端仍会把关），只是过滤失效。
      try {
        const d = await api.get<{ extensions: Record<string, string> }>('/files/allowed')
        if (alive) setAllowed(new Set(Object.keys(d.extensions)))
      } catch {
        /* 忽略 */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  /**
   * 上传文件（也支持整个文件夹）。
   *
   * 文件夹会带来三类麻烦，都在这里处理掉了：
   *  · 混着不支持的类型 —— 按后端白名单**前置过滤**，把跳过的数量报出来，
   *    而不是发几十个注定 400 的请求再刷一屏错误
   *  · 系统垃圾文件（.DS_Store / Thumbs.db / desktop.ini）—— 直接忽略
   *  · 子目录结构 —— 记进备注，否则「第一章/笔记.md」和「第二章/笔记.md」
   *    在列表里长得一模一样，分不出谁是谁
   */
  const addFiles = async (list: FileList | File[] | null) => {
    if (!list) return
    const all = Array.from(list)
    if (!all.length) return

    const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\.gitkeep)$/i
    const arr: File[] = []
    let skipped = 0

    // webkitRelativePath 只有从文件夹选择器来的文件才有值
    const isFolderUpload = all.some((f) =>
      ((f as File & { webkitRelativePath?: string }).webkitRelativePath ?? '').includes('/'),
    )

    for (const f of all) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
      if (JUNK.test(rel)) continue
      const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase()
      // 白名单还没加载回来时不拦，交给后端判断
      if (allowed.size && !allowed.has(ext)) {
        skipped++
        continue
      }
      arr.push(f)
    }

    if (!arr.length) {
      setErr(
        skipped
          ? `选中的 ${skipped} 个文件都不支持（支持 PDF / 图片 / Markdown / 代码 / 文本 / Office 等）`
          : '这个文件夹里没有可上传的文件',
      )
      if (fileRef.current) fileRef.current.value = ''
      if (dirRef.current) dirRef.current.value = ''
      return
    }

    setBusy(true)
    setErr(null)
    try {
      const got: VaultItem[] = []
      // 逐个上传：一个失败不影响其它，并把失败原因如实报出来
      const failed: string[] = []
      /* 这一次用户动作的批次键：整批文件共用它，服务端只记一次 push
         （热力图口径 = 一次上传算一次，不按文件数算）。 */
      const batchKey = store.newBatchKey()
      for (const f of arr) {
        try {
          const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || ''
          const dir = rel && rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
          // 传整个相对目录（如 数据结构作业/第一章）：
          // 列表按**第一段**分组就得到顶层文件夹条目，剩余层级作为子路径显示
          got.push(await store.upload(f, { ...(dir ? { folder: dir } : {}), batchKey }))
        } catch (e) {
          failed.push(`${f.name}：${errText(e)}`)
        }
      }
      if (got.length) {
        setItems((p) => [...got, ...p])
        /* 单个/少量文件上传时自动选中第一个，方便立刻查看。
           但**文件夹上传不能这么做** —— 选中会触发"自动展开"，
           文件夹一进来就是摊开的，等于没分组。 */
        if (!isFolderUpload) pick(got[0]!.id)
      }
      const msgs: string[] = []
      if (got.length) msgs.push(`已上传 ${got.length} 个文件`)
      if (skipped) msgs.push(`跳过 ${skipped} 个不支持的类型`)
      if (failed.length) msgs.push(failed.slice(0, 3).join('；') + (failed.length > 3 ? `…等 ${failed.length} 个失败` : ''))
      if (msgs.length > 1 || failed.length) setErr(msgs.join(' · '))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
      if (dirRef.current) dirRef.current.value = ''
    }
  }

  const delFile = (id: string) => {
    // 乐观更新：先从这个列表移除，失败再补回来
    const snapshot = items
    setItems((p) => p.filter((x) => x.id !== id))
    setPicked((cur) => (cur === id ? null : cur))
    void store.remove(id).catch((e) => {
      setItems(snapshot)
      setErr(`删除失败：${errText(e)}`)
    })
  }

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase()
    return items.filter((it) => {
      if (fKind !== 'all' && it.kind !== fKind) return false
      if (fCourse === 'none' && it.courseId) return false
      if (fCourse !== 'all' && fCourse !== 'none' && it.courseId !== fCourse) return false
      if (!k) return true
      return (
        it.name.toLowerCase().includes(k) ||
        it.note.toLowerCase().includes(k) ||
        // 也搜文件夹名：用户更可能记得「数据结构作业」而不是里面某个文件名
        (it.folder ?? '').toLowerCase().includes(k)
      )
    })
  }, [items, q, fKind, fCourse])

  /**
   * 按**顶层文件夹**分组。
   * 上传整个文件夹时不应该把几十个文件平铺出来 —— 那样等于没分类。
   * 分组键取 folder 的第一段，所以 `作业/第一章` 和 `作业/第二章` 归到同一个「作业」下。
   */
  const grouped = useMemo(() => {
    const loose: VaultItem[] = []
    const map = new Map<string, VaultItem[]>()
    for (const it of filtered) {
      const root = (it.folder ?? '').split('/')[0] || ''
      if (!root) {
        loose.push(it)
        continue
      }
      const list = map.get(root)
      if (list) list.push(it)
      else map.set(root, [it])
    }
    return {
      loose,
      folders: [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh')),
    }
  }, [filtered])

  /** 展开了哪些文件夹 */
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set())

  /** 清空确认弹窗 */
  const [clearOpen, setClearOpen] = useState(false)
  /** 成功提示。不复用 err —— 那个框是红色报错样式，用来报"已删除 N 个"语义不对 */
  const [notice, setNotice] = useState<string | null>(null)

  /**
   * 清空题库。
   * 不可逆的重操作，所以走 ConfirmDialog（带数量说明），不用行内两步确认 ——
   * 那种适合单条删除，不适合一次抹掉几十个文件。
   */
  const clearAll = async () => {
    setClearOpen(false)
    setBusy(true)
    setErr(null)
    try {
      const d = await store.clearAll('qbank')
      setItems([])
      setPicked(null)
      setDeselected(true)
      setOpenFolders(new Set())
      setNotice(`已清空题库，删除 ${d.removed} 个文件`)
      setTimeout(() => setNotice(null), 4000)
    } catch (e) {
      setErr(`清空失败：${errText(e)}`)
    } finally {
      setBusy(false)
    }
  }
  const toggleFolder = (name: string) =>
    setOpenFolders((s) => {
      const next = new Set(s)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  /** 当前展示的文件；主动取消选中后为 null，右侧回到空状态 */
  const current = deselected ? null : (items.find((x) => x.id === picked) ?? filtered[0] ?? null)

  /* 用户主动点选的文件如果藏在折叠的文件夹里，自动展开它 ——
     否则会出现"选中了但列表里看不到"。

     ⚠️ 必须用 picked（用户真的点过）而不是 current：
     current 有 `filtered[0]` 兜底、永远非空，用它的话
     任何一次列表刷新都会把文件夹展开，用户看到的仍是摊开的文件。 */
  useEffect(() => {
    if (!picked) return
    const it = items.find((x) => x.id === picked)
    const root = (it?.folder ?? '').split('/')[0]
    if (root) setOpenFolders((s) => (s.has(root) ? s : new Set(s).add(root)))
  }, [picked, items])

  /**
   * 点击左侧文件 —— **同一个动作完成选中与取消**。
   *  · 点别的文件：切过去，原来那条自动恢复原样（由 active 判定驱动）
   *  · 点已选中的那条：取消选中，右侧回到空状态
   * 比额外放一个 ✕ 更自然：不需要把鼠标移到另一处去"退出"。
   */
  const pick = (id: string) => {
    if (!deselected && current?.id === id) {
      setDeselected(true)
      return
    }
    setPicked(id)
    setDeselected(false)
  }

  const kindCounts = useMemo(() => {
    const m = new Map<VaultKind, number>()
    for (const it of items) m.set(it.kind, (m.get(it.kind) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [items])

  return (
    <div
      className="flex min-h-0 flex-col"
      style={mode === 'page' ? { height: '100%' } : { height: 'calc(100vh - 210px)', minHeight: 520 }}
    >
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* -------- 左：上传 + 筛选 + 列表 -------- */}
        <div className="flex min-h-0 flex-col">
          {/* 上传区 */}
          <div
            className="mat-clear mb-3 shrink-0 rounded-2xl p-3 transition"
            style={{
              borderColor: dragging ? 'rgba(255,179,107,.7)' : undefined,
              background: dragging ? 'rgba(255,179,107,.12)' : undefined,
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              void addFiles(e.dataTransfer.files)
            }}
          >
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="flex w-full items-center gap-2.5 rounded-xl border border-dashed border-white/22 px-3 py-3 text-left transition hover:border-white/40 hover:bg-white/6 disabled:opacity-50"
              aria-label="上传题库资料"
            >
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
                style={{ background: 'rgba(255,179,107,.2)', border: '1px solid rgba(255,179,107,.4)' }}
              >
                <IconUpload className="h-4 w-4 text-[rgb(255,179,107)]" />
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] text-white">{busy ? '正在读取…' : '上传题库资料'}</span>
                <span className="mt-0.5 block text-[10.5px] leading-snug text-white/55">
                  点这里选文件，或把文件（也可整个文件夹）拖进来
                  <br />
                  PDF / 图片 / Markdown / 代码 / 文本可站内查看
                </span>
              </span>
            </button>

            {/* 文件夹单独一个入口：浏览器的目录选择必须用 webkitdirectory，
                它和多选文件不能共用一个 input（设了它就只能选文件夹）。 */}
            <button
              onClick={() => dirRef.current?.click()}
              disabled={busy}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-[11.5px] text-ink-dim transition hover:border-white/28 hover:bg-white/10 hover:text-white disabled:opacity-50"
              aria-label="上传整个文件夹"
            >
              选择整个文件夹
              <span className="text-white/35">（会跳过不支持的类型）</span>
            </button>
            {/* 如实说明持久化的边界：存浏览器本地，不是后端 */}
            {persist === false && (
              <div className="mt-2 rounded-lg bg-[#ffc07a]/12 px-2.5 py-1.5 text-[10.5px] leading-snug text-[#ffc07a]">
                未连接后端，无法上传。请先启动服务端后刷新页面
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => void addFiles(e.target.files)}
              aria-label="选择题库文件"
            />
            {/* webkitdirectory 是 Chromium/Safari 的事实标准；Firefox 不支持，
                点了没反应 —— 所以它只是**补充入口**，主入口仍是上面那个 */}
            <input
              ref={dirRef}
              type="file"
              multiple
              // @ts-expect-error webkitdirectory 不在 React 的 input 类型里
              webkitdirectory=""
              directory=""
              className="hidden"
              onChange={(e) => void addFiles(e.target.files)}
              aria-label="选择题库文件夹"
            />

            {/* 清空题库。只在有文件时出现，且样式刻意低调 ——
                它不该像上传那样显眼，但必须找得到。 */}
            {!!items.length && persist !== false && (
              <button
                onClick={() => setClearOpen(true)}
                disabled={busy}
                className="mt-2 w-full rounded-xl px-3 py-1.5 text-[11px] text-rose-200/70 transition hover:bg-rose-400/10 hover:text-rose-100 disabled:opacity-40"
                aria-label="清空题库"
              >
                清空题库（{items.length} 个文件）
              </button>
            )}
          </div>

          {err && (
            <div
              className="mb-3 rounded-xl px-3 py-2 text-[11.5px]"
              style={{ background: 'rgba(255,120,120,.16)', color: '#ffb3b3' }}
              role="alert"
            >
              {err}
            </div>
          )}

          {notice && (
            <div
              className="mb-3 rounded-xl px-3 py-2 text-[11.5px]"
              style={{ background: 'rgba(126,214,190,.16)', color: '#bfeee0' }}
              role="status"
            >
              {notice}
            </div>
          )}

          {/* 搜索 + 筛选 */}
          <div className="mat-clear mb-3 shrink-0 rounded-2xl p-2.5">
            <label className="flex items-center gap-2 rounded-xl bg-white/6 px-2.5 py-1.5">
              <IconSearch className="h-3.5 w-3.5 shrink-0 text-white/50" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索文件名 / 备注…"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-white/40"
                aria-label="搜索题库文件"
              />
              {q && <GlassX onClick={() => setQ('')} label="清空搜索" size={18} />}
            </label>

            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                onClick={() => setFKind('all')}
                className="rounded-full px-2.5 py-1 text-[11px] transition"
                style={{
                  background: fKind === 'all' ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.06)',
                  color: fKind === 'all' ? '#fff' : 'rgba(255,255,255,.7)',
                }}
              >
                全部 {items.length}
              </button>
              {kindCounts.map(([k, n]) => (
                <button
                  key={k}
                  onClick={() => setFKind(fKind === k ? 'all' : k)}
                  className="rounded-full px-2.5 py-1 text-[11px] transition"
                  style={{
                    background: fKind === k ? `rgb(${kindRgb[k]} / .24)` : 'rgba(255,255,255,.06)',
                    color: fKind === k ? `rgb(${kindRgb[k]})` : 'rgba(255,255,255,.7)',
                  }}
                >
                  {kindLabel[k]} {n}
                </button>
              ))}
            </div>

            <select
              value={fCourse}
              onChange={(e) => setFCourse(e.target.value as typeof fCourse)}
              className="mt-2 w-full rounded-full bg-white/8 px-2.5 py-1 text-[11px] text-white/80 outline-none"
              aria-label="按课程筛选文件"
            >
              <option value="all">全部课程</option>
              {COURSES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="none">未归类</option>
            </select>
          </div>

          {/* 列表 */}
          <div
            className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1"
            style={{ maxHeight: '52vh' }}
          >
            <AnimatePresence initial={false}>
              {/* 散装文件：没有归属文件夹的，仍旧平铺 */}
              {grouped.loose.map((it) => (
                <RowWrap key={it.id}>
                  <FileRow
                    item={it}
                    active={current?.id === it.id}
                    courseName={COURSES.find((x) => x.id === it.courseId)?.name}
                    courseRgb={COURSES.find((x) => x.id === it.courseId)?.rgb}
                    onPick={() => pick(it.id)}
                    onDelete={() => delFile(it.id)}
                  />
                </RowWrap>
              ))}

              {/* 文件夹：一个可展开的条目，而不是把里面的文件摊开 */}
              {grouped.folders.map(([name, list]) => {
                const open = openFolders.has(name)
                return (
                  <div key={name} className="mt-1">
                    <button
                      onClick={() => toggleFolder(name)}
                      aria-label={`${open ? '收起' : '展开'}文件夹 ${name}`}
                      aria-expanded={open}
                      className="mb-1 flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left transition"
                      style={{
                        background: open ? 'rgb(143 178 255 / .12)' : 'rgb(255 255 255 / .05)',
                        border: `1px solid rgb(143 178 255 / ${open ? '.4' : '.18'})`,
                      }}
                    >
                      <span
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] text-white transition-transform"
                        style={{
                          background: 'rgb(143 178 255 / .22)',
                          transform: open ? 'rotate(90deg)' : 'none',
                        }}
                        aria-hidden
                      >
                        ▸
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-white" title={name}>
                        {name}
                      </span>
                      <span className="shrink-0 text-[10.5px] text-white/50">{list.length} 个文件</span>
                    </button>

                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.22, ease: EASE }}
                          style={{ overflow: 'hidden' }}
                        >
                          {/* 缩进一级，表示从属关系；子路径也显示出来，
                              否则「第一章/笔记.md」和「第二章/笔记.md」看着一模一样 */}
                          <div className="ml-3 border-l border-white/12 pl-2">
                            {list.map((it) => {
                              const sub = (it.folder ?? '').split('/').slice(1).join('/')
                              return (
                                <RowWrap key={it.id}>
                                  <FileRow
                                    item={it}
                                    active={current?.id === it.id}
                                    subPath={sub}
                                    onPick={() => pick(it.id)}
                                    onDelete={() => delFile(it.id)}
                                  />
                                </RowWrap>
                              )
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </AnimatePresence>

            {!items.length && (
              <div className="mat-clear rounded-2xl px-4 py-10 text-center text-[12px] leading-relaxed text-white/65">
                {loading ? (
                  '正在读取本地资料库…'
                ) : (
                  <>
                    题库还是空的
                    <br />
                    把课件、试卷、错题截图传进来
                  </>
                )}
              </div>
            )}
            {!!items.length && !filtered.length && (
              <div className="mat-clear rounded-2xl px-4 py-8 text-center text-[12px] text-white/65">
                没有匹配的文件
              </div>
            )}
          </div>
        </div>

        {/* -------- 右：查看器 -------- */}
        <div className="min-h-0">
          {current ? (
            <FileViewer item={current} />
          ) : (
            <div
              className="mat-clear spec grid h-full min-h-[320px] place-items-center rounded-3xl"
              /*
               纯 .mat-clear 太透 —— 这张壁纸在右侧正好是魔女的脸，
               文字直接压在五官上，很花。加一层薄暗底把干扰压下去：
               壁纸仍看得出是壁纸，但这里读起来是一块**有意留白的空状态**，
               而不是"什么都没渲染出来"。
              */
              style={{
                background:
                  'radial-gradient(120% 90% at 50% 45%, rgba(12,15,32,.58) 0%, rgba(12,15,32,.42) 55%, rgba(12,15,32,.3) 100%)',
              }}
            >
              <div className="max-w-[42ch] text-center">
                <span
                  className="mx-auto grid h-14 w-14 place-items-center rounded-2xl"
                  style={{ background: 'rgba(255,179,107,.16)', border: '1px solid rgba(255,179,107,.32)' }}
                >
                  <IconUpload className="h-6 w-6 text-[rgb(255,179,107)]" />
                </span>
                <div className="font-cn-title mt-4 text-[15px] font-semibold text-white">未打开任何文件</div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-white/72">
                  点左侧任意一条即可在这里查看 ——
                  PDF 用浏览器内置阅读器打开，图片直接显示，Markdown 与代码会渲染排版。
                </p>
                <p className="mt-3 text-[11.5px] text-white/50">
                  再点一次已选中的那条，即可收起预览
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 清空确认。不可逆操作单独一个关卡，并把"要删多少"写清楚 ——
          行内两步确认适合单条删除，不适合一次抹掉整个库。 */}
      <ConfirmDialog
        open={clearOpen}
        title="清空题库？"
        message={`将删除题库里的全部 ${items.length} 个文件，包括它们在本机磁盘上的副本。`}
        detail="文件夹里的文件也会一起删除。此操作不可撤销。"
        confirmText={`删除全部 ${items.length} 个`}
        onConfirm={() => void clearAll()}
        onCancel={() => setClearOpen(false)}
      />
    </div>
  )
}
